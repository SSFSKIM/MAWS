// The layout store (C5 execution document, Interfaces "X2 — `layout.*`" and Main modules): `<userData>/layout.json`,
// one opaque JSON value per key, the product store for layout (§4.4 as amended: layout is not in C4's index). Written
// whole through a temporary file and a rename like the settings file; the renderer debounces its own keys, and the
// window key, which main writes on every move and resize, is debounced here. Values are validated by their readers.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LayoutKey } from '@shared/ipc/schema/layout';
import { registerMainHandler } from '../ipc/router';

export interface LayoutStore {
  get(key: LayoutKey): unknown | null;
  set(key: LayoutKey, value: unknown): void;
  list(): string[];
}

const WINDOW_KEY = 'window.main';
export const WINDOW_DEBOUNCE_MS = 500;

export class LayoutFileStore implements LayoutStore {
  private readonly values: Map<string, unknown>;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;

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
      return;
    }
    this.cancelWindowWrite();
    this.windowTimer = setTimeout(() => this.flush(), WINDOW_DEBOUNCE_MS);
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

  private cancelWindowWrite(): void {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.windowTimer = null;
  }

  private write(): void {
    const temporary = `${this.file}.${process.pid}.tmp`;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.values)));
    renameSync(temporary, this.file);
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

// `layout.get/set/list` for the renderer. `window.main` is main's own key: listed (it exists in the file), but never
// read or written across IPC.
export function registerLayoutHandlers(store: LayoutStore): void {
  const renderersOnly = (key: LayoutKey) => {
    if (key === WINDOW_KEY) throw new Error(`${WINDOW_KEY} is main's own layout key`);
  };
  registerMainHandler('layout.get', ({ key }) => {
    renderersOnly(key);
    return { value: store.get(key) };
  });
  registerMainHandler('layout.set', ({ key, value }) => {
    renderersOnly(key);
    store.set(key, value);
  });
  registerMainHandler('layout.list', () => ({ keys: store.list() }));
}
