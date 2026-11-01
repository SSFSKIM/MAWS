// `mawsd`'s pty relay and the pty host's output credit (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The
// pty host's output credit while no app is attached"): the daemon in this process, and the pty host's real handlers over
// a real pty table and node-pty (src/pty-host/register.ts), served by the real socket layer on a real socket with a fake
// pid (test/support/mawsd-scene.ts). Every shell starts over a scratch home, never the owner's.
//
// P5 O7 M3 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M3 "The pty stream"): a remote act through the pty
// host's ledger (`pty.op`, src/pty-host/ops.ts), sent through the endpoint seam as the endpoint sends it, beside a local
// reader that holds the credit, and across mawsd's restart with the pty host adopted.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { createHostRuntime, type HostRegister } from '@shared/host/runtime';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { HIGH_WATERMARK } from '../pty-host/flow';
import { openPtyOpsLedger, ptyOps } from '../pty-host/ops';
import { ptyHostRegister, type PtyHostRegister } from '../pty-host/register';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { MawsdScene, until, type RawApp } from '../../test/support/mawsd-scene';
import type { DaemonServices, EndpointModule } from './endpoint-seam';

// Real processes and a 2 MiB flood: a loaded machine slows them well past vitest's default (table.test.ts's budgets).
vi.setConfig({ testTimeout: 30_000 });
const WAIT_MS = 20_000;
const SHELL_HOME = writeScratchShellHome(mkdtempSync(join(tmpdir(), 'maws-mawsd-home-')));
afterAll(() => rmSync(SHELL_HOME.dir, { recursive: true, force: true }));
const ENV = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: SHELL_HOME.dir, LANG: 'en_US.UTF-8', ...SHELL_HOME.env };
const FLOOD = 2 * 1024 * 1024;
const decoder = new TextDecoder();

let scene: MawsdScene;
let registers: PtyHostRegister[];
let calls: { name: string; input: unknown }[];
// P5 O7 M3: when set before the pty host comes up, its ledger's kill waits on it (the ledger and the table stay real)
let killGate: Promise<void> | null;
let killRuns: number;

beforeEach(() => {
  scene = new MawsdScene('maws-mp-');
  registers = [];
  calls = [];
  killGate = null;
  killRuns = 0;
  scene.ptySpawn = (pid) => bringUp(pid);
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
  for (const register of registers) await register.table()?.shutdown();
  await scene.dispose();
  vi.restoreAllMocks();
});

// The pty host's real handlers, each request recorded as it arrives. Under a kill gate, `pty.op` and `pty.opQuery` are
// the real ledger's over the real table, its kill held until the gate opens.
function bringUp(pid: number) {
  const gate = killGate;
  const real = ptyHostRegister({ hostVersion: '9.9.9', capture: async () => ({ ...ENV }), launcher: ENV, ...(gate === null && { opsDir: scene.ptyProfile.dir }) });
  registers.push(real);
  const held =
    gate &&
    ptyOps({
      ledger: openPtyOpsLedger(scene.ptyProfile.dir),
      table: {
        spawn: (input) => real.table()!.spawn(input),
        listFor: (input) => real.table()!.listFor(input),
        attachMetadata: (ptyId) => real.table()!.attachMetadata(ptyId),
        kill: async (input) => {
          await gate;
          killRuns += 1;
          return real.table()!.kill(input);
        },
      },
    });
  const recorded: HostRegister = (on, emit, client) =>
    real.register(
      ((name: string, handler: (input: unknown, ctx: unknown) => Promise<unknown>) =>
        (on as (n: string, h: (input: unknown, ctx: unknown) => Promise<unknown>) => void)(name, async (input, ctx) => {
          calls.push({ name, input });
          if (held && name === 'pty.op') return held.op(input as never);
          if (held && name === 'pty.opQuery') return held.opQuery(input as never);
          return handler(input, ctx);
        })) as never,
      emit,
      client,
    );
  return scene.serve(scene.ptyProfile, { pid, runtime: createHostRuntime(recorded) });
}

const table = () => {
  const found = registers.at(-1)?.table();
  if (!found) throw new Error('no pty host');
  return found;
};
const acks = () => calls.filter((call) => call.name === 'pty.ack').length;
let labels = 0;

