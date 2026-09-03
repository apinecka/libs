# apinecka-libs

Public npm packages published under the [`@apinecka`](https://www.npmjs.com/settings/apinecka/packages)
scope.

| Package | Description |
| --- | --- |
| [`@apinecka/amqp`](libs/amqp) | NestJS module for AMQP/RabbitMQ on top of `amqp-connection-manager` |
| [`@apinecka/amqp-schema`](libs/amqp-schema) | Shared AMQP schema/contract for the apinecka logs pipeline |
| [`@apinecka/eslint-config-be`](libs/eslint-config-be) | Shared ESLint flat config for Node.js/NestJS backends |
| [`@apinecka/eslint-config-web`](libs/eslint-config-web) | Shared ESLint flat config for React/TypeScript frontends |
| [`@apinecka/drizzle`](libs/drizzle) | NestJS module for Drizzle ORM over Postgres: connection wiring, migrations, and test-DB helpers |
| [`@apinecka/jwt`](libs/jwt) | NestJS module for unified JWT handling: RS512 tokens and multi-key rotation |
| [`@apinecka/redis`](libs/redis) | NestJS module for Redis: cache-aside helper and distributed locks |

Each package builds and publishes independently from its own directory (`npm install && npm run build && npm publish`).
See [`.github/workflows/libs-publish.yml`](.github/workflows/libs-publish.yml) for the CI publish flow.

## License

MIT
