import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { previewLine } from '@shared/owner/preview';
import { currentChain } from '@shared/wire/transcript';
import { loadJournal, loadTranscriptFixture, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
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
const records0 = () => loadTranscriptFixture('subagent-parent').filter((r) => typeof r.uuid === 'string' && r.parentUuid === null);

describe('head and tail summary', () => {
  it('summarises subagent-parent.jsonl from its 64 KiB windows', () => {
    const bytes = readFileSync(PARENT_FIXTURE);
    expect(bytes.length).toBeGreaterThan(HEAD_TAIL_BYTES); // head and tail are distinct windows for this file
    const stat = statSync(PARENT_FIXTURE);
    const { head, tail } = headAndTail(bytes);
    const summary = summarize(head, tail, { size: stat.size, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs }, PARENT_PATH, '-private-tmp-maws-probe-WmHZ2j');

    expect(summary.sessionId).toBe('9a1d4262-0b43-46ad-acb9-5982f31d209c');
    expect(summary.transcriptPath).toBe(PARENT_PATH);
    expect(summary.slug).toBe('-private-tmp-maws-probe-WmHZ2j');
    expect(summary.directory).toBe('/private/tmp/maws-probe-WmHZ2j');
    expect(summary.relocatedCwd).toBeNull();
    expect(summary.size).toBe(stat.size);
    expect(summary.mtimeMs).toBe(stat.mtimeMs);
    expect(summary.birthtimeMs).toBe(stat.birthtimeMs); // E3: orders a fork family (A-16)
    expect(summary.rootUuid).toBe(records0()[0]?.uuid);
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
    expect(summary.lastAssistantText).toBe(previewLine(lastText!, 200)); // E11 F2b: the preview, not the raw text
  });

  // W13: a session resumed after an update was last written by the newer engine, as its live status says
  it('takes the latest version that wrote the file', () => {
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/first', version: '2.1.283', timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: 'Hello' } }) +
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', cwd: '/first', version: '2.1.283', timestamp: '2026-09-28T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] } }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'a1', cwd: '/first', version: '2.1.287', timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: 'Again' } }) +
      line({ type: 'last-prompt', lastPrompt: 'Again', leafUuid: 'u2', sessionId: 'S' });
    const bytes = Buffer.from(text, 'utf8');
    expect(summarize(bytes, bytes, { size: bytes.length, mtimeMs: 5, birthtimeMs: 0 }, '/store/projects/-first/S.jsonl', '-first').engineVersion).toBe('2.1.287');
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
    const summary = summarize(bytes, bytes, { size: bytes.length, mtimeMs: 5, birthtimeMs: 0 }, '/store/projects/-first/S.jsonl', '-first');
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

  // Debt wave 4, the title rule (charter §19, the C12 review rulings, item (1)): a `none`-source title is the
  // conversation's first human prompt; the engine's `last-prompt` follows the latest prompt, a relay's steer included.
  // E11 F2b (plan 2.6): the last answer is kept as its preview, chosen from the whole block before the 200-character cap
  it('keeps the last answer as its owner-aware preview: the essential text, not the "<to-human>" its first line holds', () => {
    const report = `<to-human>\n${'context '.repeat(40)}\n<essential>Decisive: the cache is stale.</essential>\n</to-human>`;
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: '2026-09-29T10:00:00.000Z', message: { role: 'user', content: 'Check the cache' } }) +
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-29T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: report }] } });
    const bytes = Buffer.from(text, 'utf8');
    expect(summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').lastAssistantText).toBe('Decisive: the cache is stale.');
  });

  it("the prompt is the conversation's first, never a later prompt or a relay's steer that the engine's last-prompt names", () => {
    const steer = 'Relay to agent a7aea42f9bed9b3ea with SendMessage, verbatim, then continue what you were doing: Say PING in your next inbox line';
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: '2026-09-29T10:00:00.000Z', message: { role: 'user', content: 'Fix the drag handle' } }) +
      line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-29T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }] } }) +
      line({ type: 'last-prompt', lastPrompt: 'Fix the drag handle', leafUuid: 'a1', sessionId: 'S' }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: '2026-09-29T10:00:02.000Z', message: { role: 'user', content: steer } }) +
      line({ type: 'last-prompt', lastPrompt: steer, leafUuid: 'u2', sessionId: 'S' });
    const bytes = Buffer.from(text, 'utf8');
    expect(summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').firstPrompt).toBe('Fix the drag handle');

    // a real terminal transcript with three prompts: last-prompt ends on the third
    const real = readFileSync(join(TEST_FIXTURE_DIR, 'transcripts/rewind-terminal.jsonl'));
    const windows = headAndTail(real);
    expect(summarize(windows.head, windows.tail, { size: real.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/a76ad588-e4b4-4a99-bf4e-69287514916f.jsonl', '-p').firstPrompt).toBe('Remember APPLE.');
  });

  // W9 (H2): the engine writes `"gitBranch":"HEAD"` in a folder that is no repository (and for a detached checkout)
  it('takes no branch from HEAD or an empty gitBranch, the latest record deciding', () => {
    const real = readFileSync(join(TEST_FIXTURE_DIR, 'transcripts/rewind-terminal.jsonl'));
    expect(real.toString('utf8')).toContain('"gitBranch":"HEAD"');
    const windows = headAndTail(real);
    expect(summarize(windows.head, windows.tail, { size: real.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/a76ad588-e4b4-4a99-bf4e-69287514916f.jsonl', '-p').gitBranch).toBeNull();
    const of = (...branches: string[]) => {
      const bytes = Buffer.from(branches.map((gitBranch, i) => line({ type: 'user', uuid: `u${i}`, parentUuid: i === 0 ? null : `u${i - 1}`, cwd: '/d', gitBranch, message: { role: 'user', content: 'go' } })).join(''), 'utf8');
      return summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').gitBranch;
    };
    expect([of(''), of('main', 'HEAD'), of('HEAD', 'main')]).toEqual([null, null, 'main']);
  });

  it('a bash-mode first prompt is the command as the terminal shows it, `! <command>`, never its tags', () => {
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', message: { role: 'user', content: '<bash-input>git status</bash-input>' } }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'u1', message: { role: 'user', content: '<bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>' } }) +
      line({ type: 'user', uuid: 'u3', parentUuid: 'u2', message: { role: 'user', content: 'Now fix the drag handle' } });
    const bytes = Buffer.from(text, 'utf8');
    expect(summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').firstPrompt).toBe('! git status');
  });

  // W11 (I1): an empty first text block titled the session blank; the block with words is the prompt
  it('an empty text block is no prompt: the first block with words is, else the next user record', () => {
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', message: { role: 'user', content: [{ type: 'text', text: '' }, { type: 'text', text: 'Fix the drag handle' }] } }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'u1', message: { role: 'user', content: 'later' } });
    const bytes = Buffer.from(text, 'utf8');
    expect(summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').firstPrompt).toBe('Fix the drag handle');
    const blank =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', message: { role: 'user', content: [{ type: 'text', text: '  ' }] } }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'u1', message: { role: 'user', content: 'Then this one' } });
    const blankBytes = Buffer.from(blank, 'utf8');
    expect(summarize(blankBytes, blankBytes, { size: blankBytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').firstPrompt).toBe('Then this one');
  });

  it('a first prompt longer than the head window falls back to the earliest last-prompt the windows hold', () => {
    const big = line({ parentUuid: null, type: 'user', uuid: 'u1', timestamp: '2026-09-29T10:00:00.000Z', cwd: '/d', message: { role: 'user', content: 'y'.repeat(150 * 1024) } });
    const rest =
      line({ type: 'last-prompt', lastPrompt: 'yyyy…', leafUuid: 'u1', sessionId: 'S' }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'u1', timestamp: '2026-09-29T10:00:02.000Z', message: { role: 'user', content: 'a steer' } }) +
      line({ type: 'last-prompt', lastPrompt: 'a steer', leafUuid: 'u2', sessionId: 'S' });
    const whole = Buffer.from(big + rest, 'utf8');
    const windows = headAndTail(whole);
    expect(summarize(windows.head, windows.tail, { size: whole.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').firstPrompt).toBe('yyyy…');
  });

  it('takes the custom title from the tail record, else the custom-title.json sidecar, else the head record (SPEC 35.14.3)', () => {
    const filler = line({ type: 'attachment', uuid: 'f1', parentUuid: 'u1', attachment: { type: 'x', text: 'y'.repeat(HEAD_TAIL_BYTES) } });
    const headOnly = Buffer.from(
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', message: { role: 'user', content: 'hi' } }) +
        line({ type: 'custom-title', customTitle: 'In the head', sessionId: 'S' }) +
        filler +
        line({ type: 'assistant', uuid: 'a1', parentUuid: 'f1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }),
      'utf8',
    );
    const windows = headAndTail(headOnly);
    const stat = { size: headOnly.length, mtimeMs: 1, birthtimeMs: 0 };
    expect(summarize(windows.head, windows.tail, stat, '/p/S.jsonl', '-p').customTitle).toBe('In the head');
    expect(summarize(windows.head, windows.tail, stat, '/p/S.jsonl', '-p', 'From the sidecar').customTitle).toBe('From the sidecar');

    const inTail = Buffer.concat([headOnly, Buffer.from(line({ type: 'custom-title', customTitle: 'In the tail', sessionId: 'S' }), 'utf8')]);
    const tailWindows = headAndTail(inTail);
    expect(summarize(tailWindows.head, tailWindows.tail, { size: inTail.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p', 'From the sidecar').customTitle).toBe('In the tail');
  });

  it('falls back to the first user text for the prompt, clears an empty custom title, and reads a bookkeeping-only file as having no messages', () => {
    const text =
      line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }) +
      line({ type: 'user', uuid: 'u2', parentUuid: 'u1', isMeta: true, message: { role: 'user', content: 'meta text' } }) +
      line({ type: 'user', uuid: 'u3', parentUuid: 'u2', message: { role: 'user', content: 'x'.repeat(300) } }) +
      line({ type: 'custom-title', customTitle: '', sessionId: 'S' });
    const bytes = Buffer.from(text, 'utf8');
    const summary = summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p');
    expect(summary.firstPrompt).toBe('x'.repeat(200));
    expect(summary.customTitle).toBeNull();
    expect(summary.lastAssistantText).toBeNull();

    const bookkeeping = Buffer.from(line({ type: 'queue-operation', operation: 'enqueue', sessionId: 'S' }) + line({ type: 'cost-state', sessionId: 'S' }), 'utf8');
    const empty = summarize(bookkeeping, bookkeeping, { size: bookkeeping.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p');
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
    const summary = summarize(headAndTail(whole).head, headAndTail(whole).tail, { size: whole.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p');
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

  it('a nested uuid, cwd or gitBranch inside a tool input never masquerades as the record\'s in a head fragment', () => {
    // A 150 KB assistant record: real top-level facts first, then a tool input carrying the same keys, then padding.
    const big = line({
      parentUuid: null, type: 'assistant', uuid: 'real-message', gitBranch: 'main', cwd: '/real', timestamp: '2026-09-28T10:00:00.000Z', version: '2.1.283',
      message: { id: 'm', model: 'x', content: [{ type: 'tool_use', id: 't', name: 'Write', input: { uuid: 'nested-input-uuid', gitBranch: 'nested-input-branch', cwd: '/nested', content: 'y'.repeat(150 * 1024) } }] },
    });
    const whole = Buffer.from(big, 'utf8');
    const summary = summarize(headAndTail(whole).head, headAndTail(whole).tail, { size: whole.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p');
    expect(summary.leafUuid).toBe('real-message');
    expect(summary.gitBranch).toBe('main');
    expect(summary.directory).toBe('/real');
    expect(summary.engineVersion).toBe('2.1.283');
    expect(summary.firstRecordAt).toBe('2026-09-28T10:00:00.000Z');
  });

  it('a tail fragment that begins mid-record contributes nothing, even when it holds nested keys', () => {
    // The big record's nested keys sit at its end, inside the tail window's cut-off first line; the whole record after
    // it carries no gitBranch, so the branch must come from the head's record start, not from the tool input.
    const big = line({
      parentUuid: null, type: 'user', uuid: 'real-message', gitBranch: 'main', cwd: '/real', timestamp: '2026-09-28T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'y'.repeat(150 * 1024) }, { type: 'tool_result', tool_use_id: 't', content: '{"uuid":"nested-input-uuid","gitBranch":"nested-input-branch","cwd":"/nested"}' }] },
      toolUseResult: { uuid: 'nested-result-uuid', gitBranch: 'nested-result-branch', cwd: '/nested-result' },
    });
    const last = line({ type: 'assistant', uuid: 'a1', parentUuid: 'real-message', timestamp: '2026-09-28T10:00:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } });
    const whole = Buffer.from(big + last, 'utf8');
    const summary = summarize(headAndTail(whole).head, headAndTail(whole).tail, { size: whole.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p');
    expect(summary.leafUuid).toBe('a1');
    expect(summary.gitBranch).toBe('main');
    expect(summary.directory).toBe('/real');
    expect(summary.lastRecordAt).toBe('2026-09-28T10:00:05.000Z');
    expect(summary.lastAssistantText).toBe('done');
  });

  it('a torn last line of the tail window is scanned from its record start, depth 1 only', () => {
    const first = line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', gitBranch: 'main', timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: 'hi' } });
    const torn = JSON.stringify({ parentUuid: 'u1', type: 'assistant', uuid: 'u2', gitBranch: 'torn', timestamp: '2026-09-28T10:00:01.000Z', message: { id: 'm', content: [{ type: 'tool_use', input: { uuid: 'nested-input-uuid', gitBranch: 'nested-input-branch' } }] } });
    const whole = Buffer.from(first + torn.slice(0, torn.length - 20), 'utf8'); // cut inside the nested input, no newline
    const summary = summarize(whole, whole, { size: whole.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p');
    expect(summary.leafUuid).toBe('u2');
    expect(summary.gitBranch).toBe('torn');
    expect(summary.lastRecordAt).toBe('2026-09-28T10:00:01.000Z');
    expect(summary.directory).toBe('/d');
  });

  it('ignores the partial line at the start of a tail window and at the end of a head window', () => {
    const first = line({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content: 'hi' } });
    const middle = line({ type: 'ai-title', aiTitle: 'Torn by the window', sessionId: 'S' });
    const last = line({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: '2026-09-28T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } });
    const whole = Buffer.from(first + middle + last, 'utf8');
    // A head that ends inside `middle` and a tail that starts inside `middle`: the torn title line is in neither window whole.
    const head = whole.subarray(0, first.length + 10);
    const tail = whole.subarray(first.length + 12);
    const summary = summarize(head, tail, { size: whole.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p');
    expect(summary.aiTitle).toBeNull();
    expect(summary.leafUuid).toBe('a1');
    expect(summary.directory).toBe('/d');
    expect(summary.firstRecordAt).toBe('2026-09-28T10:00:00.000Z');
    expect(summary.lastRecordAt).toBe('2026-09-28T10:00:01.000Z');
  });
});

// E3 (A-16's disk signal): a `--fork-session` copy repeats its parent's root record under its own session id, so the
// first `parentUuid: null` record of the head names the conversation a transcript belongs to.
describe('the transcript’s root uuid', () => {
  it('finds the parent’s root in the fork child of p1-fork-session-flag (seq 40), past its uuid-less head records', () => {
    const snapshot = loadJournal('pass3', 'p1-fork-session-flag').find((row) => row.seq === 40)!.frame as { label: string; records: object[] };
    expect(snapshot.label).toBe('fork-child');
    const bytes = Buffer.from(snapshot.records.map(line).join(''), 'utf8');
    const summary = summarize(bytes, bytes, { size: bytes.length, mtimeMs: 2, birthtimeMs: 1759721379180 }, '/p/bfdf4123-a931-4896-abd3-1f99c542f54e.jsonl', '-p');
    expect(summary.rootUuid).toBe('b1277739-a5e8-440b-99de-90dd59edf04f');
    expect(summary.birthtimeMs).toBe(1759721379180);
  });

  it('is null for a head with no message record, and skips records that are not roots', () => {
    const bookkeeping = Buffer.from(line({ type: 'queue-operation', operation: 'enqueue', sessionId: 'S' }) + line({ type: 'mode', mode: 'normal', sessionId: 'S' }), 'utf8');
    expect(summarize(bookkeeping, bookkeeping, { size: bookkeeping.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').rootUuid).toBeNull();
    const text = line({ type: 'file-history-snapshot', messageId: 'm1', snapshot: {} }) + line({ type: 'user', uuid: 'u2', parentUuid: 'u1', message: { role: 'user', content: 'x' } }) + line({ type: 'user', uuid: 'u3', parentUuid: null, message: { role: 'user', content: 'y' } });
    const bytes = Buffer.from(text, 'utf8');
    expect(summarize(bytes, bytes, { size: bytes.length, mtimeMs: 1, birthtimeMs: 0 }, '/p/S.jsonl', '-p').rootUuid).toBe('u3');
  });
});
