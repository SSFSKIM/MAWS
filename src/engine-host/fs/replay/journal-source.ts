// The journal source of a replay (X8; C4 execution document, "Replay engine"): a probe journal read whole and validated
// row by row before anything plays, so a launch that fails emits nothing. Also the shared read of any replay source,
// and the stand-in row normaliser the host wires while C3's `Normalizer` is not in the tree.
import { readFile } from 'node:fs/promises';
import type { SessionEvent } from '@shared/graph/events';
import type { EventId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import { JournalRowSchema, type JournalRow } from '@shared/wire/journal';
import type { RowNormalizer } from './runner';

// How a source's bytes are read; tests inject one to hold a load past a deadline.
export type SourceReader = (path: string) => Promise<Buffer>;

export interface LoadedJournal {
  rows: JournalRow[];
  totalRows: number; // the `in` and `out` rows, which are what plays
  spanMs: number; // from the first to the last of them, as recorded
}

// The source's non-empty lines with their 1-based line numbers; fails with the named replay errors.
export async function readSourceLines(path: string, read: SourceReader = readFile): Promise<{ text: string; line: number }[]> {
  let bytes: Buffer;
  try {
    bytes = await read(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'EIO';
    throw new Error(code === 'ENOENT' ? `replay source not found: ${path}` : `replay source unreadable: ${path}: ${code}`, { cause: error });
  }
  const lines = bytes
    .toString('utf8')
    .split('\n')
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(({ text }) => text.trim().length > 0);
  if (lines.length === 0) throw new Error(`replay source empty: ${path}`);
  return lines;
}

export async function loadJournalSource(path: string, read?: SourceReader): Promise<LoadedJournal> {
  const rows: JournalRow[] = [];
  for (const { text, line } of await readSourceLines(path, read)) {
    let row: unknown;
    try {
      row = JSON.parse(text);
    } catch {
      row = undefined;
    }
    const parsed = JournalRowSchema.safeParse(row);
    if (!parsed.success) throw new Error(`replay source is not a journal: ${path}: line ${line}`);
    rows.push(parsed.data);
  }
  const played = rows.filter((row) => row.direction === 'in' || row.direction === 'out');
  const spanMs = played.length === 0 ? 0 : Date.parse(played[played.length - 1].at) - Date.parse(played[0].at);
  return { rows, totalRows: played.length, spanMs: Number.isNaN(spanMs) ? 0 : spanMs };
}

// Until C3's `Normalizer` lands on this branch, journal replay goes through this: one `frame.unknown` per `in` row
// (named by the frame's type and subtype, attributed by its `parent_tool_use_id`) and nothing for `out` rows, so the
// controls and progress are real end to end. C4 execution document, Interfaces "Replay engine"; M7 records the state.
export function frameUnknownNormalizer(sessionId: SessionId): RowNormalizer {
  return {
    normalize(row: JournalRow): SessionEvent[] {
      if (row.direction !== 'in') return [];
      const frame = (typeof row.frame === 'object' && row.frame !== null ? row.frame : {}) as { type?: unknown; subtype?: unknown; parent_tool_use_id?: unknown };
      return [
        {
          id: `row:${row.seq}` as EventId,
          sessionId,
          at: row.at,
          seq: row.seq,
          agentId: null,
          parentToolUseId: typeof frame.parent_tool_use_id === 'string' ? (frame.parent_tool_use_id as ParentToolUseId) : null,
          kind: 'frame.unknown',
          frameType: typeof frame.type === 'string' ? frame.type : 'unknown',
          subtype: typeof frame.subtype === 'string' ? frame.subtype : null,
        },
      ];
    },
  };
}
