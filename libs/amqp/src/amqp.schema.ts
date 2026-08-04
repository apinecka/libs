export class AmqpSchema<S extends IAmqpSchema<never, never>> {
	public queues: S['queues']
	public exchanges: S['exchanges']
	public bindings: Binding<S>[] = []

	constructor(queues: S['queues'], exchanges: S['exchanges'], bindings: Binding<S>[]) {
		this.queues = queues
		this.exchanges = exchanges
		this.bindings = [...bindings]
	}

	static create() {
		return new AmqpSchema({}, {}, [])
	}

	addQueue<Name extends string>(def: QueueDefinition<Name>) {
		return new AmqpSchema<
			IAmqpSchema<
				keyof S['queues'] extends never ? Name : keyof S['queues'] | Name,
				keyof S['exchanges']
			>
		>(
			{ ...this.queues, [def.name]: def } as { [name in keyof S['queues'] extends never ? Name : keyof S['queues'] | Name]: QueueDefinition<string> },
			this.exchanges as { [name in keyof S['exchanges']]: ExchangeDefinition<string> },
			this.bindings as unknown as Binding<IAmqpSchema<keyof S['queues'] extends never ? Name : keyof S['queues'] | Name, keyof S['exchanges']>>[],
		)
	}

	addExchange<Name extends string>(def: ExchangeDefinition<Name>) {
		return new AmqpSchema<
			IAmqpSchema<
				keyof S['queues'],
				keyof S['exchanges'] extends never ? Name : keyof S['exchanges'] | Name
			>
		>(
			this.queues as { [name in keyof S['queues']]: QueueDefinition<string> },
			{ ...this.exchanges, [def.name]: def } as { [name in keyof S['exchanges'] extends never ? Name : keyof S['exchanges'] | Name]: ExchangeDefinition<string> },
			this.bindings as unknown as Binding<IAmqpSchema<keyof S['queues'], keyof S['exchanges'] extends never ? Name : keyof S['exchanges'] | Name>>[],
		)
	}

	bindQueueToExchange(def: Binding<S>) {
		this.bindings.push(def)
		return this
	}

	getConsumeDefinition(name: keyof S['queues']) {
		return {
			prefetch: 1,
			...this.queues[name],
		}
	}

	getExchangeDefinition(name: keyof S['exchanges']) {
		return this.exchanges[name]
	}

	getPublishQueueDefinition(name: keyof S['queues']) {
		return this.queues[name]
	}

	getPublishExchangeDefinition(name: keyof S['exchanges']) {
		return this.exchanges[name]
	}
}

export interface IAmqpSchema<Queues extends string | number | symbol, Exchanges extends string | number | symbol> {
	queues: {
		[name in Queues]: QueueDefinition<string>
	}
	exchanges: {
		[name in Exchanges]: ExchangeDefinition<string>
	}
}

export interface QueueDefinition<Name extends string> {
	name: Name
	/** Defaults to `1` */
	prefetch?: number
	/** Defaults to `false` */
	exclusive?: boolean
	/** Defaults to `false` */
	autoDelete?: boolean
	/** Binds dynamically to the exchange */
	bind?: {
		exchange: ExchangeDefinition<string>
		routingKey: string
	}
	/** Suppress debug logs for consumed and published messages (e.g. high-throughput queues) */
	silent?: boolean
}

export interface ExchangeDefinition<Name extends string> {
	name: Name
	type: 'topic' | 'fanout'
}

interface Binding<S extends IAmqpSchema<string, string>> {
	sourceExchange: keyof S['exchanges']
	targetQueue: keyof S['queues']
	routingKey: string
}
