import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { appendFile, mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentBlock } from '@shared/graph/events';
import { FIXTURE_DIR, TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import { PROBE_JOINS, recordedJoin } from '../../../test/support/recorded-joins';
import { innerOpeningEnvelope, laterPassOverTheCap } from '../../../test/support/ask-steer';
import { consentMessage, envelopeSlices, pastedBodies, takeEnvelopesOut } from '@shared/engine/arrival';
import { answerOutsideTranscript } from '@shared/engine/persons-message';
import { answeredBlock, ASK_STEER_OPENING, askSteerOpening, askSteerText } from '@shared/maws/ask';
import type { SessionId } from '@shared/graph/ids';
import type { SearchCheckpoint } from '@shared/ipc/schema/fs';
import { TranscriptRecordSchema } from '@shared/wire/transcript';
import { createBackfillContext, parseBash, recordToEvents } from './backfill';
import { SearchTextReader, WORKER } from './search-text';

let reader: SearchTextReader;
beforeEach(() => { reader = new SearchTextReader(); });
afterEach(() => reader.stop());

it('bounds escaped wire pages and preserves the entire conversation, including one oversized record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-pages-'));
  try {
    const path = join(dir, 'session.jsonl');
    const body = 'x'.repeat(128 * 1024 - 1) + '\u{1F600}' + '\u0000회의'.repeat(100_000) + ' unique-tail';
    await writeFile(path, [
      { type: 'user', message: { content: body } },
      { type: 'assistant', message: { content: 'the last answer' } },
    ].map((row) => JSON.stringify(row)).join('\n'));
    let page = await reader.read(path);
    const stamp = { size: page.size, mtimeMs: page.mtimeMs };
    const pages: string[] = [];
    do {
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(1024 * 1024);
      expect(page).toMatchObject(stamp);
      expect(page.text.slice(-1)).not.toMatch(/[\uD800-\uDBFF]/);
      expect(page.text.slice(0, 1)).not.toMatch(/[\uDC00-\uDFFF]/);
      pages.push(page.text);
      if (!page.cursor) break;
      // Continuation owns the open file, not a rescan/reopen of the path.
      if (pages.length === 1) await rename(path, join(dir, 'moved.jsonl'));
      page = await reader.read(path, page.cursor);
    } while (pages.length < 100);
    expect(page.cursor).toBeNull();
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.join('')).toBe(body + '\nthe last answer');
  } finally { await rm(dir, { recursive: true }); }
});

it('indexes user and assistant text, not tool results, thinking, metadata or a torn line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-'));
  try {
    const path = join(dir, 'session.jsonl');
    const rows = [
      { type: 'user', message: { content: 'Find bg-finished' } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Done 회의' }, { type: 'tool_use', input: { hidden: 'secret' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'large log' }] } },
      { type: 'user', isMeta: true, message: { content: 'metadata' } },
      { type: 'progress', message: { content: 'progress' } },
    ];
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n{"type":"user"');
    const first = await reader.read(path);
    expect(first.text).toBe('Find bg-finished\nDone 회의');
    expect(first.cursor).toBeNull();
  } finally { await rm(dir, { recursive: true }); }
});

// test/fixtures/transcript-to-human-final.jsonl: the to-human plugin's made-up answer after a final message said
// nothing, so a search never finds a session by its words; the turn's own text stays indexed.
it('does not index the to-human plugin’s answer after a final message', async () => {
  const page = await reader.read(join(TEST_FIXTURE_DIR, 'transcript-to-human-final.jsonl'));
  expect(page.text).toBe('Run the stages and tell me how it went.\nLooking first.');
  expect(page.cursor).toBeNull();
});

it('does not create an extraction worker when the service stops during the initial open', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-stop-'));
  try {
    const path = join(dir, 'session.jsonl');
    await writeFile(path, JSON.stringify({ type: 'user', message: { content: 'never applied' } }));
    const pending = reader.read(path);
    reader.stop();
    await expect(pending).rejects.toThrow('stopped');
    await expect(reader.read(path)).rejects.toThrow('stopped');
  } finally { await rm(dir, { recursive: true }); }
});

