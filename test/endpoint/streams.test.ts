// Remote terminals and forwarded ports at the endpoint (P5 O7 M3, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Acts, then streams", "Streams", "The pty stream", "Forwarding"; Interfaces §L's M3 rows, §N): the offer rows, each
// admitted for a caller who holds `shell` and refused for one who doesn't; then the streams opened under those acts, over
// a fake pty host that keeps a ring and emits frames, and a real loopback HTTP server for the forwards. The transitions a
// single channel's life hides are each a case: a reopen on a new channel from offsets, a forward across the loss of its
// channel (and past its window), a grant withdrawn mid-stream, two devices on one pty.
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { keyId, signRecord, SIGNING_DOMAINS, type Action, type Grant } from 'org-protocol';
import type { Decision } from '../../src/endpoint/authorize';
import { OFFERS } from '../../src/endpoint/offers';
import { STREAM_BACKLOG_BYTES } from '../../src/endpoint/streams';
import { FakePtyHost } from './fake-pty-host';
import { iso } from './org-fixtures';
import { act, done, drop, makeOrg, openRemote, ORG, sleep, startEndpoint, stopAll, until, waitFor, type Fixture, type Msg, type Org, type Remote, type StartOptions } from './sub-harness';

let org: Org;
const started: Fixture[] = [];
const servers: Array<Server | TcpServer> = [];

