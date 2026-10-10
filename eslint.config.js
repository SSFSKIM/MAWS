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
  // P2-F W-V (L154): the React Compiler turned a used postfix `spans[kind]++` into a prefix increment (P2-C, 26ef4b47),
  // so the built app read ordinal + 1 while every uncompiled test passed. In renderer code a postfix `++`/`--` stands
  // only as a statement or a for loop's update, where its value is never read.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'UpdateExpression[prefix=false]:not(ExpressionStatement > UpdateExpression):not(ForStatement > UpdateExpression.update):not(ForStatement > SequenceExpression.update > UpdateExpression)',
          message: 'A postfix ++/-- whose value is read can compile to the prefix form under the React Compiler (L154): save the value you need first (const old = n), then increment or decrement as its own statement (n++).',
        },
      ],
    },
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
