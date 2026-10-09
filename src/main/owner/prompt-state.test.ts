// The recorded state of a session's system prompt (the P2-C document, Design §2, item 2): the last `prompt_snapshot`
// attachment after the last compact boundary, classified by the contract's header. Pinned on the engine's own records
// (U2 run 6, kept whole in the fixtures' `prompt_snapshot_records` notes) and on synthetic transcripts.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTRACT_HEADER, TO_HUMAN_CONTRACT } from '@shared/owner/contract';
import { classifySnapshot, PromptStateReader, recordedState } from './prompt-state';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-prompt-state-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ENGINE_SEGMENTS = ['\nYou are an agent working with the user toward their goals.', '<total_tokens>15000000 tokens left</total_tokens>'];
const snapshot = (systemPrompt: string[]) => JSON.stringify({ type: 'attachment', uuid: 'a1', attachment: { type: 'prompt_snapshot', systemPrompt, contextRendering: {} } });
const BOUNDARY = JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid: 'b1', content: 'Conversation compacted' });
const user = (text: string) => JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: text } });
const write = (name: string, lines: string[]) => {
  const path = join(dir, name);
  writeFileSync(path, lines.map((line) => `${line}\n`).join(''));
  return path;
};

describe('classifySnapshot', () => {
  it('reads contract n from a segment opening with its header, and none otherwise', () => {
    expect(classifySnapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT])).toBe('contract:1');
    expect(classifySnapshot([...ENGINE_SEGMENTS, `${CONTRACT_HEADER(2)}\n\nlater semantics`])).toBe('contract:2');
    expect(classifySnapshot([...ENGINE_SEGMENTS, `${CONTRACT_HEADER(12)}\n`])).toBe('contract:12');
    expect(classifySnapshot(ENGINE_SEGMENTS)).toBe('none');
    expect(classifySnapshot([...ENGINE_SEGMENTS, `Some appended prompt. ${CONTRACT_HEADER(1)}`])).toBe('none'); // the header opens the segment
    expect(classifySnapshot([...ENGINE_SEGMENTS, '# Messages to the human (MAWS to-human contract x)'])).toBe('none');
    expect(classifySnapshot('not segments')).toBe('none');
  });
});

describe('recordedState reads a transcript', () => {
  it('is unrecorded for a missing file and for one with no snapshot', async () => {
    expect(await recordedState(join(dir, 'missing.jsonl'))).toBe('unrecorded');
    expect(await recordedState(write('plain.jsonl', [user('hello'), user('again')]))).toBe('unrecorded');
  });

  it('takes the last snapshot, and only one after the last compact boundary', async () => {
    expect(await recordedState(write('a.jsonl', [snapshot(ENGINE_SEGMENTS), user('x'), snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT]), user('y')]))).toBe('contract:1');
    expect(await recordedState(write('b.jsonl', [snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT]), user('x'), snapshot(ENGINE_SEGMENTS)]))).toBe('none');
    expect(await recordedState(write('c.jsonl', [snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT]), BOUNDARY, user('after')]))).toBe('unrecorded'); // the boundary hides it
    expect(await recordedState(write('d.jsonl', [snapshot(ENGINE_SEGMENTS), BOUNDARY, snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT])]))).toBe('contract:1');
  });

  it('is not misled by a prompt or a record that only mentions the two record types', async () => {
    const mention = user('the "prompt_snapshot" and "compact_boundary" records');
    const attachment = JSON.stringify({ type: 'attachment', attachment: { type: 'output_style', style: 'prompt_snapshot' } });
    expect(await recordedState(write('e.jsonl', [snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT]), mention, attachment, '{"type":"user", not json prompt_snapshot']))).toBe('contract:1');
  });

  it('reads records longer than its chunk, and lines split across chunks', async () => {
    const reader = new PromptStateReader({ chunkBytes: 64 });
    const long = snapshot([...ENGINE_SEGMENTS, `${TO_HUMAN_CONTRACT}${'x'.repeat(500)}`]);
    expect(await reader.recordedState(write('f.jsonl', [user('a'.repeat(100)), long, user('b'.repeat(90)), user('c')]))).toBe('contract:1');
    expect(await reader.recordedState(write('g.jsonl', [long, BOUNDARY, user('d'.repeat(200))]))).toBe('unrecorded');
  });

  it('scans only what was appended since its last read, and starts over when the file shrank', async () => {
    const reader = new PromptStateReader({ chunkBytes: 64 });
    const path = write('h.jsonl', [snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT]), user('one')]);
    expect(await reader.recordedState(path)).toBe('contract:1');
    appendFileSync(path, `${user('two')}\n`);
    expect(await reader.recordedState(path)).toBe('contract:1'); // the earlier answer stands for what was read
    appendFileSync(path, `${BOUNDARY}\n`);
    expect(await reader.recordedState(path)).toBe('unrecorded');
    appendFileSync(path, `${snapshot(ENGINE_SEGMENTS)}\n`);
    expect(await reader.recordedState(path)).toBe('none');
    writeFileSync(path, `${snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT])}\n`); // rewritten shorter
    expect(await reader.recordedState(path)).toBe('contract:1');
  });

  it('leaves a last line still being written for the next read', async () => {
    const reader = new PromptStateReader({ chunkBytes: 64 });
    const record = snapshot([...ENGINE_SEGMENTS, TO_HUMAN_CONTRACT]);
    const path = join(dir, 'i.jsonl');
    writeFileSync(path, `${user('one')}\n${record.slice(0, 80)}`);
    expect(await reader.recordedState(path)).toBe('unrecorded');
    appendFileSync(path, `${record.slice(80)}\n`);
    expect(await reader.recordedState(path)).toBe('contract:1');
  });
});

