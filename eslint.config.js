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
// P5 O1 M3 start (docs/doperpowers/plans/2026-10-27-p5-o1-seams.md, M3): the machine-bound services, the ones P5 moves
// to mawsd (survey §2 items 1-7 and 12), import no Electron (value, type or dynamic) and not main's open-external (an
// Electron effect): every client-only effect goes through the injected client port (OX4). P5 O3-C moved the spine and
// the checkouts into src/services/, under rule A below; what stays machine-bound under src/main/ is O4's and O5's (the
// library's files, connectors, delivery, the catalog, usage, the gateway), one file allowed with its reason.
const CLIENT_PORT = "A machine-bound service (P5 OX4) imports no Electron and not main's open-external: reach the person's screen through the injected ClientPort (src/shared/client/port.ts).";
const MACHINE_BOUND = ['src/main/{library,connectors,delivery,catalog,usage,gateway}/**/*.{ts,tsx}']; // P5 O6 M1: machine
const MACHINE_BOUND_TESTS = ['src/main/{library,connectors,delivery,catalog,usage,gateway}/**/*.test.{ts,tsx}'];
const MACHINE_BOUND_ALLOWED = [
  'src/main/connectors/legacy-custody.ts', // P5 O4 M2 (U7, D20): safeStorage, read once by the adoption of format 1 grants
];
// `.` stands for the slash, as above
const CLIENT_PORT_DYNAMIC = { selector: 'ImportExpression[source.value=/^(?:electron|.*.open-external)$/]', message: CLIENT_PORT };
// P5 O1 M3 end
// P5 O3-C start (docs/doperpowers/plans/2026-10-28-p5-o3-c-spine-library.md, Interfaces §E): the library, src/services/
// (the spine O3-D moves into mawsd and the checkouts O3-E moves), is composed by its roots from injected dependencies.
// Rule A: it imports nothing from main, mawsd, the renderer or the preload, nor Electron. Rule B: nothing under
// src/main/ but its root imports from it; staying code reads the spine through the view. Tests are exempt from rule B
// (a suite may drive both halves); src/main/app.ts, the root (src/main/index.ts until P5 O5's entry split), imports the
// services entry alone (M4).
const SERVICES_BOUNDARY = {
  regex: '^(\\.\\./)+(main|mawsd|renderer|preload)(/|$)',
  message: 'The services library (src/services/, P5 O3-C rule A) imports nothing from main, mawsd, the renderer or the preload: it takes its commands, intercepts and events through the injected ServicesBus (@shared/spine/bus), and staying code reads it through SpineView (@shared/spine/view).',
};
const READ_THROUGH_VIEW = {
  regex: '^(\\.\\./)+services(/|$)',
  message: "Staying code reads the spine only through SpineView (@shared/spine/view; P5 O3-C rule B): nothing under src/main/ but main's root imports from src/services/.",
};
const ROOT_THROUGH_ENTRY = {
  regex: '^\\.\\./services/(?!entry$)',
  message: "Main's root reaches the services library only through its entry, ../services/entry (P5 O3-C rule B): the roots' view, the checkouts' file reads and the stop functions are all it holds of the library.",
};
// P5 O3-C end
// P5 O10 start (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md, Constraints, "The module"): the endpoint module is
// its own directory with one entry. Its machine key, grant ledger, policy and state code are reached by nothing outside
// it but through src/endpoint/index.ts; its own suites (test/endpoint/) are the module's and reach inside. It imports no
// Electron, O1's rule with no exception (its block below). M10: src/endpoint/presence.ts is its second entry, what mawsd
// reads before it loads the module (whether an enrollment is on disk, the unenrolled status, a read-only command's
// unenrolled answer), importing of it only the pure renderers the module answers with (answers.ts, status.ts).
const ENDPOINT = 'The endpoint module (src/endpoint/) is reached only through its entries, src/endpoint/index.ts and presence.ts (P5 O10): its key, policy and state code stay inside it.';
const ENDPOINT_PATTERNS = [{ regex: '(?:^|/)endpoint/(?!(?:index|presence)(?:\\.ts)?$)', message: ENDPOINT }];
// P5 O10 end
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
// P4-W2L start: English throughout (P4 Decision Log 4). Every age, date and time MAWS shows is written by one module in
// one display locale, src/shared/app/date-format.ts; a date formatter built elsewhere, or a date's toLocaleDateString or
// toLocaleTimeString, writes the system's locale into English copy. The same core rule under its own name, as the
// one-schema check. A Date's toLocaleString is not told from a number's here; the module's header names it too.
const ONE_LOCALE_MESSAGE =
  'Ages, dates and times are written by @shared/app/date-format in its one display locale (P4 Decision Log 4): use its named shapes, or dateTimeFormat for a shape of your own.';
