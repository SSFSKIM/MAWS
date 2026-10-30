// `mawsd`'s pty relay and the pty host's output credit (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, "The
// pty host's output credit while no app is attached"): the daemon in this process, and the pty host's real handlers over
// a real pty table and node-pty (src/pty-host/register.ts), served by the real socket layer on a real socket with a fake
// pid (test/support/mawsd-scene.ts). Every shell starts over a scratch home, never the owner's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { createHostRuntime, type HostRegister } from '@shared/host/runtime';
import { HIGH_WATERMARK } from '../pty-host/flow';
import { ptyHostRegister, type PtyHostRegister } from '../pty-host/register';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { MawsdScene, until, type RawApp } from '../../test/support/mawsd-scene';

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

beforeEach(() => {
  scene = new MawsdScene('maws-mp-');
  registers = [];
  calls = [];
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

// The pty host's real handlers, each request recorded as it arrives.
function bringUp(pid: number) {
  const real = ptyHostRegister({ hostVersion: '9.9.9', capture: async () => ({ ...ENV }), launcher: ENV });
  registers.push(real);
  const recorded: HostRegister = (on, emit, client) =>
    real.register(
      ((name: string, handler: (input: unknown, ctx: unknown) => Promise<unknown>) =>
        (on as (n: string, h: (input: unknown, ctx: unknown) => Promise<unknown>) => void)(name, async (input, ctx) => {
          calls.push({ name, input });
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
