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
// `sheet.list` is out, apply the list and then what was held. Unlike lane A it lists again at every new connection to
// the machine's host, not only until one list is answered, and then reads every watched session again: a `mawsd` that
// restarted knows nothing of what went while it was down. A record that appears between a snapshot and a subscription
// made after it would otherwise never show, since the service speaks only on change. Each read of a session carries a
// count that only grows, and an answer is applied only when no later read of that session was: `seq` cannot stand for
// it, since an inbox line changes a model without moving it.
//
// M4 (§F; S13): each session's memory of its sheet (drafts, what the person saw, the acts this window sent, a Send in
// flight), held here, outside the components, so it survives a tab's unmount and is shared by every mount of the
// session's sheet in this window (the side sheet, an Overview card, the channel's card). The components change it only
// through an update applied to the memory as it stands (`updateSheetMemory`, X5's `onMemory`); it goes with the record.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import { EMPTY_MEMORY, type SheetMemory } from '../sheet/memory';

export interface SheetsState {
  summaries: ReadonlyMap<string, SheetSummary>; // by the engine's session id
  models: ReadonlyMap<string, SheetModel | null>; // the sessions watched; null: read, and no record (or not one this build reads)
  door: DoorState; // from the last list or read; the service announces every record it holds when the door moves, so a watched one is read again
  memories: ReadonlyMap<string, SheetMemory>; // M4: by the engine's session id, while its record lives
}

const empty = (): SheetsState => ({ summaries: new Map(), models: new Map(), door: { known: false }, memories: new Map() });

export const useSheets = create<SheetsState>(() => empty());

let connected: MawsBridge | null = null;
const watchers = new Map<string, number>(); // how many views watch each session
const issued = new Map<string, number>(); // the last read asked of each session
const applied = new Map<string, number>(); // the last read applied

function applySummary(session: string, summary: SheetSummary | null): void {
  const summaries = new Map(useSheets.getState().summaries);
  if (summary === null) summaries.delete(session);
  else summaries.set(session, summary);
  useSheets.setState({ summaries, ...(summary === null && { memories: without(useSheets.getState().memories, (held) => held === session) }) });
}

// The memories but those `gone` holds for; the same map when none goes.
function without(memories: ReadonlyMap<string, SheetMemory>, gone: (session: string) => boolean): ReadonlyMap<string, SheetMemory> {
  if (![...memories.keys()].some(gone)) return memories;
  return new Map([...memories].filter(([session]) => !gone(session)));
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
  let held: [string, SheetSummary | null][] | null = null; // what arrived while a list is out
  let live = true;
  let listing = false;
  let heard = false; // the host was heard while a list was out, whose answer may be older than its return
  const off = client.on('sheet.changed', ({ session, summary }) => {
    if (!live) return;
    if (held !== null) held.push([session, summary]);
    else applySummary(session, summary);
    if (watchers.has(session)) read(client, session);
  });
  const settle = (result: CommandResult<'sheet.list'> | null) => {
    const raced = held ?? [];
    held = null;
    listing = false;
    if (!live) return;
    if (result?.ok) {
      const summaries = new Map(result.value.sessions.map((summary) => [summary.session, summary]));
      useSheets.setState({ summaries, door: result.value.door, memories: without(useSheets.getState().memories, (session) => !summaries.has(session)) });
    }
    else console.warn('[sheet] sheet.list unavailable; keeping what the store holds', result?.error.message ?? 'rejected');
    for (const [session, summary] of raced) applySummary(session, summary);
    if (result?.ok) for (const session of watchers.keys()) read(client, session);
    if (heard) list();
  };
  const list = () => {
    listing = true;
    heard = false;
    held = [];
    void client.invoke('sheet.list', {}).then(settle, () => settle(null));
  };
  // Main emits `host.status` at each ready of the machine's host and each change of the spine's availability: a `mawsd`
  // that restarted knows nothing of what went while it was down, so every one lists again.
  const offHost = client.on('host.status', (_status, { machine }) => {
    if (!live || machine !== client.localMachine) return;
    if (listing) heard = true;
    else list();
  });
  list();
  return () => {
    live = false;
    off();
    offHost();
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

/** A session's memory of its sheet; the empty one for a session this window has not touched. */
export const selectSheetMemory = (state: Pick<SheetsState, 'memories'>, session: string): SheetMemory => state.memories.get(session) ?? EMPTY_MEMORY;

/** Applies an update to a session's memory as it stands now (X5's `onMemory`); callable after the sheet that asked is gone. */
export function updateSheetMemory(session: string, update: (current: SheetMemory) => SheetMemory): void {
  const { memories } = useSheets.getState();
  const current = memories.get(session) ?? EMPTY_MEMORY;
  const next = update(current);
  if (next === current) return;
  useSheets.setState({ memories: new Map(memories).set(session, next) });
}

// Tests: the store and its reads back to empty.
export function resetSheetStore(): void {
  connected = null;
  watchers.clear();
  issued.clear();
  applied.clear();
  useSheets.setState(empty());
}
