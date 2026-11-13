// The turn a row the bridge appended belongs to. A steer an older bridge appended with no steer line is drawn as the
// owner's prompt queued into the running turn (`bridge-rows.ts`): MAWS's reducer folds it into the turn that runs. (A
// marked steer and a delivery the bridge appends into a running turn, doperpowers PR 233's every Send to a busy session,
// are the arrivals reader's, UX wave U3, UC-2: MAWS's backfill places them.) One that lands while no turn runs
// has no turn to fold into, and MAWS's reducer keeps it as a prompt waiting for its own: appended while its turn was
// ending, after the turn's `turn_duration` (a race the bridge answers with its wake), or after an Esc stopped the turn
// (doperpowers PR 238: the owner's message after an Esc goes in as such a row, and only the bridge's wake goes through the
// inbox). Left so, it waits forever — "Sends at the next step" once a turn runs — and the turn it would open holds only
// its bubble and never ends.
//
// So a row the bridge appended while no turn ran is taken by the next turn that starts, by MAWS's backfill, which holds
// every prompt of the person's that waits so (its `withWaitingWords`): a turn runs from its start or the model's output
// until its end. The bridge's wake, which the bridge sends for exactly such unread rows, opens its turn with the first of
// them, so the owner's words open the turn that answers them, the wake's notice in it and the turn's end naming it; the
// others the turn takes at its start. Any other turn that starts first (a prompt typed at the terminal, a peer's
// message) takes them at its start, as a turn takes a prompt queued into it. This module only tells the backfill of the
// older steer, which reaches the backfill as a prompt queued into the turn (`steerAsDrawn`).
import type { SessionEvent } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import type { JsonObject } from 'desk-hub/protocol';
import { waitForTurn, type BackfillContext } from '../../../../engine-host/fs/backfill';
import { bridgeRowKind, markedSteerWords } from './bridge-rows';

const isAppendedPrompt = (row: JsonObject) => bridgeRowKind(row) === 'steer' && markedSteerWords(row) === null;

/** A row's events, the older steer appended while no turn ran held for the turn that starts next. Called on every row a context maps, in order. */
export function withAppendedTurn(row: JsonObject, events: SessionEvent[], ctx: BackfillContext): SessionEvent[] {
  if (isAppendedPrompt(row) && typeof row.uuid === 'string') waitForTurn(ctx, row.uuid as MessageUuid);
  return events;
}
