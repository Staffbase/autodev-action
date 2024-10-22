// @ts-check

import js from '@eslint/js'
import ts from 'typescript-eslint'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import vitest from 'eslint-plugin-vitest'

export default ts.config(
  {
    ignores: ['**/dist/', '**/lib/', '**/node_modules/']
  },
  js.configs.recommended,
  ...ts.configs.strictTypeChecked,
  ...ts.configs.stylisticTypeChecked,
  {
    languageOptions: {
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json'
      }
    }
  },
  {
    files: ['**.{cjs.mjs,ts}'],
    ...ts.configs.disableTypeChecked
  },
  {
    rules: {
      '@typescript-eslint/no-unsafe-return': 0,
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface']
    }
  },
  {
    plugins: {
      'simple-import-sort': simpleImportSort
    },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error'
    }
  },
  {
    files: ['**.test.ts'], // or any other pattern
    plugins: {
      vitest
    },
    rules: {
      ...vitest.configs.recommended.rules, // you can also use vitest.configs.all.rules to enable all rules
      'vitest/max-nested-describe': ['error', {max: 3}] // you can also modify rules' behavior using option like this
    }
  }
)
