import 'reflect-metadata'

import { DynamicModule, Injectable, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { sql } from 'drizzle-orm'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { DrizzleModule } from './drizzle.module'
import { DrizzleProvider } from './drizzle.provider'
import { DrizzleCredentials } from './drizzle.types'
import { getTestDbCredentials } from './testing'
import { getDb } from './utils'

const schema = {}

async function query(db: NodePgDatabase<typeof schema>) {
	const result = await db.execute(sql`SELECT 1 as value`)
	return result.rows[0]
}

describe('DrizzleModule', () => {
	it('connects the default DrizzleProvider under `main` and injects it by type', async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [DrizzleModule.forRoot({ credentials: getTestDbCredentials(), schema })],
		}).compile()
		await moduleRef.init()

		try {
			const provider = moduleRef.get(DrizzleProvider)
			expect(await query(provider.main)).toEqual({ value: 1 })
		} finally {
			await moduleRef.close()
		}
	})

	it('supports a custom provider with a differently named connection', async () => {
		@Injectable()
		class PrimaryDbProvider {
			primary!: NodePgDatabase<typeof schema>

			constructor(private config: { credentials: DrizzleCredentials; schema: typeof schema }) {}

			async onApplicationBootstrap() {
				this.primary = await getDb(this.config)
			}
		}

		const moduleRef = await Test.createTestingModule({
			imports: [DrizzleModule.forRoot({ credentials: getTestDbCredentials(), schema, provider: PrimaryDbProvider })],
		}).compile()
		await moduleRef.init()

		try {
			const provider = moduleRef.get(PrimaryDbProvider)
			expect(await query(provider.primary)).toEqual({ value: 1 })
		} finally {
			await moduleRef.close()
		}
	})

	it('supports the README multi-connection pattern: one hand-rolled provider, several named connections', async () => {
		interface DbProviderConfig {
			main: DrizzleCredentials
			mainReadOnly: DrizzleCredentials
			logs: DrizzleCredentials
		}

		@Injectable()
		class DbProvider {
			main!: NodePgDatabase<typeof schema>
			mainReadOnly!: NodePgDatabase<typeof schema>
			logs!: NodePgDatabase<typeof schema>

			constructor(private config: DbProviderConfig) {}

			async onApplicationBootstrap() {
				this.main = await getDb({ credentials: this.config.main, schema })
				this.mainReadOnly = await getDb({ credentials: this.config.mainReadOnly, schema })
				this.logs = await getDb({ credentials: this.config.logs, schema })
			}
		}

		@Module({})
		class DbModule {
			static forRoot(config: DbProviderConfig): DynamicModule {
				return {
					module: DbModule,
					providers: [{ provide: DbProvider, useFactory: () => new DbProvider(config) }],
					exports: [DbProvider],
					global: true,
				}
			}
		}

		const credentials = getTestDbCredentials()
		const moduleRef = await Test.createTestingModule({
			imports: [DbModule.forRoot({ main: credentials, mainReadOnly: credentials, logs: credentials })],
		}).compile()
		await moduleRef.init()

		try {
			const provider = moduleRef.get(DbProvider)
			expect(await query(provider.main)).toEqual({ value: 1 })
			expect(await query(provider.mainReadOnly)).toEqual({ value: 1 })
			expect(await query(provider.logs)).toEqual({ value: 1 })
			expect(provider.main).not.toBe(provider.mainReadOnly)
		} finally {
			await moduleRef.close()
		}
	})
})
