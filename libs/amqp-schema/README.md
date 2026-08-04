# @apinecka/amqp-schema

Shared AMQP schema for the apinecka logs pipeline: defines the `logs.publish` queue and the
`LogEntry`/`LogLevel` shape published to it, built on top of [`@apinecka/amqp`](https://www.npmjs.com/package/@apinecka/amqp).

This package exists so that every producer/consumer of the logs queue - regardless of which
repo or service it lives in - shares one compiled definition of the queue and message shape,
instead of each side hand-maintaining a copy.

## Install

```bash
npm install @apinecka/amqp-schema @apinecka/amqp
```

## Usage

```ts
import { EnverAmqp } from '@apinecka/amqp-schema'

const { schema, LogLevel } = EnverAmqp

// Publish
await amqpService.publish(schema.queues['logs.publish'], {
	content: {
		level: LogLevel.error,
		message: 'Something went wrong',
		appName: 'my-service',
		timestamp: new Date().toISOString(),
	} satisfies EnverAmqp.LogEntry,
})
```

```ts
import { AmqpConsumer } from '@apinecka/amqp'
import { EnverAmqp } from '@apinecka/amqp-schema'

@AmqpConsumer(EnverAmqp.schema.queues['logs.publish'])
async handleLog(entry: EnverAmqp.LogEntry) {
	// ...
}
```

## License

MIT
