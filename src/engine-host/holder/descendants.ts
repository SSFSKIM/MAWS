// O16 M5: the descendant veto (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; D17, D48, D52,
// D69). Every process under `claude` counts as the session's work unless it is registered infrastructure, bound by
// identity (its pid and its start time, as supervisor-files.ts `procStartOf` reads it, and its parent, `claude`):
// - the sminos bridge child its observer's gate `hello` named by pid. The bridge's binding is the process first found at
//   the named pid as a child of `claude` (M0 Q4); once it is gone or re-parented, neither it nor another process at that
//   pid is exempt again, until a hello names another pid;
// - the bridge by its own argv (D69), `sminos[.py] bridge --session <S>` with S one of the row's engine session ids, the
//   registration for every process whose bridge never says that hello (no observer: an older sminos, or a process
//   O12 M4 records as legacy), and superseded by the hello for one whose bridge does (`isBridgeOf`);
// - each stdio MCP server of the launch, by either of two routes. By command line: one direct child of `claude` whose
//   command line is a server's `mcp_status` `config.{command, args}` as the kernel ran it (`expectedArgv`); a server's
//   binding lasts while that process lives as a child of `claude`, one gone (or re-parented) frees the server for its
//   next process, and a second process matching a server while the first lives is work. By count (D69), which also
//   covers a launcher that execs another binary and a bare command an adopter cannot resolve: a connected stdio server
//   always has exactly one live process as `claude`'s direct child (the transport's spawn, which ends the connection when
//   it closes), so when a fresh `mcp_status` names no server pending and the unbound direct children that are not
//   claude's Bash wrappers (`isBashWrapper`), with the servers already bound, are exactly as many as the connected stdio
//   servers, those children are the servers and are bound (`settle`), provided each started within a minute of
//   `claude` itself and no later than the launch's first turn, when the engine spawns its stdio servers and before any
//   child the model's work can start (`SERVER_SPAWN_WINDOW_MS`). Any other child makes the numbers disagree or falls
//   outside the window, and nothing is bound by count until it is gone;
// - what an adopter restores from the state file: the bindings the process's previous manager made (`Binding`), each
//   bound again only if the same process (pid, start, parent) is still there.
//
// D52: the subtree of a bound process is infrastructure too (npx, uvx and their like run the real server as a child of
// the registered process); the bound process is the only way in, never a process whose parent merely looks like
// infrastructure. The work the veto exists for (background Bash, Monitors, subagents' shells) runs under claude's own
// Bash wrappers, which no registration names and the count rule never binds. A zombie (`stat` Z) holds nothing and is
// never counted. Nothing is ever exempted by its name, its group or its start time alone.
//
// One read serves the table's memory sample and the reap's step: `ps -axo pid=,ppid=,rss=,stat=,lstart=,command=` under
// the C locale and UTC (`lstart` as `procStartOf` reads it), whose first three columns are the sampler's (process-table.ts
// `parsePsTree` reads those alone).
import { execFileSync } from 'node:child_process';
import { accessSync, closeSync, constants, openSync, readSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { InfrastructureRecord } from '@shared/engine/session-state-store';

export const PS_TREE_ARGS = ['-axo', 'pid=,ppid=,rss=,stat=,lstart=,command='] as const;
export const PS_TREE_ENV = { LC_ALL: 'C', TZ: 'UTC' } as const; // `lstart` comparable with procStartOf's

export interface TreeProcess { pid: number; ppid: number; stat: string; start: string; command: string }
export type ProcessTree = ReadonlyMap<number, TreeProcess>;
// The registrations: the bridge child's pid (the observer's hello), each stdio MCP server's argv as it runs; and (D69)
// the row's engine session ids and the roots the engine loaded sminos from (its system/init's plugins; none yet before
// the first turn), which the bridge by argv is matched against, and when the launch's first turn started (null before
// any), before which no child of the engine is the model's work.
export interface Registered {
  pids: ReadonlySet<number>;
  mcpCommands: readonly (readonly string[])[];
  sessionIds?: ReadonlySet<string>;
  sminosRoots?: readonly string[];
  firstTurnAt?: string | null;
}
// A binding as the state file keeps it for an adopter (D69): the process, and what it was bound as.
export interface Binding { pid: number; start: string; kind: 'server' | 'bridge' }
// What a fresh `mcp_status` says of the launch's stdio servers (the count rule's input).
export interface StdioServers { connected: number; pending: number }

const LSTART = '[A-Z][a-z]{2} [A-Z][a-z]{2} [ \\d]\\d \\d\\d:\\d\\d:\\d\\d \\d{4}';
const LINE = new RegExp(`^\\s*(\\d+)\\s+(\\d+)\\s+\\d+(?:\\s+(\\S+)(?:\\s+(${LSTART}))?(?:\\s+(.*))?)?\\s*$`);

// A line without `lstart` (a test's tree) reads with an empty start, which compares equal to itself.
export function parseTree(output: string): ProcessTree {
  const tree = new Map<number, TreeProcess>();
  for (const line of output.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    tree.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), stat: m[3] ?? '', start: m[4] ?? '', command: m[5] ?? '' });
  }
  return tree;
}

