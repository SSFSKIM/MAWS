// The holder's acceptance run on a devcloud VM (P5 O16 M4; docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M4 and
// Concrete Steps' "VM run"): acceptance 13's engine-host case with the real engine against the stub model. A client of
// the installed `mawsd`'s machine.sock, as lane-b.mjs is, with no app anywhere. Run as the user whose `mawsd install`
// (devenv/setup.sh) runs the systemd user unit, with XDG_RUNTIME_DIR set so `systemctl --user` reaches its manager:
//   node holder.mjs run <directory> <tag> --next-pack <pack> [--sleep-s 120] [--stub-port 47899]
// It starts the stub model (stub-model.mjs beside it, with spikes/protocol-probe/stub-api.mjs copied beside that),
// allows `sleep` in <directory>'s project settings, and starts a lane B session there whose first message makes the stub
// run `sleep <s>` in the background and then a Bash call no rule allows, so a permission is raised and the turn waits
// on it. Mid-turn it restarts the unit (`systemctl --user restart mawsd`: a new mawsd adopts the same engine host), then
// installs <pack>, a pack of another engine-host build (`mawsd install`: current flips, the unit restarts, and the new
// mawsd has the old engine host hand its sessions over to a successor of its own build). Then it allows the
// permission, waits for the turn's result and for the background shell's completion to reach the model, reads the
// launch's events back (`session.events`) and prints `PASS holder: …`, or `FAIL holder: <why>` and exits 1. Each step
// prints the pids it read, the unit's KillMode and the control group of the session host and the engine.
//
// The engine's model is reached as the gateway: mawsd's environment names the stub in MAWS_RELAY_URL (a drop-in on the
// unit), as scene.sh does for its lane B. Every wait is bounded.
import console from 'node:console';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { reach } from './lane-b.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UNIT = 'mawsd.service';
const PAGE = 500;

// ---- the stub model's script ------------------------------------------------------------------------------------------

const GO = /o16-holder go ([a-z0-9]{1,16}) (\d{1,4})/;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b?.type === 'text' ? (b.text ?? '') : b?.type === 'tool_result' ? textOf(b.content) : '')).join('\n');
}

/**
 * The holder run's next model step for a main-loop request, or null when the conversation is not the run's: decided by
 * the run's first message and the last assistant message alone, so a request the engine repeats gets the same answer.
 *   the first request              Bash `sleep <s>` in the background
 *   after that tool's result        Bash `curl` to a closed port, which no rule allows: the permission
 *   after the permission's tool     the turn's text, `o16-holder done <tag>`
 *   after that (a new turn: the background shell's completion)   `o16-holder notified <tag>`
 */
export function holderStep(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const first = messages.find((m) => m?.role === 'user');
  const go = GO.exec(textOf(first?.content));
  if (!go) return null;
  const [, tag, seconds] = go;
  const last = [...messages].reverse().find((m) => m?.role === 'assistant');
  if (!last) return { tool: { id: `toolu_o16_${tag}_bg`, name: 'Bash', input: { command: `sleep ${seconds}`, run_in_background: true, description: `o16 holder background sleep ${tag}` } } };
  const used = (Array.isArray(last.content) ? last.content : []).filter((b) => b?.type === 'tool_use').map((b) => b.id);
  if (used.includes(`toolu_o16_${tag}_bg`)) return { tool: { id: `toolu_o16_${tag}_ask`, name: 'Bash', input: { command: `curl -sS --max-time 2 http://127.0.0.1:9/o16-holder-${tag}`, description: `o16 holder permission ${tag}` } } };
  if (used.includes(`toolu_o16_${tag}_ask`)) return { text: `o16-holder done ${tag}` };
  return { text: `o16-holder notified ${tag}` };
}

// ---- reading the machine ----------------------------------------------------------------------------------------------

