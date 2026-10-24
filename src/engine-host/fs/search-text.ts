import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// Run in the engine host, never main's UI thread. Stream JSONL so tool-result
// payloads do not accumulate alongside the actual conversation text.
export async function readSearchText(path: string): Promise<{ text: string; size: number; mtimeMs: number }> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (info.size === 0) return { text: '', size: 0, mtimeMs: info.mtimeMs };
    const lines = createInterface({ input: file.createReadStream({ autoClose: false, end: info.size - 1 }), crlfDelay: Infinity });
    const text: string[] = [];
    for await (const line of lines) {
      let row: unknown;
      try { row = JSON.parse(line); } catch { continue; } // malformed/torn records are not messages
      if (!row || typeof row !== 'object') continue;
      const value = row as { type?: unknown; message?: { content?: unknown }; isMeta?: unknown };
      if (!['user', 'assistant'].includes(String(value.type)) || value.isMeta === true) continue;
      const content = value.message?.content;
      if (typeof content === 'string') text.push(content);
      else if (Array.isArray(content)) for (const block of content) {
        if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') text.push(block.text);
      }
    }
    return { text: text.join('\n'), size: info.size, mtimeMs: info.mtimeMs };
  } finally { await file.close(); }
}