// The tree as it is now, read synchronously (the reap's step: about 50 ms on a Mac with 850 processes, at a rare event).
// Throws when `ps` fails, which the caller reads as unreadable, never as zero.
export function readTreeSync(): string {
  return execFileSync('/bin/ps', PS_TREE_ARGS, { encoding: 'utf8', env: PS_TREE_ENV, timeout: 5_000, maxBuffer: 64 * 1024 * 1024 });
}

// D52: the argv a stdio server's process carries as the kernel ran it. The engine resolves `command` through the launch's
// PATH (the launch plan's environment, never the host's own; no realpath: each directory joined with the name, the first
// executable file wins; a name with a slash is taken as given, against the engine's cwd). A file starting `#!` runs as
// its interpreter line, then that path, then the configured args; `#!/usr/bin/env X [args]` runs as `X [args]` (env's own
// exec). Anything unresolvable or unreadable is matched as configured. The session reads it once per registration.
export function expectedArgv(argv: readonly string[], launch: { path: string | undefined; cwd: string }): string[] {
  const [command, ...args] = argv;
  if (command === undefined || command === '') return [...argv];
  const shown = command.includes('/') ? command : (launch.path ?? '/usr/bin:/bin').split(':').map((dir) => `${dir === '' ? '.' : dir}/${command}`).find((candidate) => executable(resolve(launch.cwd, candidate)));
  if (shown === undefined) return [...argv];
  const line = shebangOf(isAbsolute(shown) ? shown : resolve(launch.cwd, shown));
  if (line === null) return [...argv];
  const [interpreter, ...interpreterArgs] = line;
  if (basename(interpreter!) === 'env' && interpreterArgs.length > 0 && !interpreterArgs[0]!.startsWith('-')) return [...interpreterArgs, shown, ...args];
  return [interpreter!, ...interpreterArgs, shown, ...args];
}

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

// The interpreter line's words, or null when the file does not start `#!` or cannot be read.
function shebangOf(file: string): string[] | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(512);
    const text = head.subarray(0, readSync(fd, head, 0, head.length, 0)).toString('utf8');
    if (!text.startsWith('#!')) return null;
    const words = text.slice(2).split('\n')[0]!.trim().split(/\s+/).filter(Boolean);
    return words.length > 0 ? words : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

// A process's command line (`ps` joins argv with spaces) against an argv: argv0 by its basename (env and the kernel name
// an interpreter as they found it), every word after it exactly. What is left before those words is argv0 alone: one
// word, or the configured argv0 itself when that has a space.
export function matchesArgv(command: string, argv: readonly string[]): boolean {
  const [argv0, ...words] = argv;
  if (argv0 === undefined) return false;
  const rest = words.join(' ');
  if (rest !== '' && !command.endsWith(` ${rest}`)) return false;
  const head = rest === '' ? command : command.slice(0, command.length - rest.length - 1);
  if (head === argv0) return true;
  return head !== '' && !head.includes(' ') && basename(head) === basename(argv0);
}

