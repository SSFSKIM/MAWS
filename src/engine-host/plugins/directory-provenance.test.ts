// P4-AGG M2 (the task review's second finding): `plugins.directoryProvenance`, where the engine recorded an installed
// Anthropic Directory plugin's code: its install binding (`plugin-directory-bindings.json`), else the saved directory
// catalog's entry names (`plugin-directory-cache-v2.json`), both in the plugins folder, read and never written.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directoryProvenance } from './directory-provenance';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-provenance-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, value: unknown) => writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
// the shapes 2.1.309 writes (cli.pretty.js 779832 `Xe`, 779884 `K`; 60890 the bindings), trimmed to what is read
const cache = {
  schemaVersion: 2,
  fetchedAt: '2026-10-25T03:05:50.335Z',
  listings: [
    { id: 'plugin_1', name: 'Superpowers', source: { type: 'directory', repository: { url: 'https://github.com/obra/superpowers', reviewed_commit: 'a'.repeat(40) } } },
    { id: 'plugin_2', name: 'Frontend design', source: { type: 'directory', repository: { url: 'https://github.com/anthropics/claude-plugins-official', path: 'plugins/frontend-design', reviewed_commit: 'b'.repeat(40) } } },
  ],
  missedListings: [{ missedAt: '2026-10-24T00:00:00.000Z', listing: { id: 'plugin_3', name: 'Gone', source: { type: 'directory', repository: { url: 'https://github.com/acme/gone', reviewed_commit: 'c'.repeat(40) } } } }],
  entryNames: { plugin_1: 'superpowers', plugin_2: 'frontend-design', plugin_3: 'gone', plugin_4: 'claimed' },
  entryNameClaims: { plugin_4: { repositoryKey: 'github.com/acme/claimed#plugins/x', lastSeen: '2026-10-25T03:05:50.335Z' } },
};

describe('plugins.directoryProvenance', () => {
  it('answers the install binding first, then the saved catalog’s entry names, only for the names asked', async () => {
    write('plugin-directory-bindings.json', { schemaVersion: 1, bindings: { 'superpowers@anthropic-plugin-directory': { repositoryKey: 'github.com/obra/superpowers#' }, 'other@anthropic-plugin-directory': { repositoryKey: 'github.com/x/y#' } } });
    write('plugin-directory-cache-v2.json', cache);
    expect(await directoryProvenance(dir, ['superpowers', 'frontend-design', 'gone', 'claimed', 'unknown'])).toEqual([
      { name: 'superpowers', repositoryKey: 'github.com/obra/superpowers#' },
      { name: 'frontend-design', repositoryKey: 'github.com/anthropics/claude-plugins-official#plugins/frontend-design' },
      { name: 'gone', repositoryKey: 'github.com/acme/gone#' },
      { name: 'claimed', repositoryKey: 'github.com/acme/claimed#plugins/x' },
    ]);
  });

  it('answers nothing for files that are absent, damaged, links, or of another version, and never throws', async () => {
    expect(await directoryProvenance(dir, ['superpowers'])).toEqual([]);
    write('plugin-directory-bindings.json', '{not json');
    write('plugin-directory-cache-v2.json', { ...cache, schemaVersion: 3 });
    expect(await directoryProvenance(dir, ['superpowers', 'frontend-design'])).toEqual([]);
    rmSync(join(dir, 'plugin-directory-cache-v2.json'));
    mkdirSync(join(dir, 'elsewhere'));
    writeFileSync(join(dir, 'elsewhere', 'cache.json'), JSON.stringify(cache));
    symlinkSync(join(dir, 'elsewhere', 'cache.json'), join(dir, 'plugin-directory-cache-v2.json'));
    expect(await directoryProvenance(dir, ['superpowers'])).toEqual([]);
    expect(await directoryProvenance(join(dir, 'missing'), ['superpowers'])).toEqual([]);
  });
});
