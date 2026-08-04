# @apinecka/eslint-config-be

Shared [ESLint flat config](https://eslint.org/docs/latest/use/configure/configuration-files) for
apinecka's Node.js/NestJS backends: TypeScript, tabs, single quotes, no semicolons, import
sorting, and unused-import cleanup.

## Install

```bash
npm install --save-dev @apinecka/eslint-config-be eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser eslint-plugin-simple-import-sort eslint-plugin-unused-imports
```

## Usage

`eslint.config.mjs`:

```js
import beConfig from '@apinecka/eslint-config-be'

export default beConfig
```

Extend or override further by exporting an array that spreads `beConfig`:

```js
import beConfig from '@apinecka/eslint-config-be'

export default [
	...beConfig,
	{
		rules: {
			'no-console': 'off',
		},
	},
]
```

## Requirements

- ESLint 9 (flat config)
- TypeScript project with `@typescript-eslint/parser` configured via `projectService`

## License

MIT
