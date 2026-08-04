import { MemoryCache } from '..'

let cache: MemoryCache
const nullFallback = () => Promise.resolve(null)

beforeEach(() => {
	cache = new MemoryCache()
})

test('no data', async () => {
	await expect(cache.load('a', nullFallback)).resolves.toBeNull()

	await expect(cache.remove('a')).resolves.toBeFalsy()
})

test('save, load, remove', async () => {
	const _cache = cache as any

	await expect(cache.save('a', { ok: true }, { expiration: 100 })).resolves.toMatchObject({ ok: true })

	await expect(cache.load('a', nullFallback)).resolves.toMatchObject({ ok: true })

	await expect(cache.remove('a')).resolves.toBeTruthy()

	await expect(cache.load('a', nullFallback)).resolves.toBeNull()

	expect(_cache.expirations).toEqual({})
	expect(_cache.data).toEqual({})
	expect(_cache.tags).toEqual({})
})

test('record expires', async () => {
	const _cache = cache as any

	await expect(cache.save('a', { ok: true }, { expiration: 0.1, tags: ['t-a'] })).resolves.toMatchObject({ ok: true })

	await new Promise((resolve) => setTimeout(resolve, 100))

	await expect(cache.load('a', nullFallback)).resolves.toBeNull()

	expect(_cache.expirations).toEqual({})
	expect(_cache.data).toEqual({})
	expect(_cache.tags).toEqual({})
})

test('tags and invalidations', async () => {
	const _cache = cache as any

	await cache.save('a1', { ok: true }, { expiration: 100, tags: ['t-a'] })
	await cache.save('a2', { ok: true }, { expiration: 100, tags: ['t-a'] })
	await cache.save('b1', { ok: true }, { expiration: 100, tags: ['t-b'] })
	await cache.save('c1', { ok: true }, { expiration: 100, tags: ['t-c'] })

	await expect(cache.invalidate('t-a')).resolves.toBe(2)

	expect(_cache.expirations).toEqual({
		b1: expect.any(Object),
		c1: expect.any(Object),
	})
	expect(_cache.data).toEqual({
		b1: expect.any(Object),
		c1: expect.any(Object),
	})
	expect(_cache.tags).toEqual({
		't-b': expect.any(Object),
		't-c': expect.any(Object),
	})
})

test('flush', async () => {
	for (let i = 0; i < 1000; i++) {
		await cache.save(`item-${i}`, { iAmItem: i + 1 }, { expiration: 100, tags: ['generated', 'another-tag'] })
	}

	await expect(cache.flush()).resolves.toBeUndefined()

	const _cache = cache as any
	expect(_cache.expirations).toEqual({})
	expect(_cache.data).toEqual({})
	expect(_cache.tags).toEqual({})
})
