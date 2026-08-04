/* eslint-disable no-console */
import { Redis } from 'ioredis'

import { RedisCache } from '..'

const redis = new Redis({
	host: 'localhost',
	port: 10101,
})

let cache: RedisCache
const nullFallback = () => Promise.resolve(null)

beforeEach(async () => {
	cache = new RedisCache(redis)
	await redis.flushall()
})

afterAll(async () => {
	await redis.quit()
})

test('no data', async () => {
	await expect(cache.load('a', nullFallback)).resolves.toBeNull()

	await expect(cache.remove('a')).resolves.toBeFalsy()
})

test('save, load, remove', async () => {
	await expect(cache.save('a', { ok: true }, { expiration: 100 })).resolves.toMatchObject({ ok: true })

	await expect(cache.load('a', nullFallback)).resolves.toMatchObject({ ok: true })

	await expect(cache.remove('a')).resolves.toBeTruthy()

	await expect(cache.load('a', nullFallback)).resolves.toBeNull()

	await expect(redis.keys('*')).resolves.toEqual([])
})

test('supported data types', async () => {
	await cache.save('string', 'string', { expiration: 100 })
	await cache.save('number', 10.5, { expiration: 100 })
	await cache.save('boolean', true, { expiration: 100 })
	await cache.save('array', [0, 'a'], { expiration: 100 })

	await expect(cache.load('string', nullFallback)).resolves.toBe('string')
	await expect(cache.load('number', nullFallback)).resolves.toBe(10.5)
	await expect(cache.load('boolean', nullFallback)).resolves.toBe(true)
	await expect(cache.load('array', nullFallback)).resolves.toEqual([0, 'a'])
})

test('deserialization', async () => {
	await cache.save('a', { date: new Date('2023-01-01T00:00:00Z') }, { expiration: 100 })

	await expect(
		cache.load<{ date: Date }>(
			'a',
			() => Promise.resolve({ date: new Date() }),
			(serialized) => ({ date: new Date(serialized.date as string) }),
		),
	).resolves.toMatchObject({ date: new Date('2023-01-01T00:00:00Z') })
})

test('record expires', async () => {
	await expect(cache.save('a', { ok: true }, { expiration: 1, tags: ['t-a'] })).resolves.toMatchObject({ ok: true })

	await new Promise((resolve) => setTimeout(resolve, 1001))

	await expect(cache.load('a', nullFallback)).resolves.toBeNull()

	await expect(redis.keys('*')).resolves.toEqual([])
})

test('tags and invalidations', async () => {
	await cache.save('a1', { ok: true }, { expiration: 100, tags: ['t-a'] })
	await cache.save('a2', { ok: true }, { expiration: 100, tags: ['t-a'] })
	await cache.save('b1', { ok: true }, { expiration: 100, tags: ['t-b'] })
	await cache.save('c1', { ok: true }, { expiration: 100, tags: ['t-c'] })

	await expect(cache.invalidate('t-a')).resolves.toBe(2)

	await expect(redis.keys('*')).resolves.toEqual(
		expect.arrayContaining([
			'cache:item-data:b1',
			'cache:item-tags:b1',
			'cache:tag:t-b:b1',

			'cache:item-data:c1',
			'cache:item-tags:c1',
			'cache:tag:t-c:c1',
		]),
	)
})

test('tags invalidations with thousands of keys', async () => {
	const count = 10000

	// Create records
	const logKeySave = `create-${count}-items`
	console.time(logKeySave)

	for (let i = 0; i < count; i++) {
		await cache.save(`item-${i}`, { iAmItem: i + 1 }, { expiration: 100, tags: ['generated', 'another-tag'] })
	}
	await cache.save('survivor', { ok: true }, { expiration: 100, tags: ['i-am-different'] })

	console.timeEnd(logKeySave)

	// Invalidate tags

	const logKey = `invalidation-${count}-items`
	console.time(logKey)

	await expect(cache.invalidate('generated')).resolves.toBe(count)

	console.timeEnd(logKey)

	// Check results

	await expect(redis.keys('*')).resolves.toEqual(
		expect.arrayContaining([
			'cache:item-data:survivor',
			'cache:item-tags:survivor',
			'cache:tag:i-am-different:survivor',
		]),
	)
}, 20000)

test('flush', async () => {
	const count = 1000

	// Create records
	for (let i = 0; i < count; i++) {
		await cache.save(`item-${i}`, { iAmItem: i + 1 }, { expiration: 100, tags: ['generated', 'another-tag'] })
	}
	await redis.set('another-namespace:survivor', 'important data')

	// Flush

	const logKey = `flush-${count}-items`
	console.time(logKey)

	await expect(cache.flush()).resolves.toBeUndefined()

	console.timeEnd(logKey)

	// Check the result

	await expect(redis.keys('*')).resolves.toEqual(expect.arrayContaining(['another-namespace:survivor']))
})
