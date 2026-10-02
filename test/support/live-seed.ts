import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The transcript, not the PTY's echoed input, proves that the seed turn completed.
export function hasCompletedReply(jsonl: string, prompt: string, marker: string): boolean {
  let prompted = false;
  // A writer may be partway through the last row. Only newline-terminated records are evidence.
  for (const line of jsonl.split('\n').slice(0, -1)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { type?: string; isSidechain?: boolean; message?: { role?: string; content?: unknown; stop_reason?: string | null } };
    if (row.isSidechain) continue;
    if (row.type === 'user') prompted = row.message?.content === prompt;
    const message = row.message;
    if (prompted && row.type === 'assistant' && message?.role === 'assistant' && message.stop_reason === 'end_turn' && Array.isArray(message.content)) {
      if (message.content.some((block: { type?: string; text?: string }) => block.type === 'text' && block.text?.includes(marker))) return true;
    }
  }
  return false;
}

export async function waitForSeedTranscript(dir: string, existing: ReadonlySet<string>, prompt: string, marker: string, timeoutMs = 120_000, pollMs = 250): Promise<string> {
  const until = Date.now() + timeoutMs;
  do {
    for (const file of existsSync(dir) ? readdirSync(dir) : []) {
      if (!file.endsWith('.jsonl') || existing.has(file)) continue;
      if (hasCompletedReply(readFileSync(join(dir, file), 'utf8'), prompt, marker)) return file.slice(0, -'.jsonl'.length);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (Date.now() < until);
  throw new Error(`no completed assistant seed turn with ${JSON.stringify(marker)} in ${dir}`);
}
