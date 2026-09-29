// The Files store (C8c execution document, Repository map `files/store.ts`; M2's decisions): `files.list` answers by
// session and directory, and the ref-counted `files.watch` holds behind them, kept current by `files.changed`. The
// Files tool watches the directories it has expanded and the viewer its file's directory, through the same counts, so
// main holds one watch per directory whatever the number of holders here. A release waits WATCH_GRACE_MS before it
// unwatches, so a quick collapse and re-expand does not churn main's watcher.
//
// FSEvents replays and restarts around an install (M1 Surprises): a listing asked for while its directory's watch is
// installing is issued once the watch has answered, and a listing held when a watch (re-)installs is issued again
// then, so a change made in the restart window is not missed.
import { create } from 'zustand';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, MawsBridge } from '@shared/ipc/schema';
import type { FilesChanged } from '@shared/ipc/schema/files';
import { ipc } from '../../../ipc/client';
import { dirname, sameFile, type Listing } from './tree';

export const WATCH_GRACE_MS = 5000;

export interface WatchHold {
  readonly ready: Promise<void>; // settles when the watch has answered (installed or refused); after an `invalidated`, the re-install
  release(): void;
}

export interface FilesStore {
  listings: Map<string, Listing>; // by listingKey(appSessionId, path); the roots listing's path is null
  listing(appSessionId: AppSessionId, path: string | null): Listing | undefined;
  list(appSessionId: AppSessionId, path: string | null): void; // (re-)lists; a listing already held stays shown until the answer
  watch(appSessionId: AppSessionId, path: string): WatchHold;
  holders(appSessionId: AppSessionId, path: string): number; // the holds on a directory now (diagnostics and tests)
  applyChanged(event: FilesChanged): void;
  reset(): void; // tests: forget every listing and hold without unwatching
}

export const listingKey = (appSessionId: AppSessionId, path: string | null): string => `${appSessionId}\n${path ?? ''}`;

interface Watched {
  appSessionId: AppSessionId;
  path: string;
  count: number;
  grace: ReturnType<typeof setTimeout> | null;
  state: 'installing' | 'installed' | 'failed';
  ready: Promise<void>;
  listAfter: boolean; // a listing was asked for while installing
}

// A bridge that throws is a failure with its message, so nothing stays in flight (as the git store does).
async function settled<N extends CommandName>(call: Promise<CommandResult<N>>): Promise<CommandResult<N>> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } };
  }
}

export function createFilesStore(client: MawsBridge, options: { graceMs?: number } = {}) {
  const graceMs = options.graceMs ?? WATCH_GRACE_MS;
  const watched = new Map<string, Watched>();
  const inflight = new Map<string, { again: boolean }>();
  let generation = 0; // bumped by reset, so answers to a forgotten call land nowhere

  return create<FilesStore>()((set, get) => {
    const put = (key: string, listing: Listing) => set((s) => ({ listings: new Map(s.listings).set(key, listing) }));
    const drop = (key: string) =>
      set((s) => {
        const listings = new Map(s.listings);
        listings.delete(key);
        return { listings };
      });

    const list = (appSessionId: AppSessionId, path: string | null) => {
      const key = listingKey(appSessionId, path);
      const w = watched.get(key);
      if (w?.state === 'installing') {
        w.listAfter = true;
        if (!get().listings.has(key)) put(key, { status: 'loading' });
        return;
      }
      const flying = inflight.get(key);
      if (flying) {
        flying.again = true;
        return;
      }
      if (!get().listings.has(key)) put(key, { status: 'loading' });
      const flight = { again: false };
      inflight.set(key, flight);
      const at = generation;
      void settled(client.invoke('files.list', path === null ? { appSessionId } : { appSessionId, path })).then((result) => {
        if (at !== generation) return;
        inflight.delete(key);
        put(key, result.ok ? { status: 'ok', value: result.value } : { status: 'error', message: result.error.message });
        if (flight.again) list(appSessionId, path);
      });
    };

    const install = (key: string, w: Watched) => {
      w.state = 'installing';
      const at = generation;
      w.ready = settled(client.invoke('files.watch', { appSessionId: w.appSessionId, path: w.path })).then((result) => {
        if (at !== generation) return;
        // Set before the identity check: a hold whose grace ran out during the install unwatches once this answers.
        w.state = result.ok ? 'installed' : 'failed';
        if (watched.get(key) !== w) return;
        if (w.listAfter || get().listings.has(key)) {
          w.listAfter = false;
          list(w.appSessionId, w.path);
        }
      });
    };

    return {
      listings: new Map(),

      listing: (appSessionId, path) => get().listings.get(listingKey(appSessionId, path)),

      list,

      watch(appSessionId, path) {
        const key = listingKey(appSessionId, path);
        let w = watched.get(key);
        if (w) {
          w.count += 1;
          if (w.grace !== null) clearTimeout(w.grace);
          w.grace = null;
          if (w.state === 'failed') install(key, w); // a refused watch is tried again by the next holder
        } else {
          w = { appSessionId, path, count: 1, grace: null, state: 'installing', ready: Promise.resolve(), listAfter: false };
          watched.set(key, w);
          install(key, w);
        }
        const held = w;
        let released = false;
        return {
          get ready() {
            return held.ready;
          },
          release() {
            if (released) return;
            released = true;
            if (--held.count > 0) return;
            held.grace = setTimeout(() => {
              held.grace = null;
              if (held.count > 0 || watched.get(key) !== held) return;
              watched.delete(key);
              drop(key); // unwatched, so no longer kept current: listed afresh on the next expand
              void held.ready.then(() => {
                if (held.state === 'installed') void settled(client.invoke('files.unwatch', { appSessionId, path }));
              });
            }, graceMs);
          },
        };
      },

      holders: (appSessionId, path) => watched.get(listingKey(appSessionId, path))?.count ?? 0,

      applyChanged(event) {
        if (event.kind === 'invalidated') {
          // Main dropped the watch: drop what it guarded; a held directory is re-watched (the boundary runs again) and
          // re-listed once that answers, so a standing substitution shows as the refusal.
          for (const [key, w] of watched) {
            if (w.appSessionId !== event.appSessionId || !sameFile(event.path, w.path)) continue;
            const listed = get().listings.has(key);
            if (w.count > 0) {
              if (listed) put(key, { status: 'loading' });
              w.listAfter = listed;
              install(key, w);
            } else {
              if (w.grace !== null) clearTimeout(w.grace);
              watched.delete(key);
              drop(key);
            }
          }
          return;
        }
        // A change names an entry: its directory is re-listed, and the entry itself when it is a listed directory.
        const parent = dirname(event.path);
        for (const key of get().listings.keys()) {
          const cut = key.indexOf('\n');
          const path = key.slice(cut + 1);
          if (key.slice(0, cut) === event.appSessionId && (path === parent || path === event.path)) list(event.appSessionId, path);
        }
      },

      reset() {
        generation += 1;
        for (const w of watched.values()) if (w.grace !== null) clearTimeout(w.grace);
        watched.clear();
        inflight.clear();
        set({ listings: new Map() });
      },
    };
  });
}

export const useFiles = createFilesStore(ipc);