const ONE_LOCALE = [
  { selector: "NewExpression[callee.object.name='Intl'][callee.property.name=/^(?:DateTimeFormat|RelativeTimeFormat|DurationFormat)$/]", message: ONE_LOCALE_MESSAGE },
  { selector: "CallExpression[callee.object.name='Intl'][callee.property.name=/^(?:DateTimeFormat|RelativeTimeFormat|DurationFormat)$/]", message: ONE_LOCALE_MESSAGE },
  { selector: "CallExpression[callee.property.name=/^toLocale(?:Date|Time)String$/]", message: ONE_LOCALE_MESSAGE },
];
const mawsDatesPlugin = { rules: { 'one-locale': builtinRules.get('no-restricted-syntax') } };
// P4-W2L end
// The desk's web app writes its times through the same module, and its counts too (formatCount, formatCompactCount), so
// there the rule also refuses every toLocaleString, a Date's or a number's, and every Intl.NumberFormat: in a browser
// each would write the browser's locale beside the desk's English (the tracker's desk-lane row, 2026-10-21).
const DESK_ONE_LOCALE_MESSAGE =
  "The desk's dates, times and counts are written by @shared/app/date-format in its one display locale (P4 Decision Log 4): formatCount or formatCompactCount for a count, a named shape or dateTimeFormat for a date.";