beforeAll(async () => {
  org = await makeOrg();
});
afterEach(async () => {
  await stopAll(started);
  for (const server of servers.splice(0)) {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
afterAll(() => stopAll(started));

const LIMITS = { perSource: { burst: 1000, perMinute: 60_000 }, overall: { burst: 1000, perMinute: 60_000 } };
const id16 = () => randomBytes(16).toString('base64url');
const b64 = (text: string | Uint8Array) => Buffer.from(text).toString('base64url');

async function start(options: StartOptions = {}): Promise<Fixture & { pty: FakePtyHost }> {
  const f = await startEndpoint(org, started, { pty: new FakePtyHost(), limits: LIMITS, ...options });
  return f as Fixture & { pty: FakePtyHost };
}

async function grant(f: Fixture, member: string, rights: Grant['rights'], version = 1): Promise<string> {
  const body: Grant = { org: ORG, machine: f.ref, machineKey: await keyId(f.key.pub), member, rights, version, issued: iso(Date.now()) };
  return (await f.endpoint.cli('grant', ['-'], JSON.stringify(await signRecord(SIGNING_DOMAINS.grant, body, org.a1.stepUp.privateKey, org.a1.stepUp.pub)))).out;
}

/** A shell act of `r` on the machine, step-up signed (a non-owner's needs it; an owner's carries it harmlessly). */
async function shellAct(f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Promise<Action> {
  return r.device.stepUp(r.device.action({ machine: f.ref, action: name, args }));
}

/** An act run to its outcome: the action and its `done`'s outcome. */
async function run(f: Fixture, r: Remote, name: string, args: Record<string, unknown>): Promise<{ action: Action; outcome: { state: string; result?: Record<string, unknown> } }> {
  const action = await shellAct(f, r, name, args);
  const from = r.inbox.length;
  expect(await act(r, action)).toBe('ok');
  return { action, outcome: (await done(r, action, from)) as { state: string; result?: Record<string, unknown> } };
}

type PtyOpen = { from?: number; epoch?: string; inputFrom?: number; credit?: number };

/** A pty stream opened under `op`: its id and the endpoint's answer (`streamOpened` or `streamRefused`). */
async function openPty(r: Remote, op: string, ptyId: string, o: PtyOpen = {}): Promise<{ id: string; answer: Msg }> {
  const id = id16();
  const from = r.inbox.length;
  await r.channel.send({ t: 'streamOpen', id, kind: 'pty', op, credit: o.credit ?? 1024 * 1024, pty: { ptyId, from: o.from ?? 0, inputEpoch: o.epoch ?? id16(), inputFrom: o.inputFrom ?? 0 } });
  return { id, answer: await waitFor(r, (m) => m.id === id && (m.t === 'streamOpened' || m.t === 'streamRefused'), `the answer to stream ${id}`, from) };
}

async function openTcp(r: Remote, op: string, forward: string, credit = 1024 * 1024): Promise<{ id: string; answer: Msg }> {
  const id = id16();
  const from = r.inbox.length;
  await r.channel.send({ t: 'streamOpen', id, kind: 'tcp', op, credit, tcp: { forward } });
  return { id, answer: await waitFor(r, (m) => m.id === id && (m.t === 'streamOpened' || m.t === 'streamRefused'), `the answer to stream ${id}`, from) };
}

const ofStream = (r: Remote, id: string) => r.inbox.filter((m) => (m as Msg).id === id) as Msg[];
/** The stream's output so far: its `streamData` decoded, each chunk checked to follow the one before. */
function output(r: Remote, id: string): { from: number; text: string; to: number } {
  const chunks = ofStream(r, id).filter((m) => m.t === 'streamData');
  if (chunks.length === 0) return { from: -1, text: '', to: -1 };
  let at = chunks[0].offset as number;
  let text = '';
  for (const m of chunks) {
    expect(m.offset).toBe(at);
    const bytes = Buffer.from(m.data as string, 'base64url');
    text += bytes.toString('utf8');
    at += bytes.byteLength;
  }
  return { from: chunks[0].offset as number, text, to: at };
}
const closeOf = (r: Remote, id: string) => ofStream(r, id).find((m) => m.t === 'streamClose')?.reason;
const code = (m: Msg) => (m.ok === true ? 'ok' : (m.error as { code: string }).code);

async function http(): Promise<{ port: number; sockets: Socket[] }> {
  const sockets: Socket[] = [];
  const server = createServer((req, res) => res.end(`hello from ${req.url}`));
  server.on('connection', (socket) => void sockets.push(socket));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, sockets };
}

const GET = (path: string) => b64(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);

// ---- The offer rows ---------------------------------------------------------------------------------------------------

describe('the offer rows (§L, M3)', () => {
  it('`pty.spawn`: an owner’s runs once under the pty host’s ledger; a member without `shell` is `grade`, and a `shell` grant holder needs step-up', async () => {
    const f = await start();
    const a = await openRemote(f, org.a1, org.A);
    const spawn = await shellAct(f, a, 'pty.spawn', { appSessionId: 'app-1', label: 't1', cwd: '/work', cols: 80, rows: 24 });
    expect(await act(a, spawn)).toBe('ok');
    expect(await done(a, spawn)).toMatchObject({ state: 'done', result: { ptyId: 'pty-1' } });
    // A reseal answers the stored result and runs nothing.
    expect(await act(a, a.device.reseal(spawn))).toBe('ok');
    expect(f.pty.runs).toEqual(['pty.spawn']);
    const op = f.pty.calls.find((c) => c.name === 'pty.op')!.input as Record<string, unknown>;
    expect(op).toMatchObject({ opId: spawn.opId, name: 'pty.spawn', claim: { member: org.A, device: 'a1' } });
    expect(op).not.toHaveProperty('action');

    const b = await openRemote(f, org.b1, org.B);
    const theirs = b.device.action({ machine: f.ref, action: 'pty.spawn', args: { appSessionId: 'app-1', label: 't2', cwd: '/work', cols: 80, rows: 24 } });
    expect(await act(b, theirs)).toBe('grade');
    expect(await grant(f, org.B, ['shell'])).toBe(`kept: version 1 for member ${org.B}, shell`);
    expect(await act(b, b.device.action({ machine: f.ref, action: 'pty.spawn', args: { appSessionId: 'app-1', label: 't2', cwd: '/work', cols: 80, rows: 24 } }))).toBe('step-up');
    expect(await act(b, await shellAct(f, b, 'pty.spawn', { appSessionId: 'app-1', label: 't2', cwd: '/work', cols: 80, rows: 24 }))).toBe('ok');
  });

  it('`pty.attach`, taking no credit whatever its args, its result the metadata only; refused `grade` without `shell`', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    f.pty.emit(ptyId, 'hello');
    const a = await openRemote(f, org.a1, org.A);
    const { outcome } = await run(f, a, 'pty.attach', { ptyId, credit: true });
    expect(outcome).toEqual({ state: 'done', result: { info: expect.objectContaining({ ptyId, offset: 5 }), ringStart: 0, nextOffset: 5 } });
    // The attach read the pty's metadata only, taking no credit whatever its args said.
    expect(f.pty.attaches).toEqual([ptyId]);
    const b = await openRemote(f, org.b1, org.B);
    expect(await act(b, await shellAct(f, b, 'pty.attach', { ptyId }))).toBe('grade');
  });

  it('`pty.kill`; refused `grade` without `shell`', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const b = await openRemote(f, org.b1, org.B);
    expect(await act(b, await shellAct(f, b, 'pty.kill', { ptyId }))).toBe('grade');
    expect(f.pty.ptys.get(ptyId)!.info.alive).toBe(true);
    const a = await openRemote(f, org.a1, org.A);
    expect((await run(f, a, 'pty.kill', { ptyId })).outcome).toEqual({ state: 'done' });
    expect(f.pty.ptys.get(ptyId)!.info.alive).toBe(false);
  });

  it('`pty.listFor`, filtered to its session; refused `grade` without `shell`', async () => {
    const f = await start();
    const mine = f.pty.spawn('app-1');
    f.pty.spawn('app-2');
    const a = await openRemote(f, org.a1, org.A);
    const { outcome } = await run(f, a, 'pty.listFor', { appSessionId: 'app-1' });
    expect((outcome.result as { ptys: Array<{ ptyId: string }> }).ptys.map((p) => p.ptyId)).toEqual([mine]);
    const b = await openRemote(f, org.b1, org.B);
    expect(await act(b, await shellAct(f, b, 'pty.listFor', { appSessionId: 'app-1' }))).toBe('grade');
  });

  it('`forward.open {port}` under the endpoint’s own ledger, its result naming the forward; `grade` without `shell`, `malformed` for anything but a port', async () => {
    const f = await start();
    const a = await openRemote(f, org.a1, org.A);
    const { action, outcome } = await run(f, a, 'forward.open', { port: 8080 });
    expect(outcome).toEqual({ state: 'done', result: { forward: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), port: 8080 } });
    expect(f.endpoint.forwards.list()).toMatchObject([{ id: outcome.result!.forward, member: org.A, device: 'a1', port: 8080 }]);
    // A reseal answers the same forward and opens no other.
    const from = a.inbox.length;
    expect(await act(a, a.device.reseal(action))).toBe('ok');
    expect(await done(a, action, from)).toEqual(outcome);
    expect(f.endpoint.forwards.list()).toHaveLength(1);
    for (const args of [{ port: 0 }, { port: 65536 }, { port: 80.5 }, { port: '80' }, { port: 80, host: 'example.com' }, {}])
      expect(await act(a, await shellAct(f, a, 'forward.open', args))).toBe('malformed');
    const b = await openRemote(f, org.b1, org.B);
    expect(await act(b, await shellAct(f, b, 'forward.open', { port: 8080 }))).toBe('grade');
  });

  it('answers a pty act `refused unavailable` when the pty host predates its ledger (`unknown_command`): nothing ran', async () => {
    const f = await start();
    const a = await openRemote(f, org.a1, org.A);
    const serve = f.services.dispatch;
    f.services.dispatch = (owner, name, input, client) =>
      owner === 'pty-host' && name === 'pty.op' ? Promise.resolve({ t: 'res', id: 'x', ok: false, error: { code: 'unknown_command', message: 'pty.op' } }) : serve(owner, name, input, client);
    const { outcome } = await run(f, a, 'pty.spawn', { appSessionId: 'app-1', label: 't1', cwd: '/work', cols: 80, rows: 24 });
    expect(outcome).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(f.pty.runs).toEqual([]);
  });

  it('leaves unoffered what §L keeps local: the bytes’ commands, the ledger, the ring’s read and the local registry’s', () => {
    for (const name of ['pty.list', 'pty.replay', 'pty.write', 'pty.resize', 'pty.ack', 'pty.checkpoint', 'pty.op', 'pty.opQuery', 'pty.foreground', 'pty.openLink', 'pty.hostState', 'pty.recaptureEnv'])
      expect([name, Object.hasOwn(OFFERS.commands, name)]).toEqual([name, false]);
    for (const name of ['pty.spawn', 'pty.attach', 'pty.kill', 'pty.listFor']) expect([name, OFFERS.commands[name]]).toEqual([name, { kind: 'act', executor: 'pty-host', target: 'machine' }]);
    expect(OFFERS.commands['forward.open']).toMatchObject({ kind: 'act', executor: 'endpoint', target: 'machine', grade: 'shell' });
  });

  it('takes no `shell` command as a call (`act-required`), and answers a pty act’s query only to its sender', async () => {
    const f = await start();
    const a = await openRemote(f, org.a1, org.A);
    const id = 'c-1';
    await a.channel.send({ t: 'call', id, name: 'pty.attach', input: { ptyId: 'p1' } });
    expect(code(await waitFor(a, (m) => m.t === 'result' && m.id === id, 'the call’s result'))).toBe('act-required');
    const { action } = await run(f, a, 'pty.spawn', { appSessionId: 'app-1', label: 't1', cwd: '/work', cols: 80, rows: 24 });
    const query = async (r: Remote) => {
      const from = r.inbox.length;
      await r.channel.send({ t: 'query', opId: action.opId, opCreated: action.opCreated, executor: 'pty-host' });
      return waitFor(r, (m) => m.t === 'queried' && m.opId === action.opId, 'the query’s answer', from);
    };
    expect(await query(a)).toMatchObject({ state: 'done', outcome: { state: 'done', result: { ptyId: 'pty-1' } } });
    const b = await openRemote(f, org.b1, org.B);
    expect(await query(b)).toEqual({ t: 'queried', opId: action.opId, state: 'refused', reason: 'grade' });
  });
});

