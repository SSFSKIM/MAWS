// The pty host's operation ledger (P5 O7 M3; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M3 "Acts, then
// streams", Interfaces §O): `pty.op` and `pty.opQuery` over a real pty table and real node-pty, the ledger in a scratch
// directory standing for `<profile>/mawsd/pty-host/`. Every shell starts over a scratch home, never the owner's. Each
// lifecycle is tested at its transitions: a reseal after a lost channel, the ledger reopened by a new process with an
// op still claimed, a pty that moved on between an act and its replay.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { HostClientHooks } from '@shared/host/runtime';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { writeScratchShellHome } from '../../test/support/shell-home';
import { terminalEnvironment } from './env';
import { openPtyOpsLedger, PTY_OPS_FILE, ptyOps } from './ops';
import { ptyHostRegister } from './register';
import { createPtyTable, type PtyTable } from './table';

vi.setConfig({ testTimeout: 20_000 }); // real shells and floods, as table.test.ts waits on them
const WAIT_MS = 18_000;
const SHELL_HOME = writeScratchShellHome(mkdtempSync(join(tmpdir(), 'maws-ptyops-home-')));
const BASE_ENV: NodeJS.ProcessEnv = { ...process.env, HOME: SHELL_HOME.dir, ...SHELL_HOME.env };
const ENVIRONMENT = terminalEnvironment(BASE_ENV, { appVersion: '9.9.9' });
afterAll(() => rmSync(SHELL_HOME.dir, { recursive: true, force: true }));

const dirs: string[] = [];
const tables: PtyTable[] = [];
afterEach(async () => {
  for (const table of tables.splice(0)) for (const info of table.list().ptys) if (info.alive) await table.kill({ ptyId: info.ptyId, signal: 'SIGKILL' });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'maws-ptyops-'));
  dirs.push(dir);
  return join(dir, 'mawsd', 'pty-host');
};

// A table over real node-pty, its environment resolving when `gate` does (at once by default), and the output it emitted.
function harness(gate: Promise<Record<string, string>> = Promise.resolve(ENVIRONMENT)) {
  const output = new Map<string, Uint8Array[]>();
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    if (name === 'pty.data') {
      const { ptyId, data } = payload as EventPayload<'pty.data'>;
      output.set(ptyId, [...(output.get(ptyId) ?? []), data]);
    }
    return true;
  };
  const table = createPtyTable({ emit, environment: gate });
  tables.push(table);
  const bytes = (ptyId: string) => new Uint8Array(Buffer.concat(output.get(ptyId) ?? []));
  const text = (ptyId: string) => new TextDecoder().decode(bytes(ptyId));
  const until = (check: () => boolean, what: string) =>
    vi.waitFor(() => {
      if (!check()) throw new Error(`${what} did not hold`);
    }, { timeout: WAIT_MS, interval: 10 });
  return { table, bytes, text, until };
}

let ops = 0;
const opId = () => `op-${String(++ops).padStart(4, '0')}-abcdefghijkl`;
const now = () => new Date().toISOString();
const CLAIM = { member: 'member-1', device: 'device-1', fingerprint: 'fp-1' };
const act = (name: string, input: unknown, id = opId(), extra: object = {}) => ({ opId: id, opCreated: now(), claim: CLAIM, name, input: input as never, ...extra });
const query = (id: string, tombstoneIfAbsent = false, opCreated = now()) => ({ opId: id, opCreated, tombstoneIfAbsent });
let labels = 0;
const spawnArgs = (rest: { appSessionId?: string; args?: string[] } = {}) => ({
  appSessionId: rest.appSessionId ?? 'app-session-1',
  label: `terminal-${++labels}`,
  cwd: '/tmp',
  cols: 80,
  rows: 24,
  shell: '/bin/sh',
  args: rest.args ?? ['-c', 'echo ready-marker; exec cat'],
});

