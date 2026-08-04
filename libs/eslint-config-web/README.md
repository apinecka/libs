# @apinecka/eslint-config-web

Shared [ESLint flat config](https://eslint.org/docs/latest/use/configure/configuration-files) for
apinecka's React/TypeScript frontends: tabs, single quotes, no semicolons, import sorting,
unused-import cleanup, and React Hooks/Fast Refresh rules.

## Install

```bash
npm install --save-dev @apinecka/eslint-config-web eslint @eslint/js typescript-eslint globals eslint-plugin-react-hooks eslint-plugin-react-refresh eslint-plugin-simple-import-sort eslint-plugin-unused-imports
```

## Usage

`eslint.config.mjs`:

```js
import webConfig from '@apinecka/eslint-config-web'

export default webConfig
```

## Requirements

- ESLint 9 (flat config)
- React project using JSX/TSX

## License

MIT
