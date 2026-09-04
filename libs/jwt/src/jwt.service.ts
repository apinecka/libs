import { Injectable, Logger } from '@nestjs/common'
import * as fs from 'fs'
import * as jwt from 'jsonwebtoken'
import * as path from 'path'

import { getWriteJwtOptions, validateToken } from './jwt.helpers'

interface LoadedJwtKey {
	publicKey: string
	privateKey?: string
}

@Injectable()
export class JwtService {
	private logger = new Logger(JwtService.name)
	private keys = new Map<string, LoadedJwtKey>()
	private activeKey: { kid: string, publicKey: string, privateKey: string }

	constructor(
		private options: JwtServiceOptions,
	) {
		for (const key of options.keys) {
			this.keys.set(key.kid, {
				publicKey: this.loadKey(key.publicKeyPath),
				privateKey: key.privateKeyPath ? this.loadKey(key.privateKeyPath) : undefined,
			})
		}

		const activeKey = this.keys.get(options.activeKid)
		if (!activeKey) {
			throw new Error(`JWT active key '${options.activeKid}' is not present in configured keys`)
		}
		if (!activeKey.privateKey) {
			throw new Error(`JWT active key '${options.activeKid}' has no private key configured`)
		}
		this.activeKey = { kid: options.activeKid, publicKey: activeKey.publicKey, privateKey: activeKey.privateKey }

		try {
			const token = this.createToken({}, 1000)
			this.validateToken(token)
		} catch (err) {
			this.logger.debug(err)
			throw new Error('JWT key pair is invalid')
		}
	}

	createToken(payload: jwt.JwtPayload, expiresInSeconds: number): string {
		return jwt.sign(payload, this.activeKey.privateKey, getWriteJwtOptions({ issuer: this.options.issuer, expiresIn: expiresInSeconds, kid: this.activeKey.kid }))
	}

	validateToken<AccessTokenData>(token: string): AccessTokenData {
		const kid = this.getTokenKid(token)
		const candidateKeys = kid !== undefined
			? [this.keys.get(kid)].filter((key): key is LoadedJwtKey => key !== undefined)
			: [...this.keys.values()]

		if (candidateKeys.length === 0) {
			throw new Error(`Unknown JWT key id '${kid}'`)
		}

		let lastError: unknown
		for (const key of candidateKeys) {
			try {
				return validateToken<AccessTokenData>({
					token,
					issuer: this.options.issuer,
					publicKey: key.publicKey,
				})
			} catch (err) {
				lastError = err
			}
		}

		throw lastError
	}

	getPublicKey(): string {
		return this.activeKey.publicKey
	}

	private getTokenKid(token: string): string | undefined {
		const decoded = jwt.decode(token, { complete: true })
		return decoded?.header.kid
	}

	private loadKey(keyPath: string): string {
		// Relative to the process's cwd, not this package's own __dirname (which - once installed
		// under a consuming app's node_modules - resolves nowhere near that app's key files).
		const absPath = path.isAbsolute(keyPath)
			? keyPath
			: path.resolve(process.cwd(), keyPath)

		try {
			return fs.readFileSync(absPath, 'utf-8')
		} catch (err) {
			this.logger.debug(err)
			throw new Error(`Failed to load JWT key from ${absPath}`)
		}
	}
}

export interface JwtServiceKeyOptions {
	kid: string
	publicKeyPath: string
	privateKeyPath?: string
}

export interface JwtServiceOptions {
	issuer: string
	activeKid: string
	keys: JwtServiceKeyOptions[]
}
