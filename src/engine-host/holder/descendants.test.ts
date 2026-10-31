// O16 M5 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; D17, D48): the descendant veto.
// Every process under `claude` is work unless it is registered infrastructure: the bridge child its observer named by
// pid, or a direct child whose command line equals a stdio MCP server's of the launch, and what either runs. The trees
// below are shaped as M0 recorded them (spikes/protocol-probe/findings-p5-o16-holder.txt Q4): MCP servers and the
// bridge as direct children in claude's group, every Bash a wrapper leading its own group and session with its
// command under it, a zombie left by the engine.
import { describe, expect, it } from 'vitest';
import { countWork, parseTree, PS_TREE_ARGS } from './descendants';

const CLAUDE = 500;
const MCP: string[][] = [['/usr/bin/node', '/tmp/o16-mcp.mjs', 'user'], ['/usr/bin/node', '/tmp/o16-mcp.mjs', 'flag']];
const line = (pid: number, ppid: number, stat: string, command: string, rss = 1024) => `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(rss).padStart(6)} ${stat.padEnd(4)} ${command}`;
const RESTING = [
  line(1, 0, 'Ss', '/sbin/launchd'),
  line(400, 1, 'Ss', '/Applications/MAWS.app/Contents/MacOS/MAWS --detached /x/supervisor'),
  line(CLAUDE, 400, 'Ss', '/Users/u/.local/bin/claude --output-format stream-json --verbose'),
  line(501, CLAUDE, 'S', '/usr/bin/node /tmp/o16-mcp.mjs user'),
  line(502, CLAUDE, 'S', '/usr/bin/node /tmp/o16-mcp.mjs flag'),
  line(503, CLAUDE, 'S', 'python3 /plugins/sminos/sminos.py bridge --session s-1 --launch=l-1'),
  line(900, 1, 'S', 'sleep 900'), // not under claude
];
const tree = (...extra: string[]) => parseTree([...RESTING, ...extra].join('\n'));
const registered = { pids: new Set([503]), mcpCommands: MCP };

describe('the process tree', () => {
  it('reads the columns the table samples: pid, ppid, rss, stat and the whole command line', () => {
    expect(PS_TREE_ARGS).toEqual(['-axo', 'pid=,ppid=,rss=,stat=,command=']);
    const t = parseTree(line(10, 1, 'S+', '/bin/bash -c source /x/snapshot.sh && eval \'sleep 600\''));
    expect(t.get(10)).toEqual({ pid: 10, ppid: 1, stat: 'S+', command: '/bin/bash -c source /x/snapshot.sh && eval \'sleep 600\'' });
  });

  it('a line with only the memory sampler’s three columns reads as a process with no state and no command', () => {
    expect(parseTree('  100     1   1000\n').get(100)).toEqual({ pid: 100, ppid: 1, stat: '', command: '' });
  });
});

describe('countWork', () => {
  it('a resting tree holds no work: the MCP servers by command line and the bridge child by pid', () => {
    expect(countWork(tree(), CLAUDE, registered)).toBe(0);
  });

  it('without the bridge child’s pid it is work, and so is a server the launch did not configure', () => {
    expect(countWork(tree(), CLAUDE, { pids: new Set(), mcpCommands: MCP })).toBe(1);
    expect(countWork(tree(), CLAUDE, { pids: new Set([503]), mcpCommands: [MCP[0]!] })).toBe(1);
  });

  it('the command line must equal the server’s argument for argument', () => {
    expect(countWork(tree(), CLAUDE, { pids: new Set([503]), mcpCommands: [['/usr/bin/node', '/tmp/o16-mcp.mjs'], ['/usr/bin/node', '/tmp/o16-mcp.mjs', 'flag', 'x']] })).toBe(2);
  });

  it('a background Bash is work: its wrapper (a group and session of its own) and the command under it', () => {
    const t = tree(line(600, CLAUDE, 'Ss', '/bin/bash -c source /x/snapshot-bash.sh && eval \'sleep 600\''), line(601, 600, 'S', 'sleep 600'));
    expect(countWork(t, CLAUDE, registered)).toBe(2);
  });

  it('a same-group sleep under claude is work', () => {
    expect(countWork(tree(line(610, CLAUDE, 'S', 'sleep 300')), CLAUDE, registered)).toBe(1);
  });

  it('a process matching a server’s command line deeper than claude’s children is work: only a direct child is a server', () => {
    const t = tree(line(620, CLAUDE, 'Ss', '/bin/bash -c x'), line(621, 620, 'S', '/usr/bin/node /tmp/o16-mcp.mjs user'));
    expect(countWork(t, CLAUDE, registered)).toBe(2);
  });

  it('what a registered process runs is infrastructure too (a server started through a launcher, the bridge’s own child)', () => {
    const t = tree(line(630, 501, 'S', '/usr/bin/node /tmp/server-worker.mjs'), line(631, 503, 'S', 'python3 -c helper'));
    expect(countWork(t, CLAUDE, registered)).toBe(0);
  });

  it('a zombie is not work, at any depth', () => {
    expect(countWork(tree(line(640, CLAUDE, 'Z', '[2.1.316] <defunct>')), CLAUDE, registered)).toBe(0);
    expect(countWork(tree(line(650, CLAUDE, 'Ss', '/bin/bash -c x'), line(651, 650, 'Z+', '<defunct>')), CLAUDE, registered)).toBe(1);
  });

  it('a claude the tree does not list has nothing under it', () => {
    expect(countWork(tree(), 4242, registered)).toBe(0);
  });

  it('a cycle in a malformed read ends', () => {
    const t = parseTree([line(CLAUDE, 701, 'S', 'claude'), line(701, CLAUDE, 'S', 'loop')].join('\n'));
    expect(countWork(t, CLAUDE, { pids: new Set(), mcpCommands: [] })).toBe(1);
  });
});
