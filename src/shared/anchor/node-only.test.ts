// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, decision D1): the screenshot's reader and
// the content builder live in src/shared/anchor/ so the machine's side and main's `side.comment.content` share them,
// and both open files through Node. The renderer and the preloads import this folder's message.ts and anchor.ts, never
// these two: a module of theirs that reached either, directly or through any module between, would pull `node:fs`
// into a bundle that cannot run it. eslint sees one import at a time, so this walks the graphs themselves.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');
const NODE_ONLY = [resolve(__dirname, 'screenshot.ts'), resolve(__dirname, 'content.ts')];
const ALIASES: Record<string, string> = { '@shared/': resolve(SRC, 'shared'), '@artifacts/': resolve(SRC, 'artifacts') }; // electron.vite.config.ts

// The module a specifier names, or null for a package (or an asset, `?raw` and the like, that is no module)
function moduleOf(from: string, spec: string): string | null {
  const alias = Object.keys(ALIASES).find((prefix) => spec.startsWith(prefix));
  if (!spec.startsWith('.') && alias === undefined) return null;
  const base = alias === undefined ? resolve(dirname(from), spec) : resolve(ALIASES[alias]!, spec.slice(alias.length));
  return [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx'), base].find((file) => /\.tsx?$/.test(file) && existsSync(file)) ?? null;
}

// The specifiers a module's value imports, re-exports, side-effect imports and dynamic imports name, in either quote
// style (the repository has no quote rule); `import type` and `export type` are erased, as a bundle erases them
function specifiersOf(text: string): string[] {
  return [
    ...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+(['"])([^'"]+)\1/gms),
    ...text.matchAll(/^import\s+(['"])([^'"]+)\1/gm),
    ...text.matchAll(/\b(?:import|require)\(\s*(['"])([^'"]+)\1\s*\)/g),
  ].map((match) => match[2]!);
}

// Every module the files reach through `specifiersOf`, each with the chain that first reached it
function reached(entries: readonly string[]): Map<string, string[]> {
  const chains = new Map<string, string[]>();
  const queue = entries.map((file) => [file]);
  for (let chain = queue.shift(); chain !== undefined; chain = queue.shift()) {
    const file = chain.at(-1)!;
    if (chains.has(file)) continue;
    chains.set(file, chain);
    for (const spec of specifiersOf(readFileSync(file, 'utf8'))) {
      const next = moduleOf(file, spec);
      if (next !== null && !chains.has(next)) queue.push([...chain, next]);
    }
  }
  return chains;
}

const sources = (dir: string) =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name) && !/\.test(-d)?\.tsx?$/.test(name))
    .map((name) => resolve(dir, name));
const offenders = (chains: Map<string, string[]>) => NODE_ONLY.filter((file) => chains.has(file)).map((file) => chains.get(file)!.map((step) => relative(SRC, step)).join(' → '));

describe('the Node-only modules of src/shared/anchor/', () => {
  it('finds every spelling of an import that would bundle a module, in either quote style, and no type-only one', () => {
    const source = [
      `import { a } from './single';`,
      `import { b } from "./double";`,
      `import {\n  c,\n  d,\n} from "./multiline";`,
      `import './side-effect-single';`,
      `import "./side-effect-double";`,
      `export { e } from "./re-export-double";`,
      `export * from './re-export-all';`,
      `const f = await import("./dynamic-double");`,
      `const g = import('./dynamic-single');`,
      `import type { H } from "./type-only";`,
      `export type { I } from './type-re-export';`,
    ].join('\n');
    expect(specifiersOf(source).sort()).toEqual(
      ['./single', './double', './multiline', './side-effect-single', './side-effect-double', './re-export-double', './re-export-all', './dynamic-double', './dynamic-single'].sort(),
    );
  });

  it('are reached by no module of the renderer', () => {
    const chains = reached(sources(resolve(SRC, 'renderer')));
    expect(chains.has(resolve(__dirname, 'message.ts')), 'the walk reaches what the renderer does import').toBe(true);
    expect(offenders(chains)).toEqual([]);
  });

  it('are reached by no preload entry (electron.vite.config.ts: index, browser, repair)', () => {
    const chains = reached(['index.ts', 'browser.ts', 'repair.ts'].map((entry) => resolve(SRC, 'preload', entry)));
    expect(offenders(chains)).toEqual([]);
  });

  it('are reached, through the module between, from main’s `side.comment.content`: the walk follows what a bundle would', () => {
    const chains = reached([resolve(SRC, 'main/side/comment-content.ts')]);
    expect(offenders(chains)).toEqual(['main/side/comment-content.ts → shared/anchor/content.ts → shared/anchor/screenshot.ts', 'main/side/comment-content.ts → shared/anchor/content.ts']);
  });
});
