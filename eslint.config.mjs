import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'release/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ]
    }
  },

  {
    files: ['src/core/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*', 'electron-*', '@electron/*'],
              message:
                'src/core must not import Electron. Core is host-agnostic — it runs in main, in a utilityProcess worker and in plain-Node tests. Keep Electron access in src/main and pass what core needs in as an argument or an injected port.'
            },
            {
              group: ['react', 'react/*', 'react-dom', 'react-dom/*', 'zustand', 'zustand/*'],
              message:
                'src/core must not import React or renderer state libraries. Core holds domain logic, not UI state. Model the behaviour as a plain function or class here and consume it from src/renderer.'
            },
            {
              group: [
                '@renderer/*',
                '../renderer/*',
                '../../renderer/*',
                '../main/*',
                '../../main/*'
              ],
              message:
                'src/core must not reach back into src/main or src/renderer. The dependency arrow points one way: hosts depend on core, never the reverse.'
            }
          ]
        }
      ]
    }
  },

  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
    languageOptions: {
      globals: globals.browser
    }
  },

  {
    files: [
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/workers/**/*.ts',
      'tests/**/*.ts',
      '*.config.ts',
      'eslint.config.mjs'
    ],
    languageOptions: {
      globals: globals.node
    }
  }
)