it('reports bounded progress over tool-only input without dropping later conversation text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-progress-'));
  try {
    const path = join(dir, 'session.jsonl');
    const tool = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(1024 * 1024) }] } });
    await writeFile(path, (tool + '\n').repeat(5) + JSON.stringify({ type: 'assistant', message: { content: 'tail after logs' } }));
    const first = await reader.read(path);
    expect(first.text).toBe('');
    expect(first.cursor).not.toBeNull();
    const second = await reader.read(path, first.cursor!);
    expect(second.text).toBe('tail after logs');
    expect(second.cursor).toBeNull();
    await expect(reader.read(path, first.cursor!)).rejects.toThrow('expired');
  } finally { await rm(dir, { recursive: true }); }
});

// An incremental pass: the index keeps a pass's checkpoint with its text and offers it back to the next pass.
async function pass(path: string, resume?: SearchCheckpoint) {
  let page = await reader.read(path, undefined, resume);
  const { from } = page;
  let text = page.text;
  while (page.cursor) { page = await reader.read(path, page.cursor); text += page.text; }
  return { text, from, checkpoint: page.checkpoint! };
}
const turn = (i: number) => JSON.stringify({ type: i % 2 ? 'assistant' : 'user', message: { content: i % 3 === 0 ? [{ type: 'text', text: `turn ${i} 회의 \u{1F600}` }, { type: 'text', text: `second ${i}` }] : `turn ${i} 회의` } });
const noise = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'log' }] } });

it('resumes at the last complete line and equals a full pass across appends that split a line, a character or a record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-incremental-'));
  try {
    const path = join(dir, 'session.jsonl');
    const whole = [...Array.from({ length: 12 }, (_, i) => [turn(i), noise]).flat(), turn(99)].join('\n') + '\n';
    const bytes = Buffer.from(whole);
    // Cut at every kind of place: mid-line, mid-character (the Korean and the emoji are multi-byte), on a newline, after
    // a last line that has no newline yet but is complete.
    const cuts = [7, 61, 100, 133, 134, 135, 300, 411, 412, 640, 700, bytes.length - 1, bytes.length];
    let resume: SearchCheckpoint | undefined;
    let stored = '';
    let resumed = 0;
    for (const cut of cuts) {
      await writeFile(path, bytes.subarray(0, cut));
      const step = await pass(path, resume);
      if (resume && step.from > 0) resumed += 1;
      stored = step.from > 0 ? stored + step.text : step.text;
      const full = await new SearchTextReader().read(path); // a fresh pass over the same file
      expect(stored).toBe(full.text);
      resume = step.checkpoint;
    }
    expect(resumed).toBeGreaterThan(8);
    expect(stored).toContain('turn 99');
  } finally { await rm(dir, { recursive: true }); }
});

it('does not lose or double a record that is complete but unterminated when the next append finishes its line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-incremental-'));
  try {
    const path = join(dir, 'session.jsonl');
    await writeFile(path, `${turn(1)}\n${turn(2)}`); // the last record is whole, its newline not yet written
    const first = await pass(path);
    expect(first.text).toBe('turn 1 회의\nturn 2 회의');
    await appendFile(path, `\n${turn(4)}\n`);
    const second = await pass(path, first.checkpoint);
    expect(second.from).toBe(first.checkpoint.offset);
    expect(first.text + second.text).toBe('turn 1 회의\nturn 2 회의\nturn 4 회의');
    // Nothing was added: the pass resumes at the end of the file and reads none of it.
    const third = await pass(path, second.checkpoint);
    expect(third).toMatchObject({ text: '', from: second.checkpoint.offset });
  } finally { await rm(dir, { recursive: true }); }
});

