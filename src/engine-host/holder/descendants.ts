// O16 M5: the descendant veto (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; D17, D48, D52).
// Every process under `claude` counts as the session's work unless it is registered infrastructure, bound by identity
// (its pid and its start time, as supervisor-files.ts `procStartOf` reads it): the sminos bridge child its observer's
// gate `hello` named by pid, and, for each stdio MCP server of the launch (`mcp_status`'s `config.{command, args}`, M0's
// question 4), one direct child of `claude` whose command line is the server's as the kernel ran it (`expectedArgv`).
// A server's binding lasts while that process lives as a child of `claude`; one gone (or re-parented) frees the server
// for its next process, and a second process matching a server while the first lives is work. The bridge's binding is
// the process first found at the named pid, never another one there after it, until a hello names another pid.
//
// D52: the subtree of a bound process is infrastructure too (npx, uvx and their like run the real server as a child of
// the registered process); the bound process is the only way in, never a process whose parent merely looks like
// infrastructure. The work the veto exists for (background Bash, Monitors, subagents' shells) runs under claude's own
// Bash wrappers, which no registration names. A zombie (`stat` Z) holds nothing and is never counted. M0 found nothing
// else under a resting `-p` session but transient startup children, so an unnamed one is a finding that extends the
// registration with evidence, never a rule by group or start time (a Bash a tool runs leads a group and session of its
// own, so only the tree sees it).
//
// One read serves the table's memory sample and the reap's step: `ps -axo pid=,ppid=,rss=,stat=,lstart=,command=` under
// the C locale and UTC (`lstart` as `procStartOf` reads it), whose first three columns are the sampler's (process-table.ts
// `parsePsTree` reads those alone).
import { execFileSync } from 'node:child_process';
import { accessSync, closeSync, constants, openSync, readSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export const PS_TREE_ARGS = ['-axo', 'pid=,ppid=,rss=,stat=,lstart=,command='] as const;
export const PS_TREE_ENV = { LC_ALL: 'C', TZ: 'UTC' } as const; // `lstart` comparable with procStartOf's

export interface TreeProcess { pid: number; ppid: number; stat: string; start: string; command: string }
export type ProcessTree = ReadonlyMap<number, TreeProcess>;
// The registrations: the bridge child's pid (the observer's hello) and each stdio MCP server's argv as it runs.
export interface Registered { pids: ReadonlySet<number>; mcpCommands: readonly (readonly string[])[] }

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

interface Identity { pid: number; start: string }
const same = (identity: Identity, p: TreeProcess | undefined): p is TreeProcess => p !== undefined && p.start === identity.start;

// One engine's registered infrastructure across reads: each registration bound to one process by identity.
export class Infrastructure {
  private readonly servers = new Map<number, Identity>(); // a server's index in the registration -> its process
  private serversKey = '';
  private readonly bridges = new Map<number, Identity | null>(); // a named pid -> the process first found there (null: gone)

  // The processes under `claudePid` that are its work.
  count(tree: ProcessTree, claudePid: number, registered: Registered): number {
    return walk(tree, claudePid, this.bind(tree, claudePid, registered));
  }

  private bind(tree: ProcessTree, claudePid: number, registered: Registered): Set<number> {
    const bound = new Set<number>();
    for (const pid of [...this.bridges.keys()]) if (!registered.pids.has(pid)) this.bridges.delete(pid);
    for (const pid of registered.pids) {
      const p = tree.get(pid);
      const identity = this.bridges.get(pid);
      if (identity === undefined) {
        if (p !== undefined) this.bridges.set(pid, { pid, start: p.start }); // bound at the first read that finds it
      }
      else if (identity !== null && !same(identity, p)) this.bridges.set(pid, null); // gone: a process at its pid later is not it
      if (this.bridges.get(pid) && p !== undefined) bound.add(pid);
    }
    const key = JSON.stringify(registered.mcpCommands);
    if (key !== this.serversKey) {
      this.servers.clear();
      this.serversKey = key;
    }
    for (const [i, identity] of this.servers) {
      const p = tree.get(identity.pid);
      if (!same(identity, p) || p.ppid !== claudePid || p.stat.startsWith('Z')) this.servers.delete(i);
      else bound.add(p.pid);
    }
    const children = [...tree.values()].filter((p) => p.ppid === claudePid && !p.stat.startsWith('Z'));
    registered.mcpCommands.forEach((argv, i) => {
      if (this.servers.has(i)) return;
      const p = children.find((child) => !bound.has(child.pid) && matchesArgv(child.command, argv));
      if (p === undefined) return;
      this.servers.set(i, { pid: p.pid, start: p.start });
      bound.add(p.pid);
    });
    return bound;
  }
}

// The processes under `claudePid` that are its work, from a single read (no binding carried over).
export function countWork(tree: ProcessTree, claudePid: number, registered: Registered): number {
  return new Infrastructure().count(tree, claudePid, registered);
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
