import { execFileSync, spawn } from 'node:child_process';
import { chmod, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionId } from '@shared/graph/ids';
import type { Holder, JobState, LiveSessionRecord } from '@shared/wire/store';
import { StoreFixture } from '../../../test/support/store-fixture';
import { HolderRegistry } from './holders';

const S1 = '11111111-1111-4111-8111-111111111111' as SessionId;
const S2 = '22222222-2222-4222-8222-222222222222' as SessionId;
const NO_SUCH_PID = 2 ** 22 - 1;

interface Emitted {
  sessionId: SessionId;
  holder: Holder;
  registry: LiveSessionRecord | null;
  job: JobState | null;
}

// `ps -o lstart=` for `pid` rendered in the given zone and the C locale, trimmed: the form the engine stores is UTC.
const lstart = (pid: number, tz: string) =>
  execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { LC_ALL: 'C', TZ: tz }, encoding: 'utf8' }).trim();

describe('holders come from live sessions/<pid>.json records', () => {
  let fixture: StoreFixture;
  let emitted: Emitted[];
  let registry: HolderRegistry | null;
  const savedEnv = { TZ: process.env.TZ, LANG: process.env.LANG };

  beforeEach(async () => {
    fixture = await StoreFixture.create();
    emitted = [];
    registry = null;
  });
  afterEach(async () => {
    registry?.stop();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixture.dispose();
  });

  const create = (deps: ConstructorParameters<typeof HolderRegistry>[2] = {}) => {
    registry = new HolderRegistry(fixture.paths, (sessionId, holder, record, job) => emitted.push({ sessionId, holder, registry: record, job }), deps);
    return registry;
  };

  it('an interactive record for a live pid is a terminal holder', async () => {
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', cwd: '/w', status: 'idle' });
    const holders = create();
    await holders.start();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ sessionId: S1, holder: { kind: 'terminal', pid: process.pid }, job: null });
    expect(emitted[0].registry).toMatchObject({ pid: process.pid, sessionId: S1, kind: 'interactive', status: 'idle' });
    expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid: process.pid });
  });

  it('a record for a pid that does not exist holds nothing and emits nothing', async () => {
    await fixture.addRegistryRecord(NO_SUCH_PID, { sessionId: S1, kind: 'interactive' });
    const holders = create();
    await holders.start();
    expect(emitted).toEqual([]);
    expect(holders.holderOf(S1)).toEqual({ kind: 'none' });
  });

  it('compares procStart in UTC and the C locale whatever zone the host runs in (timezone regression gate)', async () => {
    process.env.TZ = 'Asia/Seoul';
    process.env.LANG = 'ko_KR.UTF-8';
    const utc = lstart(process.pid, 'UTC');
    const seoul = lstart(process.pid, 'Asia/Seoul');
    expect(seoul).not.toBe(utc); // nine hours apart: the gate can tell the two conventions apart

    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', procStart: utc });
    const holders = create();
    await holders.start();
    expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid: process.pid });

    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', procStart: seoul });
    await holders.refresh();
    expect(holders.holderOf(S1)).toEqual({ kind: 'none' });
    expect(emitted.map((e) => e.holder)).toEqual([{ kind: 'terminal', pid: process.pid }, { kind: 'none' }]);
  });

  it('a procStart that is some other token is a reused pid, not a holder', async () => {
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', procStart: 'Thu Jan  1 00:00:00 1970' });
    const holders = create();
    await holders.start();
    expect(emitted).toEqual([]);
    expect(holders.holderOf(S1)).toEqual({ kind: 'none' });
  });

  it('degrades to liveness alone when ps cannot be spawned', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', procStart: 'not checkable' });
    const holders = create({ ps: '/nonexistent/ps' });
    await holders.start();
    expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid: process.pid });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('/nonexistent/ps failed'), expect.any(String));
    errors.mockRestore();
  });

  it('keeps a record whose rewrite stays unparseable: a torn registry file does not end a holder', async () => {
    const path = await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive' });
    const holders = create();
    await holders.start();
    await writeFile(path, '{"pid":'); // torn, and never repaired within the retry schedule
    await holders.refresh();
    expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid: process.pid });
    expect(emitted).toHaveLength(1);
  });

  it('holds for a status value the engine adds later', async () => {
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', status: 'some-new-status' });
    const holders = create();
    await holders.start();
    expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid: process.pid });
    expect(emitted[0].registry?.status).toBe('some-new-status');
  });

  it('a record without kind is interactive, and an unknown kind with a live pid still holds as a background job, logged once', async () => {
    await fixture.addRegistryRecord(process.pid, { sessionId: S1 });
    const holders = create();
    await holders.start();
    expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid: process.pid });

    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'future', jobId: 'cafe0123' });
    await holders.refresh();
    await holders.refresh();
    expect(holders.holderOf(S1)).toEqual({ kind: 'background_job', pid: process.pid, jobId: 'cafe0123' });
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(warnings.mock.calls[0].join(' ')).toContain('future');
    warnings.mockRestore();
  });

  it('removing the record emits none', async () => {
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive' });
    const holders = create();
    await holders.start();
    await fixture.removeRegistryRecord(process.pid);
    await holders.refresh();
    expect(emitted.map((e) => [e.sessionId, e.holder, e.registry])).toEqual([
      [S1, { kind: 'terminal', pid: process.pid }, expect.objectContaining({ pid: process.pid })],
      [S1, { kind: 'none' }, null],
    ]);
  });

  it('a live bg record is a background job carrying its jobId, with the job state beside it', async () => {
    await fixture.addJob('11111111', { sessionId: S1, state: 'working', name: 'nightly', template: 'bg' });
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'bg', jobId: '11111111' });
    const holders = create();
    await holders.start();
    expect(holders.holderOf(S1)).toEqual({ kind: 'background_job', pid: process.pid, jobId: '11111111' });
    expect(emitted[0].job).toMatchObject({ sessionId: S1, state: 'working', name: 'nightly' });
  });

  it('a job state alone is not a holder: liveness is decided by pids', async () => {
    await fixture.addJob('22222222', { sessionId: S2, state: 'working' });
    const holders = create();
    await holders.start();
    expect(holders.holderOf(S2)).toEqual({ kind: 'none' });
    expect(emitted).toEqual([]);
  });

  it('daemon records hold as background jobs without a jobId; spares and parked records hold nothing', async () => {
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'daemon' });
    const holders = create();
    await holders.start();
    expect(holders.holderOf(S1)).toEqual({ kind: 'background_job', pid: process.pid, jobId: null });

    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive', spare: true });
    await holders.refresh();
    expect(holders.holderOf(S1)).toEqual({ kind: 'none' });
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'bg', parkedJobId: 'abcdabcd' });
    await holders.refresh();
    expect(holders.holderOf(S1)).toEqual({ kind: 'none' });
  });

  it('a background refresh that cannot read the registry logs and keeps the last known holders, without rejecting', async () => {
    await fixture.addRegistryRecord(process.pid, { sessionId: S1, kind: 'interactive' });
    const holders = create();
    await holders.start();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await chmod(fixture.paths.sessions, 0o000); // the fixture's own temp directory
    try {
      await expect(holders.refresh()).resolves.toBeUndefined();
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('holder refresh failed'), expect.stringContaining('EACCES'));
      expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid: process.pid });
    } finally {
      await chmod(fixture.paths.sessions, 0o755);
      errors.mockRestore();
    }
  });

  it('polls liveness while a holder is known, so a killed process whose record stays behind stops holding', async () => {
    const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    const pid = child.pid!;
    await fixture.addRegistryRecord(pid, { sessionId: S1, kind: 'interactive' });
    const holders = create({ pollMs: 50 });
    await holders.start();
    expect(holders.holderOf(S1)).toEqual({ kind: 'terminal', pid });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;
    await expect.poll(() => holders.holderOf(S1), { timeout: 1_000, interval: 20 }).toEqual({ kind: 'none' });
    expect(emitted.at(-1)).toMatchObject({ sessionId: S1, holder: { kind: 'none' } });
  });
});
