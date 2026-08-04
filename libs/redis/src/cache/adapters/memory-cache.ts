/* eslint-disable @typescript-eslint/require-await */
import { CacheAdapter, CacheSaveOptions } from '../cache.types'

interface Data {
	[key: string]: {
		data: unknown
		tags?: string[]
	}
}

interface Tags {
	[key: string]: Set<string>
}

interface Expirations {
	[key: string]: NodeJS.Timeout
}

export class MemoryCache implements CacheAdapter {
	private data: Data = {}
	private tags: Tags = {}
	private expirations: Expirations = {}

	async load<Data>(key: string, fallback: (key: string) => Promise<Data>): Promise<Data | null> {
		if (this.data[key] === undefined) {
			return fallback(key)
		}

		return this.data[key].data as Data
	}

	async save<Data>(key: string, data: Data, options: CacheSaveOptions): Promise<Data> {
		this.removeKeyFromTags(key)
		this.removeExpiration(key)

		this.data[key] = {
			data,
			tags: options.tags,
		}

		this.expirations[key] = setTimeout(() => this.handleExpiration(key), options.expiration * 1000)

		this.addKeyToTags(key, options.tags)

		return data
	}

	async remove(key: string): Promise<boolean> {
		if (!this.data[key]) {
			return false
		}

		this.removeKeyFromTags(key)
		this.removeExpiration(key)
		delete this.data[key]

		return true
	}

	async invalidate(tags: string | string[]): Promise<number> {
		const tagsArray = Array.isArray(tags) ? tags : [tags]
		const removeKeysList: string[] = []

		for (const tag of tagsArray) {
			const tagKeys = this.tags[tag]

			if (!tagKeys || tagKeys.size === 0) continue

			removeKeysList.push(...tagKeys)
			delete this.tags[tag]
		}

		const removeKeysSet = new Set(removeKeysList)

		const promises = []
		for (const key of removeKeysSet) {
			promises.push(this.remove(key))
		}

		await Promise.all(promises)
		return removeKeysList.length
	}

	async flush() {
		this.data = {}
		this.tags = {}

		for (const expiration of Object.values(this.expirations)) {
			clearTimeout(expiration)
		}
		this.expirations = {}
	}

	private handleExpiration(key: string) {
		this.removeKeyFromTags(key)
		delete this.data[key]
		delete this.expirations[key]
	}

	private removeExpiration(key: string) {
		if (!this.expirations[key]) return

		clearTimeout(this.expirations[key])
		delete this.expirations[key]
	}

	private removeKeyFromTags(key: string) {
		const existingData = this.data[key]

		if (!existingData || !existingData.tags?.length) return

		for (const tag of existingData.tags) {
			if (!this.tags[tag]) continue

			this.tags[tag].delete(key)

			if (this.tags[tag].size === 0) {
				delete this.tags[tag]
			}
		}
	}

	private addKeyToTags(key: string, tags?: string[]) {
		if (!tags || tags.length === 0) return

		for (const tag of tags || []) {
			if (!this.tags[tag]) {
				this.tags[tag] = new Set()
			}

			this.tags[tag].add(key)
		}
	}
}
