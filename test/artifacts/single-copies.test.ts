// Parent Decision Log 28 (docs/doperpowers/plans/2026-10-12-p3-co-work.md; the P3-A document's constraints): exactly
// one copy of `@y/y`, `lib0` and `prosemirror-model`. A second `@y/y` trips v14's duplicate-import guard and breaks
// `instanceof` between the binding and `@y/protocols`/`@y/prosemirror`; a second `prosemirror-model` breaks the Tiptap
// binding. Checked twice: the lockfile names one version of each (the pin), and every package that uses one resolves
// the same installed copy.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const PINS = { '@y/y': '14.0.0-rc.28', lib0: '1.0.0-rc.36', 'prosemirror-model': '1.25.12' } as const;
type Pinned = keyof typeof PINS;
// For each pinned package, the packages whose imports of it must land on the one copy.
const CONSUMERS: Record<Pinned, string[]> = {
  '@y/y': ['@y/protocols', '@y/prosemirror'],
  lib0: ['@y/y', '@y/protocols', '@y/prosemirror'],
  'prosemirror-model': ['@tiptap/pm', '@tiptap/core', 'prosemirror-state', 'prosemirror-view', '@y/prosemirror'],
};

// The directory of the package `name` as an import from `fromDir` finds it: Node's lookup through each
// `node_modules` from `fromDir` upward, so a nested copy under a consumer is found before the hoisted one.
function packageDir(name: string, fromDir: string): string {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = resolve(dir, 'node_modules', name);
    if (existsSync(resolve(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) throw new Error(`${name} is not installed above ${fromDir}`);
  }
}

describe('one copy each of @y/y, lib0 and prosemirror-model', () => {
  const lockfile = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8');

  it.each(Object.entries(PINS))('the lockfile resolves %s to the one pinned version %s', (name, version) => {
    const escaped = name.replace(/[/.]/g, (c) => `\\${c}`);
    const versions = new Set([...lockfile.matchAll(new RegExp(`^  '?${escaped}@([^(':]+)`, 'gm'))].map((match) => match[1]));
    expect([...versions]).toEqual([version]);
  });

  it.each(Object.keys(PINS) as Pinned[])('every consumer of %s resolves the root’s copy', (name) => {
    const root = packageDir(name, ROOT);
    expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version).toBe(PINS[name]);
    for (const consumer of CONSUMERS[name]) expect(packageDir(name, packageDir(consumer, ROOT)), `${name} from ${consumer}`).toBe(root);
  });

  it('pins the four packages exactly in package.json', () => {
    const { devDependencies } = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
    expect(devDependencies).toMatchObject({ '@y/y': '14.0.0-rc.28', '@y/prosemirror': '2.0.0-15', '@y/protocols': '1.0.6-rc.1', lib0: '1.0.0-rc.36' });
  });
});
