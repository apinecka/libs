import tsParser from '@typescript-eslint/parser'
import importSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import eslintTs from 'typescript-eslint'

export default [
	...eslintTs.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
	},
	eslintTs.configs.eslintRecommended,
	{
		languageOptions: {
			parser: tsParser,
		},
		plugins: {
			'simple-import-sort': importSort,
			'unused-imports': unusedImports
		},
		rules: {
			'no-console': 1,
			'indent': [
				'error',
				'tab',
				{
					ignoredNodes: ['PropertyDefinition'],
					'FunctionExpression': {
						parameters: 1,
						body: 1,
					},
					SwitchCase: 1
				}
			],
			'@/indent': [
				'error', 
				'tab', 
				{ 
					'SwitchCase': 1,
					'ignoredNodes': ['PropertyDefinition[decorators]', 'TSMergedDeclarationSpaced']
				}
			],

			'linebreak-style': ['error', 'unix'],
			
			'no-multi-spaces': ['error'],
			'@/semi': [2, 'never'],
			'@/quotes': [2, 'single'],
			'simple-import-sort/imports': 'error',
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-namespace': 'off',
			'unused-imports/no-unused-imports': 'error',
			'unused-imports/no-unused-vars': [
				'warn',
				{ vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' }
			],
			'@typescript-eslint/no-floating-promises': 'error',
			'@typescript-eslint/no-misused-promises': 'error'
		}
	}
]