// ---- Streams -------------------------------------------------------------------------------------------------------------

describe('admission', () => {
  it('refuses `grade` an open under another member’s act and under an attach of another pty', async () => {
    const f = await start();
    expect(await grant(f, org.B, ['shell'])).toContain('shell');
    const one = f.pty.spawn('app-1');
    const two = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const b = await openRemote(f, org.b1, org.B);
    const theirs = await run(f, b, 'pty.attach', { ptyId: one });
    expect((await openPty(a, theirs.action.opId, one)).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    const mine = await run(f, a, 'pty.attach', { ptyId: one });
    expect((await openPty(a, mine.action.opId, two)).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    // A forward's act opens no pty, and a pty's no connection: each kind reads its own executor's ledger, which holds
    // nothing of the other's op.
    const forward = await run(f, a, 'forward.open', { port: 9 });
    expect((await openPty(a, forward.action.opId, one)).answer).toMatchObject({ t: 'streamRefused', reason: 'unknown' });
    expect((await openTcp(a, mine.action.opId, 'x')).answer).toMatchObject({ t: 'streamRefused', reason: 'unknown' });
    // A forward's act names its own forward only.
    expect((await openTcp(a, forward.action.opId, 'another')).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    // An op nobody sent: `unknown` (a fresh act may open it).
    expect((await openPty(a, id16(), one)).answer).toMatchObject({ t: 'streamRefused', reason: 'unknown' });
    // An output offset past what the pty emitted is no offset the device read.
    expect((await openPty(a, mine.action.opId, one, { from: 1 })).answer).toMatchObject({ t: 'streamRefused', reason: 'malformed' });
    expect((await openPty(a, mine.action.opId, one)).answer).toMatchObject({ t: 'streamOpened' });
  });

  it('tells a caller below the floor nothing: `grade` whatever the op names, the ledger not read', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const real = await run(f, a, 'pty.attach', { ptyId });
    const b = await openRemote(f, org.b1, org.B);
    const asked = f.pty.calls.length;
    expect((await openPty(b, real.action.opId, ptyId)).answer).toMatchObject({ reason: 'grade' });
    expect((await openPty(b, id16(), ptyId)).answer).toMatchObject({ reason: 'grade' });
    expect((await openTcp(b, id16(), 'x')).answer).toMatchObject({ reason: 'grade' });
    expect(f.pty.calls.slice(asked)).toEqual([]);
  });
});

describe('the pty stream', () => {
  it('delivers the ring’s tail from the device’s offset while a local viewer’s checkpoint stands past it, then live output under credit, held past it, and closes `behind` at the backlog', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    f.pty.emit(ptyId, 'hello world');
    f.pty.checkpoint(ptyId, 11);
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const { id, answer } = await openPty(a, action.opId, ptyId, { from: 6, credit: 8 });
    expect(answer).toMatchObject({ t: 'streamOpened', pty: { info: { ptyId }, ringStart: 6, nextOffset: 11 }, credit: 256 * 1024 });
    await until(() => output(a, id).to === 11, 'the ring’s tail');
    expect(output(a, id)).toEqual({ from: 6, text: 'world', to: 11 });
    // 3 bytes of credit left: live output goes up to it and the rest waits for the device's refund.
    f.pty.emit(ptyId, 'abcdef');
    await until(() => output(a, id).to === 14, 'live output up to the credit');
    await sleep(50);
    expect(output(a, id).text).toBe('worldabc');
    await a.channel.send({ t: 'streamCredit', id, bytes: 100 });
    await until(() => output(a, id).to === 17, 'the held output');
    expect(output(a, id).text).toBe('worldabcdef');
    // Past the backlog the stream closes `behind`; the device reopens from its last offset and the ring fills the gap.
    for (let i = 0; i < 3; i++) f.pty.emit(ptyId, 'x'.repeat(STREAM_BACKLOG_BYTES / 2));
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('behind');
    const again = await openPty(a, action.opId, ptyId, { from: 17, credit: 4 * 1024 * 1024 });
    expect(again.answer).toMatchObject({ t: 'streamOpened', pty: { ringStart: 17 + STREAM_BACKLOG_BYTES / 2, nextOffset: 17 + (3 * STREAM_BACKLOG_BYTES) / 2 } });
  });

  it('reopens on a new channel from its offsets under the same act, with no output repeated or lost', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.spawn', { appSessionId: 'app-1', label: 't9', cwd: '/work', cols: 80, rows: 24 });
    const spawned = (await done(a, action)) as { result: { ptyId: string } };
    expect(spawned.result.ptyId).not.toBe(ptyId);
    const pty = spawned.result.ptyId;
    const first = await openPty(a, action.opId, pty);
    f.pty.emit(pty, 'one ');
    await until(() => output(a, first.id).to === 4, 'the first output');
    drop(a);
    f.pty.emit(pty, 'two ');
    const a2 = await openRemote(f, org.a1, org.A);
    const second = await openPty(a2, action.opId, pty, { from: output(a, first.id).to });
    expect(second.answer).toMatchObject({ t: 'streamOpened', pty: { ringStart: 4, nextOffset: 8 } });
    f.pty.emit(pty, 'three');
    await until(() => output(a2, second.id).to === 13, 'the output after the reopen');
    expect(output(a2, second.id)).toEqual({ from: 4, text: 'two three', to: 13 });
  });

  it('writes input once across a reopen, and starts a new input epoch at zero', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const epoch = id16();
    const first = await openPty(a, action.opId, ptyId, { epoch });
    await a.channel.send({ t: 'streamData', id: first.id, offset: 0, data: b64('ls\n') });
    await until(() => f.pty.writes.length === 1, 'the first write');
    drop(a);
    // The device resends what it can't know was written, then goes on.
    const a2 = await openRemote(f, org.a1, org.A);
    const second = await openPty(a2, action.opId, ptyId, { epoch, inputFrom: 0 });
    await a2.channel.send({ t: 'streamData', id: second.id, offset: 0, data: b64('ls\n') });
    await a2.channel.send({ t: 'streamData', id: second.id, offset: 3, data: b64('pwd\n') });
    await until(() => f.pty.writes.length === 2, 'the next write');
    await sleep(50);
    expect(f.pty.writes.map((w) => w.data)).toEqual(['ls\n', 'pwd\n']);
    // A new app run under the same device keys: a new epoch, its offsets from zero again.
    const third = await openPty(a2, action.opId, ptyId, { epoch: id16(), inputFrom: 0 });
    await a2.channel.send({ t: 'streamData', id: third.id, offset: 0, data: b64('ls\n') });
    await until(() => f.pty.writes.length === 3, 'the new epoch’s write');
    expect(f.pty.writes.map((w) => w.data)).toEqual(['ls\n', 'pwd\n', 'ls\n']);
    // Input is credited back once written; a UTF-8 character split across chunks arrives whole.
    const bytes = Buffer.from('é');
    await a2.channel.send({ t: 'streamData', id: third.id, offset: 3, data: b64(bytes.subarray(0, 1)) });
    await a2.channel.send({ t: 'streamData', id: third.id, offset: 4, data: b64(bytes.subarray(1)) });
    await until(() => f.pty.writes.length === 4, 'the character');
    expect(f.pty.writes[3].data).toBe('é');
    await until(() => ofStream(a2, third.id).some((m) => m.t === 'streamCredit'), 'the input credit refunded');
  });

  it('resizes through `pty.resize`, closes `malformed` on another control, and closes `exit` after what it holds when the pty exits', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const { id } = await openPty(a, action.opId, ptyId);
    await a.channel.send({ t: 'streamControl', id, control: { resize: { cols: 120, rows: 40 } } });
    await until(() => f.pty.resizes.length === 1, 'the resize');
    expect(f.pty.resizes).toEqual([{ ptyId, cols: 120, rows: 40 }]);
    f.pty.emit(ptyId, 'bye');
    f.pty.exit(ptyId);
    await until(() => closeOf(a, id), 'the close');
    expect(output(a, id).text).toBe('bye');
    expect(closeOf(a, id)).toBe('exit');
    const other = await openPty(a, action.opId, ptyId);
    // An exited pty's ring still opens, and closes at once after it.
    await until(() => closeOf(a, other.id), 'the exited pty’s close');
    expect(closeOf(a, other.id)).toBe('exit');
    const live = f.pty.spawn('app-1');
    const attach = await run(f, a, 'pty.attach', { ptyId: live });
    const s = await openPty(a, attach.action.opId, live);
    await a.channel.send({ t: 'streamControl', id: s.id, control: { resize: { cols: 0, rows: 40 } } });
    await until(() => closeOf(a, s.id), 'the malformed control’s close');
    expect(closeOf(a, s.id)).toBe('malformed');
  });

  it('streams one pty to two devices, each with its own offsets and input', async () => {
    const f = await start();
    expect(await grant(f, org.B, ['shell'])).toContain('shell');
    const ptyId = f.pty.spawn('app-1');
    f.pty.emit(ptyId, 'ring ');
    const a = await openRemote(f, org.a1, org.A);
    const b = await openRemote(f, org.b1, org.B);
    const mine = await run(f, a, 'pty.attach', { ptyId });
    const theirs = await run(f, b, 'pty.attach', { ptyId });
    const sa = await openPty(a, mine.action.opId, ptyId, { from: 0 });
    const sb = await openPty(b, theirs.action.opId, ptyId, { from: 5 });
    f.pty.emit(ptyId, 'live');
    await until(() => output(a, sa.id).to === 9 && output(b, sb.id).to === 9, 'both outputs');
    expect(output(a, sa.id).text).toBe('ring live');
    expect(output(b, sb.id)).toEqual({ from: 5, text: 'live', to: 9 });
    await a.channel.send({ t: 'streamData', id: sa.id, offset: 0, data: b64('a') });
    await b.channel.send({ t: 'streamData', id: sb.id, offset: 0, data: b64('b') });
    await until(() => f.pty.writes.length === 2, 'both inputs');
    expect(f.pty.writes.map((w) => w.data).sort()).toEqual(['a', 'b']);
  });

  it('dies with its channel: frames after it go nowhere, and the stream reopens on the next', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const { id } = await openPty(a, action.opId, ptyId);
    drop(a);
    await until(() => f.endpoint.channels.size === 0, 'the channel’s end');
    f.pty.emit(ptyId, 'after');
    await sleep(30);
    expect(ofStream(a, id).filter((m) => m.t === 'streamData')).toEqual([]);
    const a2 = await openRemote(f, org.a1, org.A);
    const again = await openPty(a2, action.opId, ptyId);
    await until(() => output(a2, again.id).to === 5, 'the ring on the next channel');
    expect(output(a2, again.id).text).toBe('after');
  });
});

