#!/usr/bin/env node
// The TCC probe (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M8 "TCC under launchd (U8, macOS)", Concrete Steps
// 10): which app macOS's TCC attributes a protected-folder access to when the access comes from under `mawsd` under a
// LaunchAgent. It RAISES TCC DIALOGS, so it runs only with the owner at the Mac and the architect's go; see README.md.
//
//   node spikes/mawsd-tcc/probe.mjs --app /Applications/MAWS.app --owner-present
//
// Stage A, the unit's program: a LaunchAgent with a probe label runs the app binary as Node (ELECTRON_RUN_AS_NODE=1,
// AssociatedBundleIdentifiers [dev.maws.app], as the unit's plist), on a child script that runs `/bin/ls ~/Documents`
// and `/bin/ls ~/Desktop` and records each result and how long it blocked (a dialog holds the call until answered).
// Stage B, the real engine host's spawn path: a LaunchAgent with a probe label runs the bundle's own
// `app.asar/out/main/mawsd.js run --unit` for a scratch profile, exactly as the unit's plist does; the probe connects
// to its engine-host relay as an app would, points the engine binary at a stub `claude` (engine.configure) and launches
// a session (session.launch); the engine host spawns the stub, which runs the same two `ls` and records them.
// After each stage the operator says whether a dialog appeared and which app it named. Everything the probe made (its
// two LaunchAgents, the scratch profile and the hosts it started) is removed at the end, whatever happened; the
// findings go to spikes/mawsd-tcc/findings.txt.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDERS = [join(homedir(), 'Documents'), join(homedir(), 'Desktop')];
const STAGE_BOUND_MS = 180_000; // a dialog left unanswered this long ends the stage as "no result"
const SOCKET_PROTOCOL = 3; // src/shared/host/socket-protocol.ts
const WIRE_MINOR = 1; // src/shared/ipc/wire.ts at P5 O2

function args(argv) {
  const at = argv.indexOf('--app');
  const app = at >= 0 ? argv[at + 1] : '/Applications/MAWS.app';
  return { app, present: argv.includes('--owner-present') };
}

