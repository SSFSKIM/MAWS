// The built `mawsd` as a process (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M5's Proves, the last
// item): `out/main/mawsd.js` under plain Node with a scratch profile and a scratch HOME, spawning the built engine host.
// An app-side connection is welcomed by the spawned engine host; `daemon.restart` ends mawsd with 75, and the next mawsd
// (started here as a unit would restart it) adopts the same engine host. Skipped without a build, as the bundle guard is;
// class 1a builds first.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RawApp, until } from '../../test/support/mawsd-scene';

const MAWSD = resolve(__dirname, '../../out/main/mawsd.js');
vi.setConfig({ testTimeout: 60_000 });

let scratch: string | null = null;
const children: ChildProcess[] = [];
const pids: number[] = [];

afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function run(profile: string): { child: ChildProcess; exited: Promise<number | null>; output: () => string } {
  let output = '';
  const child = spawn(process.execPath, ['--disable-sigusr1', MAWSD, 'run', '--private', '--dir', join(profile, 'mawsd')], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(profile, 'home'), MAWS_USER_DATA: profile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => void (output += chunk.toString()));
  const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));
  return { child, exited, output: () => output };
}

const log = (profile: string) => {
  try {
    return readFileSync(join(profile, 'mawsd', 'mawsd.log'), 'utf8');
  } catch {
    return '';
  }
};

// The nth mawsd over the profile serves (the log is the profile's, across runs)
async function served(profile: string, mawsd: ReturnType<typeof run>, nth: number): Promise<void> {
  const machineSock = join(profile, 'mawsd', 'machine.sock');
  const serving = () => log(profile).split('\n').filter((line) => line.includes(' serving;')).length;
  await until(() => serving() >= nth || mawsd.child.exitCode !== null, 20_000, `mawsd to serve:\n${mawsd.output()}\n${log(profile)}`);
  expect(mawsd.child.exitCode, `${mawsd.output()}\n${log(profile)}`).toBeNull();
  expect(existsSync(machineSock)).toBe(true);
}

describe.skipIf(!existsSync(MAWSD))('the built mawsd under plain Node', () => {
  it('an app is welcomed by the engine host it spawned; daemon.restart exits 75 and the next mawsd adopts the same engine host', async () => {
    scratch = mkdtempSync(join(tmpdir(), 'maws-mp-'));
    const profile = scratch;
    const first = run(profile);
    await served(profile, first, 1);
    const token = () => readFileSync(join(profile, 'mawsd', 'mawsd.token'), 'utf8').trim();

    const app = await RawApp.connect(join(profile, 'mawsd', 'engine-host.sock'), token());
    expect(app.first, log(profile)).toMatchObject({ t: 'welcome' });
    const enginePid = app.first!.pid as number;
    pids.push(enginePid);
    expect(enginePid).not.toBe(first.child.pid);
    expect(alive(enginePid)).toBe(true);
    app.leave();

    const machine = await RawApp.connect(join(profile, 'mawsd', 'machine.sock'), token());
    expect(machine.welcomed()).toBe(true);
    const status = await machine.request('daemon.status');
    expect(status).toMatchObject({ ok: true, value: { pid: first.child.pid, kind: 'private', hosts: { 'engine-host': { pid: enginePid } } } });
    expect(await machine.request('daemon.restart')).toMatchObject({ ok: true });
    await expect(first.exited).resolves.toBe(75);
    expect(alive(enginePid)).toBe(true); // mawsd never stops a session's host

    const second = run(profile); // as the unit restarts it
    await served(profile, second, 2);
    expect(second.child.pid).not.toBe(first.child.pid);
    const back = await RawApp.connect(join(profile, 'mawsd', 'engine-host.sock'), token());
    expect(back.first, log(profile)).toMatchObject({ t: 'welcome', pid: enginePid });
    back.destroy();
    machine.destroy();
    second.child.kill('SIGTERM');
    await expect(second.exited).resolves.toBe(0);
  });
});