// The engine's real records (U2 run 6): the notes keep every `prompt_snapshot` record's segments whole and the compact
// boundary's line; a transcript is rebuilt from them, each record at its own line, so the classifier reads exactly
// what 2.1.295 wrote.
describe('conformance: the classifier on the engine’s recorded prompt snapshots (U2 run 6)', () => {
  type Note = { line: number; compactBoundary?: true; systemPrompt?: string[] };
  const notes = (scenario: string): Note[] => {
    const fixture = join(__dirname, '../../../spikes/protocol-probe/fixtures/pass3', `p2-to-human-shapes-${scenario}.jsonl`);
    const rows = readFileSync(fixture, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { frame: { event?: string; records?: Record<string, Note[]> } });
    const found = rows.flatMap((row) => (row.frame.event === 'prompt_snapshot_records' ? Object.values(row.frame.records ?? {}) : []));
    expect(found).toHaveLength(1); // one transcript per scenario
    return found[0]!;
  };
  const rebuild = (scenario: string, upTo = Infinity) => {
    const kept = notes(scenario).filter((note) => note.line <= upTo);
    const last = Math.max(...kept.map((note) => note.line)) + 2;
    const lines = Array.from({ length: last }, (_, i) => user(`turn ${i}`));
    for (const note of kept) {
      lines[note.line - 1] = note.compactBoundary ? BOUNDARY : snapshot(note.systemPrompt!);
    }
    return write(`${scenario}-${upTo}.jsonl`, lines);
  };

  it('S14 (a new session under the contract) records contract:1, its last segment the contract verbatim', async () => {
    const records = notes('s14-new');
    expect(records.every((note) => note.systemPrompt?.at(-1) === TO_HUMAN_CONTRACT)).toBe(true);
    expect(await recordedState(rebuild('s14-new'))).toBe('contract:1');
  });

  it('S14 after its compact boundary records contract:1 anew; cut at the boundary, the older snapshot is hidden', async () => {
    const boundary = notes('s14-compact').find((note) => note.compactBoundary)!;
    expect(notes('s14-compact').some((note) => note.line > boundary.line && note.systemPrompt)).toBe(true);
    expect(await recordedState(rebuild('s14-compact'))).toBe('contract:1');
    expect(await recordedState(rebuild('s14-compact', boundary.line))).toBe('unrecorded');
  });

  it('S16 (no contract, no style) records none', async () => {
    expect(await recordedState(rebuild('s16-new'))).toBe('none');
  });

  it('S15 (a declared style selected, no contract) records none: a style never reaches the snapshot', async () => {
    expect(notes('s15-new').every((note) => note.systemPrompt?.length === 11)).toBe(true);
    expect(await recordedState(rebuild('s15-new'))).toBe('none');
  });
});
