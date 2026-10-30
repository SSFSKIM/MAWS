import { afterEach, beforeEach, expect, it } from 'vitest';
import { appendFile, mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import type { SearchCheckpoint } from '@shared/ipc/schema/fs';
import { SearchTextReader } from './search-text';

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
