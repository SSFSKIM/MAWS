// The watch on the engine's plugin state (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Decision Log 8):
// a plugin or marketplace changed outside MAWS (an agent's `claude plugin install` in a terminal, an edited settings
// file) must not read "not installed" until Refresh. Main watches, read-only, the files that state lives in for the
// configuration and each cwd the catalog holds; a change, debounced, names the views to forget: `all` for the
// configuration's files, the cwd for a project's settings.
// - The configuration: `<config>/settings.json`; the plugins folder's `installed_plugins.json`,
//   `known_marketplaces.json` and `plugin-directory-bindings.json` (the engine's own walk cache changes on every walk and
//   is not watched).
// - A project: `<cwd>/.claude/settings.json` and `settings.local.json`; while `.claude` does not exist, those two files
//   are polled for their creation.
// - The MCP configuration the connectors' installed state and postures read (scalpel-3#1): the engine's global file
//   (`.claude.json`: user and local servers), MAWS's own settings (its app servers), and `.mcp.json` in the project and
//   every ancestor below the file system root, as the engine's inventory reads them (customization/inventory.ts). A
//   change there is `mcp`: main asks the host for the configured servers again and forgets only the views whose servers
//   moved, so the engine's frequent rewrites of `.claude.json` read nothing again.
// Folders are watched only where the folder is the state's own (the configuration directory, the plugins folder, a
// project's `.claude`), one non-recursive `fs.watch` each: on macOS a folder watch is an FSEvents stream over the
// folder's whole tree, so the home folder, a project's root and its ancestors are never watched (they would wake main for
// every build and checkout beneath them). Single files elsewhere are polled by their stat (`fs.watchFile`, every
// POLL_MS), which also survives a rename-on-write. MAWS has no watcher of these files to share (files/watch.ts serves a
// window's session paths, git/watcher.ts a repository). C4's timing gathers changes: a 250 ms trailing debounce capped
// at 1 s from the first. A folder that cannot be watched (absent, unreadable) is skipped until the next sync.
import { unwatchFile, watch as fsWatch, watchFile, type Stats } from 'node:fs';
import { dirname, join } from 'node:path';
import type { EngineStatePlaces } from './engine-reads';

export type WatchFn = (dir: string, listener: (event: string, filename: string | null) => void) => { close(): void; on(event: 'error', listener: (error: Error) => void): unknown };
/** A file's stat poll: `listener` hears each change of its stat (created, written, replaced, removed). */
export type PollFn = (path: string, listener: () => void) => { close(): void };
/** What a change touches: the engine's plugin state (the views to forget), or its MCP configuration (the connectors to check). */
export type ChangeKind = 'plugins' | 'mcp';

const DEBOUNCE_MS = 250;
const MAX_WAIT_MS = 1000;
const CONFIG_FILES = ['settings.json'];
const PLUGIN_FILES = ['installed_plugins.json', 'known_marketplaces.json', 'plugin-directory-bindings.json'];
const PROJECT_FILES = ['settings.json', 'settings.local.json'];
const PROJECT_MCP = '.mcp.json';

const POLL_MS = 2_000;

const defaultWatch: WatchFn = (dir, listener) => fsWatch(dir, { persistent: false }, (event, filename) => listener(event, filename === null ? null : String(filename)));
const defaultPoll: PollFn = (path, listener) => {
  const changed = (now: Stats, before: Stats) => {
    if (now.mtimeMs !== before.mtimeMs || now.ino !== before.ino || now.size !== before.size) listener();
  };
  watchFile(path, { persistent: false, interval: POLL_MS }, changed);
  return { close: () => unwatchFile(path, changed) };
};

interface Target {
  names: ReadonlySet<string>;
  scope: string; // 'all', or the cwd whose views a change touches
  kind: ChangeKind;
}

export interface StateWatchDeps {
  onChange(scope: string, kind: ChangeKind): void; // 'all' or a cwd
  watch?: WatchFn;
  poll?: PollFn;
  appSettings?: string; // MAWS's own settings file, whose app MCP servers the engine is given (<userData>/settings.json)
}

// A project's folders whose `.mcp.json` the engine reads: the cwd and every ancestor down to but excluding the file system
// root, the same range as customization/inventory.ts. Each file is polled by its stat; none of these folders is watched.
function ancestorsOf(cwd: string): string[] {
  const dirs: string[] = [];
  for (let at = cwd; dirname(at) !== at; at = dirname(at)) dirs.push(at);
  return dirs;
}

