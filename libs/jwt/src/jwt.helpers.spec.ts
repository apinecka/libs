import * as JwtHelpers from './jwt.helpers'

// extractBearerToken

test('extractBearerToken: extracts the token from a Bearer header', () => {
	expect(JwtHelpers.extractBearerToken({ authorization: 'Bearer abc.def.ghi' })).toBe('abc.def.ghi')
})

test('extractBearerToken: is case-insensitive on the scheme', () => {
	expect(JwtHelpers.extractBearerToken({ authorization: 'bearer abc.def.ghi' })).toBe('abc.def.ghi')
})

test('extractBearerToken: reads the capitalized Authorization header', () => {
	expect(JwtHelpers.extractBearerToken({ Authorization: 'Bearer abc.def.ghi' })).toBe('abc.def.ghi')
})

test('extractBearerToken: returns null when no header is present', () => {
	expect(JwtHelpers.extractBearerToken({})).toBeNull()
})

test('extractBearerToken: returns null for a non-Bearer scheme', () => {
	expect(JwtHelpers.extractBearerToken({ authorization: 'Basic abc.def.ghi' })).toBeNull()
})

test('extractBearerToken: takes the first value when the header is repeated', () => {
	expect(JwtHelpers.extractBearerToken({ Authorization: ['Bearer first', 'Bearer second'] })).toBe('first')
})

// getJWTPayload

test('getJWTPayload: decodes the payload without verifying the signature', () => {
	const payload = { sub: 'user-1', iat: 1700000000 }
	const encoded = Buffer.from(JSON.stringify(payload)).toString('base64')
	const token = `header.${encoded}.signature`

	expect(JwtHelpers.getJWTPayload(token)).toEqual(payload)
})

test('getJWTPayload: returns null for a malformed token', () => {
	expect(JwtHelpers.getJWTPayload('not-a-jwt')).toBeNull()
})