// claude's own Bash wrapper, the process every Bash a tool runs (foreground, background, a Monitor, a subagent's) starts
// as: `<shell> -c source <config>/shell-snapshots/snapshot-<shell>-….sh …` (M0 Q4; the owner's tree). It is work like any
// unbound process; the shape only keeps it out of what the count rule and the bridge rule may bind.
export const isBashWrapper = (command: string): boolean => /^(?:\S*\/)?(?:bash|zsh|sh|dash|ksh) -c (?:source|\.) \S*\/shell-snapshots\/snapshot-/.test(command);

// D69: the sminos bridge of a process whose bridge never says the observer's hello, as its mod spawns it
// (`<root>/skills/sminos/scripts/sminos bridge --session <S> [--launch=<id>] [--lane <verdict>]`, a bash launcher that
// execs `<python> …/sminos.py bridge --session <S> …`, so the process reads `sminos.py` after the exec and `sminos` only
// before it). The plugin's own script, first or second (after its interpreter, whatever that interpreter's path):
// `<root>/skills/sminos/scripts/sminos` or `sminos.py` for a root the engine loaded sminos from, or, before the engine has
// said where (its first system/init), any path ending so; then `bridge --session S` with S one of the row's engine
// session ids, then anything. Never a Bash wrapper, whose command line can carry the same words. A path with a space in
// it is not matched: its process stays work.
const SMINOS_SCRIPT = /\/skills\/sminos\/scripts\/sminos(?:\.py)?$/;
export function isBridgeOf(command: string, sessionIds: ReadonlySet<string>, roots: readonly string[] = []): boolean {
  if (sessionIds.size === 0 || isBashWrapper(command)) return false;
  const words = command.split(' ');
  const script = (word: string): boolean => (roots.length === 0 ? SMINOS_SCRIPT.test(word) : roots.some((root) => word === `${root}/skills/sminos/scripts/sminos` || word === `${root}/skills/sminos/scripts/sminos.py`));
  return [0, 1].some((at) => script(words[at] ?? '') && words[at + 1] === 'bridge' && words[at + 2] === '--session' && sessionIds.has(words[at + 3] ?? ''));
}

interface Identity { pid: number; start: string; ppid: number }
const same = (identity: Identity, p: TreeProcess | undefined): p is TreeProcess => p !== undefined && p.start === identity.start && p.ppid === identity.ppid;

// One engine's registered infrastructure across reads: each registration bound to one process by identity (its pid, its
// start time and its parent, `claude`), from the read that finds it as claude's child. Reads are numbered at their start
// (`read`); one older than the newest applied (an asynchronous sample whose `ps` began before a synchronous step's) is a
// view of the past: it neither binds nor retires anything and is not counted (null), so its caller keeps what it has.
export class Infrastructure {
  private readonly servers = new Map<number, Identity>(); // by command line: a server's index in the registration -> its process
  private serversKey = '';
  private readonly counted = new Map<number, Identity>(); // by count, or restored: a server's process by its pid (D69)
  private readonly bridges = new Map<number, Identity | null>(); // a named pid -> the process first found there (null: gone)
  private bridgeArgv: Identity | null = null; // D69: the bridge bound by its argv while no hello names a pid
  private restored: Binding[] | null; // an adopter's: bound at the first read, each only if the same process is there
  private newest = -Infinity;
  private unbound: TreeProcess[] = []; // the last applied read's unbound direct children that are not Bash wrappers
  private unboundEarly = false; // and whether each of them started inside the engine's spawn window
  private savedKey: string;

  constructor(restored: readonly Binding[] = []) {
    this.restored = restored.length > 0 ? [...restored] : null;
    this.savedKey = keyOf(restored);
  }

  // The processes under `claudePid` that are its work; null for a read older than the newest applied.
  count(tree: ProcessTree, claudePid: number, registered: Registered, read?: number): number | null {
    if (!this.applies(read)) return null;
    return walk(tree, claudePid, this.bind(tree, claudePid, registered));
  }

  // D69's count rule over a read taken after a fresh `mcp_status` (`stdio`): with no stdio server pending, the unbound
  // direct children that are not Bash wrappers are bound as servers when they and the servers already bound are exactly
  // as many as the connected stdio servers. Then the work under `claudePid`, as `count` reads it.
  settle(tree: ProcessTree, claudePid: number, registered: Registered, stdio: StdioServers, read?: number): number | null {
    if (!this.applies(read)) return null;
    const bound = this.bind(tree, claudePid, registered);
    if (stdio.pending === 0 && this.countable && this.servers.size + this.counted.size + this.unbound.length === stdio.connected) {
      for (const p of this.unbound) {
        this.counted.set(p.pid, { pid: p.pid, start: p.start, ppid: p.ppid });
        bound.add(p.pid);
      }
      this.unbound = [];
    }
    return walk(tree, claudePid, bound);
  }

