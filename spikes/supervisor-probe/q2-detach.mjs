// E10 M0 Q2 (docs/doperpowers/plans/2026-10-06-e10-supervisor.md, M0): does a child spawned as §Design 1 specifies
// (`detached: true`, stdio to a log file, `argv0: 'maws-supervisor'`, `unref()`) outlive its parent?
//   A. a plain Node parent spawns it, then the parent's whole process group is SIGKILLed;
//   B. an Electron app (q2-electron-main.cjs under node_modules/electron) spawns it with process.execPath as Node and
//      calls app.quit(); the app's process group is SIGKILLed afterwards for good measure;
//   C. the same Electron app spawns it and holds; its process group is SIGKILLed (a crash, or launchd's group kill).
// For each: the child's PID, PPID, PGID and STAT (an `s` marks a session leader) before and after, and whether it is
// alive. Every process started is killed at the end and the scratch directories are removed.
//   node spikes/supervisor-probe/q2-detach.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const self = fileURLToPath(import.meta.url);
const role = process.argv[2];

function ps(pid) {
  try {
    const line = execFileSync('ps', ['-o', 'pid=,ppid=,pgid=,stat=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    return { pid: +m[1], ppid: +m[2], pgid: +m[3], stat: m[4], sessionLeader: m[4].includes('s'), command: m[5].slice(0, 160) };
  } catch {
    return null; // gone
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function firstLine(stream) {
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk;
    const i = buffer.indexOf('\n');
    if (i >= 0) return JSON.parse(buffer.slice(0, i));
  }
  throw new Error('no line');
}
const killGroup = (pgid) => { try { process.kill(-pgid, 'SIGKILL'); return 'sent'; } catch (e) { return e.code; } };

async function outer() {
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const electron = join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  const started = []; // every pid this run started, killed at the end
  const scratchDirs = [];
  process.on('exit', () => { for (const pid of started) try { process.kill(pid, 'SIGKILL'); } catch {} }); // also on a thrown probe
  const result = { question: 'Q2', node: process.version, cases: {} };

  // A. a Node parent, killed with its whole process group
  {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'maws-q2-node-')));
    scratchDirs.push(dir);
    const parent = spawn(process.execPath, [self, '--parent', dir], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    parent.stdout.setEncoding('utf8');
    const { child } = await firstLine(parent.stdout);
    started.push(parent.pid, child);
    await delay(300);
    const before = { parent: ps(parent.pid), child: ps(child) };
    const t0 = Date.now();
    const sent = killGroup(parent.pid);
    await once(parent, 'exit');
    await delay(500);
    result.cases.A_nodeParentGroupKilled = { before, groupKill: sent, after: { parent: ps(parent.pid), child: ps(child), childAlive: alive(child), msAfterKill: Date.now() - t0 }, childLog: readFileSync(join(dir, 'host.log'), 'utf8').trim() };
  }

  // B and C. the Electron app: quit, or hold and be killed
  for (const mode of ['quit', 'hold']) {
    const userData = realpathSync(mkdtempSync(join(tmpdir(), `maws-q2-electron-${mode}-`)));
    scratchDirs.push(userData);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = spawn(electron, [join(repo, 'spikes/supervisor-probe/q2-electron-main.cjs'), `--user-data-dir=${userData}`, mode, userData, self], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let stderr = '';
    app.stderr.setEncoding('utf8');
    app.stderr.on('data', (s) => (stderr += s));
    app.stdout.setEncoding('utf8');
    const exited = once(app, 'exit');
    const { electron: appPid, child } = await firstLine(app.stdout);
    started.push(appPid, child);
    const before = { app: ps(appPid), child: ps(child) };
    const t0 = Date.now();
    let appExit;
    if (mode === 'quit') {
      const [code, signal] = await exited;
      appExit = { code, signal, msToExit: Date.now() - t0, groupKillAfterQuit: killGroup(app.pid) };
    } else {
      await delay(500);
      appExit = { groupKill: killGroup(app.pid) };
      const [code, signal] = await exited;
      Object.assign(appExit, { code, signal, msToExit: Date.now() - t0 });
    }
    await delay(500);
    result.cases[mode === 'quit' ? 'B_electronAppQuit' : 'C_electronAppGroupKilled'] = { before, appExit, after: { app: ps(appPid), child: ps(child), childAlive: alive(child) }, childLog: readFileSync(join(userData, 'host.log'), 'utf8').trim(), appStderrLines: stderr.split('\n').filter(Boolean).length };
  }

  // Cleanup: every pid started, then a check that none survives and the scratch directories are gone.
  for (const pid of started) if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  await delay(300);
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  result.cleanup = { started, stillAlive: started.filter(alive), scratchRemoved: scratchDirs.every((d) => !existsSync(d)) };
  mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./results/q2.json', import.meta.url), JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify(result, null, 1));
}

if (role === '--child') {
  // the stand-in supervisor: says where it runs, then lives two minutes unless killed
  console.log(JSON.stringify({ child: process.pid, tag: process.argv[3], execPath: process.execPath, node: process.version, electron: process.versions.electron ?? null }));
  setTimeout(() => process.exit(0), 120_000);
} else if (role === '--parent') {
  const dir = process.argv[3];
  const logFd = openSync(join(dir, 'host.log'), 'a');
  const child = spawn(process.execPath, [self, '--child', 'node-parent'], { detached: true, stdio: ['ignore', logFd, logFd], env: process.env, cwd: process.cwd(), argv0: 'maws-supervisor' });
  child.unref();
  closeSync(logFd);
  process.stdout.write(JSON.stringify({ parent: process.pid, child: child.pid }) + '\n');
  setInterval(() => {}, 1_000); // holds until killed
} else {
  await outer();
}
