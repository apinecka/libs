 
import { Injectable, Logger } from '@nestjs/common'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { ChannelWrapper } from 'amqp-connection-manager'
import { PublishOptions } from 'amqp-connection-manager/dist/types/ChannelWrapper'
import { Channel, ConsumeMessage, MessageProperties } from 'amqplib'
import * as crypto from 'crypto'

import { AmqpClient } from './amqp.client'
import { AMQP_BATCH_CONSUMER_HANDLER, AMQP_CONSUMER_HANDLER, BatchConsumerMeta } from './amqp.decorators'
import { AmqpSchema, ExchangeDefinition, IAmqpSchema, QueueDefinition } from './amqp.schema'

@Injectable()
export class AmqpService {
	private consumers: string[] = []
	private logger = new Logger(AmqpService.name)
	private consumeChannel?: ChannelWrapper = undefined
	private publishChannel?: ChannelWrapper = undefined

	constructor(
		private client: AmqpClient,
		private schema: AmqpSchema<IAmqpSchema<string, string>>,
		private readonly discoveryService: DiscoveryService,
		private readonly metadataScanner: MetadataScanner,
		private readonly reflector: Reflector,
	) {}

	async onApplicationBootstrap() {
		const consumers = this.discoverConsumers()
		await this.setupSchema(this.schema, consumers.map(({ definition }) => definition))
		await this.startConsumers(consumers)
		await this.registerBatchConsumers()
	}

	async onModuleDestroy() {
		await this.client.close()
	}

	private getConsumeChannel(): ChannelWrapper {
		if (!this.consumeChannel) {
			this.consumeChannel = this.client.createChannel({ json: true })
		}
		return this.consumeChannel
	}

	private getPublishChannel(): ChannelWrapper {
		if (!this.publishChannel) {
			this.publishChannel = this.client.createChannel({ json: true })
		}
		return this.publishChannel
	}

	// Declares the shared schema's exchanges/queues/bindings AND every decorated consumer's
	// own (exclusive) queue+bind in a single addSetup() call. amqp-connection-manager only
	// guarantees run order *within* one addSetup callback - if the channel isn't connected
	// yet when addSetup() is called, it just queues the function and returns immediately
	// (see ChannelWrapper.addSetup), and once the connection opens it runs every queued
	// setup concurrently via Promise.all (see ChannelWrapper._onConnect). Two separate
	// addSetup() calls (e.g. one for the schema, one per consumer) can therefore race - a
	// consumer's QueueBind can reach the broker before the schema's exchange has been
	// asserted, failing with 404 NOT_FOUND. This only surfaces on a slow/first-ever
	// connection (e.g. a brand new vhost); on an already-warm connection both addSetup
	// calls run synchronously and in order, which is why this previously went unnoticed.
	private async setupSchema(
		schema: AmqpSchema<IAmqpSchema<string, string>>,
		consumerDefinitions: QueueDefinition<string>[],
	) {
		await this.getConsumeChannel()
			.addSetup(async (channel: Channel) => {
				for (const exchange of Object.values(schema.exchanges)) {
					await channel.assertExchange(exchange.name, exchange.type)
				}
				for (const queue of Object.values(schema.queues)) {
					await this.assertQueue(channel, queue)
				}
				for (const binding of Object.values(schema.bindings)) {
					await channel.bindQueue(binding.targetQueue, binding.sourceExchange, binding.routingKey)
				}
				for (const definition of consumerDefinitions) {
					if (definition.bind) await this.assertQueue(channel, definition)
				}
			})
	}

	private async assertQueue(setupChannel: Channel, definition: QueueDefinition<string>) {
		await setupChannel.assertQueue(definition.name, {
			autoDelete: definition.autoDelete,
			exclusive: definition.exclusive,
		})
		if (definition.bind) {
			await setupChannel.bindQueue(definition.name, definition.bind.exchange.name, definition.bind.routingKey)
		}
	}