it('does a full pass when the file was truncated, rewritten in place, replaced, or its head changed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-incremental-'));
  try {
    const path = join(dir, 'session.jsonl');
    const original = Array.from({ length: 40 }, (_, i) => turn(i)).join('\n') + '\n';
    await writeFile(path, original);
    const { checkpoint } = await pass(path);
    expect(checkpoint.offset).toBe(Buffer.byteLength(original));
    const expectFull = async (resume: SearchCheckpoint | undefined = checkpoint) => {
      const step = await pass(path, resume);
      const full = await new SearchTextReader().read(path);
      expect(step.from).toBe(0);
      expect(step.text).toBe(full.text);
    };
    // Resuming from the unchanged file does resume.
    expect((await pass(path, checkpoint)).from).toBe(checkpoint.offset);
    // Truncated below the offset.
    await writeFile(path, original.slice(0, 300));
    await expectFull();
    // Rewritten in place, longer than before, with a different first line.
    await writeFile(path, [turn(500), ...Array.from({ length: 80 }, (_, i) => turn(i))].join('\n') + '\n');
    await expectFull();
    // Rewritten in place to the same size and head, with a different last stretch before the offset.
    await writeFile(path, original.slice(0, original.length - 12) + 'x'.repeat(11) + '\n');
    await expectFull();
    // Replaced by another file with the same content: a different inode.
    await writeFile(join(dir, 'other.jsonl'), original);
    await rename(join(dir, 'other.jsonl'), path);
    await expectFull();
  } finally { await rm(dir, { recursive: true }); }
});

it('reads work proportional to the appended bytes, not to the transcript, when it resumes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-incremental-'));
  try {
    const path = join(dir, 'session.jsonl');
    const filler = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x'.repeat(8 * 1024) }] } });
    const body = Array.from({ length: 2500 }, (_, i) => (i % 10 === 0 ? turn(i) : filler)).join('\n') + '\n'; // about 20 MB
    await writeFile(path, body);
    const size = Buffer.byteLength(body);
    const full = await pass(path);
    expect(reader.stats.bytesRead).toBeGreaterThanOrEqual(size);
    const appended = `${turn(1)}\n${filler}\n${turn(2)}\n`;
    await appendFile(path, appended);
    const before = reader.stats.bytesRead;
    const step = await pass(path, full.checkpoint);
    const read = reader.stats.bytesRead - before;
    expect(step.from).toBe(size);
    expect(step.text).toBe('\nturn 1 회의\nturn 2 회의');
    // The new lines, and the fingerprints (one to validate the resume, one for the next; two small spans each); the 20 MB before them is not read.
    expect(read).toBeGreaterThanOrEqual(Buffer.byteLength(appended));
    expect(read).toBeLessThanOrEqual(Buffer.byteLength(appended) + 4 * 4096);
  } finally { await rm(dir, { recursive: true }); }
});

it('fails a resumed pass whose already-indexed prefix was rewritten while it ran, instead of publishing a checkpoint over it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-incremental-'));
  try {
    const path = join(dir, 'session.jsonl');
    const head = JSON.stringify({ type: 'user', message: { content: 'old-head' } });
    await writeFile(path, head + '\n');
    const first = await pass(path);
    const big = JSON.stringify({ type: 'assistant', message: { content: 'word '.repeat(60_000) } }); // several pages
    await appendFile(path, big + '\n');
    const page = await reader.read(path, undefined, first.checkpoint);
    expect(page.from).toBe(first.checkpoint.offset);
    expect(page.cursor).not.toBeNull();
    await writeFile(path, Buffer.from(JSON.stringify({ type: 'user', message: { content: 'new-head' } }) + '\n' + big + '\n'));
    let next = page;
    await expect((async () => { while (next.cursor) next = await reader.read(path, next.cursor); })()).rejects.toThrow('rewritten');
  } finally { await rm(dir, { recursive: true }); }
});

// Ticket 704 (docs/doperpowers/plans/2026-11-15-envelope-split.md, M3; ruling A; Acceptance 9): outside the transcript an
// answer reads as nothing. The engine's file holds one `user` line for a joined message, the person's prompt and MAWS's
// answer envelope as one text; the real worker reads it over the recorded file's bytes and indexes the person's words
// alone. What it should give is the text of the same file with that line holding the prompt as MAWS wrote it (the
// recording's own member), or no line where every member was an envelope.
const uxwave = (name: string) => join(FIXTURE_DIR, 'uxwave', `${name}.transcript.jsonl`);
const ENVELOPE_MARKS = ['[MAWS ask', '```json'];
const holdsEnvelope = (text: string) => ENVELOPE_MARKS.some((mark) => text.includes(mark));
const promptTexts = (prompt: string | ContentBlock[] | null): string[] =>
  prompt === null ? [] : typeof prompt === 'string' ? [prompt] : prompt.flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []));

