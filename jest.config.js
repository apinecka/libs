/** @type {import('jest').Config} */
module.exports = {
	rootDir: '.',
	testEnvironment: 'node',
	testRegex: '.*\\.spec\\.ts$',
	transform: {
		'^.+\\.ts$': 'ts-jest',
	},
	moduleFileExtensions: ['js', 'json', 'ts'],
	testPathIgnorePatterns: ['/node_modules/', '/dist/'],
	// Spec files share a single real Redis instance (see docker-compose.yml) - running them
	// in parallel workers causes flushall() in one file to race with another's assertions.
	maxWorkers: 1,
	forceExit: true,
}