const ctl = (...args) => spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
const unitProperty = (name) => ctl('show', UNIT, '-p', name, '--value').stdout.trim();
const cgroupOf = (pid) => {
  try {
    return readFileSync(`/proc/${pid}/cgroup`, 'utf8').split('\n').find((line) => line.startsWith('0::'))?.slice(3) ?? null;
  } catch {
    return null;
  }
};
// A process's identity: its pid and start (field 22 of /proc/<pid>/stat, clock ticks since boot).
function startOf(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}
const alive = (proc) => proc !== null && startOf(proc.pid) === proc.start;
const parentOf = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  } catch {
    return 0;
  }
};
/** The `sleep <s>` process under `ancestor`, or null. */
function shellUnder(ancestor, seconds) {
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let argv;
    try {
      argv = readFileSync(`/proc/${name}/cmdline`, 'utf8').split('\0').filter(Boolean);
    } catch {
      continue;
    }
    if (argv.length !== 2 || argv[0].split('/').pop() !== 'sleep' || argv[1] !== String(seconds)) continue;
    for (let p = parentOf(Number(name)); p > 1; p = parentOf(p)) if (p === ancestor) return { pid: Number(name), start: startOf(Number(name)) };
  }
  return null;
}

/** Polls `read` until `done(value)` holds, every `everyMs`, at most `ms`. */
async function until(read, done, what, ms, everyMs = 1000) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) throw new Error(`${what} not within ${ms / 1000} s (last: ${JSON.stringify(last)?.slice(0, 600)})`);
    await sleep(everyMs);
  }
}

/** Every event of the session's launch, as the engine host numbers them (lane-b.mjs's `events`, the events themselves). */
async function eventsOf(link, app) {
  const out = [];
  let afterSeq = null;
  for (let page = 0; page < 400; page++) {
    const value = await link.request('session.events', { appSessionId: app, afterSeq, limit: PAGE });
    if (value.historyUnavailable === true) throw new Error(`session.events: part of the launch's history is unavailable (after seq ${afterSeq})`);
    const mine = (Array.isArray(value.events) ? value.events : []).filter((e) => typeof e?.seq === 'number');
    out.push(...mine);
    if (value.complete === true || mine.length === 0) return out;
    afterSeq = mine.at(-1).seq;
  }
  throw new Error('session.events: not complete after 400 pages');
}

const contentText = (content) => (typeof content === 'string' ? content : textOf(content));

// ---- the run ----------------------------------------------------------------------------------------------------------