describe('forwarded ports', () => {
  it('carries an HTTP round trip on a `tcp` stream, and refuses one to a closed port `unreachable`', async () => {
    const f = await start();
    const server = await http();
    const a = await openRemote(f, org.a1, org.A);
    const { action, outcome } = await run(f, a, 'forward.open', { port: server.port });
    const forward = outcome.result!.forward as string;
    const { id, answer } = await openTcp(a, action.opId, forward);
    expect(answer).toMatchObject({ t: 'streamOpened', credit: 256 * 1024 });
    await a.channel.send({ t: 'streamData', id, offset: 0, data: GET('/page') });
    await until(() => closeOf(a, id), 'the response and the close');
    expect(output(a, id).text).toMatch(/^HTTP\/1\.1 200 OK[\s\S]*hello from \/page$/);
    expect(closeOf(a, id)).toBe('closed');

    const closed = await http();
    servers.pop()!.close();
    await sleep(20);
    const gone = await run(f, a, 'forward.open', { port: closed.port });
    expect((await openTcp(a, gone.action.opId, gone.outcome.result!.forward as string)).answer).toMatchObject({ t: 'streamRefused', reason: 'unreachable' });
  });

  it('keeps a forward across its channel’s loss within the window, a stream on the next channel naming it with no new act, and forgets it past the window (`unknown`)', async () => {
    const f = await start({ subscriptions: { resumeMs: 400 } });
    const server = await http();
    const a = await openRemote(f, org.a1, org.A);
    const { action, outcome } = await run(f, a, 'forward.open', { port: server.port });
    const forward = outcome.result!.forward as string;
    drop(a);
    const a2 = await openRemote(f, org.a1, org.A);
    const { id } = await openTcp(a2, action.opId, forward);
    await a2.channel.send({ t: 'streamData', id, offset: 0, data: GET('/again') });
    await until(() => closeOf(a2, id), 'the response on the next channel');
    expect(output(a2, id).text).toContain('hello from /again');
    // The next channel holds it now: its loss starts the window again, which then runs out.
    drop(a2);
    await sleep(600);
    expect(f.endpoint.forwards.list()).toEqual([]);
    const a3 = await openRemote(f, org.a1, org.A);
    expect((await openTcp(a3, action.opId, forward)).answer).toMatchObject({ t: 'streamRefused', reason: 'unknown' });
  });

  it('dies with its channel: the connection to the machine’s port is reset', async () => {
    const f = await start();
    const server = await http();
    const a = await openRemote(f, org.a1, org.A);
    const { action, outcome } = await run(f, a, 'forward.open', { port: server.port });
    await openTcp(a, action.opId, outcome.result!.forward as string);
    await until(() => server.sockets.length === 1, 'the connection');
    const socket = server.sockets[0];
    const ended = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    drop(a);
    await ended;
    expect(socket.destroyed).toBe(true);
  });
});

