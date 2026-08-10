import { Logger } from '@nestjs/common'
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import * as path from 'path'
import { Client, Pool } from 'pg'

import { DrizzleCredentials } from './drizzle.types'

/** Opens a pooled connection and returns a `drizzle-orm` instance typed to `schema`. */
export async function getDb<Schema extends Record<string, unknown>>({ credentials, schema }: {
	credentials: DrizzleCredentials
	schema: Schema
}) {
	const pool = new Pool({
		host: credentials.host,
		port: credentials.port,
		user: credentials.user,
		password: credentials.password,
		database: credentials.database,
		max: credentials.pool || 4,
	})

	await pool.connect()

	return drizzle(pool, { schema }) as NodePgDatabase<Schema>
}

const MIGRATION_MAX_ATTEMPTS = 5
const MIGRATION_RETRY_BASE_DELAY_MS = 2_000
const MIGRATION_RETRY_MAX_DELAY_MS = 30_000

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Runs drizzle-kit-generated migrations from `migrationsPath` against `credentials`.
 *
 * Safe to call from every instance on startup when multiple instances boot against the same
 * database: coordination uses a Postgres session-level advisory lock, so only the lock holder
 * migrates while everyone else blocks on `pg_advisory_lock` until it's released - no polling
 * needed. The lock is tied to the connection, so a crashed/killed process releases it
 * automatically. On failure (e.g. an infrastructure blip, not a SQL error) the lock is released
 * and the attempt retried with backoff, which re-queues this instance behind any other instance
 * already waiting rather than monopolizing the retry.
 */
export async function migrateDb({ logger, credentials, migrationsPath, migrationLockKey }: {
	logger: Logger
	credentials: DrizzleCredentials
	/** Absolute path, or relative to the caller's compiled output, to the drizzle-kit migrations folder. */
	migrationsPath: string
	/**
	 * Stable numeric key for the session-level Postgres advisory lock that coordinates concurrent
	 * callers - deliberately required, not defaulted, since it decides who waits for whom. Use
	 * the *same* key across every instance migrating the *same* migration set against the same
	 * database, so they queue behind each other instead of racing. Use a *different* key for any
	 * other, unrelated migration set that might run against that database, so the two don't
	 * needlessly block on each other.
	 */
	migrationLockKey: number
}) {
	const client = new Client({
		host: credentials.host,
		port: credentials.port,
		user: credentials.user,
		password: credentials.password,
		database: credentials.database,
	})
	await client.connect()

	try {
		const migrationsFolder = path.isAbsolute(migrationsPath)
			? migrationsPath
			: path.resolve(process.cwd(), migrationsPath)

		let lastError: unknown
		for (let attempt = 1; attempt <= MIGRATION_MAX_ATTEMPTS; attempt++) {
			logger.log(`[Drizzle] waiting for migration lock (attempt ${attempt}/${MIGRATION_MAX_ATTEMPTS})`)
			await client.query('SELECT pg_advisory_lock($1)', [migrationLockKey])
			try {
				logger.log('[Drizzle] migrating')
				await migrate(drizzle(client), { migrationsFolder })
				logger.log('[Drizzle] migration done')
				return
			} catch (err) {
				lastError = err
				logger.error(`[Drizzle] migration attempt ${attempt} failed`, err instanceof Error ? err.stack : String(err))
			} finally {
				await client.query('SELECT pg_advisory_unlock($1)', [migrationLockKey])
			}

			if (attempt < MIGRATION_MAX_ATTEMPTS) {
				const delay = Math.min(MIGRATION_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MIGRATION_RETRY_MAX_DELAY_MS)
				logger.warn(`[Drizzle] retrying migration in ${delay}ms`)
				await sleep(delay)
			}
		}
		throw lastError
	} finally {
		await client.end()
	}
}

/** Postgres error codes (`error.code` on exceptions thrown by `pg`/`drizzle-orm`) worth branching on. */
export const PostgresErrorCode = {
	UniqueViolation: '23505',
} as const
