import { DynamicModule, Module } from '@nestjs/common'
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'

import { AmqpClient } from './amqp.client'
import { AmqpSchema, IAmqpSchema } from './amqp.schema'
import { AmqpService } from './amqp.service'

export const AMQP_SCHEMA_KEY = 'AMQP_SCHEMA'

@Module({})
export class AmqpModule {
	static forRoot(config: AmqpConfig): DynamicModule {
		return {
			module: AmqpModule,
			imports: [DiscoveryModule],
			providers: [
				{
					provide: AmqpService,
					useFactory: (
						discoveryService: DiscoveryService,
						metadataScanner: MetadataScanner,
						reflector: Reflector
					) => new AmqpService(
						new AmqpClient(config.urls),
						config.schema,
						discoveryService,
						metadataScanner,
						reflector,
					),
					inject: [
						DiscoveryService,
						MetadataScanner,
						Reflector,
					],
				},
			],
			exports: [AmqpService],
			global: true,
		}
	}
}

interface AmqpConfig {
	/** @example ['amqp://user:pass@host.com/vhost'] */
	urls: string[]
	schema: AmqpSchema<IAmqpSchema<string, string>>
}
