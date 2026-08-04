import { SetMetadata } from '@nestjs/common'

import { ExchangeDefinition, QueueDefinition } from './amqp.schema'

export const AMQP_CONSUMER_HANDLER = 'AMQP_CONSUMER_HANDLER'
export const AMQP_BATCH_CONSUMER_HANDLER = 'AMQP_BATCH_CONSUMER_HANDLER'

export interface BatchConsumerMeta {
	definition: QueueDefinition<string>
	flushIntervalMs: number
}

export const AmqpConsumer = (definition: QueueDefinition<string>) => {
	return SetMetadata(AMQP_CONSUMER_HANDLER, definition)
}

export const AmqpBatchConsumer = (
	definition: QueueDefinition<string>,
	options: { flushIntervalMs: number },
) => SetMetadata(AMQP_BATCH_CONSUMER_HANDLER, { definition, flushIntervalMs: options.flushIntervalMs } satisfies BatchConsumerMeta)

export const AmqpConsumerBindExclusively = ({ definition, instanceId }: {
	instanceId: string
	definition: ExchangeDefinition<string>
}) => {
	return SetMetadata(AMQP_CONSUMER_HANDLER, {
		name: `${definition.name}.${instanceId}`,
		exclusive: true,
		autoDelete: true,
		bind: {
			exchange: definition,
			routingKey: instanceId,
		}
	} satisfies QueueDefinition<string>)
}

