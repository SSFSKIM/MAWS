// The layout store (C5 execution document, Interfaces "X2 — `layout.*`" and Main modules): `<userData>/layout.json`,
// one opaque JSON value per key, the product store for layout (§4.4 as amended: layout is not in C4's index). Written
// whole through a temporary file and a rename like the settings file; the renderer debounces its own keys, and the
// window key, which main writes on every move and resize, is debounced here. Values are validated by their readers.
import { mkdirSync, readFileSync } from 'node:fs';
import { atomicWriteFileSync } from '../files/atomic-write';
import { dirname } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import type { LayoutKey } from '@shared/ipc/schema/layout';
import { addressOf, bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { registerMainHandler } from '../ipc/router';
import type { SessionReadModel } from '../sessions/read-model';

export interface LayoutStore {
  get(key: LayoutKey): unknown | null;
  set(key: LayoutKey, value: unknown): void;
  delete(key: LayoutKey): void;
  list(): string[];
}

const WINDOW_KEY = 'window.main';
export const WINDOW_DEBOUNCE_MS = 500;

export class LayoutFileStore implements LayoutStore {
  private readonly values: Map<string, unknown>;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly changed = new Set<(key: string) => void>(); // P5 O2 M2: main's interest report follows `main.tabs`

  constructor(private readonly file: string) {
    this.values = read(file);
  }

  get(key: LayoutKey): unknown | null {
    return this.values.get(key) ?? null;
  }

  // A renderer key is written at once and a failure throws, so the router answers `layout.set` with an error the page
  // logs (a pending window write stays pending then, and retries). The window key is main's own and debounced.
  set(key: LayoutKey, value: unknown): void {
    this.values.set(key, value);
    if (key !== WINDOW_KEY) {
      this.write();
      this.cancelWindowWrite(); // the whole file just went out, window key included
      this.fire(key);
      return;
    }
    this.cancelWindowWrite();
    this.windowTimer = setTimeout(() => this.flush(), WINDOW_DEBOUNCE_MS);
  }

  // Removes a key and writes the file at once; an absent key writes nothing. A failure throws, as `set` does.
  delete(key: LayoutKey): void {
    if (!this.values.delete(key)) return;
    this.write();
    this.cancelWindowWrite();
    this.fire(key);
  }

  // P5 O2 M2: a renderer key set or deleted (the window key is main's own and never reported)
  onChange(listener: (key: string) => void): () => void {
    this.changed.add(listener);
    return () => this.changed.delete(listener);
  }

  list(): string[] {
    return [...this.values.keys()];
  }

  // Writes now, cancelling a pending window write: the debounce timer and `will-quit` call it, outside any handler
  // that could catch, so a failed write (a full disk, a permission change) is logged and never thrown: layout
  // persistence must not disrupt the app's lifecycle. The values stay in memory for the next write.
  flush(): void {
    this.cancelWindowWrite();
    try {
      this.write();
    } catch (error) {
      console.error(`[layout] cannot write ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private fire(key: string): void {
    for (const listener of this.changed) listener(key);
  }

  private cancelWindowWrite(): void {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.windowTimer = null;
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    atomicWriteFileSync(this.file, JSON.stringify(Object.fromEntries(this.values)));
  }
}

function read(file: string): Map<string, unknown> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[layout] cannot read ${file}; starting empty`, error);
    return new Map();
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object of keys');
    return new Map(Object.entries(parsed));
  } catch (error) {
    console.warn(`[layout] invalid ${file}; starting empty`, error);
    return new Map();
  }
}

const SESSION_PANEL_KEY = /^panel\.([^.]+)$/;
// Past the session source's 16 ms coalescing tick, which is when the renderer first hears the removal.
export const PANEL_DROP_DELAY_MS = 100;

// P5 O6 M2 (OX2): the renderer keys a session's panel tabs by its address, `panel.<machine>/<id>`. The keys a removed local
// session leaves: its address's, and the bare one a layout from before O6 held until the renderer migrated it.
export const panelKeysOf = (local: MachineRef, appSessionId: AppSessionId): LayoutKey[] => [`panel.${addressOf(local, appSessionId)}`, `panel.${appSessionId}`];

// Whether `layout.set` may write a session's panel key: another machine's unchecked (its machine reports its removal to
// the renderer, M4), a local one's only while main knows the session. A bare key is the local machine's, so the renderer's
// migration can still read it and an e2e spec can write it through the raw bridge.
function panelKeyAllowed(session: string, local: MachineRef, known: (appSessionId: AppSessionId) => boolean): boolean {
  if (!isAddress(session)) return known(session as AppSessionId);
  return machineOf(session) !== local || known(bareOf(session) as AppSessionId);
}

// A removed session's own panel tabs (`panel.<appSessionId>`) go with it, so layout.json does not keep keys for sessions
// that no longer exist, with or without a window open. The read model sees a removal before the renderer does (the
// source coalesces its events), so the key goes once the renderer has heard it, and only if the session is still gone:
// a record removed and recreated under the same id within one tick keeps its tabs.
export function dropPanelKeysOfRemovedSessions(model: Pick<SessionReadModel, 'on' | 'record'>, store: LayoutStore, local: MachineRef): () => void {
  const timers = new Map<AppSessionId, ReturnType<typeof setTimeout>>();
  const off = model.on('record', (appSessionId: AppSessionId, record) => {
    if (record !== null || timers.has(appSessionId)) return;
    const timer = setTimeout(() => {
      timers.delete(appSessionId);
      if (model.record(appSessionId) !== null) return;
      for (const key of panelKeysOf(local, appSessionId)) {
        try {
          store.delete(key);
        } catch (error) {
          console.error(`[layout] cannot drop ${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }, PANEL_DROP_DELAY_MS);
    timers.set(appSessionId, timer);
  });
  return () => {
    off();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}

// `layout.get/set/list` for the renderer. `window.main` is main's own key: listed (it exists in the file), but never
// read or written across IPC. A session's own panel key is written only while the session exists (`known`), so a write
// already on its way when the session was removed cannot bring the key back. P5 O6 M2: a null value deletes the key (the
// renderer's migration of a bare panel key to its address), whatever main knows of the session.
export function registerLayoutHandlers(store: LayoutStore, known: (appSessionId: AppSessionId) => boolean, local: MachineRef): void {
  const renderersOnly = (key: LayoutKey) => {
    if (key === WINDOW_KEY) throw new Error(`${WINDOW_KEY} is main's own layout key`);
  };
  registerMainHandler('layout.get', ({ key }) => {
    renderersOnly(key);
    return { value: store.get(key) };
  });
  registerMainHandler('layout.set', ({ key, value }) => {
    renderersOnly(key);
    if (value === null) return store.delete(key);
    const session = key === 'panel.pinned' ? null : SESSION_PANEL_KEY.exec(key)?.[1];
    if (session && !panelKeyAllowed(session, local, known)) throw new Error(`${key}: no such session`);
    store.set(key, value);
  });
  registerMainHandler('layout.list', () => ({ keys: store.list() }));
}
