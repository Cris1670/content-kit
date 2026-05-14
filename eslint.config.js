const browserGlobals = {
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  HTMLImageElement: 'readonly',
  HTMLInputElement: 'readonly',
  MouseEvent: 'readonly',
  MutationObserver: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Uint8Array: 'readonly',
  atob: 'readonly',
  chrome: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  indexedDB: 'readonly',
  setTimeout: 'readonly',
  window: 'readonly'
};

const nodeGlobals = {
  Buffer: 'readonly',
  console: 'readonly',
  process: 'readonly'
};

export default [
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**']
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        ...nodeGlobals
      }
    },
    rules: {
      'array-callback-return': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
      'no-constant-binary-expression': 'error',
      'no-duplicate-imports': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-prototype-builtins': 'error',
      'no-return-await': 'error',
      'no-shadow': 'warn',
      'no-undef': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'object-shorthand': ['error', 'always'],
      'prefer-const': 'error'
    }
  }
];
