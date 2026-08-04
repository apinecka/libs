/* eslint-disable no-console */
import { Redis } from 'ioredis'

import { CacheAdapter, CacheData, CacheSaveOptions, SerializedData } from '../cache.types'
import { cacheCommand, commandsAliases } from './redis/lua'

interface RedisCacheOptions {
	/** Cached data namespace ("cache" by default) */
	namespace: string
	scanBulk: number
}

export class RedisCache implements CacheAdapter {
	private options: RedisCacheOptions = {
		namespace: 'cache',
		scanBulk: 1000,
	}
	private luaCommands: ReturnType<typeof commandsAliases>

	constructor(
		private redis: Redis,
		options?: Partial<RedisCacheOptions>,
	) {
		if (options) {
			this.options = {
				...this.options,
				...options,
			}
		}

		// register LUA cache script
		this.redis.defineCommand('cache', cacheCommand(this.options))
		this.luaCommands = commandsAliases(redis)
	}

	async load<Data extends CacheData>(
		key: string,
		fallback: (key: string) => Promise<Data>,
		deserialize?: (serialized: SerializedData<Data>) => Data,
	): Promise<Data> {
		const rawData = await this.luaCommands.getData(key)

		if (rawData === null) {
			return fallback(key)
		}

		if (rawData === 'null') {
			return null
		}

		let data: SerializedData<Data>
		try {
			data = JSON.parse(rawData) as SerializedData<Data>
		} catch {
			console.error('Failed to parse Redis data - invalid JSON')
			return null
		}

		return deserialize ? deserialize(data) : (data as Data)
	}

	async save<Data extends CacheData>(key: string, data: Data, options: CacheSaveOptions): Promise<Data> {
		await this.luaCommands.setData(
			key,
			JSON.stringify(data),
			options.expiration,
			(options.tags || []).join(','),
		)

		return data
	}

	async remove(key: string): Promise<boolean> {
		const count = await this.luaCommands.invalidate(
			key,
		)

		return Number(count) === 1
	}

	async invalidate(tags: string | string[]): Promise<number> {
		const tagsArray = Array.isArray(tags) ? tags : [tags]
		const count = await this.luaCommands.invalidateTags(
			tagsArray.join(','),
		)

		return Number(count)
	}

	async flush() {
		await this.luaCommands.flush()
	}
}
