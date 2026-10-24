import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSearchText } from './search-text';
it('indexes user and assistant text, not tool results, thinking, metadata or a torn line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-search-'));
  try {
    const path = join(dir, 'session.jsonl');
    const rows = [
      { type: 'user', message: { content: 'Find bg-finished' } },
      { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'Done 회의' }, { type: 'tool_use', input: { hidden: 'secret' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'large log' }] } },
      { type: 'progress', message: { content: 'progress' } },
    ];
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n{"type":"user"');
    expect((await readSearchText(path)).text).toBe('Find bg-finished\nDone 회의');
  } finally { await rm(dir, { recursive: true }); }
});
