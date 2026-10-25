import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**']),

  js.configs.recommended,
  // Type-aware rules: catch floating promises, unsafe `any` flow, etc.
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // `const { secret, ...rest } = obj` is the idiomatic way to drop a field: allow it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Express 5 forwards rejected promises from async handlers to the error middleware,
      // so passing an async function as a route handler is safe.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },

  // Plain JS config files aren't part of any tsconfig, so skip type-aware rules for them.
  { files: ['**/*.{js,mjs,cjs}'], extends: [tseslint.configs.disableTypeChecked] },

  // Must be last: turns off rules that would fight Prettier's formatting.
  prettier,
);
