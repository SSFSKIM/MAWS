// Debt wave 5, row "`claude --bg` run from the pinned 2.1.283 starts its transient daemon through ~/.local/bin/claude"
// (child C3 of docs/charter.md; docs/tech-debt-tracker.md): which binary does the daemon that a `--bg` job needs run,
// and can the launch environment MAWS constructs make it the pin?
//
// Source (2.1.283, ~/claude-code-bundle/2.1.283/cli.pretty.js): the daemon is spawned by `cGt` (L531103) with the
// command `Fu()` (chunk-nqw8wkqz, L663114 to L663138), i.e. `IAe({})`: when the running binary is native and its
// `process.execPath` starts with `$XDG_DATA_HOME/claude/versions/` (`olt`, default `$HOME/.local/share/...`, L710558 to
// L710567), the command is the installer's launcher `$HOME/.local/bin/claude` (`WLe`, `zW`); otherwise it is
// `process.execPath`. PATH is never consulted (the fallbacks after an ENOENT or EACCES are execPath, the launcher, then
// the newest version under the versions directory). So the arms below: the baseline, a PATH shim (the arrangement the
// row proposed), `XDG_DATA_HOME` moved, the pin reached through a symlink outside the versions directory, and a byte
// copy outside it (what MAWS's engine custody launches in a packaged build, src/main/engine/custody.ts).
//
// Each arm runs under its own scratch config home (the daemon's socket directory is keyed by the config home, so each
// arm starts its own transient daemon and never meets the owner's), through the owner's relay, with one Haiku turn.
// The fixture records, per arm, the daemon's own version line from `<config>/daemon.log` and the executable the OS
// reports for the daemon and its children (lsof txt).
//   node spikes/protocol-probe/scenarios/pass3/bg-daemon-binary.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BIN } from '../pass2/common.mjs';

const PIN = '2.1.283';
const ROOT = '/private/tmp/maws-w5a-bg';
const PROVENANCE = { charter: 'docs/charter.md', child: 'C3', document: 'docs/tech-debt-tracker.md (debt wave 5, row 3)', pin: '2b12f5f52a854e36b7f79e099a6f4b0e269d3707' };
const RELAY = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8641', ANTHROPIC_AUTH_TOKEN: 'claudeusage-local-gateway' };
const OUT = new URL('../../fixtures/pass3/bg-daemon-binary.jsonl', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const row = (frame) => rows.push({ seq: rows.length + 1, direction: 'meta', at: new Date().toISOString(), frame });
const sh = (cmd, args, env) => { try { return execFileSync(cmd, args, { encoding: 'utf8', ...(env && { env }) }); } catch (e) { return e.stdout?.toString() ?? ''; } };

function ownerFileCheck(when) {
  const file = join(homedir(), '.claude.json');
  const st = statSync(file);
  const projects = Object.keys(JSON.parse(readFileSync(file, 'utf8')).projects ?? {}).filter((p) => p.startsWith(ROOT) || p.startsWith('/tmp/maws-w5a-bg'));
  const plist = existsSync(join(homedir(), 'Library/LaunchAgents/com.anthropic.claude-daemon.plist'));
  row({ event: 'owner_file_check', when, mtime: st.mtime.toISOString(), size: st.size, scratchProjects: projects, daemonLaunchAgent: plist });
}

// The executable the OS reports for a process (its `txt` mapping that is a Mach-O main image, the first txt row).
function exeOf(pid) {
  const out = sh('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn']);
  return out.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? null;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const baseEnv = () => {
  const env = { TERM: 'xterm-256color', LANG: process.env.LANG ?? 'en_US.UTF-8' };
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR']) if (process.env[k]) env[k] = process.env[k];
  return env;
};

const ARMS = [
  { arm: 'installed-path', bin: () => BIN, env: {} },
  { arm: 'path-shim', bin: () => BIN, env: { PATH: `${join(ROOT, 'shim-bin')}:${process.env.PATH}` }, setup: () => { mkdirSync(join(ROOT, 'shim-bin'), { recursive: true }); if (!existsSync(join(ROOT, 'shim-bin/claude'))) symlinkSync(BIN, join(ROOT, 'shim-bin/claude')); } },
  { arm: 'xdg-data-home', bin: () => BIN, env: { XDG_DATA_HOME: join(ROOT, 'xdg-data') }, setup: () => mkdirSync(join(ROOT, 'xdg-data'), { recursive: true }) },
  { arm: 'symlink-outside', bin: () => join(ROOT, 'link/claude'), env: {}, setup: () => { mkdirSync(join(ROOT, 'link'), { recursive: true }); if (!existsSync(join(ROOT, 'link/claude'))) symlinkSync(BIN, join(ROOT, 'link/claude')); } },
  { arm: 'custody-copy', bin: () => join(ROOT, `engine/${PIN}/claude`), env: {}, setup: () => { mkdirSync(join(ROOT, `engine/${PIN}`), { recursive: true }); if (!existsSync(join(ROOT, `engine/${PIN}/claude`))) copyFileSync(BIN, join(ROOT, `engine/${PIN}/claude`)); } },
];

function usageOf(config) {
  const dir = join(config, 'projects');
  const totals = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, models: new Set() };
  if (!existsSync(dir)) return { ...totals, models: [] };
  for (const project of readdirSync(dir)) for (const f of readdirSync(join(dir, project)).filter((n) => n.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, project, f), 'utf8').split('\n')) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      const u = j.type === 'assistant' ? j.message?.usage : null;
      if (!u) continue;
      totals.models.add(j.message.model);
      totals.input += u.input_tokens ?? 0; totals.cacheWrite += u.cache_creation_input_tokens ?? 0; totals.cacheRead += u.cache_read_input_tokens ?? 0; totals.output += u.output_tokens ?? 0;
    }
  }
  // Haiku 4.5 list prices per million tokens: input 1, cache write 1.25, cache read 0.10, output 5
  const usd = (totals.input * 1 + totals.cacheWrite * 1.25 + totals.cacheRead * 0.1 + totals.output * 5) / 1e6;
  return { ...totals, models: [...totals.models], usdEstimate: Number(usd.toFixed(4)) };
}

