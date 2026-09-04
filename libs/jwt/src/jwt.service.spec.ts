import { generateKeyPairSync } from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { JwtService } from './jwt.service'

let dir: string

function writeKeyPair(name: string) {
	const { publicKey, privateKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	})

	const publicKeyPath = path.join(dir, `${name}.pub`)
	const privateKeyPath = path.join(dir, `${name}.key`)
	fs.writeFileSync(publicKeyPath, publicKey)
	fs.writeFileSync(privateKeyPath, privateKey)

	return { publicKeyPath, privateKeyPath }
}

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apinecka-jwt-'))
})

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

test('createToken/validateToken: round-trips a payload', () => {
	const { publicKeyPath, privateKeyPath } = writeKeyPair('main')
	const service = new JwtService({ issuer: 'test', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath, privateKeyPath }] })

	const token = service.createToken({ sub: 'user-1' }, 60)
	const payload = service.validateToken<{ sub: string }>(token)

	expect(payload.sub).toBe('user-1')
})

test('getPublicKey: returns the active key\'s public key', () => {
	const { publicKeyPath, privateKeyPath } = writeKeyPair('main')
	const service = new JwtService({ issuer: 'test', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath, privateKeyPath }] })

	expect(service.getPublicKey()).toBe(fs.readFileSync(publicKeyPath, 'utf-8'))
})

test('constructor: throws when activeKid is not among the configured keys', () => {
	const { publicKeyPath, privateKeyPath } = writeKeyPair('main')

	expect(() => new JwtService({ issuer: 'test', activeKid: 'missing', keys: [{ kid: 'main', publicKeyPath, privateKeyPath }] }))
		.toThrow(/active key 'missing' is not present/)
})

test('constructor: throws when the active key has no private key configured', () => {
	const { publicKeyPath } = writeKeyPair('main')

	expect(() => new JwtService({ issuer: 'test', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath }] }))
		.toThrow(/has no private key configured/)
})

test('validateToken: rejects a token signed with an unknown key id', () => {
	const { publicKeyPath, privateKeyPath } = writeKeyPair('main')
	const service = new JwtService({ issuer: 'test', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath, privateKeyPath }] })

	const { publicKeyPath: otherPub, privateKeyPath: otherPriv } = writeKeyPair('other')
	const otherService = new JwtService({ issuer: 'test', activeKid: 'other', keys: [{ kid: 'other', publicKeyPath: otherPub, privateKeyPath: otherPriv }] })
	const foreignToken = otherService.createToken({}, 60)

	expect(() => service.validateToken(foreignToken)).toThrow(/Unknown JWT key id 'other'/)
})

test('validateToken: rejects a token signed with a different issuer', () => {
	const { publicKeyPath, privateKeyPath } = writeKeyPair('main')
	const issuerA = new JwtService({ issuer: 'issuer-a', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath, privateKeyPath }] })
	const issuerB = new JwtService({ issuer: 'issuer-b', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath, privateKeyPath }] })

	const token = issuerA.createToken({}, 60)

	expect(() => issuerB.validateToken(token)).toThrow()
})

test('validateToken: rejects an expired token', async () => {
	const { publicKeyPath, privateKeyPath } = writeKeyPair('main')
	const service = new JwtService({ issuer: 'test', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath, privateKeyPath }] })

	const token = service.createToken({}, -1)

	expect(() => service.validateToken(token)).toThrow(/expired/)
})

test('loadKey: resolves a relative key path against process.cwd(), not this package\'s own directory', () => {
	writeKeyPair('main') // populates `dir` with main.pub/main.key
	const cwdBefore = process.cwd()
	process.chdir(dir)
	try {
		const service = new JwtService({ issuer: 'test', activeKid: 'main', keys: [{ kid: 'main', publicKeyPath: 'main.pub', privateKeyPath: 'main.key' }] })
		const token = service.createToken({ sub: 'user-1' }, 60)
		expect(service.validateToken<{ sub: string }>(token).sub).toBe('user-1')
	} finally {
		process.chdir(cwdBefore)
	}
})

test('key rotation: a token signed by the previous key still validates once it is kept as a read-only key', () => {
	const previous = writeKeyPair('previous')
	const current = writeKeyPair('current')

	const beforeRotation = new JwtService({ issuer: 'test', activeKid: 'previous', keys: [{ kid: 'previous', ...previous }] })
	const oldToken = beforeRotation.createToken({ sub: 'user-1' }, 60)

	const afterRotation = new JwtService({
		issuer: 'test',
		activeKid: 'current',
		keys: [
			{ kid: 'current', ...current },
			{ kid: 'previous', publicKeyPath: previous.publicKeyPath },
		],
	})

	expect(afterRotation.validateToken<{ sub: string }>(oldToken).sub).toBe('user-1')

	const newToken = afterRotation.createToken({ sub: 'user-2' }, 60)
	expect(afterRotation.validateToken<{ sub: string }>(newToken).sub).toBe('user-2')
})