const sh = (command, list, options = {}) => spawnSync(command, list, { encoding: 'utf8', ...options });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms, every = 250) {
  for (let waited = 0; waited < ms; waited += every) {
    const value = check();
    if (value) return value;
    await sleep(every);
  }
  return null;
}
const xml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist({ label, program, env, out }) {
  const strings = (list) => list.map((item) => `\t\t<string>${xml(item)}</string>`).join('\n');
  const environment = Object.entries(env).map(([key, value]) => `\t\t<key>${xml(key)}</key>\n\t\t<string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xml(label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${strings(program)}
\t</array>
\t<key>EnvironmentVariables</key>
\t<dict>
${environment}
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>ProcessType</key>
\t<string>Interactive</string>
\t<key>StandardOutPath</key>
\t<string>${xml(out)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xml(out)}</string>
\t<key>AssociatedBundleIdentifiers</key>
\t<array>
\t\t<string>dev.maws.app</string>
\t</array>
</dict>
</plist>
`;
}

// The two `ls`, recorded as JSON to `results`: each folder's exit, its first error line, the entries it listed and how
// long the call blocked. Run as Node (stage A) or by sh (stage B's stub, which has no Node it may rely on).
export const childScript = (results) => `const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const folders = ${JSON.stringify(FOLDERS)};
const rows = folders.map((dir) => {
  const start = Date.now();
  const ls = spawnSync('/bin/ls', [dir], { encoding: 'utf8' });
  return { dir, status: ls.status, error: (ls.stderr || '').split('\\n')[0], entries: (ls.stdout || '').split('\\n').filter(Boolean).length, blockedMs: Date.now() - start };
});
writeFileSync(${JSON.stringify(results)}, JSON.stringify({ pid: process.pid, ppid: process.ppid, execPath: process.execPath, rows }, null, 2));
`;
export const stubScript = (results) => `#!/bin/sh
# a stand-in claude for the TCC probe: --version for the engine host's check, else the two ls, recorded
case "$1" in --version) echo "2.1.283 (Claude Code)"; exit 0 ;; esac
out=${JSON.stringify(results)}
{
  printf '{"pid": %s, "ppid": %s, "rows": [' "$$" "$PPID"
  sep=''
${FOLDERS.map((dir) => `  start=$(/bin/date +%s)
  err=$(/bin/ls ${JSON.stringify(dir)} 2>&1 >/dev/null); status=$?
  end=$(/bin/date +%s)
  err=$(printf '%s' "$err" | /usr/bin/head -n 1 | /usr/bin/tr -cd 'A-Za-z0-9 .:/_-')
  printf '%s{"dir": "%s", "status": %s, "error": "%s", "blockedS": %s}' "$sep" ${JSON.stringify(dir)} "$status" "$err" "$((end - start))"
  sep=','`).join('\n')}
  printf ']}\\n'
} > "$out.tmp" && /bin/mv "$out.tmp" "$out"
exec /bin/sleep 5
`;

class Probe {
  constructor(app) {
    this.app = app;
    this.uid = userInfo().uid;
    this.id = randomBytes(3).toString('hex');
    this.root = `/tmp/maws-tcc-${this.id}`; // short, so the daemon's sockets need no fallback directory
    this.labels = [];
    this.hostPids = [];
    this.binary = join(app, 'Contents', 'MacOS', 'MAWS');
    this.entry = join(app, 'Contents', 'Resources', 'app.asar', 'out', 'main', 'mawsd.js');
  }

  agentPath(label) {
    return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
  }

  load(label, text) {
    const path = this.agentPath(label);
    writeFileSync(path, text);
    this.labels.push(label);
    const loaded = sh('launchctl', ['bootstrap', `gui/${this.uid}`, path]);
    if (loaded.status !== 0) throw new Error(`launchctl bootstrap ${path} failed: ${loaded.stderr.trim()}`);
  }

  async stageA() {
    const results = join(this.root, 'a.json');
    const child = join(this.root, 'child.cjs');
    writeFileSync(child, childScript(results));
    const label = `dev.maws.mawsd.tcc-probe-${this.id}-a`;
    this.load(label, plist({ label, program: [this.binary, '--disable-sigusr1', child], env: { ELECTRON_RUN_AS_NODE: '1' }, out: join(this.root, 'a.out') }));
    return (await until(() => (existsSync(results) ? JSON.parse(readFileSync(results, 'utf8')) : null), STAGE_BOUND_MS)) ?? { timedOut: STAGE_BOUND_MS };
  }

  async stageB() {
    const profile = join(this.root, 'p');
    const results = join(this.root, 'b.json');
    const stub = join(this.root, 'claude');
    writeFileSync(stub, stubScript(results), { mode: 0o755 });
    mkdirSync(join(this.root, 'cwd'), { recursive: true });
    // launchd opens StandardOutPath and StandardErrorPath before it execs, so their directory exists first, as `mawsd
    // install` makes it (owner-only) before it loads the unit
    mkdirSync(join(profile, 'mawsd'), { recursive: true, mode: 0o700 });
    const label = `dev.maws.mawsd.tcc-probe-${this.id}-b`;
    // the unit's plist (src/mawsd/units/launchd.ts), for a scratch profile under a probe label
    this.load(label, plist({ label, program: [this.binary, '--disable-sigusr1', this.entry, 'run', '--unit', '--dir', join(profile, 'mawsd')], env: { ELECTRON_RUN_AS_NODE: '1', MAWS_USER_DATA: profile }, out: join(profile, 'mawsd', 'mawsd.out') }));
    const token = await until(() => (existsSync(join(profile, 'mawsd', 'mawsd.token')) ? readFileSync(join(profile, 'mawsd', 'mawsd.token'), 'utf8').trim() : null), 20_000);
    if (!token) throw new Error(`mawsd wrote no token under ${profile}/mawsd within 20 s; see ${profile}/mawsd/mawsd.log`);
    const socket = await until(() => existsSync(join(profile, 'mawsd', 'engine-host.sock')) && join(profile, 'mawsd', 'engine-host.sock'), 20_000);
    if (!socket) throw new Error(`mawsd's engine-host.sock did not appear under ${profile}/mawsd`);
    const link = await connect(socket, token);
    try {
      const configured = await link.request('engine.configure', { binaryPath: stub });
      const appSessionId = `tcc-probe-${this.id}`;
      const spec = {
        appSessionId, cwd: join(this.root, 'cwd'), additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'direct', subagentModel: null,
        resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null,
      };
      const launched = await link.request('session.launch', { spec });
      const ran = (await until(() => (existsSync(results) ? JSON.parse(readFileSync(results, 'utf8')) : null), STAGE_BOUND_MS)) ?? { timedOut: STAGE_BOUND_MS };
      return { configured, launched, ran };
    } finally {
      link.close();
      const lock = join(profile, 'supervisor', 'host.lock');
      if (existsSync(lock)) this.hostPids.push(JSON.parse(readFileSync(lock, 'utf8')).pid);
      const ptyLock = join(profile, 'mawsd', 'pty-host', 'host.lock');
      if (existsSync(ptyLock)) this.hostPids.push(JSON.parse(readFileSync(ptyLock, 'utf8')).pid);
    }
  }

  cleanup() {
    for (const label of this.labels) {
      sh('launchctl', ['bootout', `gui/${this.uid}/${label}`]);
      rmSync(this.agentPath(label), { force: true });
    }
    for (const pid of this.hostPids) {
      // only a host of this probe's profile: its command line names the scratch root
      const command = sh('ps', ['-o', 'command=', '-p', String(pid)]).stdout;
      if (command.includes(this.root)) process.kill(pid, 'SIGTERM');
    }
    rmSync(this.root, { recursive: true, force: true });
  }
}

// One connection to mawsd's engine-host relay, as an app's: the hello with the profile's token, then requests.
async function connect(path, token) {
  const socket = createConnection(path);
  await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject));
  const lines = [];
  let buffered = '';
  socket.on('data', (chunk) => {
    buffered += String(chunk);
    for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
      lines.push(JSON.parse(buffered.slice(0, at)));
      buffered = buffered.slice(at + 1);
    }
  });
  socket.write(`${JSON.stringify({ t: 'hello', protocol: SOCKET_PROTOCOL, token, minor: WIRE_MINOR, build: 'tcc-probe', capabilities: [], appPid: process.pid })}\n`);
  const welcome = await until(() => lines.find((line) => line.t === 'welcome' || line.t === 'refuse'), 20_000);
  if (welcome?.t !== 'welcome') throw new Error(`mawsd's engine-host relay did not welcome the probe: ${JSON.stringify(welcome)}`);
  let next = 0;
  return {
    async request(name, input) {
      const id = `tcc-${(next += 1)}`;
      socket.write(`${JSON.stringify({ t: 'req', id, name, input })}\n`);
      const answer = await until(() => lines.find((line) => line.t === 'res' && line.id === id), 30_000);
      return answer ?? { timedOut: name };
    },
    close: () => socket.end(),
  };
}

