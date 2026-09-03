import type { IncomingMessage } from 'http'
import * as jwt from 'jsonwebtoken'


export function getReadJwtOptions({ issuer }: { issuer: string }): jwt.VerifyOptions {
	return {
		algorithms: ['RS512'],
		issuer,
	}
}

export function getWriteJwtOptions({ issuer, expiresIn, kid }: { expiresIn: number, issuer: string, kid: string }): jwt.SignOptions {
	return {
		issuer,
		algorithm: 'RS512',
		expiresIn,
		keyid: kid,
	}
}

export function validateToken<AccessTokenData>({ issuer, token, publicKey }: { token: string, issuer: string, publicKey: string }): AccessTokenData {
	const payload = jwt.verify(token, publicKey, getReadJwtOptions({ issuer }))
	return payload as AccessTokenData
}

export function getJWTPayload<Payload>(token: string): Payload | null {
	const parts = token.split('.')
	if (typeof parts[1] !== 'string') {
		return null
	}

	const rawJson = Buffer.from(parts[1], 'base64').toString('utf-8')
	return JSON.parse(rawJson) as Payload
}

export function extractBearerToken(headers: IncomingMessage['headers']) {
	const headerValue = headers.Authorization || headers.authorization

	const firstRecord = Array.isArray(headerValue)
		? headerValue.at(0)
		: headerValue
	if (!firstRecord) return null

	const [type, jwt] = firstRecord.split(' ')
	if (type.toLowerCase() !== 'bearer' || typeof jwt !== 'string') {
		return null
	}

	return jwt
}