describe('pty.op', () => {
  it('runs a claimed spawn once; a replay of its opId answers the stored result and spawns nothing', async () => {
    const h = harness();
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });
    const spawn = act('pty.spawn', spawnArgs());
    const first = await run.op(spawn);
    expect(first).toMatchObject({ state: 'done', result: { ok: true, value: { ptyId: expect.any(String), pid: expect.any(Number) } } });
    const again = await run.op(spawn);
    expect(again).toEqual(first);
    expect(h.table.list().ptys).toHaveLength(1);
  });

  it('answers opQuery’s states: not-received, a tombstone that refuses the late copy, in-progress, done with its binding, expired, op-conflict', async () => {
    let release!: (env: Record<string, string>) => void;
    const h = harness(new Promise((resolve) => (release = resolve)));
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });

    const absent = opId();
    expect(run.opQuery(query(absent))).toEqual({ state: 'not-received' });
    expect(run.opQuery(query(absent, true))).toEqual({ state: 'not-received' });
    expect(await run.op(act('pty.spawn', spawnArgs(), absent))).toEqual({ state: 'refused', reason: 'tombstoned' });

    const spawn = act('pty.spawn', spawnArgs({ appSessionId: 'app-session-2' }));
    const running = run.op(spawn); // claimed; the spawn waits on the login-shell environment
    const binding = { ...CLAIM, target: 'app-session-2', name: 'pty.spawn' };
    expect(run.opQuery(query(spawn.opId))).toEqual({ state: 'in-progress', ...binding });
    expect(await run.op(spawn)).toEqual({ state: 'in-progress' });
    release(ENVIRONMENT);
    const done = await running;
    expect(run.opQuery(query(spawn.opId))).toEqual({ state: 'done', outcome: (done as { result: unknown }).result, ...binding });

    expect(run.opQuery(query(spawn.opId, false, '2020-01-01T00:00:00.000Z'))).toEqual({ state: 'expired' });
    expect(await run.op({ ...spawn, claim: { ...CLAIM, fingerprint: 'fp-other' } })).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(await run.op(act('pty.spawn', spawnArgs(), opId(), { opCreated: '2020-01-01T00:00:00.000Z' }))).toEqual({ state: 'refused', reason: 'expired' });
  });

  it('keeps its ledger in the pty host’s directory, a private file, through the register', async () => {
    const dir = scratch();
    const host = ptyHostRegister({ hostVersion: '9.9.9', capture: async () => ENVIRONMENT, launcher: {}, opsDir: dir });
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    void host.register((name, handler) => void handlers.set(name, handler as never), () => true, {} as HostClientHooks);
    tables.push(host.table()!);
    const spawn = act('pty.spawn', spawnArgs());
    await expect(handlers.get('pty.op')!(spawn)).resolves.toMatchObject({ state: 'done', result: { ok: true } });
    const file = join(dir, PTY_OPS_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, 'utf8')).toContain(spawn.opId);
    await expect(handlers.get('pty.opQuery')!(query(spawn.opId))).resolves.toMatchObject({ state: 'done', target: 'app-session-1' });
  });

  it('a claimed attach takes no credit whatever its args say: a paused reader stays paused, its acked offset unchanged', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnArgs({ args: ['-c', 'yes | head -c 5000000'] }));
    await h.until(() => h.table.inspect(ptyId).flow.mode === 'paused', 'paused');
    h.table.ack({ ptyId, offset: 100 * 1024 });
    const before = h.table.inspect(ptyId).flow;
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });
    const attached = await run.op(act('pty.attach', { ptyId, credit: true }));
    expect(attached).toMatchObject({ state: 'done', result: { ok: true, value: { nextOffset: before.total, info: { ptyId, paused: true } } } });
    expect(h.table.inspect(ptyId).flow).toEqual(before);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(h.table.inspect(ptyId).flow).toEqual(before); // and nothing flows
  });

  it('keeps an attach as {info, ringStart, nextOffset}, no bytes, read back whole by a reopened ledger; a reseal answers that metadata though the pty moved on', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnArgs());
    await h.until(() => h.text(ptyId).includes('ready-marker'), 'the marker');
    h.table.checkpoint({ ptyId, offset: 4, state: 'LOCAL-STATE' });
    const dir = scratch();
    const run = ptyOps({ ledger: openPtyOpsLedger(dir), table: h.table });
    const attach = act('pty.attach', { ptyId });
    const answered = await run.op(attach);
    const value = (answered as { result: { value: Record<string, unknown> } }).result.value;
    expect(Object.keys(value).sort()).toEqual(['info', 'nextOffset', 'ringStart']);
    expect(value).toMatchObject({ ringStart: 0, nextOffset: h.table.list().ptys[0]!.offset });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value); // nothing a JSON copy changes: no bytes, no checkpoint

    h.table.write({ ptyId, data: 'more-output\n' }); // the pty moves on after the act
    await h.until(() => h.text(ptyId).includes('more-output'), 'the echo');
    const reopened = ptyOps({ ledger: openPtyOpsLedger(dir), table: h.table }); // a new process over the same file
    expect(reopened.opQuery(query(attach.opId))).toMatchObject({ state: 'done', outcome: { ok: true, value }, target: ptyId, name: 'pty.attach' });
    expect(await reopened.op(attach)).toEqual(answered); // the reseal after a lost channel: the stored metadata, not today's
  });

  it('refuses any name outside spawn, attach, kill and listFor as unavailable, claiming nothing', async () => {
    const h = harness();
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });
    for (const name of ['pty.write', 'pty.resize', 'pty.ack', 'pty.checkpoint', 'pty.list', 'pty.replay', 'pty.op', 'pty.opQuery', 'pty.recaptureEnv', 'session.send', 'constructor', 'nothing']) {
      const asked = act(name, { ptyId: 'p-1', data: 'x', offset: 0, state: '' });
      expect(await run.op(asked)).toEqual({ state: 'refused', reason: 'unavailable' });
      expect(run.opQuery(query(asked.opId))).toEqual({ state: 'not-received' });
    }
  });

  it('refuses an input outside its command’s schema as malformed, claiming nothing', async () => {
    const h = harness();
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });
    for (const [name, input] of [['pty.spawn', { appSessionId: 'a', label: 't', cwd: '/tmp', cols: 80, rows: 24, env: {} }], ['pty.attach', { ptyId: 'p', credit: 'yes' }], ['pty.listFor', {}], ['pty.kill', null]] as const) {
      const asked = act(name, input);
      expect(await run.op(asked)).toEqual({ state: 'refused', reason: 'malformed' });
      expect(run.opQuery(query(asked.opId))).toEqual({ state: 'not-received' });
    }
  });

  it('keeps a failed run as tried: an attach of an unknown pty answers its error, and so does its replay', async () => {
    const h = harness();
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });
    const attach = act('pty.attach', { ptyId: 'never-issued' });
    const failed = await run.op(attach);
    expect(failed).toEqual({ state: 'done', result: { ok: false, error: expect.objectContaining({ code: 'internal', message: 'unknown pty' }) } });
    expect(await run.op(attach)).toEqual(failed);
  });

  it('runs a kill once: its reseal answers the stored outcome, not the removed pty’s "unknown pty"', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnArgs());
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });
    const kill = act('pty.kill', { ptyId });
    const killed = await run.op(kill);
    expect(killed).toEqual({ state: 'done', result: { ok: true } });
    await h.until(() => h.table.list().ptys.length === 0, 'the killed pty removed');
    expect(await run.op(kill)).toEqual(killed);
    expect(run.opQuery(query(kill.opId))).toMatchObject({ state: 'done', target: ptyId, name: 'pty.kill' });
  });

  it('answers pty.listFor with that session’s ptys only, as a claimed act', async () => {
    const h = harness();
    const mine = await h.table.spawn(spawnArgs({ appSessionId: 'app-mine' }));
    await h.table.spawn(spawnArgs({ appSessionId: 'app-other' }));
    const run = ptyOps({ ledger: openPtyOpsLedger(scratch()), table: h.table });
    const listed = await run.op(act('pty.listFor', { appSessionId: 'app-mine' }));
    expect(listed).toMatchObject({ state: 'done', result: { ok: true } });
    const { ptys } = (listed as { result: { value: { ptys: { ptyId: string; appSessionId: string }[] } } }).result.value;
    expect(ptys.map((pty) => [pty.ptyId, pty.appSessionId])).toEqual([[mine.ptyId, 'app-mine']]);
  });

  it('a claim the last process left unfinished answers expired at the next open and is never run again', async () => {
    const dir = scratch();
    const stuck = harness(new Promise(() => {})); // the last process: its spawn never got past the environment
    const last = ptyOps({ ledger: openPtyOpsLedger(dir), table: stuck.table });
    const spawn = act('pty.spawn', spawnArgs());
    void last.op(spawn);
    expect(last.opQuery(query(spawn.opId))).toMatchObject({ state: 'in-progress' });

    const h = harness(); // the next process: a new table, empty, over the same file
    const next = ptyOps({ ledger: openPtyOpsLedger(dir), table: h.table });
    expect(next.opQuery(query(spawn.opId))).toEqual({ state: 'expired' });
    expect(await next.op(spawn)).toEqual({ state: 'in-progress' });
    expect(h.table.list().ptys).toEqual([]);
  });

  it('with no ledger (a utility host, which no endpoint reaches) refuses every op and answers every query unavailable', async () => {
    const h = harness();
    const run = ptyOps({ ledger: null, table: h.table });
    expect(await run.op(act('pty.listFor', { appSessionId: 'a' }))).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(run.opQuery(query(opId(), true))).toEqual({ state: 'unavailable' });
  });
});

