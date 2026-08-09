import { Redis } from 'ioredis'

import { RedisLocks } from '.'

const redis = new Redis({
	host: 'localhost',
	port: 6379,
})

let locks: RedisLocks

beforeEach(async () => {
	locks = new RedisLocks(redis)
	await redis.flushall()
})

afterAll(async () => {
	await redis.quit()
})

// acquire

test('acquire: returns true and sets key when not held', async () => {
	await expect(locks.acquire('lock-a', 60)).resolves.toBe(true)
	await expect(redis.exists('lock-a')).resolves.toBe(1)
})

test('acquire: sets expiration on the key', async () => {
	await locks.acquire('lock-a', 60)
	const ttl = await redis.ttl('lock-a')
	expect(ttl).toBeGreaterThan(0)
	expect(ttl).toBeLessThanOrEqual(60)
})

test('acquire: returns false when key is already held', async () => {
	await locks.acquire('lock-a', 60)
	await expect(locks.acquire('lock-a', 60)).resolves.toBe(false)
})

// isHeld

test('isHeld: returns false for non-existent key', async () => {
	await expect(locks.isHeld('lock-a')).resolves.toBe(false)
})

test('isHeld: returns true after acquiring', async () => {
	await locks.acquire('lock-a', 60)
	await expect(locks.isHeld('lock-a')).resolves.toBe(true)
})

test('isHeld: returns false after unlocking', async () => {
	await locks.acquire('lock-a', 60)
	await locks.unlock('lock-a')
	await expect(locks.isHeld('lock-a')).resolves.toBe(false)
})

// unlock

test('unlock: returns true when key existed', async () => {
	await locks.acquire('lock-a', 60)
	await expect(locks.unlock('lock-a')).resolves.toBe(true)
	await expect(redis.exists('lock-a')).resolves.toBe(0)
})

test('unlock: returns false when key did not exist', async () => {
	await expect(locks.unlock('lock-a')).resolves.toBe(false)
})

// acquireOrWait

test('acquireOrWait: acquires immediately when lock is free', async () => {
	await expect(locks.acquireOrWait('lock-a', 60)).resolves.toBeUndefined()
	await expect(redis.exists('lock-a')).resolves.toBe(1)
})

test('acquireOrWait: throws when lock is held and timeout elapses', async () => {
	await locks.acquire('lock-a', 60)
	await expect(locks.acquireOrWait('lock-a', 60, 150)).rejects.toThrow('Timeout waiting to acquire lock: lock-a')
})

test('acquireOrWait: succeeds once lock is released', async () => {
	await locks.acquire('lock-a', 60)
	setTimeout(() => { void locks.unlock('lock-a') }, 100)
	await expect(locks.acquireOrWait('lock-a', 60, 5_000)).resolves.toBeUndefined()
	await expect(redis.exists('lock-a')).resolves.toBe(1)
})

// acquireIfOtherNotHeld

test('acquireIfOtherNotHeld: acquires when guard key is not held', async () => {
	await expect(locks.acquireIfOtherNotHeld('guard', 'target', 60)).resolves.toBe(true)
	await expect(redis.exists('target')).resolves.toBe(1)
	await expect(redis.exists('guard')).resolves.toBe(0)
})

test('acquireIfOtherNotHeld: sets expiration on acquired key', async () => {
	await locks.acquireIfOtherNotHeld('guard', 'target', 60)
	const ttl = await redis.ttl('target')
	expect(ttl).toBeGreaterThan(0)
	expect(ttl).toBeLessThanOrEqual(60)
})

test('acquireIfOtherNotHeld: returns false when guard key is held', async () => {
	await locks.acquire('guard', 60)
	await expect(locks.acquireIfOtherNotHeld('guard', 'target', 60)).resolves.toBe(false)
	await expect(redis.exists('target')).resolves.toBe(0)
})

test('acquireIfOtherNotHeld: returns false when target key is already held', async () => {
	await locks.acquire('target', 60)
	await expect(locks.acquireIfOtherNotHeld('guard', 'target', 60)).resolves.toBe(false)
})

test('acquireIfOtherNotHeld: concurrent calls only succeed once', async () => {
	const results = await Promise.all([
		locks.acquireIfOtherNotHeld('guard', 'target', 60),
		locks.acquireIfOtherNotHeld('guard', 'target', 60),
		locks.acquireIfOtherNotHeld('guard', 'target', 60),
	])
	expect(results.filter(Boolean)).toHaveLength(1)
})

// unlockWithThreshold

test('unlockWithThreshold: deletes key immediately when minimal time already elapsed', async () => {
	await locks.acquire('lock-a', 60)
	const start = new Date(Date.now() - 10_000)
	await locks.unlockWithThreshold({ key: 'lock-a', minimalLockTimeMs: 5_000, start })
	await expect(redis.exists('lock-a')).resolves.toBe(0)
})

test('unlockWithThreshold: keeps key with reduced TTL when minimal time not yet elapsed', async () => {
	await locks.acquire('lock-a', 60)
	const start = new Date()
	await locks.unlockWithThreshold({ key: 'lock-a', minimalLockTimeMs: 30_000, start })
	const ttl = await redis.ttl('lock-a')
	expect(ttl).toBeGreaterThan(0)
	expect(ttl).toBeLessThanOrEqual(30)
})
