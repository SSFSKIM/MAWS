// One link per machine (P5 O7 M1, "The boundary"; P5 Decision Log 45): RL2 channels in the app are opened only by
// src/main/machines/remote/, and every consumer reaches a machine through `Machines.remote(ref)`. And that module stays
// Electron-free, so it runs under the node project and its probes are injected.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../../..');
const REMOTE = join(ROOT, 'src/main/machines/remote');
const OPENERS = ['openChannel(', 'connectChannel(', 'acceptChannel(', '/api/machines/'];
/**
 * P5 O8 M4b: the one use of a machine's hub path outside the remote module that reaches no machine: the Registry's
 * `DELETE /api/machines/<name>`, an admin's removal of a dropped machine's row (`machine drop`'s), once in hub-client.
 */
const ALLOWED = new Map([['src/main/org/hub-client.ts: /api/machines/', 1]]);
const occurrences = (text: string, opener: string) => text.split(opener).length - 1;

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
      for (const opener of OPENERS) {
        const at = `${relative(ROOT, file)}: ${opener}`;
        if (occurrences(text, opener) > (ALLOWED.get(at) ?? 0)) offenders.push(at);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps Electron out of the remote module', () => {
    const offenders = sources(REMOTE).filter((file) => /from ['"]electron['"]|require\(['"]electron['"]\)|import\(['"]electron['"]\)/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });
});