describe('a grant withdrawn', () => {
  it('ends a terminal’s stream `removed` when the machine is made read-only, and opens none while it is', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const { id } = await openPty(a, action.opId, ptyId);
    expect((await f.endpoint.cli('policy', ['--read-only', 'on'])).code).toBe(0);
    await until(() => closeOf(a, id), 'the close');
    expect(closeOf(a, id)).toBe('removed');
    expect((await openPty(a, action.opId, ptyId)).answer).toMatchObject({ reason: 'grade' });
  });

  it('closes an open pty stream and a forward’s stream `removed` within a round trip, the forward removed and the channel kept', async () => {
    const f = await start();
    const server = await http();
    expect(await grant(f, org.B, ['shell'])).toContain('shell');
    const ptyId = f.pty.spawn('app-1');
    const b = await openRemote(f, org.b1, org.B);
    const attach = await run(f, b, 'pty.attach', { ptyId });
    const pty = await openPty(b, attach.action.opId, ptyId);
    const forward = await run(f, b, 'forward.open', { port: server.port });
    const name = forward.outcome.result!.forward as string;
    const tcp = await openTcp(b, forward.action.opId, name);
    expect(tcp.answer.t).toBe('streamOpened');
    await until(() => server.sockets.length === 1, 'the connection');

    expect(await grant(f, org.B, [], 2)).toBe(`kept: version 2 for member ${org.B}, no rights`);
    await until(() => closeOf(b, pty.id) && closeOf(b, tcp.id), 'both closes');
    expect([closeOf(b, pty.id), closeOf(b, tcp.id)]).toEqual(['removed', 'removed']);
    expect(f.endpoint.forwards.list()).toEqual([]);
    await until(() => server.sockets[0].destroyed, 'the connection reset');
    // Input held or sent after it is dropped.
    f.pty.emit(ptyId, 'later');
    await b.channel.send({ t: 'streamData', id: pty.id, offset: 0, data: b64('x') });
    await sleep(30);
    expect(f.pty.writes).toEqual([]);
    expect(ofStream(b, pty.id).filter((m) => m.t === 'streamData')).toEqual([]);
    // The channel is kept, and the forward does not come back with the grade.
    expect(b.channel.closed).toBe(false);
    expect((await openPty(b, attach.action.opId, ptyId)).answer).toMatchObject({ reason: 'grade' });
    expect(await grant(f, org.B, ['shell'], 3)).toContain('shell');
    expect((await openTcp(b, forward.action.opId, name)).answer).toMatchObject({ reason: 'unknown' });
    expect((await openPty(b, attach.action.opId, ptyId)).answer).toMatchObject({ t: 'streamOpened' });
  });
});

// ---- Fix wave 1 (the task review): overlapping re-checks, the opening's races, a failed write, the opening's bound ----

