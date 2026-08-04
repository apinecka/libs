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
