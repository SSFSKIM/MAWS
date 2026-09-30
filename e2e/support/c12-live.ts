// C12's live support (C12 execution document, M3 and Concrete Steps "M3 live"; C7's `c7-live.ts` shape): the gate
// (C3's: the pinned binary answering its version, ClaudeUsage's relay answering /api/hello), the scratch the shell
// exported (a `CLAUDE_CONFIG_DIR` with `{}` settings and a `MAWS_USER_DATA`, both under /private/tmp/maws-c12-*, which
// the spec passes to `launchMaws`), the fixtures that give each tree stdio MCP children as the owner's have (a
// user-scope server `c12-plain` in the scratch global config, and repository A's project server `c12-kernel`, which the
// run lists as stateful), the owner-file check and the pin's `ls -l`, an independent `ps` read of each engine tree, and
// spend from the journals' `result.total_cost_usd`. Never the owner's ~/.claude or ~/.claude.json, which are only read
// by the owner-file check.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ENGINE_BIN, ENGINE_VERSION, RELAY_URL } from '../../src/engine-host/launch';
import { assertConfigHomeSafe } from '../../test/live/support/live';
import { journal, processCost } from './c7-live';
import { REPO_ROOT } from './launch';

const SCRATCH_PREFIX = '/private/tmp/maws-c12-';
// The probe's stdio MCP server, the stand-in for the owner's servers (M3's decision: any small stdio server would do if
// this one could not serve).
export const MCP_SERVER = join(REPO_ROOT, 'spikes/protocol-probe/scenarios/pass2/elicit-mcp-server.mjs');

