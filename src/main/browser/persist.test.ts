import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { readTabsFile, TabsFileWriter, type TabsFile } from './persist';

const FILE: TabsFile = {
  version: 1,
  tabs: [{ tabId: 'b_aaaaaaaaaaaa', appSessionId: 'App-A', partition: DEFAULT_PARTITION, url: 'https://a.test/', title: 'A', favicon: null, zoom: 1, createdAt: 'c', lastShownAt: 'l' }],
  selected: { 'App-A': 'b_aaaaaaaaaaaa' },
} as unknown as TabsFile;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-browser-persist-'));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe('tabs.json (E4a Design §2, G4)', () => {
  it('a missing file is an empty start, not a broken one', () => {
    expect(readTabsFile(join(dir, 'tabs.json'), { now: () => 1 })).toEqual({ file: { version: 1, tabs: [], selected: {} }, broken: false });
  });

  it('reads back what the writer wrote, in the documented shape', () => {
    const path = join(dir, 'tabs.json');
    const writer = new TabsFileWriter(path, () => FILE);
    writer.markDirty();
    writer.flushSync();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(FILE);
    expect(readTabsFile(path, { now: () => 1 })).toEqual({ file: FILE, broken: false });
  });

  it.each([
    ['not JSON', '{'],
    ['the wrong shape', JSON.stringify({ version: 1, tabs: [{ tabId: 'nope' }], selected: {} })],
    ['an unknown version', JSON.stringify({ ...FILE, version: 2 })],
  ])('moves a file with %s aside as tabs.json.broken-<epoch> and starts empty', (_label, text) => {
    const path = join(dir, 'tabs.json');
    writeFileSync(path, text);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readTabsFile(path, { now: () => 1234 })).toEqual({ file: { version: 1, tabs: [], selected: {} }, broken: true });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
    expect(readdirSync(dir)).toEqual(['tabs.json.broken-1234']);
    expect(readFileSync(join(dir, 'tabs.json.broken-1234'), 'utf8')).toBe(text);
  });

  it('writes at most once per 300 ms while dirty, and flushSync writes at once', () => {
    vi.useFakeTimers();
    const path = join(dir, 'tabs.json');
    let current = FILE;
    const writer = new TabsFileWriter(path, () => current);
    writer.markDirty();
    writer.markDirty();
    expect(readdirSync(dir)).toEqual([]);
    vi.advanceTimersByTime(299);
    expect(readdirSync(dir)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(FILE);
    current = { ...FILE, tabs: [] };
    writer.markDirty();
    writer.flushSync();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(current);
    vi.advanceTimersByTime(1000); // the pending timer was cancelled: nothing more is written
    expect(readdirSync(dir)).toEqual(['tabs.json']);
  });

  it('does not write again text identical to its last write', () => {
    const path = join(dir, 'tabs.json');
    let current = FILE;
    const writer = new TabsFileWriter(path, () => current);
    writer.markDirty();
    writer.flushSync();
    rmSync(path); // a second write would recreate it
    writer.markDirty();
    writer.flushSync();
    expect(readdirSync(dir)).toEqual([]);
    current = { ...FILE, tabs: [] };
    writer.markDirty();
    writer.flushSync();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(current);
  });

  it('close writes what is pending and nothing after it', () => {
    vi.useFakeTimers();
    const path = join(dir, 'tabs.json');
    let contents = FILE;
    const writer = new TabsFileWriter(path, () => contents);
    writer.markDirty();
    writer.close();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(FILE);
    contents = { ...FILE, tabs: [] };
    writer.markDirty();
    writer.flushSync();
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(FILE);
  });

  it('flushSync with nothing dirty writes nothing', () => {
    const path = join(dir, 'tabs.json');
    new TabsFileWriter(path, () => FILE).flushSync();
    expect(readdirSync(dir)).toEqual([]);
  });
});
