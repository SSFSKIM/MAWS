// E2 (M4): the renderer's view of the deliverable store (E2 execution document, Design §4 "The store"), one vanilla
// zustand store for the window. Main's reader keeps no cache and the host announces every write, so this store holds
// what main answered and re-reads one record per `deliverables.changed`:
//
// - `sessions`: a session's records, newest first, read by `deliverables.list` on first use (a refusal is kept with its
//   message until Retry; a change that lands while the read is out starts a newer read, which supersedes it);
// - `all`: every session's records, read by `deliverables.listAll` each time a tool enters the All scope;
// - `lookups`: the last `deliverables.get` answer per record (the record, or null when it is gone, and whether each
//   version's file is still on disk), which the viewer reads before it draws a body;
// - `console`: the last CONSOLE_KEPT messages main attributed to a deliverable's frame, per version
//   (`deliverables.console`); renderer memory only, so a window reload forgets them and the frame logs again when shown.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableConsole, DeliverablesChanged } from '@shared/ipc/schema/deliverables';
import type { MawsBridge } from '@shared/ipc/schema';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { ipc } from '../../ipc/client';
import { titleOf } from './model';

export const CONSOLE_KEPT = 50;

export interface RecordList {
  records: DeliverableRecord[]; // newest first by `updatedAt ?? createdAt`
  status: 'idle' | 'reading' | 'ready' | 'error';
  error: string | null; // the last read's refusal, until a read succeeds
}

export type Lookup = { status: 'reading' } | { status: 'ready'; record: DeliverableRecord | null; present: boolean[] } | { status: 'error'; error: string };

export interface ConsoleEntry {
  level: DeliverableConsole['level'];
  message: string;
  line: number | null;
  source: string | null;
}

export interface DeliverablesState {
  sessions: Map<AppSessionId, RecordList>;
  all: RecordList;
  lookups: Map<string, Lookup>; // keyed `<appSessionId>/<id>`
  console: Map<string, ConsoleEntry[]>; // keyed `<appSessionId>/<id>/<version>`
}

const IDLE: RecordList = { records: [], status: 'idle', error: null };
const initial = (): DeliverablesState => ({ sessions: new Map(), all: IDLE, lookups: new Map(), console: new Map() });

export const deliverables = createStore<DeliverablesState>()(initial);
export const useDeliverables = <T>(selector: (state: DeliverablesState) => T): T => useStore(deliverables, selector);

export const lookupKey = (appSessionId: AppSessionId, id: string) => `${appSessionId}/${id}`;
export const consoleKey = (appSessionId: AppSessionId, id: string, version: number) => `${appSessionId}/${id}/${version}`;

// Each read's ticket: an answer lands only when no newer read of the same list started after it.
const tickets = new Map<string, number>();
let lastTicket = 0;
const take = (list: string) => {
  const ticket = ++lastTicket;
  tickets.set(list, ticket);
  return () => tickets.get(list) === ticket;
};

const newestFirst = (records: DeliverableRecord[]) => [...records].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));

// The record put in its place (or taken out, when gone), the list kept newest first.
function upsert(list: RecordList, appSessionId: AppSessionId, id: string, record: DeliverableRecord | null): RecordList {
  const others = list.records.filter((r) => !(r.id === id && r.appSessionId === appSessionId));
  return { ...list, records: newestFirst(record ? [...others, record] : others) };
}

function setSession(appSessionId: AppSessionId, next: (list: RecordList) => RecordList): void {
  deliverables.setState((s) => ({ sessions: new Map(s.sessions).set(appSessionId, next(s.sessions.get(appSessionId) ?? IDLE)) }));
}

// ---- the lists ---------------------------------------------------------------------------------------------------------

export function loadSession(appSessionId: AppSessionId, client: MawsBridge = ipc): void {
  const current = take(`session:${appSessionId}`);
  setSession(appSessionId, (list) => ({ ...list, status: 'reading' }));
  void client.invoke('deliverables.list', { appSessionId }).then((result) => {
    if (!current()) return;
    setSession(appSessionId, (list) => (result.ok ? { records: result.value.records, status: 'ready', error: null } : { ...list, status: 'error', error: result.error.message }));
  });
}

// The session's list on first use; a refused read waits for Retry.
export function ensureSession(appSessionId: AppSessionId, client: MawsBridge = ipc): void {
  if ((deliverables.getState().sessions.get(appSessionId)?.status ?? 'idle') === 'idle') loadSession(appSessionId, client);
}

