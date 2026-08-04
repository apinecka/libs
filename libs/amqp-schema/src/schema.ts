import { AmqpSchema } from '@apinecka/amqp'

/**
 * Cross-repo contract: enver's `api`/`workers` publish to the `logs.publish` queue defined
 * here; this repo's `logs-api` consumes it. Both repos must define this queue and the
 * `LogEntry` shape identically (including `LogLevel`'s members) and point at the same
 * RabbitMQ broker - there is no compiler-enforced agreement across the repo boundary. Keep
 * in sync by hand with enver's `libs/amqp-schema/src/schema.ts`.
 */
export namespace EnverAmqp {
	export enum LogLevel {
		log = 'log',
		error = 'error',
		warn = 'warn',
		debug = 'debug',
		verbose = 'verbose',
		fatal = 'fatal',
	}

	export type LogEntry = {
		level: LogLevel
		message: string
		context?: string
		appName: string
		timestamp: string
	}

	export const schema = AmqpSchema.create()
		.addQueue({ name: 'logs.publish', prefetch: 100, silent: true })
}
