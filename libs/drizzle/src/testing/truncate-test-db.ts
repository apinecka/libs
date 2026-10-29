import { Logger } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { PostgresErrorCode } from '../utils'

type Db = NodePgDatabase<Record<string, unknown>>

interface CleanupStatements {
	/** DELETE of every affected table with FK triggers off, plus a sequence reset - the fast path. */
	delete: string
	/** `TRUNCATE ... RESTART IDENTITY CASCADE` of the same tables - for roles that can't set `session_replication_role`. */
	truncate: string
}

interface DbCleanupState {
	statements: Map<string, Promise<CleanupStatements | null>>
	/** Set once the fast path failed on privileges, so every later call goes straight to TRUNCATE. */
	truncateOnly: boolean
}

// Keyed by the db instance, since the statements carry table and sequence names of that database.
const cleanupState = new WeakMap<Db, DbCleanupState>()

const logger = new Logger('TruncateTestDb')

/** Postgres identifier quoting - doubles embedded double-quotes, same as the server's own quote_ident(). */
function quoteIdent(ident: string): string {
	return `"${ident.replace(/"/g, '""')}"`
}

/** Postgres string literal quoting, for the regclass names handed to setval(). */
function quoteLiteral(value: string): string {
	return `'${value.replace(/'/g, '\'\'')}'`
}

/** `pg` errors carry `code` directly, drizzle-orm wraps them in an error with the original as `cause`. */
function errorCode(err: unknown): string | undefined {
	const e = err as { code?: unknown, cause?: { code?: unknown } } | undefined
	const code = e?.code ?? e?.cause?.code
	return typeof code === 'string' ? code : undefined
}

/**
 * Empties every table in the given Postgres schemas (`public` by default) between tests, with the
 * same effect as `TRUNCATE <every table in schemas> RESTART IDENTITY CASCADE`: rows are gone and
 * serial/identity sequences start over, so tests don't depend on ID values from a previous test.
 * Cheap enough for every test's `beforeEach` - a few tens of ms even for 100+ tables.
 *
 * TRUNCATE has a fixed cost per relation (it swaps in new files and WAL-logs that), so it takes
 * ~200 ms per call even on empty tables. This runs DELETE instead, under
 * `session_replication_role = replica`, so the FK triggers don't fire and the statement order
 * doesn't matter. Because that also skips the FK cascades, the set of tables to empty is computed
 * up front: every table in `schemas`, plus every table in any schema that references one of them,
 * directly or transitively - the same set TRUNCATE ... CASCADE empties. Sequences owned by those
 * tables are reset to their start value, the same as RESTART IDENTITY.
 *
 * Setting `session_replication_role` needs a superuser, or from Postgres 15 on a `SET` privilege
 * granted on it. Without that, the first call logs a warning and from then on falls back to
 * TRUNCATE - correct, just slow.
 *
 * The statement is built once per db instance and schema list, so pass a narrower `schemas` list
 * when a spec file only touches tables in one schema.
 */
export async function truncateTestDb(db: Db, schemas: string[] = ['public']) {
	let state = cleanupState.get(db)
	if (!state) {
		state = { statements: new Map(), truncateOnly: false }
		cleanupState.set(db, state)
	}

	const key = [...schemas].sort().join(',')
	let pending = state.statements.get(key)
	if (!pending) {
		const { statements } = state
		pending = buildCleanupStatements(db, schemas).catch((err: unknown) => {
			// Don't cache a failure - one transient error would otherwise fail every later test.
			statements.delete(key)
			throw err
		})
		statements.set(key, pending)
	}

	const resolved = await pending
	if (!resolved) return

	if (state.truncateOnly) {
		await db.execute(sql.raw(resolved.truncate))
		return
	}

	try {
		await db.execute(sql.raw(resolved.delete))
	} catch (err) {
		if (errorCode(err) !== PostgresErrorCode.InsufficientPrivilege) throw err

		state.truncateOnly = true
		logger.warn(
			'Not allowed to set session_replication_role, falling back to the slower TRUNCATE. Run the tests as a '
			+ 'superuser, or on Postgres 15+ GRANT SET ON PARAMETER session_replication_role TO <test role>.',
		)
		await db.execute(sql.raw(resolved.truncate))
	}
}

async function buildCleanupStatements(db: Db, schemas: string[]): Promise<CleanupStatements | null> {
	if (schemas.length === 0) return null

	const { rows: tables } = await db.execute<{ oid: string, schemaname: string, tablename: string }>(sql`
		WITH RECURSIVE affected(oid) AS (
			SELECT c.oid
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE c.relkind IN ('r', 'p') AND n.nspname IN (${sql.join(schemas.map(s => sql`${s}`), sql`, `)})
			UNION
			SELECT con.conrelid
			FROM pg_constraint con
			JOIN affected a ON a.oid = con.confrelid
			WHERE con.contype = 'f'
		)
		SELECT c.oid::text AS oid, n.nspname AS schemaname, c.relname AS tablename
		FROM affected a
		JOIN pg_class c ON c.oid = a.oid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE NOT c.relispartition
	`)
	if (tables.length === 0) return null

	const { rows: sequences } = await db.execute<{ sequence: string, startValue: string }>(sql`
		SELECT format('%I.%I', s.schemaname, s.sequencename) AS sequence, s.start_value::text AS "startValue"
		FROM pg_sequences s
		JOIN pg_class sc ON sc.relname = s.sequencename
		JOIN pg_namespace sn ON sn.oid = sc.relnamespace AND sn.nspname = s.schemaname
		JOIN pg_depend d ON d.objid = sc.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
		WHERE d.refobjid::text IN (${sql.join(tables.map(t => sql`${t.oid}`), sql`, `)})
	`)

	const tableNames = tables.map(t => `${quoteIdent(t.schemaname)}.${quoteIdent(t.tablename)}`)

	return {
		// One simple-protocol query runs as one implicit transaction, so SET LOCAL ends with it and a
		// failure can't leave a pooled connection in replica mode or inside an open transaction.
		// BEGIN/COMMIT are deliberately absent for the same reason.
		delete: [
			'SET LOCAL session_replication_role = replica',
			...tableNames.map(t => `DELETE FROM ${t}`),
			...sequences.map(s => `SELECT setval(${quoteLiteral(s.sequence)}, ${s.startValue}, false)`),
		].join(';\n'),
		truncate: `TRUNCATE TABLE ${tableNames.join(', ')} RESTART IDENTITY CASCADE`,
	}
}
