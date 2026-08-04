import { DynamicModule, Module } from '@nestjs/common'
import Redis, { RedisOptions } from 'ioredis'

import { RedisCache } from './cache'
import { RedisLocks } from './locks'


@Module({})
export class RedisModule {
	static forRoot(config: RedisOptions): DynamicModule {
		const redis = new Redis(config)
		return {
			module: RedisModule,
			imports: [],
			providers: [
				{
					provide: Redis,
					useValue: redis,
				},
				{
					provide: RedisLocks,
					useFactory: () => new RedisLocks(redis),
				},
				{
					provide: RedisCache,
					useFactory: () => new RedisCache(redis),
				},
			],
			exports: [
				Redis,
				RedisLocks,
				RedisCache,
			],
			global: true,
		}
	}
}