describe('re-checks and the opening’s races', () => {
  it('lets output and input flow after two overlapping refreshes, both granted', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const { id } = await openPty(a, action.opId, ptyId);
    f.endpoint.channels.refreshCaps();
    f.endpoint.channels.refreshCaps();
    f.endpoint.channels.refreshCaps();
    await sleep(30);
    f.pty.emit(ptyId, 'after');
    await a.channel.send({ t: 'streamData', id, offset: 0, data: b64('typed') });
    await until(() => output(a, id).to === 5 && f.pty.writes.length === 1, 'output and input after the refreshes');
    expect(output(a, id).text).toBe('after');
    expect(f.pty.writes.map((w) => w.data)).toEqual(['typed']);
    expect(closeOf(a, id)).toBeUndefined();
  });

  it('opens nothing when `shell` is withdrawn while the ring is read: no answer but `grade`, no bytes either way, nothing left live', async () => {
    const f = await start();
    expect(await grant(f, org.B, ['shell'])).toContain('shell');
    const ptyId = f.pty.spawn('app-1');
    f.pty.emit(ptyId, 'ring');
    const b = await openRemote(f, org.b1, org.B);
    const { action } = await run(f, b, 'pty.attach', { ptyId });
    const release = f.pty.holdReplay();
    const id = id16();
    await b.channel.send({ t: 'streamOpen', id, kind: 'pty', op: action.opId, credit: 1024 * 1024, pty: { ptyId, from: 0, inputEpoch: id16(), inputFrom: 0 } });
    await until(() => f.pty.replayAsked(), 'the ring’s read');
    expect(await grant(f, org.B, [], 2)).toContain('no rights');
    f.pty.emit(ptyId, ' meanwhile');
    release();
    await until(() => ofStream(b, id).length > 0, 'the answer');
    await b.channel.send({ t: 'streamData', id, offset: 0, data: b64('x') });
    f.pty.emit(ptyId, ' later');
    await sleep(50);
    expect(ofStream(b, id)).toEqual([{ t: 'streamRefused', id, reason: 'grade' }]);
    expect(f.pty.writes).toEqual([]);
    expect(b.channel.closed).toBe(false);
    expect(f.endpoint.channels.size).toBe(1);
  });

  it('makes no forward when `shell` is withdrawn between the act’s decision and its effect, and a stream under the act is refused', async () => {
    const f = await start();
    const server = await http();
    expect(await grant(f, org.B, ['shell'])).toContain('shell');
    const b = await openRemote(f, org.b1, org.B);
    const own = f.endpoint.own;
    const runOwn = own.run.bind(own);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    own.run = async (...args) => {
      await held;
      return runOwn(...args);
    };
    const action = await shellAct(f, b, 'forward.open', { port: server.port });
    const from = b.inbox.length;
    expect(await act(b, action)).toBe('ok');
    expect(await grant(f, org.B, [], 2)).toContain('no rights');
    release();
    expect(await done(b, action, from)).toEqual({ state: 'failed', error: { code: 'grade' } });
    expect(f.endpoint.forwards.list()).toEqual([]);
    expect(await grant(f, org.B, ['shell'], 3)).toContain('shell');
    expect((await openTcp(b, action.opId, 'any')).answer).toMatchObject({ t: 'streamRefused', reason: 'grade' });
    expect(server.sockets).toEqual([]);
    expect(b.channel.closed).toBe(false);
  });

  it('bounds the frames that come while the ring is read: past the backlog the stream opens and closes `behind`, with nothing sent', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const release = f.pty.holdReplay();
    const id = id16();
    await a.channel.send({ t: 'streamOpen', id, kind: 'pty', op: action.opId, credit: 4 * 1024 * 1024, pty: { ptyId, from: 0, inputEpoch: id16(), inputFrom: 0 } });
    await until(() => f.pty.replayAsked(), 'the ring’s read');
    for (let i = 0; i < 3; i++) f.pty.emit(ptyId, 'y'.repeat(STREAM_BACKLOG_BYTES / 2));
    release();
    await until(() => closeOf(a, id), 'the close');
    expect(ofStream(a, id).map((m) => m.t)).toEqual(['streamOpened', 'streamClose']);
    expect(closeOf(a, id)).toBe('behind');
  });
});

describe('a failed write', () => {
  it('closes the stream `unavailable` with the chunk unwritten and unacknowledged, and the reopen’s resend is written once', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const epoch = id16();
    const first = await openPty(a, action.opId, ptyId, { epoch });
    f.pty.failWrites = 1;
    await a.channel.send({ t: 'streamData', id: first.id, offset: 0, data: b64('ls\n') });
    await until(() => closeOf(a, first.id), 'the close');
    expect(closeOf(a, first.id)).toBe('unavailable');
    expect(ofStream(a, first.id).some((m) => m.t === 'streamCredit')).toBe(false);
    const second = await openPty(a, action.opId, ptyId, { epoch, inputFrom: 0 });
    await a.channel.send({ t: 'streamData', id: second.id, offset: 0, data: b64('ls\n') });
    await until(() => f.pty.writes.length === 1, 'the resend written');
    await sleep(30);
    expect(f.pty.writes.map((w) => w.data)).toEqual(['ls\n']);
  });
});

