import { Injectable } from '@nestjs/common'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import { DrizzleCredentials } from './drizzle.types'
import { getDb } from './utils'

export interface DrizzleProviderConfig<Schema extends Record<string, unknown>> {
	credentials: DrizzleCredentials
	schema: Schema
}

/**
 * Injectable by type - `constructor(private db: DrizzleProvider<typeof schema>) {}` - no DI
 * token needed. Connects lazily on `onApplicationBootstrap()`, once Nest has finished wiring the
 * module graph, so `main` is only safe to read from `onApplicationBootstrap()` onward - not from
 * your own services' `onModuleInit()`, which runs earlier.
 *
 * This covers a single connection named `main`. Want a different name, or more than one
 * connection (a second database, a read replica, ...)? Copy this class - it's a handful of lines
 * - and add one property + one `getDb()` call per connection in `onApplicationBootstrap()`. See
 * the README's "Schema registration" section.
 */
@Injectable()
export class DrizzleProvider<Schema extends Record<string, unknown> = Record<string, unknown>> {
	main!: NodePgDatabase<Schema>

	constructor(private config: DrizzleProviderConfig<Schema>) {}

	async onApplicationBootstrap() {
		this.main = await getDb(this.config)
	}
}
