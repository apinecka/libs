import { Redis } from 'ioredis'

import { RedisLocks } from '.'

const redis = new Redis({
	host: 'localhost',
	port: 6379,
})

let locks: RedisLocks

/**
 * Narrows the `string | null` of a successful acquireWithToken to the token itself, so the
 * ownership tests can pass it on without a non-null assertion. A null here means the lock was
 * unexpectedly already held, which fails the test with that reason rather than a later mismatch.
 */
function expectAcquired(token: string | null): string {
	if (token === null) throw new Error('expected acquireWithToken to acquire the lock, but it returned null')
	return token
}

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

// acquireWithToken / releaseIfOwner

test('acquireWithToken: returns a token and sets key when not held', async () => {
	const token = await locks.acquireWithToken('lock-a', 60)
	expect(typeof token).toBe('string')
	await expect(redis.get('lock-a')).resolves.toBe(token)
})

test('acquireWithToken: sets expiration on the key', async () => {
	await locks.acquireWithToken('lock-a', 60)
	const ttl = await redis.ttl('lock-a')
	expect(ttl).toBeGreaterThan(0)
	expect(ttl).toBeLessThanOrEqual(60)
})

test('acquireWithToken: returns null when key is already held', async () => {
	await locks.acquireWithToken('lock-a', 60)
	await expect(locks.acquireWithToken('lock-a', 60)).resolves.toBeNull()
})

test('acquireWithToken: only one of several concurrent callers wins', async () => {
	const results = await Promise.all([
		locks.acquireWithToken('lock-a', 60),
		locks.acquireWithToken('lock-a', 60),
		locks.acquireWithToken('lock-a', 60),
	])
	expect(results.filter(t => t !== null)).toHaveLength(1)
})

test('releaseIfOwner: deletes the key when the token matches', async () => {
	const token = await locks.acquireWithToken('lock-a', 60)
	await expect(locks.releaseIfOwner('lock-a', token as string)).resolves.toBe(true)
	await expect(redis.exists('lock-a')).resolves.toBe(0)
})

test('releaseIfOwner: leaves the key alone when the token does not match', async () => {
	await locks.acquireWithToken('lock-a', 60)
	await expect(locks.releaseIfOwner('lock-a', 'wrong-token')).resolves.toBe(false)
	await expect(redis.exists('lock-a')).resolves.toBe(1)
})

test('releaseIfOwner: does not delete a lock reacquired by someone else after this owner\'s token expired', async () => {
	const staleToken = await locks.acquireWithToken('lock-a', 60)
	await redis.del('lock-a') // simulate TTL expiry
	const newToken = await locks.acquireWithToken('lock-a', 60)
	await expect(locks.releaseIfOwner('lock-a', staleToken as string)).resolves.toBe(false)
	await expect(redis.get('lock-a')).resolves.toBe(newToken)
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

// renew

test('renew: extends the lease while the token still owns the lock', async () => {
	const token = expectAcquired(await locks.acquireWithToken('lock-a', 2))
	await expect(locks.renew('lock-a', token, 60)).resolves.toBe(true)
	const ttl = await redis.ttl('lock-a')
	expect(ttl).toBeGreaterThan(2)
})

test('renew: returns false once the lock is owned by someone else', async () => {
	const stale = expectAcquired(await locks.acquireWithToken('lock-a', 60))
	await redis.del('lock-a')
	const newOwner = expectAcquired(await locks.acquireWithToken('lock-a', 60))

	await expect(locks.renew('lock-a', stale, 600)).resolves.toBe(false)
	// The new owner's lease is left exactly as it was.
	await expect(redis.get('lock-a')).resolves.toBe(newOwner)
	expect(await redis.ttl('lock-a')).toBeLessThanOrEqual(60)
})

test('renew: returns false when the lock has lapsed entirely', async () => {
	const token = expectAcquired(await locks.acquireWithToken('lock-a', 60))
	await redis.del('lock-a')
	await expect(locks.renew('lock-a', token, 60)).resolves.toBe(false)
	await expect(redis.exists('lock-a')).resolves.toBe(0)
})

// releaseWithThreshold

test('releaseWithThreshold: deletes key immediately when minimal time already elapsed', async () => {
	const token = expectAcquired(await locks.acquireWithToken('lock-a', 60))
	const start = new Date(Date.now() - 10_000)
	await expect(locks.releaseWithThreshold({ key: 'lock-a', token, minimalLockTimeMs: 5_000, start }))
		.resolves.toBe(true)
	await expect(redis.exists('lock-a')).resolves.toBe(0)
})

test('releaseWithThreshold: keeps key with reduced TTL when minimal time not yet elapsed', async () => {
	const token = expectAcquired(await locks.acquireWithToken('lock-a', 60))
	const start = new Date()
	await expect(locks.releaseWithThreshold({ key: 'lock-a', token, minimalLockTimeMs: 30_000, start }))
		.resolves.toBe(true)
	const ttl = await redis.ttl('lock-a')
	expect(ttl).toBeGreaterThan(0)
	expect(ttl).toBeLessThanOrEqual(30)
})

test('releaseWithThreshold: an overrun run does not delete the lock a later run now holds', async () => {
	// A takes the lock, its lease lapses mid-run, then B legitimately acquires the same lock.
	const staleToken = expectAcquired(await locks.acquireWithToken('lock-a', 60))
	await redis.del('lock-a')
	const newToken = expectAcquired(await locks.acquireWithToken('lock-a', 60))

	// A finally finishes, long past its minimal lock time, and releases "its" lock.
	const startedLongAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)
	await expect(locks.releaseWithThreshold({
		key: 'lock-a',
		token: staleToken,
		minimalLockTimeMs: 60_000,
		start: startedLongAgo,
	})).resolves.toBe(false)

	await expect(redis.get('lock-a')).resolves.toBe(newToken)
	expect(await redis.ttl('lock-a')).toBeGreaterThan(0)
})

test('releaseWithThreshold: does not shorten the TTL of a lock owned by another run', async () => {
	const staleToken = expectAcquired(await locks.acquireWithToken('lock-a', 600))
	await redis.del('lock-a')
	await locks.acquireWithToken('lock-a', 600)

	await expect(locks.releaseWithThreshold({
		key: 'lock-a',
		token: staleToken,
		minimalLockTimeMs: 30_000,
		start: new Date(),
	})).resolves.toBe(false)

	expect(await redis.ttl('lock-a')).toBeGreaterThan(30)
})
