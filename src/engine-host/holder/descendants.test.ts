// O16 M5 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M5 and Interfaces §F; D17, D48): the descendant veto.
// Every process under `claude` is work unless it is registered infrastructure: the bridge child its observer named by
// pid, or a direct child whose command line equals a stdio MCP server's of the launch, and what either runs. The trees
// below are shaped as M0 recorded them (spikes/protocol-probe/findings-p5-o16-holder.txt Q4): MCP servers and the
// bridge as direct children in claude's group, every Bash a wrapper leading its own group and session with its
// command under it, a zombie left by the engine.
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countWork, expectedArgv, Infrastructure, isBashWrapper, matchesArgv, parseTree, PS_TREE_ARGS, readTreeSync, restoredBindings, SERVER_SPAWN_WINDOW_MS } from './descendants';

const CLAUDE = 500;
const MCP: string[][] = [['/usr/bin/node', '/tmp/o16-mcp.mjs', 'user'], ['/usr/bin/node', '/tmp/o16-mcp.mjs', 'flag']];
const line = (pid: number, ppid: number, stat: string, command: string, rss = 1024) => `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(rss).padStart(6)} ${stat.padEnd(4)} ${command}`;
const START = 'Sat Oct 31 13:18:40 2026';
const LATER = 'Sat Oct 31 14:02:07 2026';
// macOS and Linux: /bin/ps with the BSD-style `-axo` columns (procps reads `-axo` through its BSD parser) and `lstart` in
// one format ("%a %b %e %H:%M:%S %Y" under the C locale), and the kernel's exec of a `#!` file; the cases on real processes
// run on both (mawsd's server role runs on Linux) and skip elsewhere.
const NO_LIVE_PS = process.platform !== 'darwin' && process.platform !== 'linux';
const lined = (pid: number, ppid: number, start: string, command: string) => `${String(pid).padStart(5)} ${String(ppid).padStart(5)}   1024 S    ${start}     ${command}`;
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
  it('reads the columns the table samples: pid, ppid, rss, stat, the start time and the whole command line', () => {
    expect(PS_TREE_ARGS).toEqual(['-axo', 'pid=,ppid=,rss=,stat=,lstart=,command=']);
    const t = parseTree(`${lined(10, 1, START, '/bin/bash -c source /x/snapshot.sh && eval \'sleep 600\'')}\n${lined(11, 1, 'Thu Jan  1 00:00:12 1970', '/sbin/launchd')}`);
    expect(t.get(10)).toEqual({ pid: 10, ppid: 1, stat: 'S', start: START, command: '/bin/bash -c source /x/snapshot.sh && eval \'sleep 600\'' });
    expect(t.get(11)).toMatchObject({ start: 'Thu Jan  1 00:00:12 1970', command: '/sbin/launchd' }); // as procStartOf reads it
  });

  it('a line without a start time reads with an empty one; with only the sampler’s three columns, no state and no command', () => {
    expect(parseTree(line(10, 1, 'S+', 'sleep 1')).get(10)).toEqual({ pid: 10, ppid: 1, stat: 'S+', start: '', command: 'sleep 1' });
    expect(parseTree('  100     1   1000\n').get(100)).toEqual({ pid: 100, ppid: 1, stat: '', start: '', command: '' });
  });

  it('reads this machine’s tree, this process with its start time and command line', { skip: NO_LIVE_PS }, () => {
    expect(parseTree(readTreeSync()).get(process.pid)).toMatchObject({ pid: process.pid, start: expect.stringMatching(/^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d \d{4}$/) });
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

  it('D52: what a registered process runs is infrastructure too (a server started through a launcher, the bridge’s own child)', () => {
    const t = tree(line(630, 501, 'S', '/usr/bin/node /tmp/server-worker.mjs'), line(631, 503, 'S', 'python3 -c helper'));
    expect(countWork(t, CLAUDE, registered)).toBe(0);
  });

  it('D52: a Bash wrapper’s sleep still counts beside a registered server’s grandchild, which does not', () => {
    const t = tree(
      line(660, CLAUDE, 'Ss', '/bin/zsh -c source /x/snapshot-zsh.sh && eval \'sleep 600\''), line(661, 660, 'S', 'sleep 600'),
      line(662, 501, 'S', 'npm exec o16-mcp'), line(663, 662, 'S', 'node /x/o16-mcp/server.js'),
    );
    expect(countWork(t, CLAUDE, registered)).toBe(2);
  });

  it('a second process matching a server’s command line while the first lives is work: one process per registration', () => {
    expect(countWork(tree(line(670, CLAUDE, 'S', '/usr/bin/node /tmp/o16-mcp.mjs user'), line(671, 670, 'S', 'sleep 9')), CLAUDE, registered)).toBe(2);
  });
});

