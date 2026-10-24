import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
