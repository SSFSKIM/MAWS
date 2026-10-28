// The guarded-entry rule (P5 O10 M10, the architect's ruling on acceptance 14; O3 §11's spine rule is the same: nothing
// resident that idle doesn't need). A guarded entry is a built file a long-lived process runs from under `out/`
// (mawsd.js, the engine host's and the pty host's bundles, O3's hosts as they come), which outlives the app binary that
// started it and runs where only Node is installed. Read in the build's own CommonJS output, every module its graph
// loads is one of:
//   - at start (a `require` the module's evaluation runs): a Node builtin or one of the entry's allowed externals, or a
//     chunk the same build emitted under `out/`, named by a relative path;
//   - deferred (a dynamic `import()`, which the build writes as `Promise.resolve().then(() => require(...))`, or one left
//     as `import(...)`): only a chunk the same build emitted under `out/`, by a relative path, and only where the entry
//     admits deferred loads at all. A bare specifier, deferred, would resolve into node_modules when it runs, which a
//     packaged app or a Linux pack need not carry; a path that leaves `out/` names no file of this build.
// Every chunk the graph names, deferred ones included, is read under the same rule. A load whose specifier is not a
// string literal can't be judged, and is refused.
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';

export type GuardedEntry = {
  /** The built entry, a file under `root`. */
  entry: string;
  /** The build's output directory (`out/`): every chunk the graph loads is a file under it. */
  root: string;
  /** Bare specifiers the entry may load at start besides Node's builtins (zod, the MCP SDK, node-pty, ...). */
  externals?(name: string): boolean;
  /** Whether a deferred load (of a chunk beside it) is admitted at all; the engine host's E10 rule admits none. */
  deferred: boolean;
};

export type Load = { file: string; specifier: string; deferred: boolean };

const DEFERRED_REQUIRE = /Promise\.resolve\(\)\.then\(\(\)\s*=>\s*require\(\s*(["'])([^"']+)\1\s*\)\)/g;
const IMPORT = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g;
const REQUIRE = /\brequire\(\s*(["'])([^"']+)\1\s*\)/g;
const COMPUTED = /\b(?:import|require)\s*\(\s*(?!["')])/g;
// A comment line (`*`, `/*`, `//`) is not code: inlined sources keep JSDoc that reads `import('../x.js')`.
const code = (text: string) =>
  text
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n');

/** The loads `text` (a built file at `file`) makes, each marked deferred or at start; and its computed ones. */
export function loadsOf(file: string, text: string): { loads: Load[]; computed: number } {
  const body = code(text);
  const deferred = [...body.matchAll(DEFERRED_REQUIRE)].map((m) => m[2]);
  const imports = [...body.matchAll(IMPORT)].map((m) => m[2]);
  const loads: Load[] = [];
  const lazy = new Map<string, number>();
  for (const specifier of deferred) lazy.set(specifier, (lazy.get(specifier) ?? 0) + 1);
  for (const [, , specifier] of body.matchAll(REQUIRE)) {
    const owed = lazy.get(specifier) ?? 0;
    if (owed > 0) lazy.set(specifier, owed - 1);
    loads.push({ file, specifier, deferred: owed > 0 });
  }
  for (const specifier of imports) loads.push({ file, specifier, deferred: true });
  return { loads, computed: [...body.matchAll(COMPUTED)].length };
}

/** What breaks the rule in `guarded`'s graph, one line each; empty when it holds. */
export function guardedEntryProblems(guarded: GuardedEntry, read: (file: string) => string | null = readBuilt): string[] {
  const root = resolve(guarded.root);
  const inside = (file: string) => file.startsWith(root + sep);
  const problems: string[] = [];
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = read(file);
    const name = relative(root, file);
    if (text === null) return void problems.push(`${name}: not a file this build emitted`);
    const { loads, computed } = loadsOf(file, text);
    if (computed > 0) problems.push(`${name}: ${computed} load(s) of a computed specifier, which can't be judged`);
    for (const load of loads) {
      const what = `${name}: ${load.deferred ? 'a deferred load' : 'a load'} of ${load.specifier}`;
      if (!load.specifier.startsWith('.')) {
        if (load.deferred) problems.push(`${what}: deferred, only a chunk beside the entry, by a relative path`);
        else if (!isBuiltin(load.specifier) && !(guarded.externals?.(load.specifier) ?? false)) problems.push(`${what}: neither a Node builtin nor an allowed external`);
        continue;
      }
      if (load.deferred && !guarded.deferred) {
        problems.push(`${what}: this entry admits no deferred load`);
        continue;
      }
      const target = resolve(dirname(file), load.specifier);
      if (!inside(target)) {
        problems.push(`${what}: outside ${relative(process.cwd(), root) || root}`);
        continue;
      }
      visit(target);
    }
  };
  visit(resolve(guarded.entry));
  return problems;
}

/** The files the entry loads at start (its run path): the entry and every chunk a load at start names, transitively. */
export function runPathOf(entry: string, read: (file: string) => string | null = readBuilt): Map<string, string> {
  const files = new Map<string, string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    const text = read(file);
    if (text === null) return;
    files.set(file, text);
    for (const load of loadsOf(file, text).loads) if (!load.deferred && load.specifier.startsWith('.')) visit(resolve(dirname(file), load.specifier));
  };
  visit(resolve(entry));
  return files;
}

function isBuiltin(name: string): boolean {
  return name.startsWith('node:') || builtinModules.includes(name);
}

function readBuilt(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
