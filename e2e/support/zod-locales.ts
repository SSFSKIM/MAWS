// The O17 footprint fix's zod patch (patches/zod@4.6.5.patch, pnpm-workspace.yaml's patchedDependencies), checked where
// zod is installed and where the packaged app ships it: requiring zod's CommonJS entries and parsing with a schema loads
// no non-English locale, the English messages read as the unpatched package gave them, and reading `locales` still
// loads them. One script for both places: test/zod-locales.test.ts runs it under Node over the repository's
// node_modules, and e2e/supervisor-packaged.spec.ts under the packaged binary as Node, as mawsd and the engine host run,
// over app.asar's (electron-builder copies the installed tree, so the app ships what the install patched).
import { execFileSync } from 'node:child_process';

export interface ZodLocales {
  error?: string; // the script itself failed
  zod: string | null; // the zod directory the entries resolved to
  version: string | null;
  loaded: string[]; // the non-English locale modules loaded once the entries were required and a parse failed
  messages: string[]; // that parse's issue messages
  localeRead: string | null; // `typeof locales.de` once read
  loadedAfterRead: number; // the non-English locale modules loaded after that read
}

// The script's parse, as zod 4.6.5 without the patch words it.
export const ENGLISH_MESSAGES = ['Too small: expected string to have >=1 characters', 'Invalid input: expected int, received number', 'Invalid option: expected one of "a"|"b"', 'Unrecognized key: "extra"'];

// Plain CommonJS for the binary's `-e`: zod resolved from MAWS_ZOD_FROM (a directory), its answer one JSON line on stdout.
// The entries are those MAWS's bundles and the MCP SDK require.
export const ZOD_LOCALES_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const out = { zod: null, version: null, loaded: [], messages: [], localeRead: null, loadedAfterRead: 0 };
try {
  const req = createRequire(path.join(process.env.MAWS_ZOD_FROM, 'noop.js'));
  out.zod = path.dirname(req.resolve('zod/package.json'));
  out.version = JSON.parse(fs.readFileSync(path.join(out.zod, 'package.json'), 'utf8')).version;
  const locales = path.join(out.zod, 'v4', 'locales') + path.sep;
  const nonEnglish = () => Object.keys(require.cache).filter((file) => file.startsWith(locales) && !['en.cjs', 'index.cjs'].includes(path.basename(file))).map((file) => path.basename(file, '.cjs')).sort();
  const z = req('zod');
  for (const entry of ['zod/v4', 'zod/v4-mini', 'zod/v4/core', 'zod/mini']) req(entry);
  const result = z.strictObject({ name: z.string().min(1), count: z.number().int(), kind: z.enum(['a', 'b']) }).safeParse({ name: '', count: 1.5, kind: 'c', extra: true });
  out.messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
  out.loaded = nonEnglish();
  out.localeRead = typeof z.locales.de;
  out.loadedAfterRead = nonEnglish().length;
} catch (error) {
  out.error = error && error.stack ? String(error.stack) : String(error);
}
process.stdout.write(JSON.stringify(out) + '\n');
`;

// Runs the script with `command` (Node, or the packaged binary with ELECTRON_RUN_AS_NODE=1 in `env`), zod resolved from
// `from`.
export function runZodLocales(command: string, env: NodeJS.ProcessEnv, from: string): ZodLocales {
  const stdout = execFileSync(command, ['-e', ZOD_LOCALES_SCRIPT], { env: { ...env, MAWS_ZOD_FROM: from }, encoding: 'utf8', timeout: 60_000 });
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as ZodLocales;
}

// What the reading shows wrong, each one line; empty when the patch holds.
export function zodLocaleProblems(result: ZodLocales): string[] {
  if (result.error !== undefined) return [`the zod locale script failed: ${result.error}`];
  const problems: string[] = [];
  if (result.loaded.length > 0) {
    problems.push(
      `zod ${result.version} (${result.zod}) loaded ${result.loaded.length} non-English locales with itself (${result.loaded.slice(0, 5).join(', ')}, …): ` +
        'patches/zod@4.6.5.patch is not applied. A zod upgrade drops it: carry the patch to the new version (pnpm patch zod@<version>), or remove it if that version loads its locales lazily itself',
    );
  }
  if (JSON.stringify(result.messages) !== JSON.stringify(ENGLISH_MESSAGES)) problems.push(`zod's English messages changed: ${JSON.stringify(result.messages)}, not ${JSON.stringify(ENGLISH_MESSAGES)}`);
  if (result.localeRead !== 'function' || result.loadedAfterRead === 0) problems.push(`reading zod's locales gave locales.de as ${result.localeRead} and loaded ${result.loadedAfterRead} locale modules; the getter must still load them`);
  return problems;
}
