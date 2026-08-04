# @apinecka/redis

NestJS module for Redis, built on [`ioredis`](https://www.npmjs.com/package/ioredis): a
global connection, a tag-based cache-aside helper (`RedisCache`), and a distributed lock
helper (`RedisLocks`).

## Install

```bash
npm install @apinecka/redis ioredis @nestjs/common
```

## Usage

```ts
import { RedisModule } from '@apinecka/redis'

@Module({
	imports: [
		RedisModule.forRoot({ host: 'localhost', port: 6379 }),
	],
})
export class AppModule {}
```

```ts
import { RedisCache, RedisLocks } from '@apinecka/redis'

@Injectable()
export class ReportsService {
	constructor(private cache: RedisCache, private locks: RedisLocks) {}

	async getReport(id: string) {
		return this.cache.load(`report:${id}`, async key => {
			const report = await this.buildReport(id)
			await this.cache.save(key, report, { expiration: 60, tags: ['reports'] })
			return report
		})
	}
}
```

Both `RedisCache` and `RedisLocks` are provided by `RedisModule.forRoot()` alongside the raw
`ioredis` client.

## Peer dependencies

- `@nestjs/common` — the module is NestJS-specific.
- `ioredis` — the underlying Redis client.

## License

MIT
