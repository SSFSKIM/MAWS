// The rows the doperpowers plugin appends to a session's main loop (`$.session.append`), and how the session view draws
// a steer among them. The engine keeps every one alike, whatever the plugin asks: a user row, `isMeta`, origin `{kind:
// "plugin", name: "doperpowers"}` (`isBridgeRow`), one text block. MAWS's backfill reads a meta row as context and
// draws nothing for it: right for the bridge's records, wrong for a steer, the owner's words read at the loop's next
// model request, which left the view once its row landed (the tail lets a steer go at the row its result names).
//
// They are a closed set, from DX5 (doperpowers `docs/doperpowers/plans/2026-10-15-arkho-desk-c2-bridge.md`: the
// `steer`, `deliver` [midturn] and `interrupt` [record] [marker] rows, the DC10 extension's `stop`), and one other mod:
// - a delivery: its first line a whole sminos frame (`conversation/delivery-frame.ts`, which draws it);
// - the interrupt's marker: the engine's `[Request interrupted by user]` whole (doperpowers #225 on);
// - the interrupt's note: `The interrupt came from the desk.` (or `… from outside the terminal.`), then only its lines
//   for the Bash calls the interrupt stopped or could not stop;
// - a stop's note, its whole text: `Task <id>, a background task, was stopped from the desk: it is not running.` (or
//   `… from outside the terminal: …`);
// - the interrupt's record before #225: `[Request interrupted by user from the desk]` (or `… from outside the
//   terminal]`), then only those same Bash lines;
// - the `/secret` mod's record, appended by doperpowers 7.138 and 7.139 before the mod moved to the cua plugin: `The
//   person stored a secret under <KEY>. You never see its value. …`;
// - a steer: any other.
// The notes are read as DX4 reads them (`sminos_jobs.STOP_NOTE`; the vendored vectors' case 18): by the row's whole
// text, never by a line found in it, so a steer that quotes a note is a steer.
//
// A steer is known by exclusion: nothing in its row says it is one (tech debt: a self-identifying steer row in the
// bridge would remove the exclusion). A new kind of appended row would read as a steer and draw as the owner's words, so
// `bridge-rows.test.ts` pins the kind of every such row in the doperpowers fixtures MAWS vendors. A steer is drawn as
// the owner's prompt queued into the running turn ("Sent during this turn"), as a delivery appended there is, under its
// row's own uuid; the held row stays verbatim.
import type { JsonObject } from 'desk-hub/protocol';
import { asQueuedPrompt, deliveryFrame, isBridgeRow } from '../../conversation/delivery-frame';
import { BRIDGE_TASK_LINE, bridgeRecordLines, isEngineMarker, singleText } from './interrupt';

export type BridgeRowKind = 'delivery' | 'interrupt-marker' | 'interrupt-note' | 'stop-note' | 'interrupt-record' | 'secret-note' | 'steer';

const INTERRUPT_ORIGINS = new Set(['The interrupt came from the desk.', 'The interrupt came from outside the terminal.']);
const STOP_NOTE = /^Task [A-Za-z0-9_-]{1,64}, a background task, was stopped from (?:the desk|outside the terminal): it is not running\.$/;
const SECRET_NOTE = /^The person stored a secret under (\S+)\. You never see its value\. In a shell command, read it as "\$\(cat ~\/\.config\/claude-secrets\/\1\)", never printing it\.$/;

function isInterruptNote(text: string): boolean {
  const [first, ...lines] = text.split('\n');
  return INTERRUPT_ORIGINS.has(first) && lines.every((line) => BRIDGE_TASK_LINE.test(line));
}

/** Which of the plugin's appended rows this is, by the rule above; null for a row the plugin did not append. */
export function bridgeRowKind(row: JsonObject): BridgeRowKind | null {
  if (!isBridgeRow(row)) return null;
  if (deliveryFrame(row) !== null) return 'delivery';
  if (isEngineMarker(row)) return 'interrupt-marker';
  if (bridgeRecordLines(row) !== null) return 'interrupt-record';
  const text = singleText(row);
  if (text !== null && isInterruptNote(text)) return 'interrupt-note';
  if (text !== null && STOP_NOTE.test(text)) return 'stop-note';
  if (text !== null && SECRET_NOTE.test(text)) return 'secret-note';
  return 'steer';
}

/** The row as the session view draws it: a steer as the owner's prompt queued into the running turn; any other as it is. */
export function steerAsDrawn(row: JsonObject): JsonObject {
  if (bridgeRowKind(row) !== 'steer') return row;
  const content = (row.message as JsonObject | undefined)?.content;
  return typeof content === 'string' || Array.isArray(content) ? asQueuedPrompt(row, content as string | JsonObject[]) : row;
}