// A pty whose program waits, floods FLOOD bytes, prints a marker, then echoes what it is sent.
async function spawnFlood(app: RawApp, marker: string, delay = '0.3'): Promise<string> {
  const answer = await app.request('pty.spawn', {
    appSessionId: 'app-session-1',
    label: `terminal-${++labels}`,
    cwd: tmpdir(),
    cols: 80,
    rows: 24,
    shell: '/bin/sh',
    args: ['-c', `sleep ${delay}; head -c ${FLOOD} /dev/zero | tr '\\0' x; echo ${marker}; exec cat`],
  }, WAIT_MS);
  expect(answer).toMatchObject({ ok: true });
  return (answer.value as { ptyId: string }).ptyId;
}

const written = (ptyId: string) => table().inspect(ptyId).flow.total;

describe('the pty relay', () => {
  it('relays requests and pty.data as pty frames to an app that reads them', async () => {
    await scene.start();
    const app = await scene.app('pty-host');
    expect(app.welcomed()).toBe(true);
    expect(scene.spawn).toHaveBeenCalledOnce();
    app.ready();
    const answer = await app.request('pty.spawn', { appSessionId: 'app-session-1', label: 'frames', cwd: tmpdir(), cols: 80, rows: 24, shell: '/bin/sh', args: ['-c', 'echo relayed-marker; exec cat'] }, WAIT_MS);
    const { ptyId } = answer.value as { ptyId: string };
    await until(() => app.events('pty.data').some((payload) => decoder.decode((payload as { data: Uint8Array }).data).includes('relayed-marker')), WAIT_MS, 'the marker');
    const frame = app.events('pty.data')[0] as { ptyId: string; offset: number; data: Uint8Array };
    expect(frame.ptyId).toBe(ptyId);
    expect(frame.data).toBeInstanceOf(Uint8Array);
    expect(calls.filter((call) => call.name === 'pty.recaptureEnv')).toHaveLength(1); // a fresh login-shell capture per attachment
  });
});

describe('the pty host’s output credit while no app is attached', () => {
  it('with no app attached, a pty writing 2 MiB then a marker stays flowing and writes the marker', async () => {
    await scene.start();
    const app = await scene.app('pty-host');
    app.ready();
    const ptyId = await spawnFlood(app, 'flood-marker-1');
    app.leave(); // before the flood starts: nobody reads it but mawsd
    await until(() => app.closed, WAIT_MS, 'the departure');
    await until(() => written(ptyId) >= FLOOD + 'flood-marker-1'.length, WAIT_MS, 'the flood and its marker');
    expect(table().inspect(ptyId).flow.mode).toBe('flowing');
    expect(acks()).toBeGreaterThan(0);
    const back = await scene.app('pty-host');
    const attached = await back.request('pty.attach', { ptyId }, WAIT_MS);
    expect(decoder.decode((attached.value as { replay: Uint8Array }).replay)).toContain('flood-marker-1');
  });

  it('after an app’s welcome mawsd sends no further pty.ack', async () => {
    await scene.start();
    const first = await scene.app('pty-host');
    first.ready();
    const ptyId = await spawnFlood(first, 'flood-marker-2', '0');
    first.leave();
    await until(() => written(ptyId) >= FLOOD, WAIT_MS, 'the flood');
    const app = await scene.app('pty-host');
    app.ready();
    await until(() => calls.filter((call) => call.name === 'pty.recaptureEnv').length === 2, WAIT_MS, 'the second attachment');
    const before = acks();
    const attach = await app.request('pty.attach', { ptyId }, WAIT_MS); // the renderer's attach takes the credit
    expect(attach).toMatchObject({ ok: true });
    app.post({ t: 'req', id: 'w', name: 'pty.write', input: { ptyId, data: 'after-the-welcome\n' } });
    await until(() => app.events('pty.data').some((payload) => decoder.decode((payload as { data: Uint8Array }).data).includes('after-the-welcome')), WAIT_MS, 'the echo');
    expect(acks()).toBe(before);
  });

  it('recovers after a restart: a pty that paused while mawsd was down resumes, its host adopted with no spawn', async () => {
    const first = await scene.start();
    const app = await scene.app('pty-host');
    app.ready();
    const ptyId = await spawnFlood(app, 'flood-marker-3', '0.5');
    app.leave();
    await until(() => app.closed, WAIT_MS, 'the departure');
    await first.stop('test'); // the pty host keeps running; nobody holds its credit
    scene.daemons.length = 0;
    await until(() => table().inspect(ptyId).flow.mode === 'paused', WAIT_MS, 'the pause');
    expect(written(ptyId)).toBeLessThan(FLOOD);
    expect(written(ptyId)).toBeGreaterThanOrEqual(HIGH_WATERMARK);
    const spawns = scene.spawn.mock.calls.length;
    await scene.start();
    await until(() => written(ptyId) >= FLOOD + 'flood-marker-3'.length, WAIT_MS, 'the flood and its marker');
    expect(scene.spawn.mock.calls.length).toBe(spawns); // adopted
    expect(table().inspect(ptyId).flow.mode).toBe('flowing');
    expect(scene.apps.filter((each) => !each.closed)).toEqual([]); // no app opened
  });
});