describe('a device’s close of a forwarded connection', () => {
  it('resets the machine’s side at once, even against a server that keeps a half-closed connection open', async () => {
    const f = await start();
    const sockets: Socket[] = [];
    const server = createTcpServer({ allowHalfOpen: true }, (socket) => {
      sockets.push(socket);
      socket.on('error', () => {});
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const a = await openRemote(f, org.a1, org.A);
    const { action, outcome } = await run(f, a, 'forward.open', { port: (server.address() as AddressInfo).port });
    const { id } = await openTcp(a, action.opId, outcome.result!.forward as string);
    await until(() => sockets.length === 1, 'the connection');
    const closed = new Promise<void>((resolve) => sockets[0].once('close', () => resolve()));
    await a.channel.send({ t: 'streamClose', id, reason: 'closed' });
    await Promise.race([closed, sleep(2000).then(() => Promise.reject(new Error('the machine’s side was not reset')))]);
    expect(sockets[0].destroyed).toBe(true);
  });
});

// ---- Fix wave 2 (the task review): a revocation against the publication, a connection lost while decided, at most once --

/** The `nth` stream decision from now on (1-based) passed through `wrap`; every other decision untouched. */
function onStreamDecision(f: Fixture, nth: number, wrap: (decided: Promise<Decision>) => Promise<Decision>): void {
  const authorizer = f.endpoint.authorizer;
  const original = authorizer.authorize.bind(authorizer);
  let seen = 0;
  authorizer.authorize = (request, who, now) => {
    const decided = original(request, who, now);
    return request.kind === 'stream' && ++seen === nth ? wrap(decided) : decided;
  };
}

/** `member`'s grant ended at once, with no await between the ledger's write and the re-check it starts. */
function withdrawNow(f: Fixture, member: string): void {
  const state = f.endpoint.parts!.state;
  const ledger = state.ledger!;
  const grants = { ...ledger.grants };
  delete grants[member];
  state.setLedger({ ...ledger, grants });
  f.endpoint.channels.refreshCaps();
}

/** `fn` run `depth` microtasks from now. */
function inMicrotasks(depth: number, fn: () => void): void {
  queueMicrotask(() => (depth === 0 ? fn() : inMicrotasks(depth - 1, fn)));
}

/** A decision answered as it was, `fn` queued `depth` microtasks behind its answer. */
const thenQueue = (depth: number, fn: () => void) => async (decided: Promise<Decision>) => {
  const decision = await decided;
  inMicrotasks(depth, fn);
  return decision;
};

/** A decision computed at once and answered once `held` resolves. */
const heldUntil = (held: Promise<void>) => async (decided: Promise<Decision>) => {
  const decision = await decided;
  await held;
  return decision;
};

const DEPTHS = [0, 1, 2, 3, 4];

describe('a revocation against the publication', () => {
  it('leaves no pty stream live when the withdrawal runs a microtask behind the final decision’s grant, at any depth', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    let version = 1;
    expect(await grant(f, org.B, ['shell'], version)).toContain('shell');
    const b = await openRemote(f, org.b1, org.B);
    const { action } = await run(f, b, 'pty.attach', { ptyId });
    for (const depth of DEPTHS) {
      onStreamDecision(f, 2, thenQueue(depth, () => withdrawNow(f, org.B)));
      const { id, answer } = await openPty(b, action.opId, ptyId);
      await sleep(30);
      if (answer.t === 'streamOpened') expect([depth, closeOf(b, id)]).toEqual([depth, 'removed']);
      else expect([depth, answer.reason]).toEqual([depth, 'grade']);
      await b.channel.send({ t: 'streamData', id, offset: 0, data: b64('x') });
      await sleep(20);
      expect([depth, f.pty.writes]).toEqual([depth, []]);
      expect(await grant(f, org.B, ['shell'], ++version)).toContain('shell');
    }
    expect(b.channel.closed).toBe(false);
  });

  it('leaves no tcp stream live when the withdrawal runs a microtask behind the final decision’s grant, at any depth', async () => {
    const f = await start();
    const server = await http();
    let version = 1;
    for (const depth of DEPTHS) {
      expect(await grant(f, org.B, ['shell'], version++)).toContain('shell');
      const b = await openRemote(f, org.b1, org.B);
      const { action, outcome } = await run(f, b, 'forward.open', { port: server.port });
      const before = server.sockets.length;
      onStreamDecision(f, 2, thenQueue(depth, () => withdrawNow(f, org.B)));
      const { id, answer } = await openTcp(b, action.opId, outcome.result!.forward as string);
      await sleep(30);
      if (answer.t === 'streamOpened') expect([depth, closeOf(b, id)]).toEqual([depth, 'removed']);
      else expect([depth, answer.reason]).toEqual([depth, 'grade']);
      expect([depth, f.endpoint.forwards.list()]).toEqual([depth, []]);
      expect([depth, server.sockets.slice(before).every((socket) => socket.destroyed)]).toEqual([depth, true]);
      drop(b);
      await until(() => f.endpoint.channels.size === 0, 'the channel gone');
    }
  });

  it('leaves no forward when the withdrawal runs a microtask behind its effect’s decision, at any depth', async () => {
    const f = await start();
    const server = await http();
    let version = 1;
    expect(await grant(f, org.B, ['shell'], version)).toContain('shell');
    const b = await openRemote(f, org.b1, org.B);
    for (const depth of DEPTHS) {
      onStreamDecision(f, 1, thenQueue(depth, () => withdrawNow(f, org.B)));
      const { outcome } = await run(f, b, 'forward.open', { port: server.port });
      await sleep(30);
      expect([depth, f.endpoint.forwards.list()]).toEqual([depth, []]);
      if (outcome.state === 'failed') expect([depth, outcome]).toEqual([depth, { state: 'failed', error: { code: 'grade' } }]);
      expect(await grant(f, org.B, ['shell'], ++version)).toContain('shell');
    }
    expect(server.sockets).toEqual([]);
  });

  it('asks again when a re-check starts while the final decision is pending: the pty stream, the tcp stream and the forward are refused `grade`', async () => {
    const f = await start();
    const server = await http();
    const ptyId = f.pty.spawn('app-1');
    expect(await grant(f, org.B, ['shell'], 1)).toContain('shell');
    const b = await openRemote(f, org.b1, org.B);
    const attach = await run(f, b, 'pty.attach', { ptyId });
    const forward = await run(f, b, 'forward.open', { port: server.port });
    const asked = (n: number) => {
      let release!: () => void;
      onStreamDecision(f, n, heldUntil(new Promise<void>((resolve) => (release = resolve))));
      return () => release();
    };

    let release = asked(2);
    const pty = id16();
    await b.channel.send({ t: 'streamOpen', id: pty, kind: 'pty', op: attach.action.opId, credit: 1024 * 1024, pty: { ptyId, from: 0, inputEpoch: id16(), inputFrom: 0 } });
    await sleep(30);
    withdrawNow(f, org.B);
    release();
    await until(() => ofStream(b, pty).length > 0, 'the pty stream’s answer');
    expect(ofStream(b, pty)).toEqual([{ t: 'streamRefused', id: pty, reason: 'grade' }]);
    expect(await grant(f, org.B, ['shell'], 2)).toContain('shell');

    release = asked(1);
    const action = await shellAct(f, b, 'forward.open', { port: server.port });
    const from = b.inbox.length;
    expect(await act(b, action)).toBe('ok');
    await sleep(30);
    withdrawNow(f, org.B);
    release();
    expect(await done(b, action, from)).toEqual({ state: 'failed', error: { code: 'grade' } });
    expect(await grant(f, org.B, ['shell'], 3)).toContain('shell');

    // The forward made before the withdrawals went with the first one's re-check.
    expect(forward.outcome.state).toBe('done');
    expect(f.endpoint.forwards.list()).toEqual([]);
    const again = await run(f, b, 'forward.open', { port: server.port });
    release = asked(2);
    const tcp = id16();
    await b.channel.send({ t: 'streamOpen', id: tcp, kind: 'tcp', op: again.action.opId, credit: 1024 * 1024, tcp: { forward: again.outcome.result!.forward as string } });
    await until(() => server.sockets.length === 1, 'the connection');
    await sleep(20);
    withdrawNow(f, org.B);
    release();
    await until(() => ofStream(b, tcp).length > 0, 'the tcp stream’s answer');
    expect(ofStream(b, tcp)).toEqual([{ t: 'streamRefused', id: tcp, reason: 'grade' }]);
    await until(() => server.sockets[0].destroyed, 'the connection reset');
    expect(b.channel.closed).toBe(false);
  });
});

describe('a forwarded connection lost while its stream is decided', () => {
  it('is refused `unreachable`, never opened, and the channel is kept', async () => {
    const f = await start();
    const server = await http();
    const a = await openRemote(f, org.a1, org.A);
    const { action, outcome } = await run(f, a, 'forward.open', { port: server.port });
    let release!: () => void;
    onStreamDecision(f, 2, heldUntil(new Promise<void>((resolve) => (release = resolve))));
    const id = id16();
    await a.channel.send({ t: 'streamOpen', id, kind: 'tcp', op: action.opId, credit: 1024 * 1024, tcp: { forward: outcome.result!.forward as string } });
    await until(() => server.sockets.length === 1, 'the connection');
    server.sockets[0].resetAndDestroy();
    await sleep(30);
    release();
    await until(() => ofStream(a, id).length > 0, 'the answer');
    await sleep(20);
    expect(ofStream(a, id)).toEqual([{ t: 'streamRefused', id, reason: 'unreachable' }]);
    expect(a.channel.closed).toBe(false);
    expect(f.endpoint.channels.size).toBe(1);
    // The forward stands: a stream on it connects again.
    const next = await openTcp(a, action.opId, outcome.result!.forward as string);
    expect(next.answer.t).toBe('streamOpened');
  });
});

describe('a write whose outcome is unknown', () => {
  for (const lost of ['throw', 'timeout', 'host_unavailable'] as const) {
    it(`is at most once: the write lands and its reply is lost (${lost}), the stream closes \`unavailable\`, and the reopen’s resend is dropped`, async () => {
      const f = await start();
      const ptyId = f.pty.spawn('app-1');
      const a = await openRemote(f, org.a1, org.A);
      const { action } = await run(f, a, 'pty.attach', { ptyId });
      const epoch = id16();
      const first = await openPty(a, action.opId, ptyId, { epoch });
      f.pty.lostReplies = [lost];
      await a.channel.send({ t: 'streamData', id: first.id, offset: 0, data: b64('ls\n') });
      await until(() => closeOf(a, first.id), 'the close');
      expect(closeOf(a, first.id)).toBe('unavailable');
      expect(f.pty.writes.map((w) => w.data)).toEqual(['ls\n']);
      const second = await openPty(a, action.opId, ptyId, { epoch, inputFrom: 0 });
      await a.channel.send({ t: 'streamData', id: second.id, offset: 0, data: b64('ls\n') });
      await a.channel.send({ t: 'streamData', id: second.id, offset: 3, data: b64('pwd\n') });
      await until(() => f.pty.writes.length === 2, 'the next chunk written');
      await sleep(30);
      expect(f.pty.writes.map((w) => w.data)).toEqual(['ls\n', 'pwd\n']);
      expect(closeOf(a, second.id)).toBeUndefined();
    });
  }

  it('moves the decoder past the chunk too: a character the lost chunk began is finished by the next chunk after the reopen', async () => {
    const f = await start();
    const ptyId = f.pty.spawn('app-1');
    const a = await openRemote(f, org.a1, org.A);
    const { action } = await run(f, a, 'pty.attach', { ptyId });
    const epoch = id16();
    const e = Buffer.from('é');
    const first = await openPty(a, action.opId, ptyId, { epoch });
    f.pty.lostReplies = ['throw'];
    await a.channel.send({ t: 'streamData', id: first.id, offset: 0, data: b64(Buffer.concat([Buffer.from('a'), e.subarray(0, 1)])) });
    await until(() => closeOf(a, first.id), 'the close');
    const second = await openPty(a, action.opId, ptyId, { epoch, inputFrom: 0 });
    await a.channel.send({ t: 'streamData', id: second.id, offset: 0, data: b64(Buffer.concat([Buffer.from('a'), e.subarray(0, 1)])) });
    await a.channel.send({ t: 'streamData', id: second.id, offset: 2, data: b64(Buffer.concat([e.subarray(1), Buffer.from('b')])) });
    await until(() => f.pty.writes.length === 2, 'the next chunk written');
    await sleep(30);
    expect(f.pty.writes.map((w) => w.data)).toEqual(['a', 'éb']);
  });
});

// ---- IPv6 loopback: a dev server bound to `localhost` on ::1 alone ------------------------------------------------------

describe('a forward to a server on ::1 alone', () => {
  let ipv6 = false;
  beforeAll(async () => {
    const probe = createTcpServer();
    ipv6 = await new Promise<boolean>((resolve, reject) => {
      probe.once('error', (error: NodeJS.ErrnoException) => (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT' ? resolve(false) : reject(error)));
      probe.listen(0, '::1', () => resolve(true));
    });
    if (ipv6) await new Promise((resolve) => probe.close(resolve));
  });

  it('carries an HTTP round trip: 127.0.0.1 is refused, so ::1 is tried once and connects', async (ctx) => {
    if (!ipv6) ctx.skip();
    const f = await start();
    const server = createServer((req, res) => res.end(`hello over ::1 from ${req.url}`));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '::1', resolve));
    const a = await openRemote(f, org.a1, org.A);
    const { action, outcome } = await run(f, a, 'forward.open', { port: (server.address() as AddressInfo).port });
    const { id, answer } = await openTcp(a, action.opId, outcome.result!.forward as string);
    expect(answer).toMatchObject({ t: 'streamOpened' });
    await a.channel.send({ t: 'streamData', id, offset: 0, data: GET('/vite') });
    await until(() => closeOf(a, id), 'the response and the close');
    expect(output(a, id).text).toMatch(/^HTTP\/1\.1 200 OK[\s\S]*hello over ::1 from \/vite$/);
    expect(closeOf(a, id)).toBe('closed');
  });
});
