# @apinecka/drizzle

NestJS module for [`drizzle-orm`](https://www.npmjs.com/package/drizzle-orm) over Postgres
(via [`pg`](https://www.npmjs.com/package/pg)): a DI-friendly connection wrapper
(`DrizzleModule`), a lock-coordinated migration runner (`migrateDb`), and test-database helpers.

This package ships **no schema**. You write your Drizzle schema and migrations the normal way
(`drizzle-kit`) and register them with `DrizzleModule` yourself - see
[Schema registration](#schema-registration) below.

## Install

```bash
npm install @apinecka/drizzle drizzle-orm pg @nestjs/common
```

## Usage

```ts
import { DrizzleModule } from '@apinecka/drizzle'
import * as schema from './schema'

@Module({
	imports: [
		DrizzleModule.forRoot({
			credentials: { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres', database: 'app' },
			schema,
		}),
	],
})
export class AppModule {}
```

```ts
import { DrizzleProvider } from '@apinecka/drizzle'
import * as schema from './schema'

@Injectable()
export class UsersService {
	constructor(private db: DrizzleProvider<typeof schema>) {}

	findAll() {
		return this.db.main.select().from(schema.users)
	}
}
```

`DrizzleProvider` is injectable by type - no `@Inject()` decorator or DI token needed. It exposes
a single connection under `main`, populated once Nest calls `onApplicationBootstrap()` during
startup - so don't read it from your own services' constructors or `onModuleInit()`, which run
earlier.

It also ends its connection pool for you on `onModuleDestroy()`, which Nest calls automatically
when the app (or a `TestingModule`) is closed - `app.close()` in production (paired with
`app.enableShutdownHooks()` to run it on `SIGTERM`/`SIGINT` too), `moduleRef.close()` in tests. No
manual cleanup needed; call `provider.close()` directly only if you need to end the pool without
tearing down the whole module.

## Schema registration

`DrizzleProvider` deliberately stays a single, small class: one connection named `main`. You're
not meant to configure it further - copy it instead. It's a handful of lines, and copying keeps
every app's DB wiring equally easy to read instead of hiding behind options.

**Want the connection under a different name than `main`?** Write your own provider (matching
`DrizzleProvider`'s constructor) and pass it to `forRoot()`:

```ts
// db.provider.ts
import { closeDb, DrizzleCredentials, getDb } from '@apinecka/drizzle'
import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from './schema'

@Injectable()
export class DbProvider implements OnModuleDestroy {
	primary!: NodePgDatabase<typeof schema>

	constructor(private config: { credentials: DrizzleCredentials; schema: typeof schema }) {}

	async onApplicationBootstrap() {
		this.primary = await getDb(this.config)
	}

	async onModuleDestroy() {
		await closeDb(this.primary)
	}
}
```

```ts
// app.module.ts
import { DrizzleModule } from '@apinecka/drizzle'

import { DbProvider } from './db.provider'
import * as schema from './schema'

@Module({
	imports: [DrizzleModule.forRoot({ credentials, schema, provider: DbProvider })],
})
export class AppModule {}
```

Your own provider is responsible for its own cleanup, same as `DrizzleProvider` - `getDb()`'s
result carries its underlying `pg` `Pool` as `$client`, and `closeDb()` is just `db.$client.end()`.

**Need more than one database** (a second, unrelated database, or a read-only replica)? Copy
`DrizzleProvider` and add one property + one `getDb()` call per connection in
`onApplicationBootstrap()` - `DrizzleModule.forRoot()` won't fit anymore since it only wires up a
single `{ credentials, schema }`, so pair it with your own tiny module too (copied from
`DrizzleModule`):

```ts
// db.provider.ts
import { DrizzleCredentials, getDb } from '@apinecka/drizzle'
import { Injectable } from '@nestjs/common'
import { NodePgDatabase } from 'drizzle-orm/node-postgres'

import * as schema from './schema'

export interface DbProviderConfig {
	main: DrizzleCredentials
	mainReadOnly: DrizzleCredentials
	logs: DrizzleCredentials
}

@Injectable()
export class DbProvider {
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
```

```ts
// db.module.ts
import { DynamicModule, Module } from '@nestjs/common'

import { DbProvider, DbProviderConfig } from './db.provider'

@Module({})
export class DbModule {
	static forRoot(config: DbProviderConfig): DynamicModule {
		return {
			module: DbModule,
			providers: [{ provide: DbProvider, useFactory: () => new DbProvider(config) }],
			exports: [DbProvider],
			global: true,
		}
	}
}
```

```ts
@Injectable()
export class UsersService {
	constructor(private db: DbProvider) {}

	findAll() {
		return this.db.main.select().from(schema.users)
	}
}
```

## Migrations

### Generating a migration

Migrations are generated by the `drizzle-kit` CLI from your schema - install it as a dev
dependency (`npm install -D drizzle-kit`) and give it its own config, separate from anything in
this package (`drizzle-kit` doesn't know about NestJS or `DrizzleModule` at all - it just diffs
your schema against the last generated migration):

```ts
// drizzle.config.ts - [development ONLY], next to your schema.ts
import type { Config } from 'drizzle-kit'

export default {
	schema: './schema.ts',
	out: './migrations',
	dialect: 'postgresql',
	breakpoints: true,
	dbCredentials: {
		host: 'localhost',
		port: 5432,
		user: 'postgres',
		password: 'postgres',
		database: 'app',
		ssl: false,
	},
} satisfies Config
```

```bash
npx drizzle-kit generate --config=./drizzle.config.ts --name=descriptive_name
```

This writes a new `.sql` file (plus its `meta/*_snapshot.json`) into `out`. Treat everything
under `out` as a generated artifact: never hand-edit a migration file. If a migration hasn't
been applied anywhere yet (e.g. you're still iterating on a schema change locally), delete it,
adjust the schema, and regenerate instead of patching the SQL directly - once it *has* shipped
anywhere, change the schema further and generate a new migration on top of it instead.

### Running migrations

`migrateDb()` runs those `drizzle-kit`-generated migrations and is safe to call from every
instance on startup, even when several instances boot against the same database concurrently: it
coordinates via a Postgres advisory lock, so only one instance migrates while the rest block
until it's done, and retries with backoff on infrastructure failures.

```ts
import { migrateDb } from '@apinecka/drizzle'
import { Logger } from '@nestjs/common'

await migrateDb({
	logger: new Logger('Migration'),
	credentials: { host: 'localhost', database: 'app' },
	migrationsPath: path.resolve(__dirname, './migrations'),
	migrationLockKey: 483_921, // any stable number you pick - see below
})
```

`migrationLockKey` is required, not defaulted - it's the advisory-lock key that decides who
coordinates with whom, so silently sharing one across every consumer of this package (as an
internal default would) risks unrelated migration sets blocking on each other for no reason. Use
the *same* key across every instance migrating the *same* migration set against the *same*
database (that's the coordination you want - only one of them should actually run the SQL at a
time), and a *different* key for any other, unrelated migration set that might run against that
database.

## Error handling

`PostgresErrorCode` names the raw Postgres `error.code` values worth branching on (e.g. from a
`catch` block around an insert):

```ts
import { PostgresErrorCode } from '@apinecka/drizzle'

try {
	await db.insert(schema.users).values(user)
} catch (err) {
	if ((err as { code?: string }).code === PostgresErrorCode.UniqueViolation) {
		throw new ConflictException('User already exists')
	}
	throw err
}
```

## Testing helpers

`@apinecka/drizzle/testing` is a separate entry point for test-only helpers (they use a raw `pg`
client for admin actions like dropping a database, which you don't want anywhere near production
code).

Migrating is comparatively slow and every test file reuses the same schema, so run
`dropAndCreateTestDb()`/`migrateTestDb()` **exactly once for the whole test run**, via Jest's
`globalSetup` - never per test file, and never per test. Individual tests then just
`truncateTestDb()` to guarantee empty tables:

```ts
// jest.global-setup.ts - runs once, before any test file, in its own process
import { dropAndCreateTestDb, migrateTestDb } from '@apinecka/drizzle/testing'

export default async function () {
	// credentials default to getTestDbCredentials() - pass them explicitly only for a second database
	await dropAndCreateTestDb()
	await migrateTestDb({ migrationsPath: path.resolve(__dirname, './migrations'), migrationLockKey: 483_921 })
}
```

```js
// jest.config.js
/** @type {import('jest').Config} */
module.exports = {
	// ...
	globalSetup: '<rootDir>/jest.global-setup.ts',
}
```

```ts
// some.spec.ts
import { truncateTestDb } from '@apinecka/drizzle/testing'

afterEach(async () => {
	await truncateTestDb(db, ['public'])
})
```

`getTestDbCredentials()` reads `TEST_DB_HOST` / `TEST_DB_PORT` / `TEST_DB_USER` /
`TEST_DB_PASSWORD` / `TEST_DB_NAME`, falling back to a local Postgres on the default port.

### Setting `TEST_DB_*` for Jest

Point Jest at a setup file via `setupFiles` and set the vars there. Using `??=` means CI can still
override any of them by exporting real env vars before running Jest, while local runs get sane
defaults for free:

```js
// jest.config.js
/** @type {import('jest').Config} */
module.exports = {
	// ...
	setupFiles: ['<rootDir>/jest.env.js'],
}
```

```js
// jest.env.js
process.env.TEST_DB_HOST ??= 'localhost'
process.env.TEST_DB_PORT ??= '5432'
process.env.TEST_DB_USER ??= 'postgres'
process.env.TEST_DB_PASSWORD ??= 'postgres'
process.env.TEST_DB_NAME ??= 'test'
```

## Peer dependencies

- `@nestjs/common` — the module is NestJS-specific.
- `drizzle-orm` / `pg` — the underlying ORM and Postgres driver.

## License

MIT
