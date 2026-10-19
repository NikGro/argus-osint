import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['tests/fixtures/**', 'data/**', 'node_modules/**', 'static/app.js'] },
  js.configs.recommended,
  {
    files: ['static/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-binary-expression': 'error'
    }
  },
  {
    files: ['static/**/*.jsx'],
    rules: {
      'no-unused-vars': [
        'error',
        { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^([A-Z]|_)' }
      ]
    }
  },
  { files: ['static/transform-worker.js'], languageOptions: { globals: globals.worker } }
];
