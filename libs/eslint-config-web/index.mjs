import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
	{ ignores: ['**/dist/**', '**/src/api/schema/**'] },
	{
		files: ['**/*.{ts,tsx}'],
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		plugins: {
			'react-hooks': reactHooks,
			'react-refresh': reactRefresh,
			'simple-import-sort': importSort,
			'unused-imports': unusedImports,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

			'indent': ['error', 'tab', { SwitchCase: 1 }],
			'linebreak-style': ['error', 'unix'],
			'no-multi-spaces': ['error'],
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-namespace': 'off',
			'simple-import-sort/imports': 'error',
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'warn',
				{ vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
			],
		},
	},
)
