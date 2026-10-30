// One link per machine (P5 O7 M1, "The boundary"; P5 Decision Log 45): RL2 channels in the app are opened only by
// src/main/machines/remote/, and every consumer reaches a machine through `Machines.remote(ref)`. And that module stays
// Electron-free, so it runs under the node project and its probes are injected.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../..');
const REMOTE = join(ROOT, 'src/main/machines/remote');
const OPENERS = ['openChannel(', 'connectChannel(', 'acceptChannel(', '/api/machines/'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('the RL2 boundary', () => {
  it('lets nothing in main or the renderer but the remote module open a channel or reach a machine’s hub routes', () => {
    const offenders: string[] = [];
    for (const file of [...sources(join(ROOT, 'src/main')), ...sources(join(ROOT, 'src/renderer'))]) {
      if (file.startsWith(REMOTE + sep)) continue;
      const text = readFileSync(file, 'utf8');
      for (const opener of OPENERS) if (text.includes(opener)) offenders.push(`${relative(ROOT, file)}: ${opener}`);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps Electron out of the remote module', () => {
    const offenders = sources(REMOTE).filter((file) => /from ['"]electron['"]|require\(['"]electron['"]\)|import\(['"]electron['"]\)/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
