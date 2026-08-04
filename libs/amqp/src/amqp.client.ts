import { Injectable, Logger } from '@nestjs/common'
import { AmqpConnectionManager,AmqpConnectionManagerOptions, connect, CreateChannelOpts } from 'amqp-connection-manager'

@Injectable()
export class AmqpClient {
	private logger = new Logger(AmqpClient.name)

	private connection: AmqpConnectionManager

	constructor (urls: string[], options?: AmqpConnectionManagerOptions) {
		this.connection = connect(urls, options)

		this.connection.on('connect', ({ url }) => {
			const resolvedUrl = typeof url === 'string'
				? url.split('@')[1]
				: url?.hostname || '<no-url>'
			this.logger.log(`AMQP connected to "${resolvedUrl}"`)
		})

		this.connection.on('connectFailed', ({ err, url }) => {
			const resolvedUrl = typeof url === 'string'
				? url.split('@')[1]
				: url?.hostname || '<no-url>'
			this.logger.error(`AMQP failed to connect to "${resolvedUrl}"`, err)
		})

		this.connection.on('disconnect', ({ err }) => {
			this.logger.error('AMQP disconnected', err)
		})
	}

	createChannel(options: CreateChannelOpts) {
		return this.connection.createChannel(options)
	}

	async close() {
		await this.connection.close()
	}
}
