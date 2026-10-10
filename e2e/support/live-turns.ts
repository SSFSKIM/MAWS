// The live specs' wait for a submitted turn (P2-F F-E, E scalpel-1#4). A status sample with no open turn and no pending
// request also describes a session that has not started the prompt yet (a launch, the first message's setup, the gap
// before the engine takes it), so a spec waits on the prompt itself: every prompt MAWS writes to the engine is a
// `user` frame whose uuid the engine's `command_lifecycle` frames answer, ending `completed` or `cancelled`
// (`spikes/protocol-probe/fixtures/pass3/p2-to-human-off.jsonl` seqs 9 to 32). A spec counts the prompts before the
// gesture that submits and waits until a prompt was written after that count and every one since has ended.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JournalRow } from '@shared/wire/journal';

export interface WrittenPrompt {
  uuid: string;
  at: string;
  ended: 'completed' | 'cancelled' | null; // null: not yet
}

type Frame = { type?: string; uuid?: unknown; command_uuid?: unknown; state?: unknown };

// The prompts written to a session's engine, in the journal's order, each with how its command ended.
export function writtenPrompts(rows: readonly JournalRow[]): WrittenPrompt[] {
  const ended = new Map<string, 'completed' | 'cancelled'>();
  for (const row of rows) {
    const frame = row.frame as Frame;
    if (row.direction === 'in' && frame.type === 'command_lifecycle' && typeof frame.command_uuid === 'string' && (frame.state === 'completed' || frame.state === 'cancelled')) ended.set(frame.command_uuid, frame.state);
  }
  return rows
    .filter((row) => row.direction === 'out' && (row.frame as Frame).type === 'user' && typeof (row.frame as Frame).uuid === 'string')
    .map((row) => {
      const uuid = (row.frame as Frame).uuid as string;
      return { uuid, at: row.at, ended: ended.get(uuid) ?? null };
    });
}

// The turns of what was submitted after `before` prompts had been written are over.
export const promptsEnded = (prompts: readonly WrittenPrompt[], before: number): boolean => prompts.length > before && prompts.slice(before).every((p) => p.ended !== null);

// A session's journal rows under a MAWS profile, every launch's file, in time order.
export function sessionJournal(userData: string, appSessionId: string): JournalRow[] {
  const dir = join(userData, 'engine-host', 'journal', appSessionId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as JournalRow))
    .sort((a, b) => a.at.localeCompare(b.at) || a.seq - b.seq);
}
