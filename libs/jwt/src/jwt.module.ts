import { DynamicModule, Global, Module } from '@nestjs/common'

import { JwtService, JwtServiceOptions } from './jwt.service'

@Module({})
@Global()
export class JwtModule {
	static forRoot(options: JwtServiceOptions): DynamicModule {
		return {
			module: JwtModule,
			imports: [],
			providers: [
				{ provide: JwtService, useFactory: () => new JwtService(options) },
			],
			exports: [JwtService],
			global: true,
		}
	}
}