  // The last applied read's direct children of `claude` that no registration names and that are not Bash wrappers.
  get unnamed(): readonly TreeProcess[] {
    return this.unbound;
  }

  // Whether a count could bind them: there are some, and each started within SERVER_SPAWN_WINDOW_MS of `claude` itself
  // (what the caller asks `mcp_status` about).
  get countable(): boolean {
    return this.unbound.length > 0 && this.unboundEarly;
  }

  // The bindings an adopter would restore: every server's process and the argv-bound bridge (a hello's bridge is named
  // again by the observer's next hello).
  bindings(): Binding[] {
    return [
      ...[...this.servers.values(), ...this.counted.values()].map(({ pid, start }) => ({ pid, start, kind: 'server' as const })),
      ...(this.bridgeArgv === null ? [] : [{ pid: this.bridgeArgv.pid, start: this.bridgeArgv.start, kind: 'bridge' as const }]),
    ];
  }

  // The bindings when they changed since the last call (or the restored set), else null: what the caller saves.
  changed(): Binding[] | null {
    const bindings = this.bindings();
    const key = keyOf(bindings);
    if (key === this.savedKey) return null;
    this.savedKey = key;
    return bindings;
  }

  private applies(read: number | undefined): boolean {
    if (read === undefined) return true;
    if (read < this.newest) return false;
    this.newest = read;
    return true;
  }

  private bind(tree: ProcessTree, claudePid: number, registered: Registered): Set<number> {
    const bound = new Set<number>();
    const live = (identity: Identity): TreeProcess | null => {
      const p = tree.get(identity.pid);
      return same(identity, p) && !p.stat.startsWith('Z') ? p : null;
    };
    for (const pid of [...this.bridges.keys()]) if (!registered.pids.has(pid)) this.bridges.delete(pid);
    for (const pid of registered.pids) {
      const p = tree.get(pid);
      const identity = this.bridges.get(pid);
      if (identity === undefined) {
        if (p !== undefined && p.ppid === claudePid) this.bridges.set(pid, { pid, start: p.start, ppid: p.ppid }); // bound at the first read that finds it under claude
      } else if (identity !== null && !same(identity, p)) {
        this.bridges.set(pid, null); // gone or re-parented: neither it nor a process at its pid later is the bridge
      }
      if (this.bridges.get(pid) && p !== undefined) bound.add(pid);
    }
    if (this.restored !== null) {
      for (const { pid, start, kind } of this.restored) {
        const p = tree.get(pid);
        if (p === undefined || p.start !== start || p.ppid !== claudePid || p.stat.startsWith('Z')) continue;
        if (kind === 'server') this.counted.set(pid, { pid, start, ppid: claudePid });
        else if (kind === 'bridge') this.bridgeArgv = { pid, start, ppid: claudePid };
      }
      this.restored = null;
    }
    const key = JSON.stringify(registered.mcpCommands);
    if (key !== this.serversKey) {
      this.servers.clear();
      this.serversKey = key;
    }
    for (const [i, identity] of this.servers) {
      const p = live(identity);
      if (p === null) this.servers.delete(i);
      else bound.add(p.pid);
    }
    for (const [pid, identity] of this.counted) {
      if (live(identity) === null) this.counted.delete(pid);
      else bound.add(pid);
    }
    // D69: the bridge by its argv, superseded by any hello that names a pid; one process at a time
    // (and while it still reads as the bridge: once the engine names sminos's root, a process elsewhere is no bridge)
    const isBridge = (command: string): boolean => isBridgeOf(command, registered.sessionIds ?? NO_IDS, registered.sminosRoots ?? []);
    if (this.bridgeArgv !== null) {
      const p = live(this.bridgeArgv);
      if (registered.pids.size > 0 || p === null || !isBridge(p.command)) this.bridgeArgv = null;
    }
    const children = [...tree.values()].filter((p) => p.ppid === claudePid && !p.stat.startsWith('Z'));
    if (registered.pids.size === 0 && this.bridgeArgv === null) {
      const p = children.find((child) => !bound.has(child.pid) && isBridge(child.command));
      if (p !== undefined) this.bridgeArgv = { pid: p.pid, start: p.start, ppid: p.ppid };
    }
    if (this.bridgeArgv !== null) bound.add(this.bridgeArgv.pid);
    // by command line: a process bound by count (or restored) that matches a server's argv takes that server's index, so a
    // second process matching it while the first lives stays work
    registered.mcpCommands.forEach((argv, i) => {
      if (this.servers.has(i)) return;
      const matching = children.filter((child) => (!bound.has(child.pid) || this.counted.has(child.pid)) && matchesArgv(child.command, argv));
      const p = matching.find((child) => this.counted.has(child.pid)) ?? matching[0];
      if (p === undefined) return;
      this.counted.delete(p.pid);
      this.servers.set(i, { pid: p.pid, start: p.start, ppid: p.ppid });
      bound.add(p.pid);
    });
    this.unbound = children.filter((p) => !bound.has(p.pid) && !isBashWrapper(p.command));
    const born = startMs(tree.get(claudePid)?.start ?? '');
    const turn = registered.firstTurnAt ? Date.parse(registered.firstTurnAt) : NaN;
    const turnSecond = Number.isNaN(turn) ? Infinity : Math.floor(turn / 1000) * 1000; // lstart counts whole seconds
    this.unboundEarly = born !== null && this.unbound.every((p) => {
      const at = startMs(p.start);
      return at !== null && at - born <= SERVER_SPAWN_WINDOW_MS && at <= turnSecond;
    });
    return bound;
  }
}

