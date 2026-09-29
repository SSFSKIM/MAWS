import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionEventSchema } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { currentChain } from '@shared/wire/transcript';
import { FIXTURE_DIR, loadJournal, loadTranscriptFixture, TRANSCRIPT_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { frameUnknownNormalizer, loadJournalSource } from './journal-source';
import { loadTranscriptSource } from './transcript-source';

const RUN = 'rp_00000000-0000-4000-8000-000000000009' as SessionId;

describe('replay sources load and validate before anything plays', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'maws-replay-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };

  it('loads a probe journal: the in and out rows are its total, the span runs from the first to the last of them', async () => {
    const path = join(FIXTURE_DIR, 'pass2/workflow.jsonl');
    const loaded = await loadJournalSource(path);
    const rows = loadJournal('pass2', 'workflow');
    const played = rows.filter((r) => r.direction === 'in' || r.direction === 'out');
    expect(loaded.rows).toEqual(rows);
    expect(loaded.totalRows).toBe(played.length);
    expect(loaded.spanMs).toBe(Date.parse(played.at(-1)!.at) - Date.parse(played[0].at));
  });

  it('loads a transcript: its chain is the total, the span runs over the chain\'s timestamps', async () => {
    const loaded = await loadTranscriptSource(join(TRANSCRIPT_FIXTURE_DIR, 'subagent-parent.jsonl'));
    expect(loaded.totalRows).toBe(currentChain(loadTranscriptFixture('subagent-parent')).chain.length);
    expect(loaded.totalRows).toBeGreaterThan(20);
    expect(loaded.spanMs).toBeGreaterThan(0);
    // A torn tail's unparseable line is skipped, as the engine's reader skips it.
    expect((await loadTranscriptSource(join(TRANSCRIPT_FIXTURE_DIR, 'torn-tail.jsonl'))).records).toHaveLength(11);
  });

  it('names what is wrong: not found, unreadable, empty, not a journal (with the line), not a transcript', async () => {
    const missing = join(dir, 'missing.jsonl');
    await expect(loadJournalSource(missing)).rejects.toThrow(`replay source not found: ${missing}`);
    await expect(loadTranscriptSource(missing)).rejects.toThrow(`replay source not found: ${missing}`);
    await expect(loadJournalSource(dir)).rejects.toThrow(`replay source unreadable: ${dir}: EISDIR`);
    const empty = file('empty.jsonl', '\n\n');
    await expect(loadJournalSource(empty)).rejects.toThrow(`replay source empty: ${empty}`);
    await expect(loadTranscriptSource(empty)).rejects.toThrow(`replay source empty: ${empty}`);
    const rows = readRows(join(FIXTURE_DIR, 'pass2/workflow.jsonl')).slice(0, 4);
    const third = file('third.jsonl', [rows[0], rows[1], '{"type":"user","uuid":"u1"}', rows[3]].join('\n'));
    await expect(loadJournalSource(third)).rejects.toThrow(`replay source is not a journal: ${third}: line 3`);
    const garbage = file('garbage.jsonl', `${rows[0]}\nnot json\n`);
    await expect(loadJournalSource(garbage)).rejects.toThrow(`replay source is not a journal: ${garbage}: line 2`);
    const journal = join(FIXTURE_DIR, 'pass2/workflow.jsonl');
    await expect(loadTranscriptSource(journal)).rejects.toThrow(`replay source is not a transcript: ${journal}`);
  });

  it('a journal line\'s leading NULs are stripped before parsing, as the transcript source and fixture seeding strip them', async () => {
    const rows = readRows(join(FIXTURE_DIR, 'pass2/workflow.jsonl')).slice(0, 4);
    const torn = file('nul.jsonl', [rows[0], `\0\0${rows[1]}`, '\0\0\0', rows[2], rows[3]].join('\n'));
    const loaded = await loadJournalSource(torn);
    expect(loaded.rows).toEqual(rows.map((row) => JSON.parse(row) as unknown));
  });

  it('finds the sibling sidecar directory by the file stem first, then by the records\' session id', async () => {
    const sidecars = join(TRANSCRIPT_FIXTURE_DIR, '9a1d4262-0b43-46ad-acb9-5982f31d209c', 'subagents');
    const parent = readRows(join(TRANSCRIPT_FIXTURE_DIR, 'subagent-parent.jsonl'));
    // A resumed store transcript: named by its own id, while its leading records carry the prior session's.
    const stem = '44444444-4444-4444-8444-444444444444';
    const prior = parent.map((line) => line.replaceAll('9a1d4262-0b43-46ad-acb9-5982f31d209c', '55555555-5555-4555-8555-555555555555'));
    const resumed = file(`${stem}.jsonl`, `${prior.join('\n')}\n`);
    cpSync(sidecars, join(dir, stem, 'subagents'), { recursive: true });
    const loaded = await loadTranscriptSource(resumed);
    expect(loaded.subagents?.byToolUseId('toolu_01CYiK6ncgQLFUQ2iqC1b4oB')).toMatchObject({ agentId: 'ad286defbc77bc090' });
    // A copy named otherwise has no stem directory: the records' id names it.
    const copy = join(dir, 'copy', 'parent-copy.jsonl');
    cpSync(join(TRANSCRIPT_FIXTURE_DIR, 'subagent-parent.jsonl'), copy);
    cpSync(sidecars, join(dir, 'copy', '9a1d4262-0b43-46ad-acb9-5982f31d209c', 'subagents'), { recursive: true });
    expect((await loadTranscriptSource(copy)).subagents?.byToolUseId('toolu_01CYiK6ncgQLFUQ2iqC1b4oB')).toMatchObject({ agentId: 'ad286defbc77bc090' });
  });

  it('reads through an injected reader, so a test can hold the load', async () => {
    const loaded = await loadJournalSource('/nowhere/held.jsonl', async () => Buffer.from(`${readRows(join(FIXTURE_DIR, 'pass2/rewind.jsonl')).join('\n')}\n`));
    expect(loaded.rows).toEqual(loadJournal('pass2', 'rewind'));
  });

  it('the stand-in normaliser answers one frame.unknown per in row and nothing for out rows', () => {
    const normalizer = frameUnknownNormalizer(RUN);
    const rows = loadJournal('pass2', 'rewind');
    const events = rows.filter((r) => r.direction === 'in' || r.direction === 'out').flatMap((r) => normalizer.normalize(r));
    expect(events).toHaveLength(rows.filter((r) => r.direction === 'in').length);
    for (const event of events) {
      expect(SessionEventSchema.parse(event)).toEqual(event);
      expect(event).toMatchObject({ kind: 'frame.unknown', sessionId: RUN });
      expect(event.seq).not.toBeNull();
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(events.find((e) => e.kind === 'frame.unknown' && e.frameType === 'system')).toMatchObject({ subtype: 'init' });
  });
});

function readRows(path: string): string[] {
  return readFileSync(path, 'utf8').split('\n').filter((line) => line.length > 0);
}
