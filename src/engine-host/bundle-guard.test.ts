// E10 (§Design 6): the app's binary may be replaced under a running supervisor; the running process keeps its loaded
// modules, so the engine-host chunk must load everything at start: no dynamic `import()`, and nothing required but
// Node's builtins and `zod`. Reads the built chunk under `out/main` when a build is present and is skipped otherwise;
// the E10 gates run it after `pnpm build`, which makes it mandatory there.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const OUT = resolve(__dirname, '../../out/main');
const MARKER = 'the engine host needs MAWS_USER_DATA'; // index.ts's own refusal, unique to the engine-host chunk

function engineHostChunk(): string | null {
  if (!existsSync(OUT)) return null;
  for (const name of readdirSync(OUT).filter((file) => file.endsWith('.js'))) {
    const text = readFileSync(join(OUT, name), 'utf8');
    if (text.includes(MARKER)) return text;
  }
  return null;
}

const chunk = engineHostChunk();

describe.skipIf(chunk === null)('the built engine-host chunk', () => {
  it('has no dynamic import()', () => {
    expect(chunk!.match(/\bimport\s*\(/g) ?? []).toEqual([]);
  });

  it('requires only Node builtins and zod', () => {
    const required = [...new Set([...chunk!.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]))];
    expect(required.length).toBeGreaterThan(0);
    expect(required.filter((name) => !name.startsWith('node:') && name !== 'zod')).toEqual([]);
  });
});
