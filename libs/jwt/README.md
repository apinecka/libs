# @apinecka/jwt

NestJS module for unified JWT handling, built on
[`jsonwebtoken`](https://www.npmjs.com/package/jsonwebtoken): RS512-signed tokens, multi-key
rotation via key id (`kid`), and request/payload helpers.

## Install

```bash
npm install @apinecka/jwt jsonwebtoken @nestjs/common
```

## Usage

```ts
import { JwtModule } from '@apinecka/jwt'

@Module({
	imports: [
		JwtModule.forRoot({
			issuer: 'my-app',
			activeKid: 'main',
			keys: [
				{ kid: 'main', publicKeyPath: '../../data/keys/public', privateKeyPath: '../../data/keys/private' },
			],
		}),
	],
})
export class AppModule {}
```

```ts
import { JwtService } from '@apinecka/jwt'

@Injectable()
export class AuthService {
	constructor(private jwt: JwtService) {}

	login(userId: string) {
		return this.jwt.createToken({ sub: userId }, 60 * 60) // expires in 1 hour
	}

	authenticate(token: string) {
		return this.jwt.validateToken<{ sub: string }>(token) // throws when invalid/expired
	}
}
```

`JwtService` also exposes `getPublicKey()`, returning the active key's public key (e.g. for a
JWKS-style endpoint).

`JwtModule.forRoot()` registers `JwtService` as a global provider, so it does not need to be
imported in every feature module.

### Request helpers

`JwtHelpers` provides framework-agnostic helpers for pulling a token out of a request and reading
its payload without verifying it:

```ts
import { JwtHelpers } from '@apinecka/jwt'

const token = JwtHelpers.extractBearerToken(req.headers) // reads the "Authorization: Bearer <token>" header
const payload = JwtHelpers.getJWTPayload<{ sub: string }>(token) // decodes the payload without verifying the signature
```

`JwtHelpers.getReadJwtOptions`/`getWriteJwtOptions` return the `jsonwebtoken` verify/sign options
(`RS512`, issuer, kid) that `JwtService` itself uses, in case you need to call `jsonwebtoken`
directly. `JwtHelpers.validateToken` is the underlying single-key verify that `JwtService` uses
for each candidate key.

### Key rotation

`keys` may list more than one key id. `activeKid` selects which one signs new tokens; it must have
both a public and a private key. Every other entry is read-only (public key only) and stays
available so tokens it already signed keep validating until they expire — keep the previous key
around for as long as its longest-lived token can still be presented, then remove it:

```ts
JwtModule.forRoot({
	issuer: 'my-app',
	activeKid: '2026-09',
	keys: [
		{ kid: '2026-09', publicKeyPath: './keys/2026-09.pub', privateKeyPath: './keys/2026-09.key' },
		{ kid: '2026-03', publicKeyPath: './keys/2026-03.pub' }, // previous key, verify-only
	],
})
```

`validateToken` picks the key by the `kid` embedded in the token's header; a token with no
recognizable `kid` (or an unknown one) is rejected.

`publicKeyPath`/`privateKeyPath` may be absolute, or relative — relative paths are resolved
against `process.cwd()`, i.e. wherever the app was started from, the same as e.g.
`@apinecka/drizzle`'s `migrationsPath`. Pass an absolute path (`path.resolve(__dirname, ...)`)
instead if your app's cwd isn't guaranteed to be its own root - a bundler that inlines everything
into one file, or a process manager that launches from a different directory.

On construction, `JwtService` signs and validates a throwaway token with the active key pair and
throws if that round-trip fails, so a misconfigured key pair (mismatched keys, unreadable file,
wrong format) fails fast at boot instead of surfacing later on the first real token.

## Generating keys

Tokens are signed with `RS512` (RSA + SHA-512), so each key pair must be an RSA key. Generate a
4096-bit pair:

```bash
ssh-keygen -t rsa -b 4096 -m PEM -E SHA512 -f private
openssl rsa -in private -pubout -outform PEM -out public
```

This produces `private` (PKCS#1 PEM, keep secret) and `public` (PEM). Point `privateKeyPath` /
`publicKeyPath` at them. Store the private key outside version control (e.g. mounted as a secret)
and only commit `public` if you need it checked in for reference.

To rotate keys: generate a new pair under a new `kid`, add it to `keys` and switch `activeKid` to
it, keep the previous entry with only its `publicKeyPath` for as long as tokens signed with it can
still be outstanding, then remove it once they've all expired.

## Peer dependencies

- `@nestjs/common` — the module is NestJS-specific.
- `jsonwebtoken` — the underlying JWT implementation.

## License

MIT