async function run({ directory, tag, nextPack, seconds, stubPort, profile }) {
  const dir = join(profile, 'mawsd');
  for (const f of [join(HERE, 'stub-model.mjs'), join(HERE, 'stub-api.mjs')]) if (!existsSync(f)) throw new Error(`no ${f}: copy spikes/protocol-probe/stub-api.mjs beside stub-model.mjs`);
  if (!existsSync(join(nextPack, 'out', 'main', 'mawsd.js')) || !existsSync(join(nextPack, 'runtime', 'bin', 'node'))) throw new Error(`${nextPack} is no Linux pack (out/main/mawsd.js, runtime/bin/node)`);
  const say = (line) => console.log(`${new Date().toISOString()} ${line}`);
  say(`unit ${UNIT}: KillMode=${unitProperty('KillMode')} MainPID=${unitProperty('MainPID')} ControlGroup=${unitProperty('ControlGroup')}`);

  const stub = spawn(process.execPath, [join(HERE, 'stub-model.mjs'), '--port', String(stubPort), '--delay-ms', '300'], { stdio: ['ignore', 'pipe', 'pipe'] });
  stub.stdout.on('data', (chunk) => process.stdout.write(String(chunk).replace(/^(?=.)/gm, 'stub: ')));
  stub.stderr.on('data', (chunk) => process.stdout.write(String(chunk).replace(/^(?=.)/gm, 'stub! ')));
  try {
    await until(() => globalThis.fetch(`http://127.0.0.1:${stubPort}/api/hello`).then((r) => r.status), (s) => s === 200, 'the stub model', 20_000, 250);
    mkdirSync(join(directory, '.claude'), { recursive: true });
    writeFileSync(join(directory, '.claude', 'settings.json'), `${JSON.stringify({ permissions: { allow: ['Bash(sleep:*)'] } }, null, 2)}\n`);

    let link = await reach(dir);
    const relink = async (what) => {
      link.close();
      link = await until(() => reach(dir), () => true, `machine.sock after ${what}`, 120_000);
    };
    const machine = async () => {
      const d = await link.request('daemon.status', undefined);
      return { mawsd: d.pid, engineHost: d.hosts['engine-host'].pid, engineHostState: d.hosts['engine-host'].state, engineHostBuild: d.hosts['engine-host'].build, sessionHosts: d.sessionHosts ?? null, unitMain: Number(unitProperty('MainPID')) };
    };
    const status = (app) => link.request('session.status', { appSessionId: app });

    // The session, mid-turn: the background shell running and the permission raised.
    await link.request('daemon.status', undefined); // wakes a parked engine host
    const { appSessionId: app } = await link.request('session.create', { projectId: null, location: { kind: 'directory', path: directory } });
    const text = `o16-holder go ${tag} ${seconds}`;
    const started = await link.request('session.start', { appSessionId: app, message: { content: text, display: text }, options: { gateway: 'gateway', trust: 'accepted' } }, 120_000);
    if (started?.status !== 'starting') throw new Error(`session.start answered ${JSON.stringify(started).slice(0, 400)}`);
    say(`session ${app} started: ${text}`);
    const allowed = new Set(); // permissions for the shell itself, if a rule did not cover it, are allowed at once
    const raised = await until(
      async () => {
        for (const e of await eventsOf(link, app)) {
          if (e.kind !== 'permission.requested' || allowed.has(e.requestId)) continue;
          const command = String(e.input?.command ?? '');
          if (command.startsWith('sleep ')) {
            allowed.add(e.requestId);
            await link.request('session.answer', { appSessionId: app, requestId: e.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
            say(`allowed the shell's own permission ${e.requestId} (${command})`);
            continue;
          }
          if (command.includes(`o16-holder-${tag}`)) return e;
        }
        return null;
      },
      (e) => e !== null,
      'the permission raised',
      180_000,
      2000,
    );
    const permission = raised.requestId;
    const s0 = await status(app);
    const shell = shellUnder(s0.pid, seconds);
    if (shell === null) throw new Error(`no \`sleep ${seconds}\` under the engine pid ${s0.pid}`);
    const tree = (s, step) => {
      const unitGroup = unitProperty('ControlGroup');
      const groups = { host: cgroupOf(s.holder?.pid), engine: cgroupOf(s.pid), shell: cgroupOf(shell.pid) };
      say(`${step}: session host ${s.holder?.pid} (adopted ${s.holder?.adopted}) engine ${s.pid} shell ${shell.pid} ${alive(shell) ? 'alive' : 'GONE'}; process ${s.process}, ${s.pendingRequests} pending, turn ${s.turn ? 'open' : 'none'}`);
      say(`${step}: control groups: unit ${unitGroup}; host ${groups.host}; engine ${groups.engine}; shell ${groups.shell}`);
      return groups.host === unitGroup && groups.engine === unitGroup;
    };
    const m0 = await machine();
    say(`before: mawsd ${m0.mawsd} (unit MainPID ${m0.unitMain}), engine host ${m0.engineHost} (${m0.engineHostState}, build ${m0.engineHostBuild}), session hosts ${JSON.stringify(m0.sessionHosts)}; permission ${permission} raised`);
    const cgroups = [tree(s0, 'before')];
    if (s0.turn === null) throw new Error('the turn is not open with the permission raised');
    if (s0.holder === null || s0.holder === undefined) throw new Error('the session has no session host');

    // 1. The unit restarted: a new mawsd, the same engine host, the session untouched.
    say('restart 1: systemctl --user restart mawsd');
    const restarted = ctl('restart', UNIT);
    if (restarted.status !== 0) throw new Error(`systemctl --user restart ${UNIT}: ${restarted.stderr.trim()}`);
    await relink('the unit restart');
    const m1 = await until(machine, (m) => m.mawsd !== m0.mawsd && m.engineHost !== null && m.engineHostState === 'ready', 'the new mawsd serving the engine host', 120_000);
    const s1 = await until(() => status(app), (s) => s.process === 'ready' && s.pendingRequests >= 1, 'the session ready with its permission pending after restart 1', 120_000);
    say(`after restart 1: mawsd ${m1.mawsd} (unit MainPID ${m1.unitMain}), engine host ${m1.engineHost} (build ${m1.engineHostBuild}), session hosts ${JSON.stringify(m1.sessionHosts)}`);
    cgroups.push(tree(s1, 'after restart 1'));

    // 2. A pack of another engine-host build installed: the unit restarts on it and the engine host is replaced.
    const node = join(nextPack, 'runtime', 'bin', 'node');
    say(`restart 2: ${node} --disable-sigusr1 ${join(nextPack, 'out', 'main', 'mawsd.js')} install`);
    const installed = spawnSync(node, ['--disable-sigusr1', join(nextPack, 'out', 'main', 'mawsd.js'), 'install'], { encoding: 'utf8', timeout: 180_000 });
    for (const line of `${installed.stdout}${installed.stderr}`.trim().split('\n')) say(`install: ${line}`);
    if (installed.status !== 0) throw new Error(`mawsd install exited ${installed.status ?? installed.signal}`);
    await relink('the install');
    const m2 = await until(machine, (m) => m.mawsd !== m1.mawsd && m.engineHost !== null && m.engineHost !== m1.engineHost && m.engineHostState === 'ready', 'the installed mawsd serving a new engine host', 180_000);
    const s2 = await until(() => status(app), (s) => s.process === 'ready' && s.holder?.adopted === true && s.pendingRequests >= 1, 'the session adopted with its permission pending after restart 2', 180_000);
    say(`after restart 2: mawsd ${m2.mawsd} (unit MainPID ${m2.unitMain}), engine host ${m2.engineHost} (build ${m2.engineHostBuild}), session hosts ${JSON.stringify(m2.sessionHosts)}`);
    cgroups.push(tree(s2, 'after restart 2'));
    const shellAcross = alive(shell);

    // The permission allowed: the turn completes; then the shell's completion reaches the model.
    const answered = await link.request('session.answer', { appSessionId: app, requestId: permission, answer: { kind: 'permission', decision: 'allow', scope: 'once' } });
    say(`answered ${permission}: ${answered.outcome}`);
    const ended = (marker) => (events) => events.filter((e) => e.kind === 'turn.ended' && !e.isEchoReceipt && String(e.resultText ?? e.result ?? '').includes(marker));
    const done = ended(`o16-holder done ${tag}`);
    const notified = ended(`o16-holder notified ${tag}`);
    await until(() => eventsOf(link, app), (all) => done(all).length > 0, "the turn's result", 120_000, 2000);
    say('the turn ended');
    await until(() => !alive(shell), (gone) => gone, `the shell ${shell.pid}'s end`, (seconds + 60) * 1000, 2000);
    say(`the shell ${shell.pid} ended`);
    const all = await until(() => eventsOf(link, app), (events) => notified(events).length > 0, "the shell's completion at the model", 120_000, 2000);
    const s3 = await status(app);
    const m3 = await machine();
    cgroups.push(tree(s3, 'at the end'));
    say(`process tree: ${spawnSync('ps', ['-o', 'pid,pgid,ppid,comm', '-u', String(process.getuid())], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /maws-session-ho|claude|PID/.test(l)).join(' | ')}`);

    // The verdict, from the launch's own events.
    const count = (pick) => all.filter(pick).length;
    const failures = [];
    const permissions = count((e) => e.kind === 'permission.requested' && e.requestId === permission);
    const results = done(all).length;
    const reconnects = all.filter((e) => e.kind === 'session.reconnect');
    const hostRestarts = reconnects.filter((e) => e.trigger === 'host_restart' && e.phase === 'reconnected').length;
    const prompts = count((e) => e.kind === 'user.message' && !e.isReplay && contentText(e.content).includes(text));
    for (const e of reconnects) say(`event session.reconnect ${e.phase} trigger ${e.trigger} attempt ${e.attempt} reason ${e.reason}`);
    say(`events: ${all.length}; permission.requested ${permission} x${permissions}; turn.ended done x${results}, notified x${notified(all).length}; prompt x${prompts}`);
    if (results !== 1) failures.push(`the turn's result arrived ${results} times`);
    if (permissions !== 1) failures.push(`the permission ${permission} was raised ${permissions} times`);
    if (prompts !== 1) failures.push(`the prompt was applied ${prompts} times`);
    if (hostRestarts !== 1 || reconnects.some((e) => e.phase === 'failed' || e.trigger !== 'host_restart')) failures.push(`reconnects: ${reconnects.map((e) => `${e.trigger}/${e.phase}`).join(', ') || 'none'}`);
    if (notified(all).length !== 1) failures.push(`the shell's completion reached the model ${notified(all).length} times`);
    if (!shellAcross) failures.push(`the shell ${shell.pid} did not live across both restarts`);
    if (!(m0.mawsd !== m1.mawsd && m1.mawsd !== m2.mawsd)) failures.push(`mawsd pids ${m0.mawsd} → ${m1.mawsd} → ${m2.mawsd}`);
    if (!(m0.engineHost === m1.engineHost && m1.engineHost !== m2.engineHost)) failures.push(`engine host pids ${m0.engineHost} → ${m1.engineHost} → ${m2.engineHost} (the unit restart keeps it, the install replaces it)`);
    if (m1.engineHostBuild === m2.engineHostBuild) failures.push(`the installed pack's engine host is of the same build ${m2.engineHostBuild}`);
    const pids = [s0, s1, s2, s3].map((s) => `${s.pid}/${s.holder?.pid}`);
    if (new Set(pids).size !== 1) failures.push(`session pid/host pid ${pids.join(' → ')}`);
    if (s3.launchId !== s0.launchId) failures.push(`launch ${s0.launchId} → ${s3.launchId}`);
    if (!cgroups.every(Boolean)) failures.push(`the session host or the engine left the unit's control group (${cgroups.join(', ')})`);
    if (unitProperty('KillMode') !== 'process') failures.push(`KillMode=${unitProperty('KillMode')}`);
    if (m3.engineHost !== m2.engineHost) failures.push(`the engine host changed again at the end (${m2.engineHost} → ${m3.engineHost})`);
    if (failures.length > 0) throw new Error(failures.join('; '));
    say(
      `PASS holder: result once, permission ${permission} once, shell pid ${shell.pid} alive across 2 restarts, reconnect host_restart x1, mawsd pid changed (${m0.mawsd} → ${m1.mawsd} → ${m2.mawsd}), engine host pid changed (${m1.engineHost} → ${m2.engineHost}), session pid unchanged (${s0.pid}, session host ${s0.holder.pid}, launch ${s0.launchId})`,
    );
    await link.request('session.stop', { appSessionId: app, reason: 'stop' }).catch(() => {});
    link.close();
  } finally {
    stub.kill('SIGTERM');
  }
}

function options(argv) {
  const [verb, directory, tag, ...rest] = argv;
  if (verb !== 'run' || !directory || !/^[a-z0-9]{1,16}$/.test(tag ?? '')) throw new Error('holder.mjs run <directory> <tag: [a-z0-9]{1,16}> --next-pack <pack> [--sleep-s 120] [--stub-port 47899]');
  const flag = (name, fallback) => {
    const at = rest.indexOf(`--${name}`);
    return at >= 0 ? rest[at + 1] : fallback;
  };
  const nextPack = flag('next-pack', null);
  if (!nextPack) throw new Error('--next-pack <pack> names the pack to install mid-turn');
  const profile = process.env.MAWS_USER_DATA || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'MAWS');
  return { directory, tag, nextPack, seconds: Number(flag('sleep-s', '120')), stubPort: Number(flag('stub-port', '47899')), profile };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  Promise.resolve()
    .then(() => run(options(process.argv.slice(2))))
    .then(
      () => process.exit(0),
      (error) => {
        console.log(`FAIL holder: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      },
    );
}
