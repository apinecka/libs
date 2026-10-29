import { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { closeDb, getDb } from '../utils'
import { getTestDbCredentials } from './test-db'
import { warmTestDbPool } from './warm-test-db-pool'

describe('warmTestDbPool', () => {
	let db: NodePgDatabase<Record<string, unknown>>

	beforeAll(async () => {
		db = await getDb({ credentials: { ...getTestDbCredentials(), pool: 4 }, schema: {} })
	})

	afterAll(async () => {
		await closeDb(db)
	})

	it('leaves the requested number of connections open and idle', async () => {
		const pool = (db as unknown as { $client: Pool }).$client

		await warmTestDbPool(db, 3)

		expect({ total: pool.totalCount, idle: pool.idleCount }).toEqual({ total: 3, idle: 3 })
	})
})
