import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentChain } from '@shared/wire/transcript';
import { loadTranscriptFixture, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { HEAD_TAIL_BYTES, summarize } from './summarize';

const PARENT_FIXTURE = join(TEST_FIXTURE_DIR, 'transcripts/subagent-parent.jsonl');
// The session id is the file name under projects/<slug>/ (§4.3); the fixture copy carries its own name, so the
// summariser is given the path the file has in the store.
const PARENT_PATH = '/Users/new/.claude/projects/-private-tmp-maws-probe-WmHZ2j/9a1d4262-0b43-46ad-acb9-5982f31d209c.jsonl';

function headAndTail(bytes: Buffer): { head: Buffer; tail: Buffer } {
  if (bytes.length <= HEAD_TAIL_BYTES) return { head: bytes, tail: bytes };
  return { head: bytes.subarray(0, HEAD_TAIL_BYTES), tail: bytes.subarray(bytes.length - HEAD_TAIL_BYTES) };
}

const line = (record: object) => JSON.stringify(record) + '\n';

describe('head and tail summary', () => {
  it('summarises subagent-parent.jsonl from its 64 KiB windows', () => {
    const bytes = readFileSync(PARENT_FIXTURE);
    expect(bytes.length).toBeGreaterThan(HEAD_TAIL_BYTES); // head and tail are distinct windows for this file
    const stat = statSync(PARENT_FIXTURE);
    const { head, tail } = headAndTail(bytes);
    const summary = summarize(head, tail, { size: stat.size, mtimeMs: stat.mtimeMs }, PARENT_PATH, '-private-tmp-maws-probe-WmHZ2j');

    expect(summary.sessionId).toBe('9a1d4262-0b43-46ad-acb9-5982f31d209c');
    expect(summary.transcriptPath).toBe(PARENT_PATH);
    expect(summary.slug).toBe('-private-tmp-maws-probe-WmHZ2j');
    expect(summary.directory).toBe('/private/tmp/maws-probe-WmHZ2j');
    expect(summary.relocatedCwd).toBeNull();
    expect(summary.size).toBe(stat.size);
    expect(summary.mtimeMs).toBe(stat.mtimeMs);
    expect(summary.engineVersion).toBe('2.1.283');
    expect(summary.gitBranch).toBe('master');
    expect(summary.entrypoint).toBe('sdk-ts');
    expect(summary.hasMessages).toBe(true);
    expect(summary.aiTitle).toBe('Parallel agent subagents reading files');
    expect(summary.customTitle).toBeNull();
    expect(summary.firstPrompt).toMatch(/^Dispatch two general-purpose Agent subagents/);
    expect(summary.sessionKind).toBeNull();

    const records = loadTranscriptFixture('subagent-parent');
    const chain = currentChain(records);
    expect(summary.leafUuid).toBe(chain.leaf?.uuid);
    const withUuid = records.filter((r) => typeof r.uuid === 'string');
    expect(summary.firstRecordAt).toBe(withUuid[0].timestamp);
    expect(summary.lastRecordAt).toBe(withUuid.at(-1)?.timestamp);
    const lastAssistant = [...records].reverse().find((r) => r.type === 'assistant');
    const lastText = (lastAssistant?.message as { content: { type: string; text?: string }[] }).content.find((b) => b.type === 'text')?.text;
    expect(summary.lastAssistantText).toBe(lastText?.slice(0, 200));
  });

  it('takes the last title, prompt, branch and relocation in the tail, the first cwd in the head', () => {
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/first', version: '2.1.283', gitBranch: 'main', entrypoint: 'cli', sessionKind: 'bg', timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: 'Hello there' } }) +
      line({ type: 'custom-title', customTitle: 'First name', sessionId: 'S' }) +
      line({ type: 'ai-title', aiTitle: 'Generated', sessionId: 'S' }) +
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', cwd: '/elsewhere', gitBranch: 'feature', timestamp: '2026-09-28T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Reply one' }] } }) +
      line({ type: 'progress', uuid: 'p1', parentUuid: 'a1', timestamp: '2026-09-28T10:00:02.000Z' }) +
      line({ type: 'custom-title', customTitle: 'Second name', sessionId: 'S' }) +
      line({ type: 'relocated', relocatedCwd: '/moved', sessionId: 'S' }) +
      line({ type: 'last-prompt', lastPrompt: 'Hello there', leafUuid: 'a1', sessionId: 'S' });
    const bytes = Buffer.from(text, 'utf8');
    const summary = summarize(bytes, bytes, { size: bytes.length, mtimeMs: 5 }, '/store/projects/-first/S.jsonl', '-first');
    expect(summary.sessionId).toBe('S');
    expect(summary.directory).toBe('/first');
    expect(summary.relocatedCwd).toBe('/moved');
    expect(summary.customTitle).toBe('Second name');
    expect(summary.aiTitle).toBe('Generated');
    expect(summary.firstPrompt).toBe('Hello there');
    expect(summary.gitBranch).toBe('feature');
    expect(summary.engineVersion).toBe('2.1.283');
    expect(summary.entrypoint).toBe('cli');
    expect(summary.sessionKind).toBe('bg');
    expect(summary.hasMessages).toBe(true);
    expect(summary.leafUuid).toBe('a1'); // the progress record never counts as the leaf
    expect(summary.lastRecordAt).toBe('2026-09-28T10:00:02.000Z');
    expect(summary.firstRecordAt).toBe('2026-09-28T10:00:00.000Z');
    expect(summary.lastAssistantText).toBe('Reply one');
  });

  it('falls back to the first user text for the prompt, clears an empty custom title, and reads a bookkeeping-only file as having no messages', () => {
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'u1', isMeta: true, message: { role: 'user', content: 'meta text' } }) +
      line({ type: 'user', uuid: 'u3', parentUuid: 'u2', message: { role: 'user', content: 'x'.repeat(300) } }) +
      line({ type: 'custom-title', customTitle: '', sessionId: 'S' });
    const bytes = Buffer.from(text, 'utf8');
    const summary = summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1 }, '/p/S.jsonl', '-p');
    expect(summary.firstPrompt).toBe('x'.repeat(200));
    expect(summary.customTitle).toBeNull();
    expect(summary.lastAssistantText).toBeNull();

    const bookkeeping = Buffer.from(line({ type: 'queue-operation', operation: 'enqueue', sessionId: 'S' }) + line({ type: 'cost-state', sessionId: 'S' }), 'utf8');
    const empty = summarize(bookkeeping, bookkeeping, { size: bookkeeping.length, mtimeMs: 1 }, '/p/S.jsonl', '-p');
    expect(empty.hasMessages).toBe(false);
    expect(empty.directory).toBeNull();
    expect(empty.leafUuid).toBeNull();
    expect(empty.firstPrompt).toBeNull();
  });

  it('a first record longer than the head window still yields its top-level string fields from the fragment', () => {
    // 150 KB first user record with the session's facts before the long prompt; only its first 64 KiB reach the head.
    const big = line({ parentUuid: null, type: 'user', uuid: 'u1', timestamp: '2026-09-28T10:00:00.000Z', cwd: '/private/tmp/long-prompt', sessionId: 'S', version: '2.1.283', gitBranch: 'topic', entrypoint: 'cli', message: { role: 'user', content: 'y'.repeat(150 * 1024) } });
    const tailRecord = line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-28T10:00:05.000Z', gitBranch: 'topic', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
    const whole = Buffer.from(big + tailRecord, 'utf8');
    expect(whole.length).toBeGreaterThan(2 * HEAD_TAIL_BYTES);
    const summary = summarize(headAndTail(whole).head, headAndTail(whole).tail, { size: whole.length, mtimeMs: 1 }, '/p/S.jsonl', '-p');
    expect(summary.directory).toBe('/private/tmp/long-prompt');
    expect(summary.engineVersion).toBe('2.1.283');
    expect(summary.entrypoint).toBe('cli');
    expect(summary.gitBranch).toBe('topic');
    expect(summary.firstRecordAt).toBe('2026-09-28T10:00:00.000Z');
    expect(summary.lastRecordAt).toBe('2026-09-28T10:00:05.000Z');
    expect(summary.leafUuid).toBe('a1');
    expect(summary.hasMessages).toBe(true);
    // The fragment of the same record at the start of the tail is not mistaken for the leaf or a whole record.
    expect(summary.lastAssistantText).toBe('done');
  });

  it('ignores the partial line at the start of a tail window and at the end of a head window', () => {
    const first = line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: 'hi' } });
    const middle = line({ type: 'ai-title', aiTitle: 'Torn by the window', sessionId: 'S' });
    const last = line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-28T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
    const whole = Buffer.from(first + middle + last, 'utf8');
    // A head that ends inside `middle` and a tail that starts inside `middle`: the torn title line is in neither window whole.
    const head = whole.subarray(0, first.length + 10);
    const tail = whole.subarray(first.length + 12);
    const summary = summarize(head, tail, { size: whole.length, mtimeMs: 1 }, '/p/S.jsonl', '-p');
    expect(summary.aiTitle).toBeNull();
    expect(summary.leafUuid).toBe('a1');
    expect(summary.directory).toBe('/d');
    expect(summary.firstRecordAt).toBe('2026-09-28T10:00:00.000Z');
    expect(summary.lastRecordAt).toBe('2026-09-28T10:00:01.000Z');
  });
});
