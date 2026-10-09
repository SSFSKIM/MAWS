// P2-D (2026-10-09; the P2 spec docs/doperpowers/plans/2026-10-08-p2-daily-driver.md, child P2-D, G4; the P2 interface
// ledger §1 row `session.recentTurns`): the resume chooser's preview of a session's last turns. Main reads the tail of
// the engine's own transcript (the JSONL the engine writes for a session MAWS runs and one a terminal runs alike), keeps
// the current chain (a rewound branch drops out), maps the records through the engine host's backfill so turn
// boundaries, steers, task notifications and local commands follow the transcript's own rules, and folds the events into
// turns. One bounded read through a read-only handle: no host call, no follow, no engine, no index or unread change.
import type { ContentBlock, SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import { RECENT_TURN_ANSWER_MAX, RECENT_TURN_PROMPT_MAX, type RecentTurn, type RecentTurns } from '@shared/ipc/schema/session';
import { previewLine } from '@shared/owner/preview';
import { slashCommandLine } from '@shared/wire/local-command';
import { currentChain, LastPromptAnchorSchema, TranscriptRecordSchema, type TranscriptRecord } from '@shared/wire/transcript';
import { createBackfillContext, localCommandKind, recordToEvents } from '../../engine-host/fs/backfill';
import { jsonLines, readTailSized, type OpenFile } from '../files/read-tail';

// How much of the transcript's end is read: enough for a handful of turns with their tool rounds (a long tool result can
// fill it, in which case fewer turns come back and `earlier` says more exist).
export const RECENT_TURNS_TAIL_BYTES = 256 * 1024;

export const NO_TURNS: RecentTurns = { turns: [], earlier: false, source: 'none' };

const textOf = (content: string | ContentBlock[]): string =>
  typeof content === 'string' ? content : content.map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : block.type === 'image' ? '[Image]' : '')).filter(Boolean).join('\n');

// What a human prompt reads as in the preview: a slash command as typed, `!` before a bash command, else its text.
function promptText(event: Extract<SessionEvent, { kind: 'user.message' }>): string {
  if (event.bash?.part === 'input') return `! ${event.bash.command}`;
  const text = textOf(event.content);
  return (slashCommandLine(text) ?? text).trim();
}

// The uuid of the record the current chain ends at, by the engine host's follower rules (chain-follower.ts) in one pass:
// the last record with a uuid not written before (a uuid is written once) that is not `progress` (never a leaf; a child
// naming one walks through it), unless a rewind anchor after it (`last-prompt`, `rewound: true`) names the record the
// conversation went back to; a record written after the anchor is the leaf again. The anchor's target may lie before
// the window.
function leafUuidOf(records: readonly TranscriptRecord[]): string | null {
  const seen = new Set<string>();
  let leaf: string | null = null;
  for (const record of records) {
    if (typeof record.uuid === 'string') {
      if (seen.has(record.uuid)) continue;
      seen.add(record.uuid);
      if (record.type !== 'progress') leaf = record.uuid;
    } else {
      const anchor = LastPromptAnchorSchema.safeParse(record);
      if (anchor.success && anchor.data.rewound === true && anchor.data.leafUuid !== undefined) leaf = anchor.data.leafUuid;
    }
  }
  return leaf;
}

interface Building {
  turn: RecentTurn;
}

// The turns the transcript text's records stand for, oldest first, the last `limit` of them. `cut` says the text starts
// mid-file (its first line was dropped), so a chain that does not reach its root has earlier turns.
export function recentTurnsOf(text: string, limit: number, cut: boolean): RecentTurns {
  const records: TranscriptRecord[] = [];
  for (const line of jsonLines(text)) {
    const parsed = TranscriptRecordSchema.safeParse(line);
    if (parsed.success && parsed.data.isSidechain !== true) records.push(parsed.data);
  }
  const leafUuid = leafUuidOf(records);
  if (leafUuid === null) return { turns: [], earlier: false, source: 'transcript' };
  const leaf = records.find((record) => record.uuid === leafUuid);
  // a rewind to a record before the window: the kept chain is not in it, and the discarded branch is no fallback
  if (leaf === undefined) return { turns: [], earlier: cut, source: 'transcript' };
  // the walk from the leaf: currentChain starts at the last record with a uuid, so the leaf goes last
  const { chain } = currentChain([...records, leaf]);
  const sessionId = (chain.find((r) => typeof r.sessionId === 'string')?.sessionId ?? 'unknown') as SessionId;
  const ctx = createBackfillContext({ sessionId, agent: null });
  const turns: RecentTurn[] = [];
  let open: Building | null = null;
  const current = (): Building => {
    if (open === null) {
      open = { turn: { prompt: null, answer: null, toolCalls: 0 } };
      turns.push(open.turn);
    }
    return open;
  };
  for (const record of chain) {
    // a slash command's caveat and output are the engine's, and fold into the command's turn
    const commandOutput = localCommandKind(record) === 'caveat' || localCommandKind(record) === 'output';
    for (const event of recordToEvents(record, ctx)) {
      if (event.kind === 'turn.started') {
        open = { turn: { prompt: null, answer: null, toolCalls: 0 } };
        turns.push(open.turn);
      } else if (event.kind === 'user.message') {
        // the prompt that opened the turn: a human's, never a synthetic, a peer's, a task notification's, a marker, a
        // command's output or a bash command's output (the turn it opens shows nothing)
        if (event.isSynthetic || event.origin !== null || commandOutput || event.bash?.part === 'output') continue;
        const building = current();
        const text = promptText(event);
        if (building.turn.prompt === null && text !== '') building.turn.prompt = { text: text.slice(0, RECENT_TURN_PROMPT_MAX), at: event.at };
      } else if (event.kind === 'assistant.block.complete') {
        if (event.block.type !== 'text' || typeof event.block.text !== 'string' || event.isApiErrorMessage === true) continue;
        const line = previewLine(event.block.text, RECENT_TURN_ANSWER_MAX);
        if (line !== null) current().turn.answer = { text: line, at: event.at };
      } else if (event.kind === 'tool.use') {
        current().turn.toolCalls += 1;
      }
    }
  }
  const shown = turns.filter((turn) => turn.prompt !== null || turn.answer !== null || turn.toolCalls > 0);
  const first = chain[0];
  // the chain reached a root (a first record or a compaction's boundary) inside the window, or there is more to read
  const rooted = first.parentUuid === null || first.parentUuid === undefined;
  const earlier = shown.length > limit || (cut && !rooted) || (rooted && first.type === 'system' && first.subtype === 'compact_boundary');
  return { turns: shown.slice(-limit), earlier, source: 'transcript' };
}

// The read: the transcript at `path` (null: the session has none known), its last RECENT_TURNS_TAIL_BYTES.
export async function readRecentTurns(path: string | null, limit: number, open?: OpenFile, tailBytes = RECENT_TURNS_TAIL_BYTES): Promise<RecentTurns> {
  if (path === null) return NO_TURNS;
  const tail = await readTailSized(path, tailBytes, open);
  if (tail === null) return NO_TURNS;
  return recentTurnsOf(tail.text, limit, tail.size > tailBytes);
}