// The recorded file with the joined line cut by hand to its prompt member
function cutByHand(name: string): string {
  const { joined, prompt } = recordedJoin(name);
  const lines = readFileSync(uxwave(name), 'utf8').split('\n');
  const rows = lines.map((line) => (line === '' ? null : (JSON.parse(line) as { type?: string; uuid?: string; message: { content: unknown } })));
  const at = rows.findIndex((row) => row?.type === 'user' && row.uuid === joined.uuid);
  expect(at).toBeGreaterThan(-1);
  const row = rows[at]!;
  if (prompt === null) lines.splice(at, 1);
  else lines[at] = JSON.stringify({ ...row, message: { ...row.message, content: prompt } });
  return lines.join('\n');
}

async function wholeText(path: string): Promise<string> {
  let page = await reader.read(path);
  let text = page.text;
  while (page.cursor) { page = await reader.read(path, page.cursor); text += page.text; }
  return text;
}

describe('a joined answer in the engine’s file (ticket 704)', () => {
  it.each(PROBE_JOINS)('%s: the real worker indexes the person’s prompt and nothing of the envelope; every other row as today', async (name) => {
    const dir = await mkdtemp(join(tmpdir(), 'maws-search-704-'));
    try {
      const text = await wholeText(uxwave(name));
      for (const words of promptTexts(recordedJoin(name).prompt)) expect(text).toContain(words);
      expect(holdsEnvelope(text)).toBe(false);
      const cut = join(dir, 'cut.jsonl');
      await writeFile(cut, cutByHand(name));
      expect(text).toBe(await wholeText(cut));
    } finally { await rm(dir, { recursive: true }); }
  });

  it('p1-maws-ask-async: an answer sent alone reads as nothing; the turn’s words around it stay', async () => {
    const text = await wholeText(join(TEST_FIXTURE_DIR, 'transcripts', 'p1-maws-ask-async.jsonl'));
    expect(holdsEnvelope(text)).toBe(false);
    expect(text).toContain('Use the maws ask tool with blocking false');
    expect(text).toContain('ANSWER: Yes');
  });

  it('made by hand from the recorded form: an assistant’s text and a row of another origin that hold an envelope are read as today', async () => {
    const { envelopes } = recordedJoin('u704-end-env-first-1');
    const envelope = envelopes[0]!;
    const dir = await mkdtemp(join(tmpdir(), 'maws-search-704-'));
    try {
      const path = join(dir, 'session.jsonl');
      await writeFile(path, [
        { type: 'user', origin: { kind: 'peer' }, message: { content: `A peer quotes it:\n${envelope}` } },
        { type: 'assistant', message: { content: [{ type: 'text', text: envelope }] } },
        { type: 'user', origin: { kind: 'human' }, message: { content: `Words of the person.\n${envelope}` } },
      ].map((row) => JSON.stringify(row)).join('\n') + '\n');
      expect(await wholeText(path)).toBe(`A peer quotes it:\n${envelope}\n${envelope}\nWords of the person.`);
    } finally { await rm(dir, { recursive: true }); }
  });

  // the earlier review's finding: the worker runs the reader's own source, so such an envelope is bounded out and stays
  // text, as the window draws it (the reading past the bound, A, dropped by the architect's ruling 2 of 2026-11-16)
  it('made by hand: an earlier build’s envelope whose question holds the consent sentence and another ask’s opening line, alone and after the person’s words: the text is the rows as they came, as the window draws them', async () => {
    const grant = consentMessage('command', 'make deploy');
    const envelope = innerOpeningEnvelope('toolu_A', grant);
    const dir = await mkdtemp(join(tmpdir(), 'maws-search-704-'));
    try {
      const path = join(dir, 'session.jsonl');
      await writeFile(path, [
        { type: 'user', origin: { kind: 'human' }, message: { content: envelope } },
        { type: 'user', origin: { kind: 'human' }, message: { content: `Words of the person.\n${envelope}` } },
      ].map((row) => JSON.stringify(row)).join('\n') + '\n');
      const text = await wholeText(path);
      expect(text).toBe(`${envelope}\nWords of the person.\n${envelope}`);
      for (const line of [askSteerOpening('toolu_A'), askSteerOpening('toolu_inner'), grant]) expect(envelope.split('\n')).toContain(line);
    } finally { await rm(dir, { recursive: true }); }
  });

  // the architect's ruling 4 of 2026-11-16: the reader's loop reads at most 16 passes, from its own source too, so a text
  // whose 16th pass still takes an envelope is left whole, as the window draws it
  it('made by hand: sixteen envelopes nested one inside another after the person’s words, past the loop’s 16 passes: the text is the row as it came, as the window draws it', async () => {
    const LAYOUT = { id: 'q1', question: 'Which layout should the page use?', modality: 'choice' as const, options: [{ label: 'Grid' }, { label: 'List' }] };
    const answerOf = (n: number) => askSteerText(`ask-n${n}`, [LAYOUT], [{ id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] }]);
    const nest = (depth: number) => {
      let inner = answerOf(depth);
      for (let n = depth - 1; n >= 1; n -= 1) {
        const lines = answerOf(n).split('\n');
        inner = [...lines.slice(0, 2), inner, ...lines.slice(2)].join('\n');
      }
      return `Words of the person.\n${inner}`;
    };
    const dir = await mkdtemp(join(tmpdir(), 'maws-search-704-'));
    try {
      const path = join(dir, 'session.jsonl');
      await writeFile(path, [nest(16), nest(15)].map((content) => JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { content } })).join('\n') + '\n');
      const text = await wholeText(path);
      expect(text).toBe(`${nest(16)}\nWords of the person.`); // fifteen, within the bound, are read out
    } finally { await rm(dir, { recursive: true }); }
  });

  // the frontier review's input: the loop's second pass goes over the slicer's cap of checks, and over either bound the
  // text is left whole, as the window draws it; the second row, within both bounds, has its envelope read out
  it('made by hand: the opening of one ask, a whole envelope of another, 65 closing lines and the first ask’s block, which a second pass reads only past the slicer’s cap: the text is the row as it came, as the window draws it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maws-search-704-'));
    try {
      const path = join(dir, 'session.jsonl');
      await writeFile(path, [laterPassOverTheCap(), `Words of the person.\n${askSteerText('inner', [], [])}`].map((content) => JSON.stringify({ type: 'user', origin: { kind: 'human' }, message: { content } })).join('\n') + '\n');
      expect(await wholeText(path)).toBe(`${laterPassOverTheCap()}\nWords of the person.`);
    } finally { await rm(dir, { recursive: true }); }
  });

  it('u704-end-prompt-first-1: a pass resumed from a checkpoint taken before the joined line gives what a pass from the start gives', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maws-search-704-'));
    try {
      const path = join(dir, 'session.jsonl');
      const bytes = readFileSync(uxwave('u704-end-prompt-first-1'));
      const { joined } = recordedJoin('u704-end-prompt-first-1');
      const at = bytes.indexOf(Buffer.from(`"uuid":"${joined.uuid}"`));
      const lineStart = bytes.lastIndexOf(10, at) + 1; // the joined line begins after the newline before it
      expect(lineStart).toBeGreaterThan(0);
      await writeFile(path, bytes.subarray(0, lineStart));
      const before = await pass(path);
      expect(before.checkpoint.offset).toBe(lineStart);
      await writeFile(path, bytes);
      const after = await pass(path, before.checkpoint);
      expect(after.from).toBe(lineStart);
      expect(before.text + after.text).toBe(await wholeText(path));
      expect(holdsEnvelope(after.text)).toBe(false);
    } finally { await rm(dir, { recursive: true }); }
  });
});

