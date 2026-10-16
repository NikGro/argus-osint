import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['tests/fixtures/**', 'data/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['static/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-binary-expression': 'error'
    }
  },
  { files: ['static/transform-worker.js'], languageOptions: { globals: globals.worker } }
];
