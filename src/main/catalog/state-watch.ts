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
// - The MCP configuration the connectors' installed state and postures read (scalpel-3#1): the engine's global file
//   (`.claude.json`: user and local servers), MAWS's own settings (its app servers), and `.mcp.json` in the project and
//   each ancestor up to the home folder. A change there is `mcp`: main asks the host for the configured servers again and
//   forgets only the views whose servers moved, so the engine's frequent rewrites of `.claude.json` read nothing again.
// One non-recursive `fs.watch` per directory (MAWS has no watcher of these files to share: files/watch.ts serves a
// window's session paths, git/watcher.ts a repository), with C4's timing: a 250 ms trailing debounce capped at 1 s from
// the first event. A directory that cannot be watched (absent, unreadable) is skipped until the next sync.
import { watch as fsWatch } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { EngineStatePlaces } from './engine-reads';

export type WatchFn = (dir: string, listener: (event: string, filename: string | null) => void) => { close(): void; on(event: 'error', listener: (error: Error) => void): unknown };
/** What a change touches: the engine's plugin state (the views to forget), or its MCP configuration (the connectors to check). */
export type ChangeKind = 'plugins' | 'mcp';

const DEBOUNCE_MS = 250;
const MAX_WAIT_MS = 1000;
const CONFIG_FILES = ['settings.json'];
const PLUGIN_FILES = ['installed_plugins.json', 'known_marketplaces.json', 'plugin-directory-bindings.json'];
const PROJECT_FILES = ['settings.json', 'settings.local.json'];
const PROJECT_MCP = '.mcp.json';

const defaultWatch: WatchFn = (dir, listener) => fsWatch(dir, { persistent: false }, (event, filename) => listener(event, filename === null ? null : String(filename)));

interface Target {
  names: ReadonlySet<string>;
  scope: string; // 'all', or the cwd whose views a change touches
  kind: ChangeKind;
}

export interface StateWatchDeps {
  onChange(scope: string, kind: ChangeKind): void; // 'all' or a cwd
  watch?: WatchFn;
  home?: string; // where a project's ancestors stop being watched (os.homedir())
  appSettings?: string; // MAWS's own settings file, whose app MCP servers the engine is given (<userData>/settings.json)
}

// A project's folders whose `.mcp.json` the engine reads (every ancestor, customization/inventory.ts): watched up to and
// including the home folder, and never the file system's root (a folder above home, or `/`, would watch the whole disk).
function ancestorsOf(cwd: string, home: string): string[] {
  const dirs: string[] = [];
  for (let at = cwd; dirname(at) !== at; at = dirname(at)) {
    dirs.push(at);
    if (at === home) break;
  }
  return dirs;
}

export class StateWatch {
  private readonly watching = new Map<string, { targets: Target[]; handle: ReturnType<WatchFn> }>();
  private pendingPlugins = new Set<string>();
  private pendingMcp = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstAt = 0;

  constructor(private readonly deps: StateWatchDeps) {}

  /** Watch exactly what `places` names. */
  sync(places: EngineStatePlaces): void {
    const wanted = new Map<string, Target[]>();
    const want = (dir: string, target: Target) => wanted.set(dir, [...(wanted.get(dir) ?? []), target]);
    const file = (path: string, kind: ChangeKind) => want(dirname(path), { names: new Set([basename(path)]), scope: 'all', kind });
    if (places.configHome !== null) want(places.configHome, { names: new Set(CONFIG_FILES), scope: 'all', kind: 'plugins' });
    if (places.pluginsDir !== null) want(places.pluginsDir, { names: new Set(PLUGIN_FILES), scope: 'all', kind: 'plugins' });
    if (places.globalConfig !== null) file(places.globalConfig, 'mcp');
    if (this.deps.appSettings) file(this.deps.appSettings, 'mcp');
    const home = this.deps.home ?? homedir();
    for (const cwd of places.projects) {
      // a project's .claude that does not exist yet: the project itself, for its creation
      const settings = join(cwd, '.claude');
      const target: Target = { names: new Set(PROJECT_FILES), scope: cwd, kind: 'plugins' };
      if (this.watching.has(settings) || this.start(settings, [target])) want(settings, target);
      else want(cwd, { names: new Set(['.claude']), scope: cwd, kind: 'plugins' });
      for (const dir of ancestorsOf(cwd, home)) want(dir, { names: new Set([PROJECT_MCP]), scope: 'all', kind: 'mcp' });
    }
    for (const [dir, targets] of wanted) {
      const held = this.watching.get(dir);
      if (held) held.targets = targets;
      else this.start(dir, targets);
    }
    for (const [dir, { handle }] of this.watching)
      if (!wanted.has(dir)) {
        handle.close();
        this.watching.delete(dir);
      }
  }

  close(): void {
    for (const { handle } of this.watching.values()) handle.close();
    this.watching.clear();
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