export function loadAll(client: MawsBridge = ipc): void {
  const current = take('all');
  deliverables.setState((s) => ({ all: { ...s.all, status: 'reading' } }));
  void client.invoke('deliverables.listAll', {}).then((result) => {
    if (!current()) return;
    deliverables.setState((s) => ({ all: result.ok ? { records: result.value.records, status: 'ready', error: null } : { ...s.all, status: 'error', error: result.error.message } }));
  });
}

// ---- one record --------------------------------------------------------------------------------------------------------

export async function lookup(appSessionId: AppSessionId, id: string, client: MawsBridge = ipc): Promise<Lookup> {
  const key = lookupKey(appSessionId, id);
  const current = take(`get:${key}`);
  if (deliverables.getState().lookups.get(key)?.status !== 'ready') setLookup(key, { status: 'reading' });
  const result = await client.invoke('deliverables.get', { appSessionId, id });
  const found: Lookup = result.ok ? { status: 'ready', record: result.value.record, present: result.value.present } : { status: 'error', error: result.error.message };
  if (current()) setLookup(key, found);
  return found;
}

function setLookup(key: string, value: Lookup): void {
  deliverables.setState((s) => ({ lookups: new Map(s.lookups).set(key, value) }));
}

// A write the host announced: the one record read again into every list that holds its session and into its lookup. A
// list still being read is read again instead, since its answer may predate the write.
async function applyChanged({ appSessionId, id }: DeliverablesChanged, client: MawsBridge): Promise<void> {
  const { sessions, all, lookups } = deliverables.getState();
  const session = sessions.get(appSessionId)?.status ?? 'idle';
  if (session === 'reading') loadSession(appSessionId, client);
  if (all.status === 'reading') loadAll(client);
  const wanted = session === 'ready' || all.status === 'ready' || lookups.has(lookupKey(appSessionId, id));
  if (!wanted) return;
  const found = await lookup(appSessionId, id, client);
  if (found.status !== 'ready') return;
  const now = deliverables.getState();
  if (now.sessions.get(appSessionId)?.status === 'ready') setSession(appSessionId, (list) => upsert(list, appSessionId, id, found.record));
  if (now.all.status === 'ready') deliverables.setState((s) => ({ all: upsert(s.all, appSessionId, id, found.record) }));
}

// ---- the console ring buffer -------------------------------------------------------------------------------------------

function applyConsole({ appSessionId, deliverableId, version, level, message, line, source }: DeliverableConsole): void {
  const key = consoleKey(appSessionId, deliverableId, version);
  deliverables.setState((s) => {
    const kept = [...(s.console.get(key) ?? []), { level, message, line, source }].slice(-CONSOLE_KEPT);
    return { console: new Map(s.console).set(key, kept) };
  });
}

// A frame reloaded: what it logged before is forgotten, so the chip counts the page as it now is.
export function clearConsole(appSessionId: AppSessionId, id: string, version: number): void {
  const key = consoleKey(appSessionId, id, version);
  if (!deliverables.getState().console.has(key)) return;
  deliverables.setState((s) => {
    const console = new Map(s.console);
    console.delete(key);
    return { console };
  });
}

// App.tsx's E2 block: the host's write announcements and main's console attribution.
export function connectDeliverables(client: MawsBridge = ipc): () => void {
  const offChanged = client.on('deliverables.changed', (event) => void applyChanged(event, client));
  const offConsole = client.on('deliverables.console', applyConsole);
  return () => {
    offChanged();
    offConsole();
  };
}

// A `deliverable` tab's title for the strip and the toolbar: the record's, from what the store holds of it (its lookup,
// else its session's list, read here so a restored tab not yet shown is titled too); null until known.
export function useDeliverableTitle(appSessionId: AppSessionId | null, id: string | null): string | null {
  useEffect(() => {
    if (appSessionId !== null && id !== null) ensureSession(appSessionId);
  }, [appSessionId, id]);
  return useDeliverables((s) => {
    if (appSessionId === null || id === null) return null;
    const looked = s.lookups.get(lookupKey(appSessionId, id));
    const record = (looked?.status === 'ready' ? looked.record : null) ?? s.sessions.get(appSessionId)?.records.find((r) => r.id === id) ?? null;
    return record ? titleOf(record) : null;
  });
}

// Tests.
export function resetDeliverables(): void {
  tickets.clear();
  deliverables.setState(initial());
}
