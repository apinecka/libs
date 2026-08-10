import { DynamicModule, Module } from '@nestjs/common'

import { DrizzleProvider, DrizzleProviderConfig } from './drizzle.provider'

/** Any class constructible from `{ credentials, schema }` - deliberately not constrained to `DrizzleProvider`'s shape, since the point of `provider` is to let you expose the connection under a different property name. */
export type DrizzleProviderClass<Schema extends Record<string, unknown>> = new (config: DrizzleProviderConfig<Schema>) => unknown

export interface DrizzleModuleOptions<Schema extends Record<string, unknown>> extends DrizzleProviderConfig<Schema> {
	/** Your own provider class, if you want the connection under a different property name than `main`. Defaults to `DrizzleProvider` itself. */
	provider?: DrizzleProviderClass<Schema>
}

/**
 * Generic NestJS wrapper around a single `drizzle-orm` + `node-postgres` connection.
 *
 * This module has no opinion on your schema - it only wires up a `DrizzleProvider` (or your own
 * provider of the same shape) with Nest's DI. Apps are expected to write their own schema with
 * `drizzle-orm`/`drizzle-kit` - see the README's "Schema registration" section for the pattern,
 * including how to handle more than one connection.
 */
@Module({})
export class DrizzleModule {
	static forRoot<Schema extends Record<string, unknown>>(options: DrizzleModuleOptions<Schema>): DynamicModule {
		const provider = options.provider ?? DrizzleProvider

		return {
			module: DrizzleModule,
			providers: [
				{
					provide: provider,
					useFactory: () => new provider({ credentials: options.credentials, schema: options.schema }),
				},
			],
			exports: [provider],
			global: true,
		}
	}
}
