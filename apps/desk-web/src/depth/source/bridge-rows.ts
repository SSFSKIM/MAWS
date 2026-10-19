// The rows the bridge's plugin (doperpowers, or sminos from sminos 1.0.0) appends to a session's main loop
// (`$.session.append`), and how the session view draws a steer among them. The engine keeps every one alike, whatever
// the plugin asks: a user row, `isMeta`, origin `{kind: "plugin", name: <the plugin>}` (`isBridgeRow`), one text
// block; the plugin passes nothing but the text (2.1.300 `AGt`, `m6r`). MAWS's backfill reads a meta row as context
// and draws nothing for it: right for the bridge's records, wrong for a steer, the owner's words read at the loop's
// next model request, which left the view once its row landed (the tail lets a steer go at the row its result names).
//
// They are a closed set, from DX5 (doperpowers `docs/doperpowers/plans/2026-10-15-arkho-desk-c2-bridge.md`: the
// `steer` [steer-line], `deliver` [midturn] and `interrupt` [record] [marker] rows, the DC10 extension's `stop`), and one
// other mod:
// - a steer (doperpowers 7.180.0 on): its first line the steer's own, `[sminos steer from human]`, the owner's words
//   after it (`STEER_LINE`, the bridge's, and the line `sminos steer` opens its inbox fallback with);
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
// - a steer an older bridge appended: any other. Before 7.180.0 nothing in a steer's row said it was one, so a row with
//   no steer line that is none of the rows above is still taken for one: the history holds such rows, and the Macs run
//   an older bridge until they roll after the desk. A new kind of appended row would read as such a steer and draw as
//   the owner's words, so `bridge-rows.test.ts` pins the kind of every appended row in the doperpowers fixtures MAWS
//   vendors.
// The notes are read as DX4 reads them (`sminos_jobs.STOP_NOTE`; the vendored vectors' case 18): by the row's whole
// text, never by a line found in it, so a steer that quotes a note is a steer; a steer with its line can be no note.
//
// A steer is drawn as the owner's prompt queued into the running turn ("Sent during this turn"), as a delivery appended
// there is, under its row's own uuid, without its steer line (the bubble says who wrote it); the held row stays
// verbatim. Words MAWS's backfill would read as an interrupt marker keep the line, as a delivery's keep its frame: alone,
// the bubble would be read as the marker. One appended while no turn ran is taken by the turn that starts next
// (`appended-turn.ts`). The bridge's mirror of a steer or a delivery, a system notice for the terminal, is not drawn.
import type { JsonObject } from 'desk-hub/protocol';
import { INTERRUPT_MARKER } from '../../../../../src/engine-host/normalizer-support';
import { asQueuedPrompt, BRIDGE_PLUGINS, deliveryFrame, isBridgeRow } from '../../conversation/delivery-frame';
import { BRIDGE_TASK_LINE, bridgeRecordLines, isEngineMarker, singleText } from './interrupt';

export type BridgeRowKind = 'delivery' | 'interrupt-marker' | 'interrupt-note' | 'stop-note' | 'interrupt-record' | 'secret-note' | 'steer';

/** The first line of the bridge's steer row (doperpowers `hooks/mods/bridge.tsx`, `STEER_LINE`), the owner's words after it. */
export const STEER_LINE = '[sminos steer from human]';

const INTERRUPT_ORIGINS = new Set(['The interrupt came from the desk.', 'The interrupt came from outside the terminal.']);
const STOP_NOTE = /^Task [A-Za-z0-9_-]{1,64}, a background task, was stopped from (?:the desk|outside the terminal): it is not running\.$/;
const SECRET_NOTE = /^The person stored a secret under (\S+)\. You never see its value\. In a shell command, read it as "\$\(cat ~\/\.config\/claude-secrets\/\1\)", never printing it\.$/;

function isInterruptNote(text: string): boolean {
  const [first, ...lines] = text.split('\n');
  return INTERRUPT_ORIGINS.has(first) && lines.every((line) => BRIDGE_TASK_LINE.test(line));
}

/** The owner's words of a steer the bridge marked as one (its one text block, the steer line first), else null. */
export function markedSteerWords(row: JsonObject): string | null {
  if (!isBridgeRow(row)) return null;
  const text = singleText(row);
  return text !== null && text.startsWith(`${STEER_LINE}\n`) ? text.slice(STEER_LINE.length + 1) : null;
}

/** Which of the plugin's appended rows this is, by the rule above; null for a row the plugin did not append. */
export function bridgeRowKind(row: JsonObject): BridgeRowKind | null {
  if (!isBridgeRow(row)) return null;
  if (markedSteerWords(row) !== null) return 'steer';
  if (deliveryFrame(row) !== null) return 'delivery';
  if (isEngineMarker(row)) return 'interrupt-marker';
  if (bridgeRecordLines(row) !== null) return 'interrupt-record';
  const text = singleText(row);
  if (text !== null && isInterruptNote(text)) return 'interrupt-note';
  if (text !== null && STOP_NOTE.test(text)) return 'stop-note';
  if (text !== null && SECRET_NOTE.test(text)) return 'secret-note';
  return 'steer';
}

/**
 * The bridge's mirror of a row it appended for the owner: after a steer's or a delivery's append it logs the words
 * (`$.ui.log`: `steer: <text>`, `delivered: <text>`, a delivery's frame line still in it), which the engine keeps as a
 * system notice under the plugin's name (`<plugin>: steer: …`, either plugin the bridge has run in) for the terminal to
 * draw. The session view draws the appended row itself, as the owner's prompt, so it draws no mirror: in a turn the
 * mirror repeated the words, frame and all, and after a turn's end it was a notice in a turn of its own that never
 * ended.
 */
export function isMirrorLine(row: JsonObject): boolean {
  return row.type === 'system' && row.subtype === 'informational' && typeof row.content === 'string' && MIRRORS.some((prefix) => (row.content as string).startsWith(prefix));
}
const MIRRORS = BRIDGE_PLUGINS.flatMap((plugin) => [`${plugin}: steer: `, `${plugin}: delivered: `]);

/**
 * A steer's content as its bubble draws it: a marked steer's words without the steer line (kept when the words alone
 * would read as an interrupt marker), an older bridge's steer as it is; null for any other row.
 */
export function steerContent(row: JsonObject): string | JsonObject[] | null {
  if (bridgeRowKind(row) !== 'steer') return null;
  const words = markedSteerWords(row);
  if (words !== null && !INTERRUPT_MARKER.test(words.trim())) return [{ type: 'text', text: words }];
  const content = (row.message as JsonObject | undefined)?.content;
  return typeof content === 'string' || Array.isArray(content) ? (content as string | JsonObject[]) : null;
}

/** The row as the session view draws it: a steer as the owner's prompt queued into the running turn; any other as it is. */
export function steerAsDrawn(row: JsonObject): JsonObject {
  const content = steerContent(row);
  return content === null ? row : asQueuedPrompt(row, content);
}
