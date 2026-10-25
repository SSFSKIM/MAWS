// The watch on the engine's plugin state (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Decision Log 8):
// a plugin or marketplace changed outside MAWS (an agent's `claude plugin install` in a terminal, an edited settings
// file) must not read "not installed" until Refresh. Main watches, read-only, the files that state lives in for the
// configuration and each cwd the catalog holds; a change, debounced, names the views to forget: `all` for the
// configuration's files, the cwd for a project's settings.
// - The configuration: `<config>/settings.json`; the plugins folder's `installed_plugins.json`,
//   `known_marketplaces.json` and `plugin-directory-bindings.json` (the engine's own walk cache changes on every walk and
//   is not watched).
// - A project: `<cwd>/.claude/settings.json` and `settings.local.json`; while `.claude` does not exist, the cwd itself
//   for its creation.
// One non-recursive `fs.watch` per directory (MAWS has no watcher of these files to share: files/watch.ts serves a
// window's session paths, git/watcher.ts a repository), with C4's timing: a 250 ms trailing debounce capped at 1 s from
// the first event. A directory that cannot be watched (absent, unreadable) is skipped until the next sync.
import { watch as fsWatch } from 'node:fs';
import { join } from 'node:path';
import type { EngineStatePlaces } from './engine-reads';

export type WatchFn = (dir: string, listener: (event: string, filename: string | null) => void) => { close(): void; on(event: 'error', listener: (error: Error) => void): unknown };

const DEBOUNCE_MS = 250;
const MAX_WAIT_MS = 1000;
const CONFIG_FILES = ['settings.json'];
const PLUGIN_FILES = ['installed_plugins.json', 'known_marketplaces.json', 'plugin-directory-bindings.json'];
const PROJECT_FILES = ['settings.json', 'settings.local.json'];

const defaultWatch: WatchFn = (dir, listener) => fsWatch(dir, { persistent: false }, (event, filename) => listener(event, filename === null ? null : String(filename)));

interface Target {
  names: ReadonlySet<string>;
  scope: string; // 'all', or the cwd whose views a change touches
}

export interface StateWatchDeps {
  onChange(scope: string): void; // 'all' or a cwd
  watch?: WatchFn;
}

export class StateWatch {
  private readonly watching = new Map<string, { target: Target; handle: ReturnType<WatchFn> }>();
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAt = 0;

  constructor(private readonly deps: StateWatchDeps) {}

  /** Watch exactly what `places` names. */
  sync(places: EngineStatePlaces): void {
    const kept = new Set<string>();
    const ensure = (dir: string, target: Target): boolean => {
      const watched = kept.has(dir) || this.watching.has(dir) || this.start(dir, target);
      if (watched) kept.add(dir);
      return watched;
    };
    if (places.configHome !== null) ensure(places.configHome, { names: new Set(CONFIG_FILES), scope: 'all' });
    if (places.pluginsDir !== null) ensure(places.pluginsDir, { names: new Set(PLUGIN_FILES), scope: 'all' });
    // a project's .claude that does not exist yet: the project itself, for its creation
    for (const cwd of places.projects) if (!ensure(join(cwd, '.claude'), { names: new Set(PROJECT_FILES), scope: cwd })) ensure(cwd, { names: new Set(['.claude']), scope: cwd });
    for (const [dir, { handle }] of this.watching)
      if (!kept.has(dir)) {
        handle.close();
        this.watching.delete(dir);
      }
  }

  close(): void {
    for (const { handle } of this.watching.values()) handle.close();
    this.watching.clear();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  private start(dir: string, target: Target): boolean {
    try {
      const handle = (this.deps.watch ?? defaultWatch)(dir, (_event, filename) => {
        if (filename === null || target.names.has(filename)) this.note(target.scope);
      });
      handle.on('error', () => {
        handle.close();
        this.watching.delete(dir);
      });
      this.watching.set(dir, { target, handle });
      return true;
    } catch {
      return false;
    }
  }

  private note(scope: string): void {
    this.pending.add(scope);
    const now = Date.now();
    if (this.timer === null) this.firstAt = now;
    else clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), Math.max(0, Math.min(DEBOUNCE_MS, this.firstAt + MAX_WAIT_MS - now)));
  }

  private flush(): void {
    this.timer = null;
    const scopes = this.pending;
    this.pending = new Set();
    if (scopes.has('all')) this.deps.onChange('all');
    else for (const scope of scopes) this.deps.onChange(scope);
  }
}