// The branch panel's finding 2 and the landing session's ruling (2026-11-16): a shell row is no person's text to read
// envelopes out of. The worker passes it over by the backfill's own test of a shell row (`parseBash`, run from its
// source), so the search text holds what the window draws of it: the whole command, the whole output.
describe('made by hand: a shell row that holds a literal envelope (ticket 704)', () => {
  const envelope = recordedJoin('u704-end-env-first-1').envelopes[0]!;
  const INPUT = `<bash-input>cat > note.md <<'EOF'\n${envelope}\nEOF</bash-input>`;
  const OUTPUT = `<bash-stdout>Wrote the note:\n${envelope}\ndone</bash-stdout><bash-stderr></bash-stderr><bash-exit-code>0</bash-exit-code>`;
  const rows = [
    { type: 'user', uuid: 'b0b0b0b0-0000-4000-8000-000000000701', parentUuid: null, timestamp: '2026-11-16T10:00:00.000Z', origin: { kind: 'human' }, message: { role: 'user', content: INPUT } },
    { type: 'user', uuid: 'b0b0b0b0-0000-4000-8000-000000000702', parentUuid: 'b0b0b0b0-0000-4000-8000-000000000701', timestamp: '2026-11-16T10:00:01.000Z', message: { role: 'user', content: OUTPUT } },
  ];

  it('the search text over a person’s <bash-input> row holding a heredoc envelope, and over a shell output row holding one, holds the whole command and the whole output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maws-search-704-'));
    try {
      const path = join(dir, 'session.jsonl');
      await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
      expect(await wholeText(path)).toBe(`${INPUT}\n${OUTPUT}`);
    } finally { await rm(dir, { recursive: true }); }
  });

  it('the backfill keeps the same rows whole: shell messages, which the split does not read', () => {
    const ctx = createBackfillContext({ sessionId: 'sess-shell' as SessionId, agent: null });
    const messages = rows.flatMap((row) => recordToEvents(TranscriptRecordSchema.parse(row), ctx)).filter((event) => event.kind === 'user.message');
    expect(messages.map((event) => [event.bash?.part, event.content])).toEqual([['input', INPUT.slice('<bash-input>'.length, -'</bash-input>'.length)], ['output', `Wrote the note:\n${envelope}\ndone`]]);
  });
});

