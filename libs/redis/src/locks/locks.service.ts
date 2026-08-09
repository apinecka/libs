import { Injectable } from '@nestjs/common'
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

	async unlock(key: string) {
		const count = await this.redis.del(key)
		return count === 1
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
