export interface DrizzleCredentials {
	host: string
	port?: number
	user?: string
	password?: string
	database: string
	/** Max connection pool size. Defaults to 4. */
	pool?: number
}