describe('the registration is bound by identity, pid and start time', () => {
  const registration = { pids: new Set<number>(), mcpCommands: [MCP[0]!] };
  const at = (...lines: string[]) => parseTree([lined(CLAUDE, 1, START, 'claude'), ...lines].join('\n'));

  it('a server keeps its binding while it lives; gone, its pid taken by another process, that one is work until it matches as a new server', () => {
    const infra = new Infrastructure();
    expect(infra.count(at(lined(501, CLAUDE, START, MCP[0]!.join(' '))), CLAUDE, registration)).toBe(0);
    expect(infra.count(at(lined(501, CLAUDE, LATER, 'sleep 600')), CLAUDE, registration)).toBe(1); // the pid reused
    expect(infra.count(at(lined(501, CLAUDE, LATER, 'sleep 600'), lined(502, CLAUDE, LATER, MCP[0]!.join(' '))), CLAUDE, registration)).toBe(1); // restarted: 502 bound
  });

  it('a server that re-parents loses its binding, and its subtree goes with it', () => {
    const infra = new Infrastructure();
    expect(infra.count(at(lined(501, CLAUDE, START, MCP[0]!.join(' ')), lined(510, 501, START, 'worker')), CLAUDE, registration)).toBe(0);
    expect(infra.count(at(lined(501, 1, START, MCP[0]!.join(' ')), lined(510, 501, START, 'worker')), CLAUDE, registration)).toBe(0); // not under claude
    expect(infra.count(at(lined(501, 1, START, MCP[0]!.join(' ')), lined(530, CLAUDE, LATER, MCP[0]!.join(' '))), CLAUDE, registration)).toBe(0); // the next one is bound
  });

  it('the bridge is the process first found at its named pid; another process at that pid later is work', () => {
    const infra = new Infrastructure();
    const bridge = { pids: new Set([503]), mcpCommands: [] };
    expect(infra.count(at(lined(503, CLAUDE, START, 'python3 sminos.py bridge')), CLAUDE, bridge)).toBe(0);
    expect(infra.count(at(), CLAUDE, bridge)).toBe(0);
    expect(infra.count(at(lined(503, CLAUDE, LATER, '/bin/bash -c sleep 600')), CLAUDE, bridge)).toBe(1);
    expect(infra.count(at(lined(503, CLAUDE, LATER, '/bin/bash -c sleep 600')), CLAUDE, { pids: new Set([504]), mcpCommands: [] })).toBe(1); // a hello naming another pid
  });

  it('a bridge that re-parents loses its exemption: moved under an unregistered wrapper, it counts with its subtree', () => {
    const infra = new Infrastructure();
    const bridge = { pids: new Set([503]), mcpCommands: [] };
    expect(infra.count(at(lined(503, CLAUDE, START, 'python3 sminos.py bridge'), lined(504, 503, START, 'helper')), CLAUDE, bridge)).toBe(0);
    const moved = at(lined(600, CLAUDE, LATER, '/bin/bash -c wrap'), lined(503, 600, START, 'python3 sminos.py bridge'), lined(504, 503, START, 'helper'));
    expect(infra.count(moved, CLAUDE, bridge)).toBe(3);
    expect(infra.count(at(lined(503, CLAUDE, START, 'python3 sminos.py bridge')), CLAUDE, bridge)).toBe(1); // never again
  });

  it('a bridge first found below claude’s children is never bound: the bridge is claude’s own child (M0 Q4)', () => {
    const infra = new Infrastructure();
    expect(infra.count(at(lined(600, CLAUDE, START, '/bin/bash -c wrap'), lined(503, 600, START, 'python3 sminos.py bridge')), CLAUDE, { pids: new Set([503]), mcpCommands: [] })).toBe(2);
  });

  it('a read older than the one that set the bindings changes nothing and is not counted (null)', () => {
    const infra = new Infrastructure();
    const bridge = { pids: new Set([503]), mcpCommands: [MCP[0]!] };
    const live = at(lined(503, CLAUDE, START, 'python3 sminos.py bridge'), lined(501, CLAUDE, START, MCP[0]!.join(' ')));
    expect(infra.count(live, CLAUDE, bridge, 2)).toBe(0); // the newer read, applied first
    expect(infra.count(at(lined(530, CLAUDE, START, 'sleep 1')), CLAUDE, bridge, 1)).toBeNull(); // the older one, late
    expect(infra.count(live, CLAUDE, bridge, 3)).toBe(0); // neither binding was retired
  });

  it('a named bridge not yet in the tree is bound when a later read finds it', () => {
    const infra = new Infrastructure();
    const bridge = { pids: new Set([503]), mcpCommands: [] };
    expect(infra.count(at(), CLAUDE, bridge)).toBe(0);
    expect(infra.count(at(lined(503, CLAUDE, START, 'python3 sminos.py bridge')), CLAUDE, bridge)).toBe(0);
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

// D69 (the veto's registration after landing): the owner's server shapes as the veto probe recorded them
// (spikes/protocol-probe/fixtures/p5/p5-o16-veto-mcp[-installed].jsonl, the live MacBook's tree in the plan's D69): a
// bare command (cua's `node --disable-sigusr1 …/cua-shim.mjs`), a launcher that execs another binary (ptc's
// `…/bin/ptc-launch`, running as its venv's python), a configured absolute path, and sminos's bridge child (named by
// its observer's hello here). Every process of a server is a direct child of claude spawned within a second of claude.
describe('D69: the count rule and the restored bindings', () => {
  const SESSION = '06b89407-68e7-4316-adcd-b62748ee9b3a';
  const BORN = 'Mon Nov  2 14:26:56 2026';
  const SOON = 'Mon Nov  2 14:26:57 2026';
  const HOUR = 'Mon Nov  2 15:30:02 2026';
  const CUA = ['node', '--disable-sigusr1', '/u/.claude/plugins/cache/cua/cua/0.21.0/cua-shim.mjs'];
  const PTC = ['/u/.claude/plugins/cache/ptc-tool/ptc/0.6.1/bin/ptc-launch']; // configured; it execs into the venv's python
  const ABS = ['/usr/bin/node', '/x/server.mjs', 'flag'];
  const BRIDGE = `/Library/Frameworks/Python.framework/Versions/3.12/Resources/Python.app/Contents/MacOS/Python /u/.claude/plugins/cache/doperpowers/sminos/1.31.0/skills/sminos/scripts/sminos.py bridge --session ${SESSION} --launch=k9vHeE6YTaP3bkSm5E93tw`;
  const WRAPPER = "/opt/homebrew/bin/bash -c source /u/.claude/shell-snapshots/snapshot-bash-1793629565532-co9nny.sh 2>/dev/null || true && shopt -u extglob 2>/dev/null || true && eval 'sleep 600'";
  const owner = (...extra: string[]) => parseTree([
    lined(CLAUDE, 1, BORN, '/u/.local/share/claude/versions/2.1.316 -p --input-format stream-json'),
    lined(501, CLAUDE, BORN, CUA.join(' ')),
    lined(502, CLAUDE, BORN, '/u/.ptc/venvs/4c410075651a/bin/python -m ptc.mcp'),
    lined(503, 502, SOON, '/u/.ptc/venvs/4c410075651a/bin/python -m ipykernel_launcher'), // the server's own kernel
    lined(504, CLAUDE, SOON, ABS.join(' ')),
    lined(505, CLAUDE, SOON, BRIDGE),
    ...extra,
  ].join('\n'));
  const fresh = { pids: new Set([505]), mcpCommands: [CUA, PTC, ABS] };
  const all = { connected: 3, pending: 0 };

  it('claude’s Bash wrapper shape, and nothing else', () => {
    expect(isBashWrapper(WRAPPER)).toBe(true);
    expect(isBashWrapper("/bin/bash -c source /tmp/c/shell-snapshots/snapshot-bash-1-x.sh 2>/dev/null || true && eval 'sleep 600'")).toBe(true);
    expect(isBashWrapper('/bin/zsh -c source /u/.claude/shell-snapshots/snapshot-zsh-2-y.sh && eval x')).toBe(true);
    expect(isBashWrapper('/bin/sh -c "${CLAUDE_PLUGIN_ROOT}/hooks/smns-record.sh"')).toBe(false); // a hook
    expect(isBashWrapper('/bin/bash -c sleep 600')).toBe(false);
    expect(isBashWrapper('node /x/shell-snapshots/snapshot-bash-1.sh')).toBe(false);
  });

  it('a fresh launch: cua and the absolute server by command line, ptc by count once mcp_status settles', () => {
    const infra = new Infrastructure();
    expect(infra.count(owner(), CLAUDE, fresh)).toBe(2); // ptc's python matches no configured command line (it and its kernel)
    expect(infra.unnamed.map((p) => p.pid)).toEqual([502]);
    expect(infra.countable).toBe(true);
    expect(infra.settle(owner(), CLAUDE, fresh, { connected: 3, pending: 1 })).toBe(2); // a server still pending: nothing by count
    expect(infra.settle(owner(), CLAUDE, fresh, all)).toBe(0);
    expect(infra.count(owner(), CLAUDE, fresh)).toBe(0); // bound by identity from then on, its kernel with it (D52)
    expect(infra.bindings()).toEqual(expect.arrayContaining([{ pid: 501, start: BORN, kind: 'server' }, { pid: 502, start: BORN, kind: 'server' }, { pid: 504, start: SOON, kind: 'server' }]));
  });

  it('a background Bash keeps counting, and never stops the count from binding the servers', () => {
    const infra = new Infrastructure();
    const working = owner(lined(600, CLAUDE, HOUR, WRAPPER), lined(601, 600, HOUR, 'sleep 600'));
    infra.count(working, CLAUDE, fresh);
    expect(infra.unnamed.map((p) => p.pid)).toEqual([502]); // the wrapper is never a candidate
    expect(infra.settle(working, CLAUDE, fresh, all)).toBe(2); // the wrapper and its sleep
    expect(infra.count(owner(), CLAUDE, fresh)).toBe(0);
  });

  it('the count binds nothing while any other child is unnamed: a hook, a second server-like child, another bridge', () => {
    for (const extra of [lined(610, CLAUDE, SOON, '/bin/sh -c "${CLAUDE_PLUGIN_ROOT}/hooks/smns-record.sh"'), lined(611, CLAUDE, SOON, '/x/other-server --stdio'), lined(612, CLAUDE, SOON, BRIDGE.replace(SESSION, 'another-session'))]) {
      const infra = new Infrastructure();
      expect(infra.settle(owner(extra), CLAUDE, fresh, all)).toBe(3); // ptc, its kernel and the stranger
      expect(infra.count(owner(), CLAUDE, fresh)).toBe(2); // the stranger gone: ptc still waits for a count
      expect(infra.settle(owner(), CLAUDE, fresh, all)).toBe(0);
    }
  });

  it('the count binds nothing started past the engine’s spawn window: a server started later is bound only by its command line', () => {
    const late = parseTree([lined(CLAUDE, 1, BORN, 'claude'), lined(502, CLAUDE, HOUR, '/u/.ptc/venvs/4c41/bin/python -m ptc.mcp')].join('\n'));
    const infra = new Infrastructure();
    expect(infra.settle(late, CLAUDE, { pids: new Set(), mcpCommands: [PTC] }, { connected: 1, pending: 0 })).toBe(1);
    expect(infra.countable).toBe(false);
    expect(SERVER_SPAWN_WINDOW_MS).toBe(60_000);
    const edge = (at: string) => parseTree([lined(CLAUDE, 1, BORN, 'claude'), lined(502, CLAUDE, at, 'python -m ptc.mcp')].join('\n'));
    expect(new Infrastructure().settle(edge('Mon Nov  2 14:27:56 2026'), CLAUDE, { pids: new Set(), mcpCommands: [PTC] }, { connected: 1, pending: 0 })).toBe(0); // 60 s after
    expect(new Infrastructure().settle(edge('Mon Nov  2 14:27:57 2026'), CLAUDE, { pids: new Set(), mcpCommands: [PTC] }, { connected: 1, pending: 0 })).toBe(1); // 61 s
    expect(new Infrastructure().settle(parseTree([line(CLAUDE, 1, 'S', 'claude'), line(502, CLAUDE, 'S', 'python -m ptc.mcp')].join('\n')), CLAUDE, { pids: new Set(), mcpCommands: [PTC] }, { connected: 1, pending: 0 })).toBe(1); // no start time: never
  });

  it('the probe’s d: a bound server killed stays `connected`, and a child started after it is work, not its replacement', () => {
    const infra = new Infrastructure();
    expect(infra.settle(owner(), CLAUDE, fresh, all)).toBe(0);
    const killed = parseTree([...owner().values()].filter((p) => p.pid !== 502 && p.pid !== 503).map((p) => lined(p.pid, p.ppid, p.start, p.command)).join('\n'));
    const teammate = parseTree([...killed.values()].map((p) => lined(p.pid, p.ppid, p.start, p.command)).concat(lined(700, CLAUDE, HOUR, '/u/.local/bin/claude --teammate')).join('\n'));
    expect(infra.settle(killed, CLAUDE, fresh, all)).toBe(0);
    expect(infra.settle(teammate, CLAUDE, fresh, all)).toBe(1); // 2 bound + 1 unnamed = 3 connected, but it started late
    expect(infra.count(teammate, CLAUDE, fresh)).toBe(1);
  });

  it('an adopter restores the bindings of the same processes: a bare command and an exec’d launcher without any command line', () => {
    const rebuilt = { pids: new Set([505]), mcpCommands: [ABS] }; // a bare command dropped
    const restored = restoredBindings({ launch: 'L1', processes: [{ pid: 501, start: BORN, kind: 'server' }, { pid: 502, start: BORN, kind: 'server' }, { pid: 504, start: SOON, kind: 'server' }, { pid: 9, start: BORN, kind: 'lsp' }] }, 'L1');
    expect(restored).toHaveLength(3); // a kind this build does not know is skipped
    expect(restoredBindings({ launch: 'L0', processes: [{ pid: 501, start: BORN, kind: 'server' }] }, 'L1')).toEqual([]); // another launch's
    const infra = new Infrastructure(restored);
    expect(infra.count(owner(), CLAUDE, rebuilt)).toBe(0);
    expect(infra.changed()).toBeNull(); // nothing new to save
    expect(new Infrastructure(restored).count(owner().set(501, { pid: 501, ppid: CLAUDE, stat: 'S', start: HOUR, command: CUA.join(' ') }), CLAUDE, rebuilt)).toBe(1); // another process at that pid
  });

  it('the bindings are offered for saving when they change, and only then', () => {
    const infra = new Infrastructure();
    infra.count(owner(), CLAUDE, fresh);
    expect(infra.changed()?.map((b) => b.pid).sort()).toEqual([501, 504]);
    expect(infra.changed()).toBeNull();
    infra.settle(owner(), CLAUDE, fresh, all);
    expect(infra.changed()?.map((b) => b.pid).sort()).toEqual([501, 502, 504]);
  });
});

describe('D52: a server’s argv as the kernel runs it (expectedArgv)', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const script = (name: string, text: string, mode = 0o755) => {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'bin', name), text);
    chmodSync(join(dir, 'bin', name), mode);
    return join(dir, 'bin', name);
  };
  const fresh = () => (dir = mkdtempSync(join(tmpdir(), 'maws-argv-')));

  it('a `#!/usr/bin/env X` script found through the launch’s PATH runs as X, the path as found, then the args', () => {
    fresh();
    const file = script('o16-env', '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
    expect(expectedArgv(['o16-env', 'a', 'b'], { path: `/nonexistent:${join(dir, 'bin')}`, cwd: '/' })).toEqual(['node', file, 'a', 'b']);
  });

  it('a `#!/bin/sh -e` script runs as its interpreter line, the path, then the args', () => {
    fresh();
    const file = script('o16-sh', '#!/bin/sh -e\nsleep 600\n');
    expect(expectedArgv(['o16-sh', 'x'], { path: join(dir, 'bin'), cwd: '/' })).toEqual(['/bin/sh', '-e', file, 'x']);
  });

  it('the launch’s PATH, never the host’s: a name the launch cannot find is matched as configured', () => {
    fresh();
    script('o16-env', '#!/usr/bin/env node\n');
    expect(expectedArgv(['o16-env', 'a'], { path: '/nonexistent', cwd: '/' })).toEqual(['o16-env', 'a']);
  });

  it('the first executable file on the PATH wins; a file not executable is passed over', () => {
    fresh();
    script('o16-x', '#!/bin/sh\n', 0o644);
    mkdirSync(join(dir, 'later'));
    writeFileSync(join(dir, 'later', 'o16-x'), '#!/bin/bash\n');
    chmodSync(join(dir, 'later', 'o16-x'), 0o755);
    expect(expectedArgv(['o16-x'], { path: `${join(dir, 'bin')}:${join(dir, 'later')}`, cwd: '/' })).toEqual(['/bin/bash', join(dir, 'later', 'o16-x')]);
  });

  it('a name with a slash is taken as given (against the engine’s cwd), a relative PATH entry joined as found; a binary is matched as configured', () => {
    fresh();
    script('o16-rel', '#!/bin/sh\n');
    expect(expectedArgv(['./bin/o16-rel', 'y'], { path: undefined, cwd: dir })).toEqual(['/bin/sh', './bin/o16-rel', 'y']);
    expect(expectedArgv(['o16-rel'], { path: 'bin', cwd: dir })).toEqual(['/bin/sh', 'bin/o16-rel']);
    writeFileSync(join(dir, 'bin', 'o16-bin'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
    chmodSync(join(dir, 'bin', 'o16-bin'), 0o755);
    expect(expectedArgv(['o16-bin', '--stdio'], { path: join(dir, 'bin'), cwd: '/' })).toEqual(['o16-bin', '--stdio']);
  });

  it('matches argv0 by its basename and every word after it exactly', () => {
    expect(matchesArgv('/opt/homebrew/bin/node /x/bin/npx -y srv', ['node', '/x/bin/npx', '-y', 'srv'])).toBe(true);
    expect(matchesArgv('node /x/bin/npx -y srv', ['/usr/local/bin/node', '/x/bin/npx', '-y', 'srv'])).toBe(true);
    expect(matchesArgv('node /x/bin/npx -y srv2', ['node', '/x/bin/npx', '-y', 'srv'])).toBe(false);
    expect(matchesArgv('nodejs /x/bin/npx -y srv', ['node', '/x/bin/npx', '-y', 'srv'])).toBe(false);
    expect(matchesArgv('/usr/bin/uvx', ['uvx'])).toBe(true);
    expect(matchesArgv('/usr/bin/uvxx', ['uvx'])).toBe(false);
    expect(matchesArgv('node /x/bin/o16-server user', ['o16-server', 'user'])).toBe(false); // an interpreter before it: not argv0
    expect(matchesArgv('/Apps/My Server/bin/srv --stdio', ['/Apps/My Server/bin/srv', '--stdio'])).toBe(true);
  });
});

describe.skipIf(NO_LIVE_PS)('D52: shebang servers at rest, as real processes', () => {
  let dir: string;
  let engine: ChildProcess | null = null;
  afterEach(() => {
    if (engine?.pid !== undefined) {
      try {
        process.kill(-engine.pid, 'SIGKILL');
      } catch { /* gone */ }
    }
    engine = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('an env-node script and a /bin/sh script, spawned by name through the launch’s PATH, hold no work', async () => {
    dir = mkdtempSync(join(tmpdir(), 'maws-shebang-'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'o16-env-server'), '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n');
    writeFileSync(join(dir, 'bin', 'o16-sh-server'), '#!/bin/sh\nsleep 600 &\nwait\n');
    chmodSync(join(dir, 'bin', 'o16-env-server'), 0o755);
    chmodSync(join(dir, 'bin', 'o16-sh-server'), 0o755);
    const path = `${join(dir, 'bin')}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`; // env finds this node
    const servers = [['o16-env-server', 'user', 'two words'], ['o16-sh-server', '--stdio']];
    // a stand-in engine spawning both by name, as the engine spawns a stdio server
    engine = spawn(process.execPath, ['-e', `const { spawn } = require('node:child_process'); for (const [c, ...a] of ${JSON.stringify(servers)}) spawn(c, a, { stdio: 'ignore' }); setInterval(() => {}, 1000);`], { env: { ...process.env, PATH: path }, stdio: 'ignore', detached: true });
    const pid = engine.pid!;
    const registered = { pids: new Set<number>(), mcpCommands: servers.map((argv) => expectedArgv(argv, { path, cwd: dir })) };
    const deadline = Date.now() + 10_000;
    let tree = parseTree(readTreeSync());
    // both exec'd through to their interpreters (env's own exec done, the fork's copy of the stand-in gone), the sleep up
    const settled = (t: typeof tree) => {
      const under = [...t.values()].filter((p) => p.ppid === pid).map((p) => p.command);
      return under.length === 2 && under.some((c) => /^node \S+o16-env-server /.test(c)) && under.some((c) => /^\/bin\/sh \S+o16-sh-server /.test(c))
        && [...t.values()].some((p) => p.command === 'sleep 600' && t.get(p.ppid)?.ppid === pid);
    };
    while (!settled(tree) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      tree = parseTree(readTreeSync());
    }
    expect(settled(tree)).toBe(true);
    expect(countWork(tree, pid, registered)).toBe(0);
    expect(countWork(tree, pid, { pids: new Set(), mcpCommands: servers })).toBe(3); // as configured, neither matches
  });
});
