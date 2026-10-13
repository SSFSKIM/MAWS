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
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { LibraryCounts, LibraryFilter, LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
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

export const listKey = (filter?: LibraryFilter): string => `list:${JSON.stringify(normalize(filter))}`;
export const rowKey = (artifactId: string): string => `row:${artifactId}`;
export const SPACES_KEY = 'spaces';

// ---- reads -------------------------------------------------------------------------------------------------------------

type Reader = (client: MawsBridge) => Promise<{ ok: true; value: unknown } | { ok: false; error: { message: string } }>;

const readers = new Map<string, Reader>(); // every key read, how to read it again
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
  tickets.delete(key);
  library.setState((s) => {
    const reads = new Map(s.reads);
    reads.delete(key);
    return { reads };
  });
}

// Watches `key` until the returned function is called: read now when no one else watches it, then at every change.
function watch(key: string, reader: Reader, client: MawsBridge): () => void {
  const count = watchers.get(key) ?? 0;
  watchers.set(key, count + 1);
  const kept = unwatched.indexOf(key);
  if (kept !== -1) unwatched.splice(kept, 1);
  if (count === 0) {
    readers.set(key, reader);
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
  <N extends CommandName>(name: N, input: unknown): Reader =>
  (client) =>
    client.invoke(name, input as never) as Promise<CommandResult<N>>;

export const watchLibraryList = (filter?: LibraryFilter, client: MawsBridge = ipc): (() => void) => {
  const normalized = normalize(filter);
  return watch(listKey(normalized), ask('library.list', { filter: normalized }), client);
};
export const watchLibraryRow = (artifactId: string, client: MawsBridge = ipc): (() => void) =>
  watch(rowKey(artifactId), async (c) => {
    const result = await c.invoke('library.get', { artifactId });
    return result.ok ? { ok: true, value: result.value.row } : result;
  }, client);
export const watchLibrarySpaces = (client: MawsBridge = ipc): (() => void) =>
  watch(SPACES_KEY, async (c) => {
    const result = await c.invoke('library.spaces', undefined);
    return result.ok ? { ok: true, value: result.value.spaces } : result;
  }, client);

// Every watched read, read again (a change in main's index, or a Retry).
export function refreshLibrary(client: MawsBridge = ipc): void {
  for (const key of watchers.keys()) read(key, client);
}

// App.tsx's P3-L block: main's announcements of a committed index change.
export function connectLibrary(client: MawsBridge = ipc): () => void {
  return client.on('library.changed', () => refreshLibrary(client));
}

// ---- selectors and hooks -----------------------------------------------------------------------------------------------

export const libraryList = (s: LibraryState, filter?: LibraryFilter) => (s.reads.get(listKey(filter)) ?? IDLE) as LibraryRead<LibraryList>;
export const libraryRow = (s: LibraryState, artifactId: string) => (s.reads.get(rowKey(artifactId)) ?? IDLE) as LibraryRead<LibraryRow | null>; // null: not in the library
export const librarySpaces = (s: LibraryState) => (s.reads.get(SPACES_KEY) ?? IDLE) as LibraryRead<LibrarySpace[]>;

export function useLibraryList(filter?: LibraryFilter): LibraryRead<LibraryList> {
  const key = listKey(filter);
  useEffect(() => watchLibraryList(JSON.parse(key.slice('list:'.length)) as LibraryFilter), [key]);
  return useLibrary((s) => (s.reads.get(key) ?? IDLE) as LibraryRead<LibraryList>);
}

export function useLibraryRow(artifactId: string | null): LibraryRead<LibraryRow | null> {
  useEffect(() => (artifactId === null ? undefined : watchLibraryRow(artifactId)), [artifactId]);
  return useLibrary((s) => (artifactId === null ? IDLE : libraryRow(s, artifactId)));
}

export function useLibrarySpaces(): LibraryRead<LibrarySpace[]> {
  useEffect(() => watchLibrarySpaces(), []);
  return useLibrary(librarySpaces);
}

// An `artifact` tab's title for the strip and the toolbar: its row's, null until known (or when it is not in the library).
export const useArtifactTitle = (artifactId: string | null): string | null => useLibraryRow(artifactId).value?.title ?? null;

// Tests.
export function resetLibrary(): void {
  readers.clear();
  watchers.clear();
  unwatched.length = 0;
  tickets.clear();
  library.setState({ reads: new Map() });
}
