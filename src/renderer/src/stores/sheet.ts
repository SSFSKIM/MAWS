// The window's store of this machine's question sheets (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md
// §F; S6, S7): the summary of every record the spine's sheet service follows, keyed by the engine's session id; the
// model of each session something on screen shows; and what is known of the door. A change is announced small
// (`sheet.changed`) and a model read on demand (`sheet.read`), only for a session some view watches.
//
// Its client is a parameter, as `stores/attention.ts`'s is: a transcript row may read this store and desk-web bundles the
// rows, so the store imports no IPC client of its own. `connectSheets` is given the app's; `watchSheet` uses that one
// unless given another.
//
// The connection follows lane A's order (`stores/lane-a.ts`): subscribe to `sheet.changed` first, hold what arrives while
// `sheet.list` is out, apply the list and then what was held, and list again when the machine's host was unavailable.
// A record that appears between a snapshot and a subscription made after it would otherwise never show, since the
// service speaks only on change. Each read of a session carries a count that only grows, and an answer is applied only
// when no later read of that session was: `seq` cannot stand for it, since an inbox line changes a model without moving
// it.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import { askUntilAnswered } from '../ipc/until-answered';

export interface SheetsState {
  summaries: ReadonlyMap<string, SheetSummary>; // by the engine's session id
  models: ReadonlyMap<string, SheetModel | null>; // the sessions watched; null: read, and no record (or not one this build reads)
  door: DoorState;
}

const empty = (): SheetsState => ({ summaries: new Map(), models: new Map(), door: { known: false } });

export const useSheets = create<SheetsState>(() => empty());

let connected: MawsBridge | null = null;
const watchers = new Map<string, number>(); // how many views watch each session
const issued = new Map<string, number>(); // the last read asked of each session
const applied = new Map<string, number>(); // the last read applied

function applySummary(session: string, summary: SheetSummary | null): void {
  const summaries = new Map(useSheets.getState().summaries);
  if (summary === null) summaries.delete(session);
  else summaries.set(session, summary);
  useSheets.setState({ summaries });
}

// One read of a session's model, applied unless a later read of it already was, or nothing watches it any more.
function read(client: MawsBridge, session: string): void {
  const n = (issued.get(session) ?? 0) + 1;
  issued.set(session, n);
  void client.invoke('sheet.read', { session }).then((result) => {
    if (!result.ok) return console.warn(`[sheet] sheet.read of ${session} failed`, result.error.message);
    if (!watchers.has(session) || n <= (applied.get(session) ?? 0)) return;
    applied.set(session, n);
    const models = new Map(useSheets.getState().models);
    models.set(session, result.value.model);
    useSheets.setState({ models, door: result.value.door });
  });
}

export function connectSheets(client: MawsBridge): () => void {
  connected = client;
  let held: [string, SheetSummary | null][] | null = []; // what arrived while a list is out
  let live = true;
  const off = client.on('sheet.changed', ({ session, summary }) => {
    if (!live) return;
    if (held !== null) held.push([session, summary]);
    else applySummary(session, summary);
    if (watchers.has(session)) read(client, session);
  });
  const settle = (result: CommandResult<'sheet.list'>) => {
    const raced = held ?? [];
    held = null;
    if (!live) return;
    if (result.ok) useSheets.setState({ summaries: new Map(result.value.sessions.map((summary) => [summary.session, summary])), door: result.value.door });
    else console.warn('[sheet] sheet.list unavailable; starting empty', result.error.message);
    for (const [session, summary] of raced) applySummary(session, summary);
  };
  const stopListing = askUntilAnswered(client, async () => {
    held ??= [];
    const result = await client.invoke('sheet.list', {});
    settle(result);
    return result.ok;
  });
  return () => {
    live = false;
    stopListing();
    off();
    if (connected === client) connected = null;
  };
}

/** Keeps a session's model read while something shows it; counted, so the last of several views to stop forgets it. */
export function watchSheet(session: string, client: MawsBridge | null = connected): () => void {
  const count = (watchers.get(session) ?? 0) + 1;
  watchers.set(session, count);
  if (count === 1 && client !== null) read(client, session);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (watchers.get(session) ?? 1) - 1;
    if (left > 0) return void watchers.set(session, left);
    watchers.delete(session);
    const models = new Map(useSheets.getState().models);
    models.delete(session);
    useSheets.setState({ models });
  };
}

/** The record of an app session, by its summary; null when it has none here. */
export const selectSheetSession = (state: Pick<SheetsState, 'summaries'>, appSessionId: AppSessionId): string | null => {
  for (const summary of state.summaries.values()) if (summary.appSessionId === appSessionId) return summary.session;
  return null;
};

export const selectSheetModel = (state: Pick<SheetsState, 'models'>, session: string | null): SheetModel | null => (session === null ? null : (state.models.get(session) ?? null));

// Tests: the store and its reads back to empty.
export function resetSheetStore(): void {
  connected = null;
  watchers.clear();
  issued.clear();
  applied.clear();
  useSheets.setState(empty());
}
