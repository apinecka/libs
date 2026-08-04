# @apinecka/amqp

NestJS module for AMQP/RabbitMQ built on top of
[`amqp-connection-manager`](https://www.npmjs.com/package/amqp-connection-manager): declarative
exchange/queue/binding schemas, decorator-based consumers, batch consumers, and a small
publish helper.

## Install

```bash
npm install @apinecka/amqp amqp-connection-manager amqplib @nestjs/common @nestjs/core
```

## Usage

```ts
import { AmqpModule, AmqpSchema } from '@apinecka/amqp'

const schema = AmqpSchema.create()
	.addQueue({ name: 'logs.publish', prefetch: 100 })

@Module({
	imports: [
		AmqpModule.forRoot({
			urls: ['amqp://user:pass@host/vhost'],
			schema,
		}),
	],
})
export class AppModule {}
```

Consume a queue with a decorator on any provider/controller method:

```ts
import { AmqpConsumer } from '@apinecka/amqp'

@AmqpConsumer(schema.queues['logs.publish'])
async handle(data: LogEntry) {
	// ...
}
```

See `src/amqp.decorators.ts` for the full set of decorators (single-message and batch
consumers) and `src/amqp.schema.ts` for building exchange/queue/binding schemas.

## Peer dependencies

- `@nestjs/common` and `@nestjs/core` — the module and decorators are NestJS-specific.
- `amqp-connection-manager` — connection/channel management with auto-reconnect.
- `amqplib` — required transitively by `amqp-connection-manager`.

## License

MIT