// D69: the engine spawns its stdio servers at its own start (under a second after it, the veto probe's b), before any
// turn, and a server it starts later (a reconnect, a toggle, a plugin reload) is never bound by count: `mcp_status` keeps
// a server whose process died `connected` (the probe's d), so after a crash the count's premise fails, and any child
// alive then would fill the dead server's place. So the count binds only children started within this of `claude` and no
// later than the launch's first turn (to lstart's second), when no model-driven child (a teammate, a hook of a turn) can
// exist yet; any other unnamed child keeps the count from binding anything.
export const SERVER_SPAWN_WINDOW_MS = 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// `lstart` under the C locale and UTC ("Mon Nov  2 14:26:56 2026") in ms; null for anything else (a test's empty start).
function startMs(start: string): number | null {
  const m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(start);
  const month = m === null ? -1 : MONTHS.indexOf(m[1]!);
  return m === null || month < 0 ? null : Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

// D69: what the state file kept for the adopted launch, as bindings: nothing for another launch's record, and no process
// of a kind this build does not know.
export function restoredBindings(record: InfrastructureRecord | null, launchId: string): Binding[] {
  if (record === null || record.launch !== launchId) return [];
  return record.processes.flatMap(({ pid, start, kind }) => (kind === 'server' || kind === 'bridge' ? [{ pid, start, kind }] : []));
}

const NO_IDS: ReadonlySet<string> = new Set();
const keyOf = (bindings: readonly Binding[]): string => bindings.map((b) => `${b.kind}:${b.pid}@${b.start}`).sort().join(',');

// The processes under `claudePid` that are its work, from a single read (no binding carried over).
export function countWork(tree: ProcessTree, claudePid: number, registered: Registered): number {
  return new Infrastructure().count(tree, claudePid, registered)!;
}

// Every descendant but the bound processes and their subtrees, and but zombies. A `claudePid` the tree does not list has
// nothing under it.
function walk(tree: ProcessTree, claudePid: number, bound: ReadonlySet<number>): number {
  const children = new Map<number, TreeProcess[]>();
  for (const p of tree.values()) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  let work = 0;
  const seen = new Set<number>([claudePid]);
  const stack = [...(children.get(claudePid) ?? [])];
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    if (bound.has(p.pid)) continue; // and its subtree with it (D52)
    if (!p.stat.startsWith('Z')) work += 1;
    stack.push(...(children.get(p.pid) ?? []));
  }
  return work;
}