const DESK_ONE_LOCALE = [
  ...ONE_LOCALE,
  { selector: "CallExpression[callee.property.name='toLocaleString']", message: DESK_ONE_LOCALE_MESSAGE },
  { selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']", message: DESK_ONE_LOCALE_MESSAGE },
  { selector: "CallExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']", message: DESK_ONE_LOCALE_MESSAGE },
];
const DESK_WEB = 'apps/desk-web/src/ runs in a browser (the DC5 plan): no Node or Electron module.'; // DC5
const DESK_WEB_NO_PRELOAD = 'apps/desk-web/src/ runs in a browser with no MAWS preload: `window.maws` does not exist there (the desk composite, DC6).'; // DC6
const DESK_PROTOCOL = 'apps/desk-hub/src/protocol/ is runtime-neutral (the DC3 plan, Constraints): WebCrypto and plain TypeScript, no Workers, Node, or DOM API.'; // DC3
// L154 (P2-F W-V): code built under the React Compiler (the renderer; the desk's web app) never reads a postfix ++/--.
const COMPILED_POSTFIX = {
  selector: 'UpdateExpression[prefix=false]:not(ExpressionStatement > UpdateExpression):not(ForStatement > UpdateExpression.update):not(ForStatement > SequenceExpression.update > UpdateExpression)',
  message: 'A postfix ++/-- whose value is read can compile to the prefix form under the React Compiler (L154): save the value you need first (const old = n), then increment or decrement as its own statement (n++).',
};

module.exports = defineConfig(
  // electron-vite bundles its config to electron.vite.config.<ms>.mjs beside it for the moment it loads it; the gate's
  // static job lints while it builds, and a file listed then gone failed the lint (ENOENT, run 39599150487).
  { ignores: ['.doperpowers/', 'out/', 'dist/', 'node_modules/', 'mockups/', 'research/', 'spikes/', 'plugins/', 'test-results/', 'playwright-report/', '.claude/', 'apps/*/dist/', 'apps/*/.wrangler/', 'electron.vite.config.*.mjs'] }, // DC3: the desk apps' build and wrangler state
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
        COMPILED_POSTFIX,
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
    rules: { 'no-restricted-imports': ['error', { patterns: [...YJS_PATTERNS, ...ENDPOINT_PATTERNS] }] }, // P5 O10: ENDPOINT_PATTERNS
  },
  // P5 O3-C: rule B over the client, its root and suites aside; the machine-bound block below restates it.
  {
    files: ['src/main/**/*.{ts,tsx}'],
    ignores: ['src/main/**/*.test.{ts,tsx}', 'src/main/app.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [...YJS_PATTERNS, ...ENDPOINT_PATTERNS, READ_THROUGH_VIEW] }] },
  },
  // P5 O3-C (M4): rule B over main's root, narrowed to the services entry (P5 O5: the root is app.ts, the entry index.ts
  // imports nothing of the library)
  {
    files: ['src/main/app.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [...YJS_PATTERNS, ...ENDPOINT_PATTERNS, ROOT_THROUGH_ENTRY] }] },
  },
  {
    files: ['src/artifacts/**/*.{ts,tsx}'],
    ignores: ['src/artifacts/yjs/**'],
    rules: { 'no-restricted-imports': ['error', { paths: PORTABLE_PATHS, patterns: [...PORTABLE_PATTERNS, ...YJS_PATTERNS, ...ENDPOINT_PATTERNS] }] }, // P5 O10: ENDPOINT_PATTERNS
  },
  {
    files: ['src/artifacts/yjs/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { paths: PORTABLE_PATHS, patterns: [...PORTABLE_PATTERNS, ...ENDPOINT_PATTERNS] }] }, // P5 O10: ENDPOINT_PATTERNS
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
  // P5 O1 M3: the no-Electron rule over the machine-bound services (above). This is those files' one block of each rule,
  // so it restates src/'s Yjs rules, and rule B (P5 O3-C) but for their suites.
  {
    files: MACHINE_BOUND,
    ignores: [...MACHINE_BOUND_ALLOWED, ...MACHINE_BOUND_TESTS],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: CLIENT_PORT }], patterns: [{ group: ['**/open-external'], message: CLIENT_PORT }, ...YJS_PATTERNS, ...ENDPOINT_PATTERNS, READ_THROUGH_VIEW] }], // P5 O10: ENDPOINT_PATTERNS
      'no-restricted-syntax': ['error', CLIENT_PORT_DYNAMIC, YJS_DYNAMIC],
    },
  },
  {
    files: MACHINE_BOUND_TESTS,
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: CLIENT_PORT }], patterns: [{ group: ['**/open-external'], message: CLIENT_PORT }, ...YJS_PATTERNS, ...ENDPOINT_PATTERNS] }],
      'no-restricted-syntax': ['error', CLIENT_PORT_DYNAMIC, YJS_DYNAMIC],
    },
  },
  // P5 O3-C: rule A (above) over the library, with O1's no-Electron rule and no exception; its files' one block of each
  // rule, so it restates src/'s Yjs and endpoint rules.
  {
    files: ['src/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: CLIENT_PORT }], patterns: [{ group: ['**/open-external'], message: CLIENT_PORT }, ...YJS_PATTERNS, ...ENDPOINT_PATTERNS, SERVICES_BOUNDARY] }],
      'no-restricted-syntax': ['error', CLIENT_PORT_DYNAMIC, YJS_DYNAMIC],
    },
  },
  // P5 O10 start: the endpoint module imports no Electron, O1's rule with no exception; its files' one block of each
  // rule, so it restates src/'s Yjs rules, and leaves out ENDPOINT_PATTERNS, which its own files are free of.
  {
    files: ['src/endpoint/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: CLIENT_PORT }], patterns: [{ group: ['**/open-external'], message: CLIENT_PORT }, ...YJS_PATTERNS] }],
      'no-restricted-syntax': ['error', CLIENT_PORT_DYNAMIC, YJS_DYNAMIC],
    },
  },
  // P5 O2 M5: `mawsd` runs as plain Node where no Electron is installed, O1's rule with no exception; its files' one
  // block of each rule, so it restates src/'s Yjs and endpoint rules (it reaches the endpoint module through its entry).
  {
    files: ['src/mawsd/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: CLIENT_PORT }], patterns: [{ group: ['**/open-external'], message: CLIENT_PORT }, ...YJS_PATTERNS, ...ENDPOINT_PATTERNS] }],
      'no-restricted-syntax': ['error', CLIENT_PORT_DYNAMIC, YJS_DYNAMIC],
    },
  },
  // P5 O10 M10: the built mawsd's endpoint scene is proved with the endpoint's own harness (its hub, carriers, org
  // fixtures and fake sminos), which reach inside the module, so it leaves out ENDPOINT_PATTERNS as the module's own
  // suites do; the rest of mawsd's block stands. Only the suite: mawsd's code reaches the module through its entry.
  {
    files: ['src/mawsd/process-endpoint.test.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: 'electron', message: CLIENT_PORT }], patterns: [{ group: ['**/open-external'], message: CLIENT_PORT }, ...YJS_PATTERNS] }] },
  },
  // Outside src/: the suites (but the module's own) and the e2e specs reach the module through its entry too.
  {
    files: ['test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    ignores: ['test/endpoint/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: ENDPOINT_PATTERNS }] },
  },
  // P5 O7 M1 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "Proves"): the app's RL2 link is proved against
  // the endpoint's own harness (test/endpoint/sub-harness.ts, its org fixtures) and pins its timing to the endpoint's
  // constants, so its suites reach inside the module as the module's own suites do. Only suites: the link's code doesn't.
  {
    files: ['src/main/machines/remote/*.test.ts', 'src/main/org/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: YJS_PATTERNS }] },
  },
  {
    // P5 O8 M1: the org session's suites, against the same hub and endpoint harness; P5 O9 M9 and O7 M2: remote lane A's
    // and lane B's suites, through the same link against the same harness
    files: ['test/machines/**/*.ts', 'test/org/**/*.ts', 'test/lane-a/**/*.ts', 'test/lane-b/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // P5 O10 end
  // P3-B start: the one-schema rule (above).
  {
    files: ['src/**/*.{ts,tsx}'],
    // P3-C (at the merge of B): the deck's slide-text schema, Claude's inline set and no wider, is the slides' one schema
    // module, as the composer's is its own
    ignores: ['src/artifacts/document/schema.ts', 'src/renderer/src/composer/**', 'src/artifacts/slides/editor/text-schema.ts'],
    plugins: { 'maws-schema': mawsSchemaPlugin },
    rules: { 'maws-schema/one-schema': ['error', ...ONE_SCHEMA] },
  },
  // P3-B end
  // P4-W2L start: the one-locale rule (above); tests build their own English oracles.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/shared/app/date-format.ts', 'src/**/*.test.{ts,tsx}', 'src/renderer/src/test-support/**'],
    plugins: { 'maws-dates': mawsDatesPlugin },
    rules: { 'maws-dates/one-locale': ['error', ...ONE_LOCALE] },
  },
  // P4-W2L end
  // DC3 start: the desk hub's protocol module (apps/desk-hub/src/protocol/) is imported by the Worker, the web app, and
  // the fake machine as it stands, so it imports no runtime's module; apps/desk-hub/tsconfig.protocol.json holds its
  // globals to WebCrypto, text encoding, and URL.
  {
    files: ['apps/desk-hub/src/protocol/**/*.ts', 'apps/org-protocol/src/**/*.ts', 'apps/org-protocol/vectors/{index,replay,replay-channel,scenario,scenario-remote}.ts'], // P5-O11 M1: the protocol package; P5-O10 M1: its RL2 vectors
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['electron', ...NODE_MODULES].map((name) => ({ name, message: DESK_PROTOCOL })),
          patterns: [{ group: ['node:*', 'cloudflare:*'], message: DESK_PROTOCOL }],
        },
      ],
    },
  },
  // DC3 end
  // DC5 start: the desk's web app (apps/desk-web) runs in a browser: browser globals and React's hook rules in src/, no
  // Node or Electron module there (its double, configs, and browser suites under Node are outside src/).
  {
    files: ['apps/desk-web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    ...reactHooks.configs.flat.recommended,
  },
  // The desk builds under the React Compiler as the renderer does (vite.config.ts), so the renderer's L154 rule holds here.
  { files: ['apps/desk-web/src/**/*.{ts,tsx}'], rules: { 'no-restricted-syntax': ['error', COMPILED_POSTFIX] } },
  {
    files: ['apps/desk-web/src/**/*.{ts,tsx}'],
    ignores: ['apps/desk-web/src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['electron', ...NODE_MODULES].map((name) => ({ name, message: DESK_WEB })),
          patterns: [{ group: ['node:*'], message: DESK_WEB }],
        },
      ],
    },
  },
  { files: ['apps/desk-web/{test,e2e}/**/*.ts', 'apps/desk-web/*.config.ts', 'apps/desk-web/scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  // DC5 end
  // The one-locale rule over the desk's web app (DESK_ONE_LOCALE, above); its suites build their own English oracles.
  {
    files: ['apps/desk-web/src/**/*.{ts,tsx}'],
    ignores: ['apps/desk-web/src/**/*.test.{ts,tsx}'],
    plugins: { 'maws-dates': mawsDatesPlugin },
    rules: { 'maws-dates/one-locale': ['error', ...DESK_ONE_LOCALE] },
  },
  // DC6 start: the browser has no MAWS preload, so nothing under apps/desk-web/src/ reaches for its bridge; MAWS's own
  // sources (src/) are outside this glob and keep theirs.
  {
    files: ['apps/desk-web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'maws', message: DESK_WEB_NO_PRELOAD },
        { object: 'globalThis', property: 'maws', message: DESK_WEB_NO_PRELOAD },
      ],
    },
  },
  // DC6 end
);
