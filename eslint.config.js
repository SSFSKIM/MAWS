// CommonJS on purpose: package.json has no "type": "module" (main, preload and the hosts are CJS).
const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const tseslint = require('typescript-eslint');
// P3-A start
const { builtinModules } = require('node:module');

// §4.10 of docs/doperpowers/plans/2026-10-12-p3-co-work.md: src/artifacts/ (the editors, the schema, the provider, the
// kinds' guides) runs in a renderer today and a web client in P4, so it imports no Electron and no Node module and
// never reaches for the preload's `window.maws`; the renderer adapts it through `ArtifactHost` (src/artifacts/host.ts).
const PORTABLE = 'src/artifacts/ is portable (§4.10): no Electron, no Node, no window.maws; reach the app through ArtifactHost (src/artifacts/host.ts).';
const NODE_MODULES = builtinModules.filter((name) => !name.startsWith('_'));
const PORTABLE_PATHS = ['electron', ...NODE_MODULES].map((name) => ({ name, message: PORTABLE }));
const PORTABLE_PATTERNS = [{ group: ['node:*'], message: PORTABLE }];
// esquery's regex literal cannot hold a `/`, so a subpath's slash is matched by `.`.
const PORTABLE_DYNAMIC = new RegExp(`^(?:node:.*|electron|${NODE_MODULES.map((name) => name.replace(/\//g, '.')).join('|')})$`);
// Decision Log 25: Yjs and its ProseMirror binding are called only from the binding module, so a re-pin edits one
// directory. `@y/protocols` (awareness) stays importable anywhere.
const YJS_PATTERNS = [
  {
    group: ['@y/y', '@y/y/*', '@y/prosemirror', '@y/prosemirror/*'],
    message: 'Yjs is called only through the binding module, src/artifacts/yjs/ (Decision Log 25): import from there, or add what you need to it.',
  },
];
// `no-restricted-imports` does not see `import()`; this does (`.` again stands for the slash).
const YJS_DYNAMIC = { selector: 'ImportExpression[source.value=/^@y.(?:y|prosemirror)(?:\\W.*)?$/]', message: YJS_PATTERNS[0].message };
const PORTABLE_DYNAMIC_SYNTAX = { selector: `ImportExpression[source.value=/${PORTABLE_DYNAMIC.source}/]`, message: PORTABLE };
// P3-A end
// P3-B start: schema parity (D4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md). The document's ProseMirror
// schema is built in one module, src/artifacts/document/schema.ts, so the host's writer and every editor derive the same
// Yjs storage keys from it; a second `getSchema` or a mark or node created elsewhere is a second schema. The composer's
// Tiptap schema is a different one and keeps its own. Core's `no-restricted-syntax` is configured per block above (a
// later block's options replace an earlier one's), so this check runs the same rule under its own name and displaces
// none of theirs.
const { builtinRules } = require('eslint/use-at-your-own-risk');
const ONE_SCHEMA_MESSAGE =
  "The document schema is built only in src/artifacts/document/schema.ts (schema parity): import extensions() or schemaFor() from there, or add the node or mark to it.";
const ONE_SCHEMA = [
  { selector: "CallExpression[callee.name='getSchema']", message: ONE_SCHEMA_MESSAGE },
  { selector: "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(?:Mark|Node)$/][callee.property.name='create']", message: ONE_SCHEMA_MESSAGE },
];
const mawsSchemaPlugin = { rules: { 'one-schema': builtinRules.get('no-restricted-syntax') } };
// P3-B end

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
  // P3-A start: `no-restricted-syntax`'s options are replaced per block too, so the blocks below that set it for parts of
  // src/ repeat YJS_DYNAMIC; this one covers the rest of src/ outside src/artifacts/.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/artifacts/**'],
    rules: { 'no-restricted-syntax': ['error', YJS_DYNAMIC] },
  },
  // P3-A end
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
        YJS_DYNAMIC, // P3-A
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
        YJS_DYNAMIC, // P3-A
      ],
    },
  },
  // E4b end
  // P3-A start: one `no-restricted-imports` per file (a later block's options replace an earlier one's), so the three
  // blocks below partition src/ by what each part may not import.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/artifacts/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: YJS_PATTERNS }] },
  },
  {
    files: ['src/artifacts/**/*.{ts,tsx}'],
    ignores: ['src/artifacts/yjs/**'],
    rules: { 'no-restricted-imports': ['error', { paths: PORTABLE_PATHS, patterns: [...PORTABLE_PATTERNS, ...YJS_PATTERNS] }] },
  },
  {
    files: ['src/artifacts/yjs/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: PORTABLE_PATHS, patterns: PORTABLE_PATTERNS }] },
  },
  {
    files: ['src/artifacts/**/*.{ts,tsx}'],
    ignores: ['src/artifacts/yjs/**'],
    rules: { 'no-restricted-syntax': ['error', PORTABLE_DYNAMIC_SYNTAX, YJS_DYNAMIC] },
  },
  {
    files: ['src/artifacts/yjs/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', PORTABLE_DYNAMIC_SYNTAX] },
  },
  {
    files: ['src/artifacts/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'maws', message: PORTABLE },
        { object: 'globalThis', property: 'maws', message: PORTABLE },
      ],
      'no-restricted-globals': ['error', ...['process', 'Buffer', 'global', '__dirname', '__filename'].map((name) => ({ name, message: PORTABLE }))],
    },
  },
  // P3-A end
  // P3-B start: the one-schema rule (above).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/artifacts/document/schema.ts', 'src/renderer/src/composer/**'],
    plugins: { 'maws-schema': mawsSchemaPlugin },
    rules: { 'maws-schema/one-schema': ['error', ...ONE_SCHEMA] },
  },
  // P3-B end
);
