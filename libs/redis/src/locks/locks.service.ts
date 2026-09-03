import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import Redis from 'ioredis'

@Injectable()
export class RedisLocks {
	constructor(
		private redis: Redis,
	) {}

	async acquire(key: string, expirationSeconds: number) {
		const count = await this.redis.setnx(key, 1)
		if (count > 0) {
			await this.redis.expire(key, expirationSeconds)
			return true
		}
		return false
	}

	async acquireOrWait(
		key: string,
		expirationSeconds: number, timeoutMs = 10_000,
	) {
		const start = Date.now()
		while (!(await this.acquire(key, expirationSeconds))) {
			if (Date.now() - start > timeoutMs)
				throw new Error(`Timeout waiting to acquire lock: ${key}`)
			await new Promise(resolve => setTimeout(resolve, 100))
		}
	}

	async isHeld(key: string): Promise<boolean> {
		const exists = await this.redis.exists(key)
		return exists > 0
	}

	/** Atomically checks that guardKey is not held, then acquires acquireKey. Returns true if acquired. */
	async acquireIfOtherNotHeld(guardKey: string, acquireKey: string, expirationSeconds: number): Promise<boolean> {
		const lua = `
			if redis.call('EXISTS', KEYS[1]) == 1 then
				return 0
			end
			if redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[1]) then
				return 1
			end
			return 0
		`
		const result = await this.redis.eval(lua, 2, guardKey, acquireKey, String(expirationSeconds))
		return result === 1
	}

	/**
	 * Acquires the lock and returns an ownership token, or null when it is already held.
	 *
	 * Preferred over {@link acquire} for work that can outlive its lease. The write is a single
	 * atomic `SET NX EX`, so a crash cannot leave a key with no expiration the way `SETNX` followed
	 * by a separate `EXPIRE` can, and the token lets {@link renew}, {@link releaseWithThreshold}, and
	 * {@link releaseIfOwner} act only on the lock this caller actually took.
	 */
	async acquireWithToken(key: string, expirationSeconds: number): Promise<string | null> {
		const token = randomUUID()
		const result = await this.redis.set(key, token, 'EX', expirationSeconds, 'NX')
		return result === 'OK' ? token : null
	}

	/**
	 * Extends the lease, but only while `token` still owns the lock. Returns false once ownership
	 * has been lost — the lease expired and someone else took over — which the caller should treat
	 * as "another run may already be working".
	 */
	async renew(key: string, token: string, expirationSeconds: number): Promise<boolean> {
		const lua = `
			if redis.call('GET', KEYS[1]) == ARGV[1] then
				return redis.call('EXPIRE', KEYS[1], ARGV[2])
			end
			return 0
		`
		const result = await this.redis.eval(lua, 1, key, token, String(expirationSeconds))
		return result === 1
	}

	/**
	 * Ownership-safe {@link unlockWithThreshold}: holds the lock for the remainder of
	 * `minimalLockTimeMs` or releases it immediately, but only while `token` still owns it.
	 * Returns false when ownership had already been lost, in which case nothing is touched — a run
	 * that overran its lease must never delete the lock a later run is now holding.
	 */
	async releaseWithThreshold({ key, token, minimalLockTimeMs, start }: {
		key: string
		/** Ownership token from {@link acquireWithToken} */
		token: string
		/** Local started Date */
		start: Date
		/** Minimal time that the lock should stay locked */
		minimalLockTimeMs: number
	}): Promise<boolean> {
		const remaining = this.calculateMinimalLockTimeout({ start, minimalLockTimeMs })
		const remainingSecs = Math.round(remaining / 1000)

		const lua = `
			if redis.call('GET', KEYS[1]) ~= ARGV[1] then
				return 0
			end
			if tonumber(ARGV[2]) > 0 then
				redis.call('EXPIRE', KEYS[1], ARGV[2])
			else
				redis.call('DEL', KEYS[1])
			end
			return 1
		`
		const result = await this.redis.eval(lua, 1, key, token, String(remainingSecs))
		return result === 1
	}

	async unlock(key: string) {
		const count = await this.redis.del(key)
		return count === 1
	}

	/**
	 * Deletes `key` only if it still holds `token` - a stale/expired lock reacquired by someone else is left alone.
	 * Prevents a run whose lock outlived its TTL from deleting a different run's lock on release (see
	 * blogicAnalyzer's multi-hour migration locks).
	 */
	async releaseIfOwner(key: string, token: string): Promise<boolean> {
		const lua = `
			if redis.call('GET', KEYS[1]) == ARGV[1] then
				return redis.call('DEL', KEYS[1])
			end
			return 0
		`
		const result = await this.redis.eval(lua, 1, key, token)
		return result === 1
	}

	/** Resets lock expiration by "minimalLockTime" or unlock lock immediately */
	async unlockWithThreshold({ key, minimalLockTimeMs, start }: {
		key: string
		/** Local started Date */
		start: Date
		/** Minimal time that the lock should stay locked */
		minimalLockTimeMs: number
	}) {
		const remaining = this.calculateMinimalLockTimeout({ start, minimalLockTimeMs })
		const remainingSecs = Math.round(remaining / 1000)
		
		if (remainingSecs > 0) {
			await this.redis.expire(key, remainingSecs)
		} else {
			await this.redis.del(key)
		}
	}

	private calculateMinimalLockTimeout({ start, minimalLockTimeMs }: {
		start: Date
		minimalLockTimeMs: number
	}) {
		const elapsed = Date.now() - start.getTime()
		const remaining = minimalLockTimeMs - elapsed
		return remaining > 0
			? remaining
			: 0
	}
}
