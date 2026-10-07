// CommonJS on purpose: package.json has no "type": "module" (main, preload and the hosts are CJS).
const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const tseslint = require('typescript-eslint');

module.exports = defineConfig(
  { ignores: ['.doperpowers/', 'out/', 'dist/', 'node_modules/', 'mockups/', 'research/', 'spikes/', 'plugins/', 'test-results/', 'playwright-report/', '.claude/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat.recommended,
  },
  // E4b start: the Chrome import logs only through its typed logger (E4b Design §16), so nothing logs a value.
  {
    files: ['src/main/browser/import/**/*.{ts,tsx}'],
    ignores: ['src/main/browser/import/log.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "MemberExpression[object.name='console']", message: 'Log through importLog in src/main/browser/import/log.ts: nothing under the import logs a value.' },
      ],
    },
  },
  // E4b end
);
