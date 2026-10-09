// The recorded state of a session's system prompt (the P2-C document, Design §2, item 2): the last `prompt_snapshot`
// attachment after the last compact boundary, classified by the contract's header. Pinned on the engine's own records
// (U2 run 6, kept whole in the fixtures' `prompt_snapshot_records` notes) and on synthetic transcripts.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MessageUuid } from '@shared/graph/ids';
import { CONTRACT_HEADER, TO_HUMAN_CONTRACT } from '@shared/owner/contract';
import { TRANSCRIPT_FIXTURE_DIR } from '../../../test/support/fixtures';
import { classifySnapshot, PromptStateReader, recordedState, transcriptChain, transcriptEvidence } from './prompt-state';

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

// M4's disk evidence (Design §6; spikes/protocol-probe/findings-pass3-p2-to-human.txt, "M4 DISK EVIDENCE"): the engine
// writes a record carrying a human prompt's uuid only when it took the prompt: a `user` record for an idle prompt, a
// `queued_command` attachment (its `source_uuid`) for a `next` steer; a steer it cancelled leaves no record naming it.
// Pinned on the engine's own transcripts: w1-steer-next-cancelled is the transcript of pass3/steer-next-cancelled (the
// steer d7fade79 cancelled at seq 34-36), w1-steer-next-disk the run whose steer 1566e499 folded mid-turn.
describe('transcriptEvidence', () => {
  const fixture = (name: string) => join(TRANSCRIPT_FIXTURE_DIR, `${name}.jsonl`);
  const IDLE = 'c4d464bf-50e4-4a07-8f8f-ef85370a994f' as MessageUuid; // the cancelled run's first prompt, started and completed
  const CANCELLED = 'd7fade79-6f39-40b6-91f3-9998597857b4' as MessageUuid;
  const FOLDED = '1566e499-2c53-4cc8-b952-0729fca81e91' as MessageUuid;
  const NEVER = '99999999-9999-4999-8999-999999999999' as MessageUuid;
  const userWith = (uuid: string) => JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: 'hi' } });

  it('finds an idle prompt the engine took by its user record, and nothing for the steer it cancelled', async () => {
    expect(await transcriptEvidence(fixture('w1-steer-next-cancelled'), [CANCELLED])).toBeNull();
    expect(await transcriptEvidence(fixture('w1-steer-next-cancelled'), [CANCELLED, IDLE])).toBe(IDLE);
  });

  it('finds a steer the engine folded mid-turn by its queued_command attachment', async () => {
    expect(await transcriptEvidence(fixture('w1-steer-next-disk'), [FOLDED])).toBe(FOLDED);
    expect(await transcriptEvidence(fixture('w1-steer-next-disk'), [NEVER])).toBeNull();
  });

  it('reads no other record naming the uuid as evidence, reads across chunks, and is null for a missing file or no uuid', async () => {
    const lines = [
      JSON.stringify({ type: 'file-history-snapshot', messageId: NEVER, snapshot: { messageId: NEVER } }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: `the prompt ${NEVER}` }),
      JSON.stringify({ type: 'attachment', uuid: 'a2', attachment: { type: 'edited_text_file', source_uuid: NEVER } }),
      ...Array.from({ length: 40 }, (_, i) => user(`filler ${i} ${'x'.repeat(50)}`)),
    ];
    const path = write('t.jsonl', lines);
    expect(await new PromptStateReader({ chunkBytes: 64 }).transcriptEvidence(path, [NEVER])).toBeNull();
    const taken = write('taken.jsonl', [userWith(NEVER), ...lines.slice(3)]);
    expect(await new PromptStateReader({ chunkBytes: 64 }).transcriptEvidence(taken, [NEVER])).toBe(NEVER);
    expect(await transcriptEvidence(join(dir, 'missing.jsonl'), [NEVER])).toBeNull();
    expect(await transcriptEvidence(taken, [])).toBeNull();
  });

  it('leaves a last line still being written out', async () => {
    const path = join(dir, 'torn.jsonl');
    writeFileSync(path, `${user('one')}\n${userWith(NEVER)}`);
    expect(await transcriptEvidence(path, [NEVER])).toBeNull();
    appendFileSync(path, '\n');
    expect(await transcriptEvidence(path, [NEVER])).toBe(NEVER);
  });
});

describe('transcriptChain (what a rewind took off the chain)', () => {
  // rewind-real: the prompt 36a2aa44 and its answer 57525d04 were rewound; the next prompt a4d68c72 hangs from the
  // attachment the rewound one hung from, and the cut branch stays in the file
  const REWOUND = '36a2aa44-9ae9-455e-b52b-e70b27eecde5';
  const BELOW = '57525d04-1955-412a-925d-f406bc870d17';
  const fixture = join(TRANSCRIPT_FIXTURE_DIR, 'rewind-real.jsonl');

  it("answers the target and every record below it on the engine's own transcript, none of the branch that replaced it, across chunks", async () => {
    expect(await transcriptChain(fixture, REWOUND)).toEqual(new Set([REWOUND, BELOW]));
    expect(await new PromptStateReader({ chunkBytes: 256 }).transcriptChain(fixture, REWOUND)).toEqual(new Set([REWOUND, BELOW]));
  });

  it('follows a compact boundary by its logical parent, and is null for a uuid no record has or a missing file', async () => {
    const link = (uuid: string, parentUuid: string | null, more: Record<string, unknown> = {}) => JSON.stringify({ type: 'user', uuid, parentUuid, ...more });
    const path = write('chain.jsonl', [link('p1', null), link('a1', 'p1'), link('b1', null, { type: 'system', subtype: 'compact_boundary', logicalParentUuid: 'a1' }), link('a2', 'b1'), link('other', null)]);
    expect(await transcriptChain(path, 'a1')).toEqual(new Set(['a1', 'b1', 'a2']));
    expect(await transcriptChain(path, 'nobody')).toBeNull();
    expect(await transcriptChain(join(dir, 'missing.jsonl'), 'a1')).toBeNull();
  });
});
