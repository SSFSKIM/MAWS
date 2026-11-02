// The renderer's library (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M3; Decision Log 9): one vanilla zustand
// store for the window over main's reads of its derived index, `library.list`, `library.get` and `library.spaces`. Main
// announces each committed change of the index once per tick (`library.changed`), and this store answers it by reading
// again everything a surface is watching: a list per filter (the library's views, the panel tool's session list), a row
// per artifact (a main tab's body and its label), the Spaces.
//
// - A read is watched while a surface shows it (`watchLibrary*`, or the `useLibrary*` hooks), read at its first watch
//   and again at every change. A failed read keeps the last good answer beside the refusal's message, so a list does not
//   empty while the index is briefly unavailable; the next change, or `refreshLibrary` (a Retry), reads again.
// - Each read takes a ticket: an answer lands only when no newer read of the same key started after it.
// - A read nobody watches keeps its last answer, shown at once (and read again) when a surface watches it again, so
//   switching back to a view does not flash empty; past UNWATCHED_KEPT such reads the oldest is forgotten.
// - P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5, "Which machine an artifact is on"; it lifts
//   O6 M4's refusal of another machine's list): each read is one machine's. A list is read on the machine its filter's
//   session or project names, else the machine asked (the library's machine menu, a remote session's All), else this
//   Mac; the Spaces of the machine asked; a row on its artifact's machine (`artifacts/machines.ts`, which the rows a list
//   answers fill). A machine's `library.changed`, and the `artifacts.resync` its artifacts feed says at each opening (a
//   re-read of what the feed may have missed), read again that machine's reads alone.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { CommandName, CommandResult, InvokeRest, MawsBridge } from '@shared/ipc/schema';
import type { LibraryCounts, LibraryFilter, LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { artifactMachineOf } from '../artifacts/machines';
import { ipc } from '../ipc/client';

export const UNWATCHED_KEPT = 16;

export interface LibraryRead<T> {
  status: 'idle' | 'reading' | 'ready' | 'error';
  value: T | undefined; // the last good answer; undefined before the first
  error: string | null; // the last read's refusal, until a read succeeds
}

export interface LibraryList {
  rows: LibraryRow[];
  counts: LibraryCounts;
}

export interface LibraryState {
  reads: ReadonlyMap<string, LibraryRead<unknown>>;
}

const IDLE: LibraryRead<never> = { status: 'idle', value: undefined, error: null };

export const library = createStore<LibraryState>()(() => ({ reads: new Map() }));
export const useLibrary = <T>(selector: (state: LibraryState) => T): T => useStore(library, selector);

// ---- keys --------------------------------------------------------------------------------------------------------------

// A filter as main is asked it: absent fields and a blank query left out, the fields in one order, so two filters that
// ask the same thing share one read.
function normalize(filter: LibraryFilter | undefined): LibraryFilter {
  const entries = Object.entries(filter ?? {}).filter(([key, value]) => value !== undefined && !(key === 'query' && typeof value === 'string' && value.trim() === ''));
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))) as LibraryFilter;
}

// The machine a list is read on: the one its filter's session or project names, else the one asked, else this Mac.
function listMachine(filter: LibraryFilter, asked: MachineRef | undefined): MachineRef {
  const named = [filter.appSessionId, filter.projectId].find((id) => id !== undefined && isAddress(id));
  return named !== undefined ? machineOf(named) : (asked ?? ipc.localMachine);
}

export const listKey = (filter?: LibraryFilter, machine?: MachineRef): string => {
  const normalized = normalize(filter);
  return `list:${listMachine(normalized, machine)}:${JSON.stringify(normalized)}`;
};
export const rowKey = (artifactId: string): string => `row:${artifactId}`;
export const spacesKey = (machine: MachineRef = ipc.localMachine): string => `spaces:${machine}`;

// ---- reads -------------------------------------------------------------------------------------------------------------

type Reader = (client: MawsBridge) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>;

const readers = new Map<string, Reader>(); // every key read, how to read it again
const machineOfKey = new Map<string, () => MachineRef>(); // the machine each key is read on (a row's: its artifact's, as now known)
const watchers = new Map<string, number>();
const unwatched: string[] = []; // keys nobody watches, oldest first
const tickets = new Map<string, number>();
let lastTicket = 0;

function setRead(key: string, next: (read: LibraryRead<unknown>) => LibraryRead<unknown>): void {
  library.setState((s) => ({ reads: new Map(s.reads).set(key, next(s.reads.get(key) ?? IDLE)) }));
}

function read(key: string, client: MawsBridge): void {
  const reader = readers.get(key);
  if (!reader) return;
  const ticket = ++lastTicket;
  tickets.set(key, ticket);
  setRead(key, (r) => ({ ...r, status: 'reading' }));
  void reader(client).then((result) => {
    if (tickets.get(key) !== ticket || !readers.has(key)) return;
    setRead(key, (r) => (result.ok ? { status: 'ready', value: result.value, error: null } : { ...r, status: 'error', error: result.error.message }));
  });
}

function forget(key: string): void {
  readers.delete(key);
  machineOfKey.delete(key);
  tickets.delete(key);
  library.setState((s) => {
    const reads = new Map(s.reads);
    reads.delete(key);
    return { reads };
  });
}

