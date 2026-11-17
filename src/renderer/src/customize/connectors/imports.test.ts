// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, M2, "The two sheets stop importing each
// other"; the tracker row U11g left to this landing): no module of this folder reaches itself again through the folder's
// own relative imports. The repository's lint has no rule for cycles, so this reads the folder's source.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FOLDER = import.meta.dirname;
const MODULE = /\.(ts|tsx)$/;
const SPECIFIER = /\bfrom\s+'\.\/([^']+)'/g;

// Each module of the folder (tests left out: nothing imports one) and the modules of the folder it imports.
function importsOf(): Map<string, string[]> {
  const modules = readdirSync(FOLDER).filter((file) => MODULE.test(file) && !/\.test\.tsx?$/.test(file));
  const byName = new Map(modules.map((file) => [file.replace(MODULE, ''), file]));
  return new Map(
    modules.map((file) => {
      const source = readFileSync(join(FOLDER, file), 'utf8');
      const named = [...source.matchAll(SPECIFIER)].map((match) => byName.get(match[1]!)).filter((target): target is string => target !== undefined);
      return [file, [...new Set(named)]];
    }),
  );
}

// The cycles: each module a path leaves from and comes back to, with that path.
function cyclesOf(graph: Map<string, string[]>): string[][] {
  const found: string[][] = [];
  for (const start of graph.keys()) {
    const walk = (at: string, path: string[]): void => {
      for (const next of graph.get(at) ?? []) {
        if (next === start) found.push([...path, next]);
        else if (!path.includes(next)) walk(next, [...path, next]);
      }
    };
    walk(start, [start]);
  }
  return found;
}

describe('customize/connectors', () => {
  it('has modules that import modules of the folder', () => {
    expect([...importsOf().values()].some((targets) => targets.length > 0)).toBe(true); // the reading finds the imports
  });

  it('has no two modules that import each other, directly or through others', () => {
    expect(cyclesOf(importsOf())).toEqual([]);
  });
});
