// The bridge's wake (doperpowers #233). When a turn ends with a steer or a delivered row the session has not read, the
// bridge sends a prompt of its own that points the session at it, its first line `[sminos bridge]`
// (`conversation/delivery-frame.ts`, `isBridgeWake`): as the user, or, after an Esc (the engine then refuses a plugin's
// prompt), through the session's inbox, kept as a peer message. MAWS's backfill draws the first as the owner's bubble
// and the second as a message from a peer session; it is neither. The session view draws it as the bridge's dim line in
// the turn (a plugin's line, the way the terminal draws one under the plugin's name, kept in view when the turn folds),
// and the turn it opens as one the session continued on its own: its divider reads "Continued for …", as a task
// notification's does. The held row stays verbatim. The rows it points at went in during the turn that ended or after
// it (doperpowers #238: the owner's message after an Esc), so the line names neither; a row that went in after the turn
// opens the wake's turn instead, the owner's words answered there (`appended-turn.ts`).
import type { SessionEvent } from '@shared/graph/events';
import type { JsonObject } from 'desk-hub/protocol';
import { eventBase, type BackfillContext } from '../../../../../src/engine-host/fs/backfill';
import { isBridgeWake } from '../../conversation/delivery-frame';

/** Who the line names, as the wake names itself, and what it says. */
export const WAKE_SENDER = 'sminos bridge';
export const WAKE_TEXT = 'woke the session to read a message it had not read';

/** A wake's events as the session view draws them: the bridge's line in place of the owner's bubble or a peer's message. */
export function withWakeLine(row: JsonObject, events: SessionEvent[], ctx: BackfillContext): SessionEvent[] {
  if (typeof row.uuid !== 'string' || !isBridgeWake(row)) return events;
  const drawn = events.flatMap((event): SessionEvent[] => {
    if (event.kind === 'peer.message') return [];
    if (event.kind === 'turn.started' || event.kind === 'user.message') return [{ ...event, origin: 'task-notification' }];
    return [event];
  });
  return [...drawn, { ...eventBase(ctx, `${row.uuid}#bridge-wake`), kind: 'plugin.log', plugin: WAKE_SENDER, text: WAKE_TEXT }];
}