export function c12LiveSkipReason(): string | null {
  if (process.env.MAWS_C12_LIVE !== '1') return 'the C12 live run goes only under MAWS_C12_LIVE=1';
  if (!existsSync(ENGINE_BIN)) return `engine binary missing at ${ENGINE_BIN}`;
  const version = execFileSync(ENGINE_BIN, ['--version'], { encoding: 'utf8', timeout: 15_000 }).trim();
  if (!version.startsWith(ENGINE_VERSION)) return `engine reports ${version}, expected ${ENGINE_VERSION}`;
  const code = execFileSync('/usr/bin/curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${RELAY_URL}/api/hello`], { encoding: 'utf8' }).trim();
  return code === '200' ? null : `relay at ${RELAY_URL} answered ${code}: start ClaudeUsage`;
}

export interface C12Scratch {
  root: string; // /private/tmp/maws-c12-<run>
  config: string; // the exported CLAUDE_CONFIG_DIR
  userData: string; // the exported MAWS_USER_DATA
  repoA: string; // carries `c12-kernel` in its `.mcp.json`
  repoB: string;
}

// The exported scratch, refused unless both variables name directories under one /private/tmp/maws-c12-* root and the
// config home's user settings are `{}`; the fixtures are written once (a rerun over the same root keeps them).
export function c12Scratch(): C12Scratch {
  const config = process.env.CLAUDE_CONFIG_DIR;
  const userData = process.env.MAWS_USER_DATA;
  if (!config || !userData) throw new Error('export CLAUDE_CONFIG_DIR and MAWS_USER_DATA under /private/tmp/maws-c12-* first (Concrete Steps, "M3 live")');
  const root = dirname(realpathSync(config));
  if (!root.startsWith(SCRATCH_PREFIX) || dirname(realpathSync(userData)) !== root) throw new Error(`the scratch must be one ${SCRATCH_PREFIX}* root: CLAUDE_CONFIG_DIR=${config}, MAWS_USER_DATA=${userData}`);
  const settings = join(config, 'settings.json');
  if (!existsSync(settings) || JSON.stringify(JSON.parse(readFileSync(settings, 'utf8'))) !== '{}') throw new Error(`${settings} must hold {}`);
  assertConfigHomeSafe({ configHome: config, controls: ['launch:trust'] });

  const claudeJson = join(config, '.claude.json');
  if (!existsSync(claudeJson)) {
    const plain = { type: 'stdio', command: process.execPath, args: [MCP_SERVER] };
    writeFileSync(claudeJson, `${JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', mcpServers: { 'c12-plain': plain } }, null, 2)}\n`);
  }
  const repo = (name: string, files: Record<string, string>) => {
    const dir = join(root, name);
    if (existsSync(dir)) return dir;
    mkdirSync(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const git = (...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'user.name=C12', '-c', 'user.email=c12@localhost', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', 'C12 sentinels');
    return dir;
  };
  const kernel = { mcpServers: { 'c12-kernel': { command: process.execPath, args: [MCP_SERVER] } } };
  const repoA = repo('A', { '.mcp.json': `${JSON.stringify(kernel, null, 2)}\n`, '.claude/settings.json': '{"enableAllProjectMcpServers":true}\n' });
  const repoB = repo('B', { 'one.txt': 'ONE\n' });
  return { root, config, userData: realpathSync(userData), repoA, repoB };
}

// The owner-file check of the standing rules, verbatim, for the root as given and as /tmp names it: the keys of the
// owner's ~/.claude.json `projects` under the scratch root (read only; `[]` is the pass).
export function ownerFileCheck(root: string): string[] {
  const script = "import json,sys;p=json.load(open('/Users/new/.claude.json'))['projects'];print(json.dumps([k for k in p if k.startswith(sys.argv[1])]))";
  const found: string[] = [];
  for (const prefix of [root, root.replace(/^\/private\/tmp\//, '/tmp/')]) found.push(...(JSON.parse(execFileSync('/usr/bin/python3', ['-c', script, prefix], { encoding: 'utf8' })) as string[]));
  return found;
}

export const lsPin = (): string => execFileSync('/bin/ls', ['-l', ENGINE_BIN], { encoding: 'utf8' }).trim();

// One `ps -axo pid=,ppid=,rss=,command=` read: every process's parent, resident size and command line.
export interface PsRow { pid: number; ppid: number; rssKiB: number; command: string }
export function psRead(): PsRow[] {
  return execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rssKiB: Number(m[3]), command: m[4]! }));
}

// A process and every descendant in one read, summed as C3's sampler sums them (the same definition, computed here
// independently of `process-table.ts`).
export function treeOf(rows: readonly PsRow[], pid: number): { rssKiB: number; pids: number[]; commands: string[] } {
  const children = new Map<number, PsRow[]>();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const root = rows.find((r) => r.pid === pid);
  if (!root) return { rssKiB: 0, pids: [], commands: [] };
  const tree: PsRow[] = [];
  for (const queue = [root]; queue.length > 0; ) {
    const next = queue.shift()!;
    tree.push(next);
    queue.push(...(children.get(next.pid) ?? []));
  }
  return { rssKiB: tree.reduce((sum, r) => sum + r.rssKiB, 0), pids: tree.map((r) => r.pid), commands: tree.map((r) => basename(r.command.split(' ')[0] ?? '')) };
}

// What the run spent: every journal under the profile, each process's largest main-lane `total_cost_usd`. A resumed
// process's figure may include the cost its session restored, so the sum is an upper bound; `perSession` takes each
// session's largest process figure instead.
export function spend(userData: string): { upperBoundUsd: number; perSessionUsd: number; journals: { appSessionId: string; file: string; costUsd: number }[] } {
  const dir = join(userData, 'engine-host', 'journal');
  const journals: { appSessionId: string; file: string; costUsd: number }[] = [];
  if (existsSync(dir)) {
    for (const id of readdirSync(dir)) {
      for (const file of readdirSync(join(dir, id)).filter((f) => f.endsWith('.jsonl'))) journals.push({ appSessionId: id, file, costUsd: processCost(journal(join(dir, id, file))) });
    }
  }
  const bySession = new Map<string, number>();
  for (const j of journals) bySession.set(j.appSessionId, Math.max(bySession.get(j.appSessionId) ?? 0, j.costUsd));
  const round = (n: number) => Number(n.toFixed(4));
  return { upperBoundUsd: round(journals.reduce((s, j) => s + j.costUsd, 0)), perSessionUsd: round([...bySession.values()].reduce((s, c) => s + c, 0)), journals };
}