	// Pure discovery, no channel/AMQP I/O - safe to call before the schema is set up, so its
	// result can feed setupSchema()'s single addSetup() call (see the comment there).
	private discoverConsumers(): { definition: QueueDefinition<string>, cb: ProcessCb<unknown> }[] {
		const instances = [...this.discoveryService.getControllers(), ...this.discoveryService.getProviders()]
		const consumers: { definition: QueueDefinition<string>, cb: ProcessCb<unknown> }[] = []
		for (const { instance } of instances) {
			if (typeof instance !== 'object') continue
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			for (const methodName of this.metadataScanner.getAllMethodNames(instance)) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
				const definition: QueueDefinition<string> = this.reflector.get(AMQP_CONSUMER_HANDLER, instance[methodName])
				if (definition) {
					consumers.push({
						definition,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
						cb: (...args: unknown[]) => instance[methodName](...args),
					})
				}
			}
		}
		return consumers
	}

	private async registerBatchConsumers() {
		const instances = [...this.discoveryService.getControllers(), ...this.discoveryService.getProviders()]
		for (const { instance } of instances) {
			if (typeof instance !== 'object') continue
			// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
			for (const methodName of this.metadataScanner.getAllMethodNames(instance)) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
				const batchMeta: BatchConsumerMeta = this.reflector.get(AMQP_BATCH_CONSUMER_HANDLER, instance[methodName])
				if (batchMeta) {
					await this.createBatchConsumer({
						definition: batchMeta.definition,
						flushIntervalMs: batchMeta.flushIntervalMs,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
						handler: (batch: unknown[]) => instance[methodName](batch),
					})
				}
			}
		}
	}

	private async startConsumers(consumers: { definition: QueueDefinition<string>, cb: ProcessCb<unknown> }[]) {
		for (const { definition, cb } of consumers) {
			await this.createConsumer(definition, cb)
		}
	}

	// The consumer's queue (and its bind, if any) was already asserted as part of
	// setupSchema()'s single addSetup() call - this only starts consuming from it.
	private async createConsumer(
		definition: QueueDefinition<string>,
		cb: ProcessCb<unknown>,
	) {
		const channel = this.getConsumeChannel()

		const consume = await channel
			.consume(
				definition.name,
				(message: ConsumeMessage) => void this.processMessage({
					cb,
					channel,
					definition,
					message,
				}),
				{ prefetch: definition.prefetch },
			)

		this.consumers.push(consume.consumerTag)
	}
	
	private async processMessage({ channel, message, definition, cb }: {
		channel: ChannelWrapper
		message: ConsumeMessage
		definition: QueueDefinition<string>
		cb: ProcessCb<unknown>,
	}) {
		try {
			if (!definition.silent) this.logger.debug(`[${definition.name}] Consumed`)
			await cb(JSON.parse(message.content.toString()), message.properties)
			channel.ack(message)
			if (!definition.silent) this.logger.debug(`[${definition.name}] ACK`)
		} catch (err) {
			this.logger.error(
				{ err },
				`[${definition.name}] NACK -> DROP`,
			)
			channel.nack(message, undefined, false)
		}
	}

	async createBatchConsumer<T>({
		definition,
		flushIntervalMs,
		handler,
	}: {
		definition: QueueDefinition<string>
		flushIntervalMs: number
		handler: (batch: T[]) => Promise<void>
	}) {
		const batchSize = definition.prefetch ?? 1
		const channel = this.client.createChannel({ json: false })
		const buffer: Array<{ data: T; message: ConsumeMessage }> = []
		let flushTimer: ReturnType<typeof setTimeout> | null = null
		let flushing = false

		const flush = async () => {
			if (buffer.length === 0 || flushing) return
			flushing = true
			if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null }

			const batch = buffer.splice(0)
			try {
				await handler(batch.map(b => b.data))
				for (const { message } of batch) channel.ack(message)
				if (!definition.silent) this.logger.debug(`[${definition.name}] Batch ACK (${batch.length})`)
			} catch (err) {
				this.logger.error({ err }, `[${definition.name}] Batch NACK -> DROP (${batch.length})`)
				for (const { message } of batch) channel.nack(message, false, false)
			} finally {
				flushing = false
				if (buffer.length > 0) scheduleFlush()
			}
		}

		const scheduleFlush = () => {
			if (flushTimer === null && !flushing && buffer.length > 0) {
				flushTimer = setTimeout(() => { flushTimer = null; void flush() }, flushIntervalMs)
			}
		}

		await channel.consume(
			definition.name,
			(message: ConsumeMessage) => {
				buffer.push({ data: JSON.parse(message.content.toString()) as T, message })
				if (buffer.length >= batchSize) {
					void flush()
				} else {
					scheduleFlush()
				}
			},
			{ noAck: false, prefetch: batchSize },
		)

		this.logger.log(`[${definition.name}] Batch consumer registered (batchSize=${batchSize}, interval=${flushIntervalMs}ms)`)
	}

	async publish<Data>(definition: QueueDefinition<string> | ExchangeDefinition<string>, data: PublishData<Data>) {
		const publishOptions: PublishOptions = {
			messageId: crypto.randomUUID(),
		}

		if ('type' in definition) {
			const channel = this.getPublishChannel()
			await channel.publish(definition.name, data.routingKey || '*', data.content, publishOptions)
			this.logger.debug(`[${definition.name}][exchange] Published`)
		} else {
			const channel = this.getPublishChannel()
			await channel.sendToQueue(definition.name, data.content, publishOptions)
			if (!definition.silent) this.logger.debug(`[${definition.name}][queue] Published`)
		}
	}
}

type ProcessCb<Data> = (data: Data, properties: MessageProperties) => void | Promise<void>

interface PublishData<Data> {
	content: Data,
	routingKey?: string
}
