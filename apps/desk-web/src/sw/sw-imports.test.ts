// The service worker holds no org key and imports nothing that could (§4, §6): its run-time module graph is its own
// three files, nothing from the app, the protocol module, or a package. A type-only import is erased at build and
// carries nothing.
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = import.meta.dirname;

/** The specifiers a module imports at run time (`import type` and `import { type … }`-only lines are erased). */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(/^\s*(import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    const clause = match[2];
    const typeOnly = /^type\s/.test(clause) || /^\{\s*(type\s+[\w$]+\s*(as\s+[\w$]+\s*)?,?\s*)+\}$/.test(clause);
    if (!typeOnly) specifiers.push(match[3]);
  }
  for (const match of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) specifiers.push(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of runtimeImports(file)) {
      if (!specifier.startsWith('.')) throw new Error(`${relative(here, file)} imports ${specifier} at run time`);
      walk(resolve(dirname(file), specifier.endsWith('.ts') ? specifier : `${specifier}.ts`));
    }
  };
  walk(entry);
  return seen;
}

describe("the service worker's imports", () => {
  it('are its own three files, and nothing that could reach the org key', () => {
    const files = [...graph(join(here, 'service-worker.ts'))].map((f) => relative(here, f)).sort();
    expect(files).toEqual(['handlers.ts', 'notice.ts', 'service-worker.ts']);
  });

  it('reads a type-only import as erased and anything else as a run-time import', () => {
    const probe = join(here, 'notice.ts');
    expect(runtimeImports(probe)).toEqual([]);
    expect(runtimeImports(join(here, 'handlers.ts'))).toEqual(['./notice']);
  });
});
