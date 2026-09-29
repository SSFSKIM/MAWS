import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { open as openFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryEntrySchema } from '@shared/composer/history-entry';
import type { AppSessionId } from '@shared/graph/ids';
import { TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { claudeConfigDir, PromptHistory } from './prompt-history';

// test/fixtures/history: a terminal history in the terminal's record shape and the paste-cache file for its hashed paste
// (the real filename: the first 16 hex digits of SHA-256 of the 40-line body, then `.txt`).
const PROJECT = '/tmp/maws-c7-history-project';
const TERMINAL_SESSION = '8f7e6d5c-4b3a-4291-8807-a6b5c4d3e2f1';
const APP = 'app-1' as AppSessionId;
const BODY = Array.from({ length: 40 }, (_, i) => `paste line ${i + 1}`).join('\n');

let dir: string;
let configDir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-history-'));
  configDir = join(dir, 'claude');
  cpSync(join(TEST_FIXTURE_DIR, 'history', 'paste-cache'), join(configDir, 'paste-cache'), { recursive: true });
  cpSync(join(TEST_FIXTURE_DIR, 'history', 'terminal-history.jsonl'), join(configDir, 'history.jsonl'));
  file = join(dir, 'userData', 'prompt-history.jsonl');
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const sessions: Record<string, { directory: string; engineSessionId: string | null }> = { [APP]: { directory: PROJECT, engineSessionId: '11111111-2222-4333-8444-555555555555' } };
function history(opts: { open?: typeof openFile; now?: () => number } = {}) {
  return new PromptHistory({ file, configDir, session: (id) => sessions[id] ?? null, ...opts });
}
const maws = (rows: object[]) => {
  mkdirSync(join(dir, 'userData'), { recursive: true });
  writeFileSync(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
};
const at = (iso: string) => Date.parse(iso);

describe('prompt history merges MAWS and terminal sources with bodies', () => {
  it("answers the terminal's rows of this project with their bodies: inline, resolved from the paste cache, or null", async () => {
    const entries = await history().list(APP, 200);
    for (const entry of entries) HistoryEntrySchema.parse(entry);
    expect(entries.map((e) => e.display)).toEqual(['first terminal prompt', '[Pasted text #1 +40 lines]', 'inline paste [Pasted text #1 +3 lines]', 'lost paste [Pasted text #1 +2 lines]']);
    expect(entries.every((e) => e.source === 'terminal' && e.sessionId === TERMINAL_SESSION)).toBe(true);
    expect(entries[0]).toEqual({ display: 'first terminal prompt', at: '2026-09-28T09:00:00.000Z', source: 'terminal', sessionId: TERMINAL_SESSION, pastedContents: {} });
    expect(entries[1]!.pastedContents).toEqual({ '1': { id: 1, type: 'text', content: BODY, contentHash: 'c5ddbb6e32f0ffa0', mediaType: null, filename: null } });
    expect(entries[2]!.pastedContents['1']).toMatchObject({ content: 'a\nb\nc', contentHash: null });
    expect(entries[3]!.pastedContents['1']).toMatchObject({ content: null, contentHash: '0123456789abcdef' }); // no cache file: unresolved
  });

  it('merges MAWS\'s own file by time, drops duplicates on display and body, keeps equal displays with different bodies, and caps at the newest', async () => {
    maws([
      { display: 'first terminal prompt', pastedContents: {}, timestamp: at('2026-09-28T09:30:00.000Z'), project: PROJECT, sessionId: null }, // a duplicate: the newer one stays
      { display: '[Pasted text #1 +40 lines]', pastedContents: { '1': { id: 1, type: 'text', content: 'another body', contentHash: null, mediaType: null, filename: 'notes.txt' } }, timestamp: at('2026-09-28T09:01:00.000Z'), project: PROJECT, sessionId: 'e1' },
      { display: 'a MAWS prompt elsewhere', pastedContents: {}, timestamp: at('2026-09-28T09:40:00.000Z'), project: '/tmp/elsewhere', sessionId: 'e2' },
    ]);
    const entries = await history().list(APP, 200);
    expect(entries.map((e) => [e.source, e.display])).toEqual([
      ['maws', '[Pasted text #1 +40 lines]'],
      ['terminal', '[Pasted text #1 +40 lines]'],
      ['terminal', 'inline paste [Pasted text #1 +3 lines]'],
      ['terminal', 'lost paste [Pasted text #1 +2 lines]'],
      ['maws', 'first terminal prompt'],
    ]);
    expect(entries.filter((e) => e.display === '[Pasted text #1 +40 lines]').map((e) => e.pastedContents['1']!.content)).toEqual(['another body', BODY]);
    expect((await history().list(APP, 2)).map((e) => e.display)).toEqual(['lost paste [Pasted text #1 +2 lines]', 'first terminal prompt']);
  });

  it('never builds a path for a contentHash that is not 16 lowercase hex digits', async () => {
    const bad = ['../history.jsonl', 'C5DDBB6E32F0FFA0', 'c5ddbb6e32f0ffa', 'c5ddbb6e32f0ffa0/../x'];
    writeFileSync(join(configDir, 'history.jsonl'), bad.map((contentHash, i) => `${JSON.stringify({ display: `bad ${i} [Pasted text #1 +1 lines]`, pastedContents: { 1: { id: 1, type: 'text', contentHash } }, timestamp: at('2026-09-28T10:00:00.000Z') + i, project: PROJECT, sessionId: null })}\n`).join(''));
    const open = vi.fn(openFile);
    const entries = await history({ open }).list(APP, 200);
    expect(entries.map((e) => e.pastedContents['1']!.content)).toEqual([null, null, null, null]);
    expect(open.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('paste-cache'))).toEqual([]);
    expect(open.mock.calls.map(([path]) => String(path)).sort()).toEqual([file, join(configDir, 'history.jsonl')].sort());
  });

  it("appends the terminal's record shape to MAWS's file only, never opening the terminal's file or cache for writing", async () => {
    const open = vi.fn(openFile);
    const h = history({ open, now: () => at('2026-09-28T11:00:00.000Z') });
    const pasted = { '1': { id: 1, type: 'text' as const, content: BODY, contentHash: null, mediaType: null, filename: 'log.txt' }, '2': { id: 2, type: 'image' as const, content: null, contentHash: null, mediaType: 'image/png', filename: 'shot.png' } };
    await h.append(APP, 'see [Pasted text #1 +40 lines] and [Image #2]', pasted);
    await h.append('app-unknown' as AppSessionId, 'from a session with no record', {});
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toEqual([
      { display: 'see [Pasted text #1 +40 lines] and [Image #2]', pastedContents: pasted, timestamp: at('2026-09-28T11:00:00.000Z'), project: PROJECT, sessionId: sessions[APP]!.engineSessionId },
      { display: 'from a session with no record', pastedContents: {}, timestamp: at('2026-09-28T11:00:00.000Z'), project: null, sessionId: null },
    ]);
    for (const [path, flags] of open.mock.calls) {
      if (String(path).startsWith(configDir)) expect(flags, String(path)).toBe('r');
      else expect(String(path)).toBe(file);
    }
    const recalled = await history().list(APP, 200);
    expect(recalled.at(-1)).toMatchObject({ source: 'maws', display: 'see [Pasted text #1 +40 lines] and [Image #2]', pastedContents: pasted });
  });

  it("files an unstarted session's prompt under the project it names, and a known session's under its record", async () => {
    const h = history({ now: () => at('2026-09-28T11:00:00.000Z') });
    await h.append('app-unstarted' as AppSessionId, 'first prompt of a new session', {}, '/repo/intended');
    await h.append(APP, 'a live prompt', {}, '/somewhere/else'); // the record decides
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { project: string | null });
    expect(lines.map((l) => l.project)).toEqual(['/repo/intended', PROJECT]);
  });

  it('tolerates a torn last line and a missing terminal file; a session with no record reads every project', async () => {
    writeFileSync(join(configDir, 'history.jsonl'), `${readFileSync(join(TEST_FIXTURE_DIR, 'history', 'terminal-history.jsonl'), 'utf8')}{"display":"torn`);
    expect(await history().list(APP, 200)).toHaveLength(4);
    expect((await history().list('app-unknown' as AppSessionId, 200)).map((e) => e.display)).toContain('a prompt in another project');
    rmSync(join(configDir, 'history.jsonl'));
    expect(await history().list(APP, 200)).toEqual([]);
  });

  it("keeps MAWS's own large pastes: its file is read further back than the terminal's", async () => {
    const big = 'x'.repeat(700 * 1024); // past the terminal's 512 KiB tail
    maws([
      { display: 'older [Pasted text #1 +1 lines]', pastedContents: { '1': { id: 1, type: 'text', content: big, contentHash: null, mediaType: null, filename: null } }, timestamp: at('2026-09-28T09:10:00.000Z'), project: PROJECT, sessionId: null },
      { display: 'newer', pastedContents: {}, timestamp: at('2026-09-28T09:20:00.000Z'), project: PROJECT, sessionId: null },
    ]);
    const own = (await history().list(APP, 200)).filter((e) => e.source === 'maws');
    expect(own.map((e) => e.display)).toEqual(['older [Pasted text #1 +1 lines]', 'newer']);
    expect(own[0]!.pastedContents['1']!.content).toBe(big);
  });

  it('reads the configuration directory from CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/scratch/claude' }, '/Users/x')).toBe('/scratch/claude');
    expect(claudeConfigDir({}, '/Users/x')).toBe('/Users/x/.claude');
  });
});