// The endpoint module as mawsd starts it: it keeps the seam, through which the tests send what the endpoint sends.
class SeamEndpoint implements EndpointModule {
  private services: DaemonServices | null = null;
  async start(services: DaemonServices): Promise<void> {
    this.services = services;
  }
  async stop(): Promise<void> {}
  status(): unknown {
    return { enrolled: false };
  }
  enrollment(): null {
    return null;
  }
  async cli(): Promise<{ code: number; out: string }> {
    return { code: 0, out: '' };
  }
  get s(): DaemonServices {
    if (!this.services) throw new Error('not started');
    return this.services;
  }
}

let opIds = 0;
const remoteAct = (name: string, input: unknown) => ({ opId: `op-${String(++opIds).padStart(4, '0')}-abcdefghijkl`, opCreated: new Date().toISOString(), claim: { member: 'member-2', device: 'device-2', fingerprint: 'fp-2' }, name, input });
const answered = (response: HostResponse) => {
  if (!response.ok) throw new Error(`the seam refused: ${response.error.message}`);
  return response.value as { state: string; result?: { ok: boolean; value?: unknown }; outcome?: unknown };
};

describe('a remote act through the pty host’s ledger (P5 O7 M3)', () => {
  it('a local reader paused on the pty’s credit and a remote attach through pty.op leave the local flow’s acked offset and pause unchanged', async () => {
    const endpoint = new SeamEndpoint();
    await scene.start({ endpoint });
    const app = await scene.app('pty-host');
    app.ready();
    const ptyId = await spawnFlood(app, 'flood-marker-remote', '0'); // the app holds the credit and acknowledges nothing
    await until(() => table().inspect(ptyId).flow.mode === 'paused', WAIT_MS, 'the local reader’s pause');
    const before = table().inspect(ptyId).flow;
    const acksBefore = acks();

    const attach = answered(await endpoint.s.dispatch('pty-host', 'pty.op', remoteAct('pty.attach', { ptyId, credit: true })));
    expect(attach).toMatchObject({ state: 'done', result: { ok: true, value: { ringStart: 0, nextOffset: before.total, info: { ptyId, paused: true } } } });
    const replay = await endpoint.s.dispatch('pty-host', 'pty.replay', { ptyId, from: 0 }); // the stream's read of the ring at its open
    expect(replay).toMatchObject({ ok: true, value: { replayFrom: 0, nextOffset: before.total } });

    expect(table().inspect(ptyId).flow).toEqual(before);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(table().inspect(ptyId).flow).toEqual(before); // still paused: nothing acknowledged on the local reader's behalf
    expect(acks()).toBe(acksBefore);
    expect(calls.filter((call) => call.name === 'pty.attach')).toEqual([]); // the ledger's attach never reaches the crediting one
  });

  it('a spawn through pty.op outlives mawsd’s restart: the adopted pty host answers its query and its reseal from the ledger, spawning nothing more', async () => {
    const first = new SeamEndpoint();
    const daemon = await scene.start({ endpoint: first });
    const spawn = remoteAct('pty.spawn', { appSessionId: 'app-session-remote', label: 'remote-1', cwd: tmpdir(), cols: 80, rows: 24, shell: '/bin/sh', args: ['-c', 'exec cat'] });
    const done = answered(await first.s.dispatch('pty-host', 'pty.op', spawn));
    expect(done).toMatchObject({ state: 'done', result: { ok: true, value: { ptyId: expect.any(String) } } });
    const hosts = scene.spawn.mock.calls.length;

    await daemon.stop('test'); // the pty host keeps running, its shell alive
    scene.daemons.length = 0;
    const second = new SeamEndpoint();
    await scene.start({ endpoint: second });
    const query = answered(await second.s.dispatch('pty-host', 'pty.opQuery', { opId: spawn.opId, opCreated: spawn.opCreated, tombstoneIfAbsent: true }));
    expect(query).toMatchObject({ state: 'done', outcome: done.result, target: 'app-session-remote', name: 'pty.spawn', member: 'member-2', device: 'device-2' });
    expect(answered(await second.s.dispatch('pty-host', 'pty.op', spawn))).toEqual(done); // the reseal: the stored answer
    expect(scene.spawn.mock.calls.length).toBe(hosts); // adopted, not restarted
    expect(table().list().ptys.filter((pty) => pty.alive)).toHaveLength(1);
    expect(calls.filter((call) => call.name === 'pty.spawn')).toHaveLength(0); // the ledger ran the table's spawn itself, once
  });

  it('a kill in flight across mawsd’s restart completes in the adopted pty host: its query goes in-progress to done with the original binding, once, no host replaced', async () => {
    let open!: () => void;
    killGate = new Promise((resolve) => (open = resolve));
    const first = new SeamEndpoint();
    const daemon = await scene.start({ endpoint: first });
    const shell = (label: string) => remoteAct('pty.spawn', { appSessionId: 'app-session-remote', label, cwd: tmpdir(), cols: 80, rows: 24, shell: '/bin/sh', args: ['-c', 'exec cat'] });
    const doomed = answered(await first.s.dispatch('pty-host', 'pty.op', shell('doomed')));
    const { ptyId } = (doomed.result as { value: { ptyId: string } }).value;
    answered(await first.s.dispatch('pty-host', 'pty.op', shell('kept'))); // a live pty after the kill, so the new mawsd never parks the host
    const hosts = scene.spawn.mock.calls.length;

    const kill = remoteAct('pty.kill', { ptyId });
    const lost = first.s.dispatch('pty-host', 'pty.op', kill).catch((error: unknown) => error); // its answer is lost with the daemon
    const ask = (endpoint: SeamEndpoint) => endpoint.s.dispatch('pty-host', 'pty.opQuery', { opId: kill.opId, opCreated: kill.opCreated, tombstoneIfAbsent: true }).then(answered);
    const binding = { member: 'member-2', device: 'device-2', fingerprint: 'fp-2', target: ptyId, name: 'pty.kill' };
    await vi.waitFor(async () => expect(await ask(first)).toEqual({ state: 'in-progress', ...binding }), { timeout: WAIT_MS, interval: 20 });

    await daemon.stop('test'); // the pty host keeps running, the kill held in its handler
    scene.daemons.length = 0;
    await lost;
    const second = new SeamEndpoint();
    await scene.start({ endpoint: second });
    expect(await ask(second)).toEqual({ state: 'in-progress', ...binding }); // adopted mid-op: the same claim, still running
    expect(await second.s.dispatch('pty-host', 'pty.op', kill).then(answered)).toEqual({ state: 'in-progress' }); // a reseal runs nothing

    open();
    await vi.waitFor(async () => expect(await ask(second)).toEqual({ state: 'done', outcome: { ok: true }, ...binding }), { timeout: WAIT_MS, interval: 20 });
    expect(await second.s.dispatch('pty-host', 'pty.op', kill).then(answered)).toEqual({ state: 'done', result: { ok: true } });
    expect(killRuns).toBe(1);
    await until(() => !table().list().ptys.some((pty) => pty.ptyId === ptyId), WAIT_MS, 'the killed pty removed');
    expect(table().list().ptys.filter((pty) => pty.alive).map((pty) => pty.label)).toEqual(['kept']);
    expect(scene.spawn.mock.calls.length).toBe(hosts); // adopted, never replaced
    expect(registers).toHaveLength(1);
  });
});