export class StateWatch {
  private readonly watching = new Map<string, { targets: Target[]; handle: ReturnType<WatchFn> }>();
  private readonly polling = new Map<string, { target: Target; handle: ReturnType<PollFn> }>();
  private pendingPlugins = new Set<string>();
  private pendingMcp = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAt = 0;

  constructor(private readonly deps: StateWatchDeps) {}

  /** Watch exactly what `places` names. */
  sync(places: EngineStatePlaces): void {
    const folders = new Map<string, Target[]>();
    const files = new Map<string, Target>();
    const folder = (dir: string, target: Target) => folders.set(dir, [...(folders.get(dir) ?? []), target]);
    const mcp: Target = { names: new Set(), scope: 'all', kind: 'mcp' };
    if (places.configHome !== null) folder(places.configHome, { names: new Set(CONFIG_FILES), scope: 'all', kind: 'plugins' });
    if (places.pluginsDir !== null) folder(places.pluginsDir, { names: new Set(PLUGIN_FILES), scope: 'all', kind: 'plugins' });
    if (places.globalConfig !== null) files.set(places.globalConfig, mcp);
    if (this.deps.appSettings) files.set(this.deps.appSettings, mcp);
    for (const cwd of places.projects) {
      const settings = join(cwd, '.claude');
      const target: Target = { names: new Set(PROJECT_FILES), scope: cwd, kind: 'plugins' };
      if (this.watching.has(settings) || this.start(settings, [target])) folder(settings, target);
      else for (const name of PROJECT_FILES) files.set(join(settings, name), target); // .claude not there yet
      for (const dir of ancestorsOf(cwd)) files.set(join(dir, PROJECT_MCP), mcp);
    }
    for (const [dir, targets] of folders) {
      const held = this.watching.get(dir);
      if (held) held.targets = targets;
      else this.start(dir, targets);
    }
    for (const [dir, { handle }] of this.watching)
      if (!folders.has(dir)) {
        handle.close();
        this.watching.delete(dir);
      }
    for (const [path, target] of files) {
      const held = this.polling.get(path);
      if (held) held.target = target;
      else this.polling.set(path, { target, handle: (this.deps.poll ?? defaultPoll)(path, () => this.notePolled(path)) });
    }
    for (const [path, { handle }] of this.polling)
      if (!files.has(path)) {
        handle.close();
        this.polling.delete(path);
      }
  }

  close(): void {
    for (const { handle } of this.watching.values()) handle.close();
    this.watching.clear();
    for (const { handle } of this.polling.values()) handle.close();
    this.polling.clear();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pendingPlugins.clear();
    this.pendingMcp = false;
  }

  private start(dir: string, targets: Target[]): boolean {
    try {
      const handle = (this.deps.watch ?? defaultWatch)(dir, (_event, filename) => {
        for (const target of this.watching.get(dir)?.targets ?? []) if (filename === null || target.names.has(filename)) this.note(target);
      });
      handle.on('error', () => {
        handle.close();
        this.watching.delete(dir);
      });
      this.watching.set(dir, { targets, handle });
      return true;
    } catch {
      return false;
    }
  }

  private notePolled(path: string): void {
    const held = this.polling.get(path);
    if (held) this.note(held.target);
  }

  private note(target: Target): void {
    if (target.kind === 'mcp') this.pendingMcp = true;
    else this.pendingPlugins.add(target.scope);
    const now = Date.now();
    if (this.timer === null) this.firstAt = now;
    else clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), Math.max(0, Math.min(DEBOUNCE_MS, this.firstAt + MAX_WAIT_MS - now)));
  }

  // Forgetting every view reads the connectors again too, so an MCP change beside it says nothing more.
  private flush(): void {
    this.timer = null;
    const scopes = this.pendingPlugins;
    const mcp = this.pendingMcp;
    this.pendingPlugins = new Set();
    this.pendingMcp = false;
    if (scopes.has('all')) return this.deps.onChange('all', 'plugins');
    for (const scope of scopes) this.deps.onChange(scope, 'plugins');
    if (mcp) this.deps.onChange('all', 'mcp');
  }
}
