// The turn a row the bridge appended belongs to. A steer, or a delivery the bridge appends into a running turn
// (doperpowers #233: every Send to a busy session), is drawn as the owner's prompt queued there (`bridge-rows.ts`,
// `conversation/delivery-frame.ts`): MAWS's reducer folds it into the turn that runs. One that lands while no turn runs
// has no turn to fold into, and MAWS's reducer keeps it as a prompt waiting for its own: appended while its turn was
// ending, after the turn's `turn_duration` (a race the bridge answers with its wake), or after an Esc stopped the turn
// (doperpowers #238: the owner's message after an Esc goes in as such a row, and only the bridge's wake goes through the
// inbox). Left so, it waits forever — "Sends at the next step" once a turn runs — and the turn it would open holds only
// its bubble and never ends.
//
// So the mapping follows whether a turn runs (a turn's start or the model's output, until a turn's end), and a row the
// bridge appended while none ran is taken by the next turn that starts. The bridge's wake, which the bridge sends for
// exactly such unread rows, opens its turn with the first of them: the wake's start names that row's prompt, which MAWS's
// reducer then accepts in place, so the owner's words open the turn that answers them, the wake's line in it
// (`bridge-wake.ts`) and the turn's end naming it; the others the turn takes at its start. Any other turn that starts
// first (a prompt typed at the terminal, a peer's message) takes them at its start, as a turn takes a prompt queued into
// it. The model's output with no turn started (a history whose start was not held) goes to the waiting prompt as MAWS's
// reducer places it.
import type { SessionEvent } from '@shared/graph/events';
import type { JsonObject } from 'desk-hub/protocol';
import { eventBase, type BackfillContext } from '../../../../../src/engine-host/fs/backfill';
import { isBridgeWake } from '../../conversation/delivery-frame';
import { bridgeRowKind } from './bridge-rows';

type Track = { running: boolean; waiting: string[] };

/** Per mapping context: whether a turn runs, and the appended rows waiting for one, oldest first. */
const tracks = new WeakMap<BackfillContext, Track>();

const isAppendedPrompt = (row: JsonObject) => {
  const kind = bridgeRowKind(row);
  return kind === 'steer' || kind === 'delivery';
};

const RUNS = new Set<SessionEvent['kind']>(['turn.started', 'assistant.block.delta', 'assistant.block.complete', 'tool.use']);

/** A row's events with the rows waiting for a turn taken by the turn it starts. Called on every row a context maps, in order. */
export function withAppendedTurn(row: JsonObject, events: SessionEvent[], ctx: BackfillContext): SessionEvent[] {
  let track = tracks.get(ctx);
  if (track === undefined) tracks.set(ctx, (track = { running: false, waiting: [] }));
  let out = events;
  const start = events.findIndex((event) => event.kind === 'turn.started');
  if (start >= 0 && track.waiting.length > 0) {
    out = isBridgeWake(row) ? opened(row, events, start, track.waiting, ctx) : taken(row, events, start, track.waiting, ctx);
    track.waiting = [];
  }
  for (const event of out) {
    if (RUNS.has(event.kind)) {
      track.running = true;
      track.waiting = [];
    } else if (event.kind === 'turn.ended') track.running = false;
  }
  if (!track.running && isAppendedPrompt(row) && typeof row.uuid === 'string') track.waiting.push(row.uuid);
  return out;
}

/** The engine taking a waiting prompt into the turn that runs (MAWS's reducer folds it there). */
const take = (row: JsonObject, uuid: string, i: number, ctx: BackfillContext): SessionEvent =>
  ({ ...eventBase(ctx, `${row.uuid as string}#takes-${i}`), kind: 'command.lifecycle', commandUuid: uuid, state: 'started' }) as SessionEvent;

/** The wake's turn, opened by the first waiting row's prompt: accepted in place, the others taken at its start. */
function opened(row: JsonObject, events: SessionEvent[], start: number, waiting: readonly string[], ctx: BackfillContext): SessionEvent[] {
  const [first, ...rest] = waiting;
  ctx.lastTurnUserUuid = first as never; // the turn's end names it
  return events.flatMap((event, i): SessionEvent[] => {
    if (i === start) return [{ ...event, userMessageUuid: first, origin: null } as SessionEvent, ...rest.map((uuid, j) => take(row, uuid, j, ctx))];
    // The wake's own prompt opens no turn of its own: kept with the turn, drawn as the bridge's line (`bridge-wake.ts`).
    if (event.kind === 'user.message' && event.messageUuid === row.uuid) return [{ ...event, isSynthetic: true }];
    return [event];
  });
}

/** Another turn's start, which takes every waiting row. */
function taken(row: JsonObject, events: SessionEvent[], start: number, waiting: readonly string[], ctx: BackfillContext): SessionEvent[] {
  return [...events.slice(0, start + 1), ...waiting.map((uuid, j) => take(row, uuid, j, ctx)), ...events.slice(start + 1)];
}