describe('pty.replay and pty.listFor on the table', () => {
  it('pty.replay answers the ring from an offset below the local checkpoint, and never touches the credit', async () => {
    const h = harness();
    const { ptyId } = await h.table.spawn(spawnArgs({ args: ['-c', 'yes | head -c 5000000'] }));
    await h.until(() => h.table.inspect(ptyId).flow.mode === 'paused', 'paused');
    const checkpoint = 200 * 1024;
    h.table.ack({ ptyId, offset: checkpoint });
    h.table.checkpoint({ ptyId, offset: checkpoint, state: 'LOCAL-STATE' });
    const before = h.table.inspect(ptyId).flow;
    const from = 1000;
    const replayed = h.table.replay({ ptyId, from });
    expect(replayed.replayFrom).toBe(from); // the viewer's own offset, not the local checkpoint
    expect(replayed.nextOffset).toBe(before.total);
    expect(replayed.replay).toEqual(h.bytes(ptyId).subarray(from)); // the ring reaches back past the checkpoint
    expect(h.table.inspect(ptyId).flow).toEqual(before);
    expect(h.table.attach({ ptyId, credit: false }).checkpoint).toEqual({ offset: checkpoint, state: 'LOCAL-STATE' }); // kept as it was
    expect(h.table.replay({ ptyId, from: before.total + 10 })).toMatchObject({ replayFrom: before.total + 10, nextOffset: before.total, replay: new Uint8Array(0) });
    expect(() => h.table.replay({ ptyId: 'never-issued', from: 0 })).toThrow('unknown pty');
  });

  it('pty.listFor lists a session’s ptys, a dead one kept for a reload included', async () => {
    const h = harness();
    const dead = await h.table.spawn(spawnArgs({ appSessionId: 'app-mine', args: ['-c', 'exit 0'] }));
    const live = await h.table.spawn(spawnArgs({ appSessionId: 'app-mine' }));
    await h.table.spawn(spawnArgs({ appSessionId: 'app-other' }));
    await h.until(() => h.table.list().ptys.some((pty) => pty.ptyId === dead.ptyId && !pty.alive), 'the exit');
    const { ptys } = h.table.listFor({ appSessionId: 'app-mine' as never });
    expect(ptys.map((pty) => pty.ptyId).sort()).toEqual([dead.ptyId, live.ptyId].sort());
    expect(h.table.listFor({ appSessionId: 'app-none' as never })).toEqual({ ptys: [] });
  });
});
