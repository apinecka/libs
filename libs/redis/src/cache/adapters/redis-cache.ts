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

	/** Returns the cached value for `key`, or the result of `fallback` when it's missing (not cached automatically). */
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
			return null as Data
		}

		let data: SerializedData<Data>
		try {
			data = JSON.parse(rawData) as SerializedData<Data>
		} catch {
			console.error('Failed to parse Redis data - invalid JSON')
			return null as Data
		}

		return deserialize ? deserialize(data) : (data as Data)
	}

	/** Stores `data` under `key` with the given expiration and tags. */
	async save<Data extends CacheData>(key: string, data: Data, options: CacheSaveOptions): Promise<Data> {
		await this.luaCommands.setData(
			key,
			JSON.stringify(data),
			options.expiration,
			(options.tags || []).join(','),
		)

		return data
	}

	/** Atomically reads and removes the value for `key`, returning `null` if it wasn't cached. */
	async take<Data extends CacheData>(key: string): Promise<Data | null> {
		const rawData = await this.luaCommands.takeData(key)

		if (rawData === null) {
			return null
		}

		if (rawData === 'null') {
			return null as Data
		}

		try {
			return JSON.parse(rawData) as Data
		} catch {
			console.error('Failed to parse Redis data - invalid JSON')
			return null
		}
	}

	/** Removes the cached value and its tags for `key`. Returns whether an entry was removed. */
	async remove(key: string): Promise<boolean> {
		const count = await this.luaCommands.invalidate(
			key,
		)

		return Number(count) === 1
	}

	/** Removes all cached entries associated with the given tag(s). Returns the number of removed entries. */
	async invalidate(tags: string | string[]): Promise<number> {
		const tagsArray = Array.isArray(tags) ? tags : [tags]
		const count = await this.luaCommands.invalidateTags(
			tagsArray.join(','),
		)

		return Number(count)
	}

	/** Removes every entry within this cache's namespace. */
	async flush() {
		await this.luaCommands.flush()
	}
}
