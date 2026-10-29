import { Logger } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { closeDb, getDb } from '../utils'
import { getTestDbCredentials } from './test-db'
import { truncateTestDb } from './truncate-test-db'

// Own throwaway schemas, so the FK graph under test is fixed by this file.
const EMPTIED = 'truncate_spec'
const REFERENCING = 'truncate_spec_ref'
const RESTRICTED_ROLE = 'truncate_spec_role'

type Db = NodePgDatabase<Record<string, unknown>>

async function seed(db: Db) {
	await db.execute(sql.raw(`
		INSERT INTO ${EMPTIED}.parent DEFAULT VALUES;
		INSERT INTO ${EMPTIED}.parent DEFAULT VALUES;
		INSERT INTO ${REFERENCING}.child (parent_id) VALUES (2);
		INSERT INTO ${REFERENCING}.grandchild (child_id) VALUES (1);
		INSERT INTO ${REFERENCING}.unrelated (note) VALUES ('kept');
	`))
}

async function expectEmptiedAndRestarted(db: Db) {
	const { rows: [counts] } = await db.execute<Record<string, number>>(sql.raw(`
		SELECT
			(SELECT count(*)::int FROM ${EMPTIED}.parent) AS parent,
			(SELECT count(*)::int FROM ${REFERENCING}.child) AS child,
			(SELECT count(*)::int FROM ${REFERENCING}.grandchild) AS grandchild,
			(SELECT count(*)::int FROM ${REFERENCING}.unrelated) AS unrelated
	`))
	expect(counts).toEqual({ parent: 0, child: 0, grandchild: 0, unrelated: 1 })

	const { rows: [parent] } = await db.execute<{ id: number }>(sql.raw(`INSERT INTO ${EMPTIED}.parent DEFAULT VALUES RETURNING id`))
	const { rows: [child] } = await db.execute<{ id: number }>(sql.raw(`INSERT INTO ${REFERENCING}.child (parent_id) VALUES (1) RETURNING id`))
	expect({ parent: parent?.id, child: child?.id }).toEqual({ parent: 1, child: 1 })
}

describe('truncateTestDb', () => {
	let db: Db

	beforeAll(async () => {
		db = await getDb({ credentials: getTestDbCredentials(), schema: {} })
	})

	beforeEach(async () => {
		await db.execute(sql.raw(`
			DROP SCHEMA IF EXISTS ${EMPTIED}, ${REFERENCING} CASCADE;
			CREATE SCHEMA ${EMPTIED};
			CREATE SCHEMA ${REFERENCING};
			CREATE TABLE ${EMPTIED}.parent (id serial PRIMARY KEY);
			CREATE TABLE ${REFERENCING}.child (
				id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				parent_id integer NOT NULL REFERENCES ${EMPTIED}.parent (id)
			);
			CREATE TABLE ${REFERENCING}.grandchild (child_id integer NOT NULL REFERENCES ${REFERENCING}.child (id));
			CREATE TABLE ${REFERENCING}.unrelated (note text NOT NULL);
		`))
	})

	afterAll(async () => {
		await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${EMPTIED}, ${REFERENCING} CASCADE`))
		await closeDb(db)
	})

	it('empties the schema plus every table referencing it transitively, and restarts their sequences', async () => {
		await seed(db)

		await truncateTestDb(db, [EMPTIED])

		await expectEmptiedAndRestarted(db)
	})

	it('does not cache a failed statement build', async () => {
		const failing = await getDb({ credentials: getTestDbCredentials(), schema: {} })
		try {
			const execute = jest.spyOn(failing, 'execute').mockRejectedValueOnce(new Error('transient'))
			await expect(truncateTestDb(failing, [EMPTIED])).rejects.toThrow('transient')
			execute.mockRestore()

			await seed(failing)
			await truncateTestDb(failing, [EMPTIED])
			await expectEmptiedAndRestarted(failing)
		} finally {
			await closeDb(failing)
		}
	})

	it('falls back to TRUNCATE when the role may not set session_replication_role', async () => {
		const credentials = getTestDbCredentials()
		// Owns the tables (and with them their sequences), like a role that ran the migrations itself -
		// TRUNCATE ... RESTART IDENTITY needs that.
		await db.execute(sql.raw(`
			DROP ROLE IF EXISTS ${RESTRICTED_ROLE};
			CREATE ROLE ${RESTRICTED_ROLE} LOGIN PASSWORD '${RESTRICTED_ROLE}';
			GRANT USAGE ON SCHEMA ${EMPTIED}, ${REFERENCING} TO ${RESTRICTED_ROLE};
			ALTER TABLE ${EMPTIED}.parent OWNER TO ${RESTRICTED_ROLE};
			ALTER TABLE ${REFERENCING}.child OWNER TO ${RESTRICTED_ROLE};
			ALTER TABLE ${REFERENCING}.grandchild OWNER TO ${RESTRICTED_ROLE};
			ALTER TABLE ${REFERENCING}.unrelated OWNER TO ${RESTRICTED_ROLE};
		`))
		const restricted = await getDb({
			credentials: { ...credentials, user: RESTRICTED_ROLE, password: RESTRICTED_ROLE },
			schema: {},
		})
		const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

		try {
			await seed(restricted)
			await truncateTestDb(restricted, [EMPTIED])
			await expectEmptiedAndRestarted(restricted)
			expect(warn).toHaveBeenCalledTimes(1)

			// Later calls go straight to TRUNCATE, without another failed attempt or warning.
			await truncateTestDb(restricted, [EMPTIED])
			expect(warn).toHaveBeenCalledTimes(1)
		} finally {
			warn.mockRestore()
			await closeDb(restricted)
			await db.execute(sql.raw(`
				DROP OWNED BY ${RESTRICTED_ROLE};
				DROP ROLE ${RESTRICTED_ROLE};
			`))
		}
	})
})