async function ask(rl, stage) {
  const dialog = (await rl.question(`${stage}: did a TCC dialog appear? (y/n) `)).trim();
  const named = /^y/i.test(dialog) ? (await rl.question(`${stage}: which app did the dialog name (its exact words)? `)).trim() : '';
  const answered = /^y/i.test(dialog) ? (await rl.question(`${stage}: what did you answer (Allow / Don't Allow / left it)? `)).trim() : '';
  const settings = (await rl.question(`${stage}: in System Settings › Privacy & Security › Files and Folders, which app now lists Documents or Desktop (none if none)? `)).trim();
  return { dialog, named, answered, settings };
}

async function main() {
  const { app, present } = args(process.argv.slice(2));
  if (process.platform !== 'darwin') throw new Error('the TCC probe runs on macOS only');
  if (!present) throw new Error('the probe raises TCC dialogs; run it only at the Mac, with the owner present and the architect’s go, adding --owner-present (README.md)');
  const probe = new Probe(app);
  if (!existsSync(probe.binary) || !existsSync(join(app, 'Contents', 'Resources', 'app.asar'))) throw new Error(`${app} is not a packaged MAWS (pnpm build:app; README.md)`);
  mkdirSync(probe.root, { recursive: true, mode: 0o700 });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const facts = {
    when: new Date().toISOString(),
    macos: sh('sw_vers', []).stdout.trim().replace(/\n/g, ' · '),
    model: sh('sysctl', ['-n', 'hw.model']).stdout.trim(),
    app,
    bundleId: sh('defaults', ['read', join(app, 'Contents', 'Info.plist'), 'CFBundleIdentifier']).stdout.trim(),
    signature: sh('codesign', ['-dv', app]).stderr.trim().split('\n').filter((line) => /^(Identifier|Format|Signature|TeamIdentifier|Authority)/.test(line)),
  };
  const record = { facts };
  try {
    console.log('Stage A: a LaunchAgent runs the app binary as Node on a child that lists ~/Documents and ~/Desktop. Watch for a dialog.');
    record.stageA = await probe.stageA();
    record.stageA.operator = await ask(rl, 'Stage A');
    console.log('Stage B: a LaunchAgent runs the bundle’s mawsd as the unit does; its engine host spawns a stub claude that lists the same two folders.');
    record.stageB = await probe.stageB();
    record.stageB.operator = await ask(rl, 'Stage B');
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    rl.close();
    probe.cleanup();
  }
  const findings = join(HERE, 'findings.txt');
  writeFileSync(findings, `# The TCC probe's record (spikes/mawsd-tcc/README.md); the verdict and the decision it implies go to the O2 document's Surprises.\n${JSON.stringify(record, null, 2)}\n`);
  console.log(`recorded in ${findings}`);
  if (record.error) {
    console.error(`the probe stopped: ${record.error}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
