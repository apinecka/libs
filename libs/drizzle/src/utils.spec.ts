import { Logger } from '@nestjs/common'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

import { getTestDbCredentials } from './testing'
import { migrateDb } from './utils'

jest.mock('drizzle-orm/node-postgres', () => ({
	drizzle: jest.fn(),
}))

jest.mock('drizzle-orm/node-postgres/migrator', () => ({
	migrate: jest.fn(),
}))

const mockMigrate = migrate as jest.Mock

const migrationLockKey = 72_793_114

describe('migrateDb', () => {
	const logger = new Logger()
	const credentials = getTestDbCredentials()

	beforeEach(() => {
		jest.clearAllMocks()
	})

	function callMigrateDb() {
		return migrateDb({ logger, credentials, migrationsPath: '/unused', migrationLockKey })
	}

	async function withInstantBackoff<T>(fn: () => Promise<T>) {
		const spy = jest.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
			cb()
			return 0 as unknown as NodeJS.Timeout
		}) as typeof setTimeout)
		try {
			return await fn()
		} finally {
			spy.mockRestore()
		}
	}

	async function isLockFree() {
		const client = new Client(credentials)
		await client.connect()
		try {
			const { rows } = await client.query('SELECT pg_try_advisory_lock($1) as acquired', [migrationLockKey])
			if (rows[0].acquired) await client.query('SELECT pg_advisory_unlock($1)', [migrationLockKey])
			return rows[0].acquired as boolean
		} finally {
			await client.end()
		}
	}

	it('acquires and releases the advisory lock around a successful migration', async () => {
		mockMigrate.mockResolvedValueOnce(undefined)

		await callMigrateDb()

		expect(mockMigrate).toHaveBeenCalledTimes(1)
		expect(await isLockFree()).toBe(true)
	})

	it('releases the lock after a failed attempt and lets the retry succeed', async () => {
		mockMigrate.mockRejectedValueOnce(new Error('infra blip')).mockResolvedValueOnce(undefined)

		await withInstantBackoff(callMigrateDb)

		expect(mockMigrate).toHaveBeenCalledTimes(2)
		expect(await isLockFree()).toBe(true)
	})

	it('releases the lock even after exhausting all retries and propagates the last error', async () => {
		const error = new Error('persistent infra failure')
		mockMigrate.mockRejectedValue(error)

		await expect(withInstantBackoff(callMigrateDb)).rejects.toThrow(error)

		expect(mockMigrate).toHaveBeenCalledTimes(5)
		expect(await isLockFree()).toBe(true)
	})

	it('blocks a concurrent caller until the lock holder releases it', async () => {
		const holder = new Client(credentials)
		await holder.connect()
		await holder.query('SELECT pg_advisory_lock($1)', [migrationLockKey])

		let migrated = false
		mockMigrate.mockImplementation(() => {
			migrated = true
		})
		const waiterPromise = callMigrateDb()

		await new Promise(resolve => setTimeout(resolve, 300))
		expect(migrated).toBe(false)

		await holder.query('SELECT pg_advisory_unlock($1)', [migrationLockKey])
		await holder.end()

		await waiterPromise
		expect(migrated).toBe(true)
	})
})
