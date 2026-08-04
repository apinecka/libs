export interface CacheSaveOptions {
	/** Expiration in seconds. Must be set on purpose - prevent leaking. ⚠ Negative or zero values will throw an error. */
	expiration: number
	/** Cache tags for invalidation */
	tags?: string[]
}

export type CacheData = unknown
export type SerializedData<Data extends CacheData> =
	Data extends Record<string, unknown> ? Record<keyof Data, unknown> : unknown

export interface CacheAdapter {
	load: <Data extends CacheData>(
		key: string,
		fallback: (key: string) => Promise<Data>,
		deserialize?: (serialized: SerializedData<Data>) => Data,
	) => Promise<Data | null>

	save: <Data extends CacheData>(key: string, data: Data, options: CacheSaveOptions) => Promise<Data>

	remove: (key: string) => Promise<boolean>

	invalidate: (tags: string | string[]) => Promise<number>

	flush: () => Promise<void>
}
