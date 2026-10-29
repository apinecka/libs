import { sql } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

/**
 * Opens `connections` pooled connections and leaves them idle, so that calls a concurrency test
 * starts together really overlap. The pool connects lazily, and connecting a second client takes
 * long enough for the first call's transaction to commit before the second one even reads - a race
 * test then passes with its lock removed. Call it right before the `Promise.all()` of the race.
 *
 * `connections` can't usefully exceed the pool size (`credentials.pool`, 4 by default).
 */
export async function warmTestDbPool(db: NodePgDatabase<Record<string, unknown>>, connections = 2): Promise<void> {
	await Promise.all(Array.from({ length: connections }, () => db.execute(sql`SELECT pg_sleep(0.01)`)))
}
