// O16 M5: the descendant veto (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; D17, D48).
// Every process under `claude` counts as the session's work unless it is registered infrastructure: the sminos bridge
// child, named by pid in its observer's gate `hello`, and a direct child of `claude` whose command line equals a stdio
// MCP server of the launch (`mcp_status`'s `config.{command, args}`, M0's question 4), argument for argument as `ps`
// prints them (space-joined). What a registered process runs is infrastructure too: it is the server's or the bridge's,
// never a tool's, which always runs under `claude` itself. A zombie (`stat` Z) holds nothing and is never counted. A
// process neither registration names is work; M0 found nothing else under a resting `-p` session but transient startup
// children, so an unnamed one is a finding that extends the registration with evidence, never a rule by group or start
// time (a Bash a tool runs leads a group and session of its own, so only the tree sees it).
//
// One read serves the table's memory sample and the reap's step: `ps -axo pid=,ppid=,rss=,stat=,command=`, whose first
// three columns are the sampler's (process-table.ts `parsePsTree` reads those alone).
import { execFileSync } from 'node:child_process';

export const PS_TREE_ARGS = ['-axo', 'pid=,ppid=,rss=,stat=,command='] as const;

export interface TreeProcess { pid: number; ppid: number; stat: string; command: string }
export type ProcessTree = ReadonlyMap<number, TreeProcess>;
export interface Registered { pids: ReadonlySet<number>; mcpCommands: readonly (readonly string[])[] }

const LINE = /^\s*(\d+)\s+(\d+)\s+\d+(?:\s+(\S+)(?:\s+(.*))?)?\s*$/;

export function parseTree(output: string): ProcessTree {
  const tree = new Map<number, TreeProcess>();
  for (const line of output.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    tree.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), stat: m[3] ?? '', command: m[4] ?? '' });
  }
  return tree;
}

// The tree as it is now, read synchronously (the reap's step: about 50 ms on a Mac with 850 processes, at a rare event).
// Throws when `ps` fails, which the caller reads as unreadable, never as zero.
export function readTreeSync(): string {
  return execFileSync('/bin/ps', PS_TREE_ARGS, { encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024 * 1024 });
}

// The processes under `claudePid` that are its work: every descendant but the registered infrastructure and what it
// runs, and but zombies. A `claudePid` the tree does not list has nothing under it.
export function countWork(tree: ProcessTree, claudePid: number, registered: Registered): number {
  const children = new Map<number, TreeProcess[]>();
  for (const p of tree.values()) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p]);
  const servers = new Set(registered.mcpCommands.map((argv) => argv.join(' ')));
  const infrastructure = (p: TreeProcess): boolean => registered.pids.has(p.pid) || (p.ppid === claudePid && servers.has(p.command));
  let work = 0;
  const seen = new Set<number>([claudePid]);
  const stack = [...(children.get(claudePid) ?? [])];
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (seen.has(p.pid)) continue;
    seen.add(p.pid);
    if (infrastructure(p)) continue; // and its subtree with it
    if (!p.stat.startsWith('Z')) work += 1;
    stack.push(...(children.get(p.pid) ?? []));
  }
  return work;
}
