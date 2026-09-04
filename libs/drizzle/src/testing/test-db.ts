import { Logger } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'

import { DrizzleCredentials } from '../drizzle.types'
import { migrateDb } from '../utils'

/** Reads `TEST_DB_*` env vars, falling back to the defaults of this repo's `docker-compose.yml`. */
export function getTestDbCredentials(): DrizzleCredentials {
	return {
		host: process.env.TEST_DB_HOST ?? 'localhost',
		port: parseInt(process.env.TEST_DB_PORT ?? '5432'),
		user: process.env.TEST_DB_USER ?? 'postgres',
		password: process.env.TEST_DB_PASSWORD ?? 'postgres',
		database: process.env.TEST_DB_NAME ?? 'test',
	}
}

/**
 * Drops and recreates `credentials.database`, terminating any other connections to it first.
 * Intended for one-time test-database setup (e.g. a Jest global setup), not per-test.
 *
 * `credentials` defaults to `getTestDbCredentials()` - the common case is one main test
 * database, so most callers can just omit it.
 */
export async function dropAndCreateTestDb(credentials: DrizzleCredentials = getTestDbCredentials()) {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentials.database))
		throw new Error(`Unsafe database name: "${credentials.database}"`)

	const client = new Client({ ...credentials, database: 'postgres' })
	await client.connect()

	try {
		await client.query(
			'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
			[credentials.database],
		)
		await client.query(`DROP DATABASE IF EXISTS "${credentials.database}"`)
		await client.query(`CREATE DATABASE "${credentials.database}"`)
	} finally {
		await client.end()
	}
}

/**
 * Thin convenience wrapper over `migrateDb()` for test-database setup. `credentials` defaults to
 * `getTestDbCredentials()`, same as `dropAndCreateTestDb()`. `migrationLockKey` is required for
 * the same reason it's required on `migrateDb()` - see there.
 */
export async function migrateTestDb({ credentials = getTestDbCredentials(), migrationsPath, migrationLockKey }: {
	credentials?: DrizzleCredentials
	migrationsPath: string
	migrationLockKey: number
}) {
	await migrateDb({ logger: new Logger('TestMigration'), credentials, migrationsPath, migrationLockKey })
}

/** Postgres identifier quoting - doubles embedded double-quotes, same as the server's own quote_ident(). */
function quoteIdent(ident: string): string {
	return `"${ident.replace(/"/g, '""')}"`
}

/**
 * Truncates every table in the given Postgres schemas (`public` by default) between tests.
 * `CASCADE` handles FK ordering and `RESTART IDENTITY` resets serials, so tests don't depend on ID
 * values from a previous run.
 *
 * Issues a single `TRUNCATE TABLE` for every matched table instead of one statement per table, so
 * this stays cheap to call from every test's `beforeEach`/`afterEach`.
 */
export async function truncateTestDb(db: NodePgDatabase<Record<string, unknown>>, schemas: string[] = ['public']) {
	const { rows } = await db.execute<{ schemaname: string, tablename: string }>(
		sql`SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN (${sql.join(schemas.map(s => sql`${s}`), sql`, `)})`,
	)
	if (rows.length === 0) return

	const tableList = rows.map(r => `${quoteIdent(r.schemaname)}.${quoteIdent(r.tablename)}`).join(', ')
	await db.execute(sql.raw(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`))
}