// Watches `key` until the returned function is called: read now when no one else watches it, then at every change.
function watch(key: string, reader: Reader, on: () => MachineRef, client: MawsBridge): () => void {
  const count = watchers.get(key) ?? 0;
  watchers.set(key, count + 1);
  const kept = unwatched.indexOf(key);
  if (kept !== -1) unwatched.splice(kept, 1);
  if (count === 0) {
    readers.set(key, reader);
    machineOfKey.set(key, on);
    read(key, client);
  }
  let watching = true;
  return () => {
    if (!watching) return;
    watching = false;
    const left = (watchers.get(key) ?? 1) - 1;
    if (left > 0) {
      watchers.set(key, left);
      return;
    }
    watchers.delete(key);
    unwatched.push(key);
    while (unwatched.length > UNWATCHED_KEPT) forget(unwatched.shift() as string);
  };
}

const ask =
  <N extends CommandName>(name: N, input: unknown, ...opts: InvokeRest<N>): Reader =>
  (client) =>
    client.invoke(name, input as never, ...opts) as Promise<CommandResult<N>>;

// `machine`: the machine asked, when the filter names none (the library's machine menu, a remote session's All).
export const watchLibraryList = (filter?: LibraryFilter, client: MawsBridge = ipc, machine?: MachineRef): (() => void) => {
  const normalized = normalize(filter);
  const on = listMachine(normalized, machine);
  return watch(listKey(normalized, machine), ask('library.list', { filter: normalized }, { machine: on }), () => on, client);
};
export const watchLibraryRow = (artifactId: string, client: MawsBridge = ipc): (() => void) =>
  watch(rowKey(artifactId), async (c) => {
    const result = await c.invoke('library.get', { artifactId }); // on its artifact's machine (the client asks the table)
    return result.ok ? { ok: true, value: result.value.row } : result;
  }, () => artifactMachineOf(artifactId) ?? client.localMachine, client);
export const watchLibrarySpaces = (client: MawsBridge = ipc, machine: MachineRef = client.localMachine): (() => void) =>
  watch(spacesKey(machine), async (c) => {
    const result = await c.invoke('library.spaces', undefined, { machine });
    return result.ok ? { ok: true, value: result.value.spaces } : result;
  }, () => machine, client);

// Every watched read, or (`machine`) every one of that machine, read again (a change in its index, or a Retry).
export function refreshLibrary(client: MawsBridge = ipc, machine?: MachineRef): void {
  for (const key of watchers.keys()) if (machine === undefined || machineOfKey.get(key)?.() === machine) read(key, client);
}

// App.tsx's P3-L block: a machine's announcements of a committed index change, and (P5 O7 M5a) the re-read its artifacts
// feed asks at each opening; each reads again that machine's reads.
export function connectLibrary(client: MawsBridge = ipc): () => void {
  const offChanged = client.on('library.changed', (_change, from) => refreshLibrary(client, from.machine));
  const offResync = client.on('artifacts.resync', (_resync, from) => refreshLibrary(client, from.machine));
  return () => {
    offChanged();
    offResync();
  };
}

// ---- selectors and hooks -----------------------------------------------------------------------------------------------

export const libraryList = (s: LibraryState, filter?: LibraryFilter, machine?: MachineRef) => (s.reads.get(listKey(filter, machine)) ?? IDLE) as LibraryRead<LibraryList>;
export const libraryRow = (s: LibraryState, artifactId: string) => (s.reads.get(rowKey(artifactId)) ?? IDLE) as LibraryRead<LibraryRow | null>; // null: not in the library
export const librarySpaces = (s: LibraryState, machine?: MachineRef) => (s.reads.get(spacesKey(machine)) ?? IDLE) as LibraryRead<LibrarySpace[]>;

export function useLibraryList(filter?: LibraryFilter, machine?: MachineRef): LibraryRead<LibraryList> {
  const key = listKey(filter, machine);
  const asked = JSON.stringify(normalize(filter));
  useEffect(() => watchLibraryList(JSON.parse(asked) as LibraryFilter, ipc, machine), [asked, machine]);
  return useLibrary((s) => (s.reads.get(key) ?? IDLE) as LibraryRead<LibraryList>);
}

export function useLibraryRow(artifactId: string | null): LibraryRead<LibraryRow | null> {
  useEffect(() => (artifactId === null ? undefined : watchLibraryRow(artifactId)), [artifactId]);
  return useLibrary((s) => (artifactId === null ? IDLE : libraryRow(s, artifactId)));
}

export function useLibrarySpaces(machine?: MachineRef): LibraryRead<LibrarySpace[]> {
  useEffect(() => watchLibrarySpaces(ipc, machine), [machine]);
  return useLibrary((s) => librarySpaces(s, machine));
}

// An `artifact` tab's title for the strip and the toolbar: its row's, null until known (or when it is not in the library).
export const useArtifactTitle = (artifactId: string | null): string | null => useLibraryRow(artifactId).value?.title ?? null;

// Tests.
export function resetLibrary(): void {
  readers.clear();
  machineOfKey.clear();
  watchers.clear();
  unwatched.length = 0;
  tickets.clear();
  library.setState({ reads: new Map() });
}