// Ticket 704, the architect's ruling 6 of 2026-11-16: the opening-line test has one definition, the reader's
// `envelopeSlices`. The worker holds the reader's own source byte for byte, and the opening's one constant beside it; the
// two literals of the tag the function keeps (its early return on a text without the tag, and the id pattern of `opens`)
// are that constant's, so a change of the constant that left either behind fails here.
describe('the worker’s reading of an envelope is the reader’s own (ticket 704)', () => {
  it('guard: the worker holds the reader’s functions as their own source, the opening’s one constant, and calls the slicer with the writer’s opening line', () => {
    const own: [string, unknown][] = [['envelopeSlices', envelopeSlices], ['takeEnvelopesOut', takeEnvelopesOut], ['askSteerOpening', askSteerOpening], ['pastedBodies', pastedBodies], ['answeredBlock', answeredBlock], ['answerOutsideTranscript', answerOutsideTranscript], ['parseBash', parseBash]];
    for (const [name, fn] of own) expect(WORKER, name).toContain(`\nconst ${name} = ${String(fn)};`);
    expect(WORKER).toContain(`\nconst ASK_STEER_OPENING = ${JSON.stringify(ASK_STEER_OPENING)};`);
    expect(WORKER).toContain('envelopeSlices(part, askSteerOpening, pastedBodies, answeredBlock, MAX_ENVELOPE_CHECKS)');
    // no second definition of the opening line in the worker: each name declared once
    for (const name of ['envelopeSlices', 'takeEnvelopesOut', 'askSteerOpening', 'ASK_STEER_OPENING']) expect(WORKER.split(`const ${name} = `), name).toHaveLength(2);
  });

  it('guard: the two literals of the tag inside envelopeSlices, and the tag pattern of answeredBlock, which the worker also runs, are ASK_STEER_OPENING', () => {
    const escaped = ASK_STEER_OPENING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const source = String(envelopeSlices);
    const early = /if \(!text\.includes\((['"`])(.*?)\1\)\) return whole;/.exec(source);
    expect(early?.[2], 'the early return on a text without the tag').toBe(ASK_STEER_OPENING);
    for (const [what, pattern] of [
      ['the id pattern of `opens`', /const id = \/(.+?)\/\.exec\(line\)/.exec(source)?.[1]],
      ['the tag pattern of answeredBlock', /const tag = \/(.+?)\/\.exec\(text\)/.exec(String(answeredBlock))?.[1]],
    ] as const) {
      expect(pattern?.startsWith(`^${escaped}`), what).toBe(true);
      expect(new RegExp(pattern!).exec(askSteerOpening('toolu_x'))?.[1], what).toBe('toolu_x');
    }
  });
});