async function runArm({ arm, bin, env: extra, setup }) {
  setup?.();
  const config = join(ROOT, `config-${arm}`);
  const repo = join(ROOT, `repo-${arm}`);
  rmSync(config, { recursive: true, force: true });
  mkdirSync(config, { recursive: true });
  mkdirSync(repo, { recursive: true });
  if (!existsSync(join(repo, '.git'))) execFileSync('git', ['init', '-q', repo]);
  writeFileSync(join(config, 'settings.json'), '{}\n');
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, theme: 'light', projects: { [repo]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } } }, null, 2));
  const env = { ...baseEnv(), ...extra, CLAUDE_CONFIG_DIR: config, ...RELAY };
  const exe = bin();
  row({ event: 'arm', arm, bin: exe, binIsSymlink: existsSync(exe) && sh('stat', ['-f', '%HT', exe]).trim() === 'Symbolic Link', pathHead: env.PATH.split(':')[0], xdgDataHome: env.XDG_DATA_HOME ?? null, envKeys: Object.keys(env).sort(), configHome: config, cwd: repo });
  let started = '';
  try {
    started = execFileSync(exe, ['--bg', '--model', 'haiku', 'Reply with exactly the word OK, then stop.'], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 });
  } catch (e) { started = `${e.stdout ?? ''}\n[failed: ${e.message.split('\n')[0]}]`; }
  const plain = started.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const jobId = /backgrounded\W+([0-9a-f]{6,12})/.exec(plain)?.[1] ?? null;
  row({ event: 'bg_started', arm, jobId, stdout: plain.split('\n').filter(Boolean).slice(0, 4) });
  let line = null;
  for (let i = 0; i < 60 && !line; i++) {
    const log = join(config, 'daemon.log');
    if (existsSync(log)) line = readFileSync(log, 'utf8').split('\n').find((l) => l.includes('daemon start')) ?? null;
    if (!line) await sleep(500);
  }
  const version = line ? /version=(\S+)/.exec(line)?.[1] ?? null : null;
  const pid = line ? Number(/pid=(\d+)/.exec(line)?.[1]) : null;
  row({ event: 'daemon_start', arm, line: line?.replace(/^.*?(───|─)/, '$1') ?? null, version, runsPin: version === PIN });
  if (pid && alive(pid)) {
    row({ event: 'daemon_process', arm, exe: exeOf(pid), command: sh('ps', ['-o', 'command=', '-p', String(pid)]).trim().slice(0, 300) });
  }
  // the job's own processes, once they exist: the daemon's children
  await sleep(4000);
  if (pid) {
    const kids = sh('pgrep', ['-P', String(pid)]).split('\n').filter(Boolean).map(Number);
    row({ event: 'daemon_children', arm, children: kids.map((k) => ({ exe: exeOf(k), command: sh('ps', ['-o', 'command=', '-p', String(k)]).trim().slice(0, 160) })) });
  }
  // let the one-word turn finish so its usage is in the transcript, then stop the job
  for (let i = 0; i < 40 && usageOf(config).output === 0; i++) await sleep(1000);
  if (jobId) row({ event: 'stopped', arm, stdout: sh(exe, ['stop', jobId], env).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n').filter(Boolean).slice(0, 2) });
  let exited = false;
  for (let i = 0; i < 40 && pid && !exited; i++) { exited = !alive(pid); if (!exited) await sleep(500); }
  if (pid && !exited) { process.kill(pid, 'SIGTERM'); await sleep(1000); }
  row({ event: 'daemon_exit', arm, exitedOnItsOwn: exited, alive: pid ? alive(pid) : null });
  row({ event: 'usage', arm, ...usageOf(config) });
}

async function main() {
  const hello = sh('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${RELAY.ANTHROPIC_BASE_URL}/api/hello`]);
  if (hello !== '200') throw new Error(`relay /api/hello answered ${hello}`);
  mkdirSync(ROOT, { recursive: true });
  const sha = sh('shasum', ['-a', '256', BIN]).slice(0, 64);
  row({ event: 'provenance', ...PROVENANCE, engine: BIN, engineVersion: sh(BIN, ['--version'], { ...baseEnv(), CLAUDE_CONFIG_DIR: join(ROOT, 'config-version') }).trim(), engineSha256: sha, launcher: join(homedir(), '.local/bin/claude'), launcherTarget: sh('readlink', [join(homedir(), '.local/bin/claude')]).trim(), relayHello: Number(hello) });
  ownerFileCheck('before');
  const only = process.argv[2];
  for (const arm of ARMS) if (!only || only.split(',').includes(arm.arm)) await runArm(arm);
  ownerFileCheck('after');
  row({ event: 'exit', code: 0 });
  writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const r of rows) if (['daemon_start', 'daemon_process', 'usage', 'owner_file_check'].includes(r.frame.event)) console.log(JSON.stringify(r.frame));
}

main().catch((e) => { console.error(e); process.exit(1); });
