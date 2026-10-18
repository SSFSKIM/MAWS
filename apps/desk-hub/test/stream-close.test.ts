// A machine that drops its stream has its forwarded RPC become `uncertain` at once, and goes offline once the closed
// stream's grace (one heartbeat, held for the machine's next stream) runs out, within a stated bound on the local
// runtime, where the web (DC5) sees it: the project view's `machines`, the grid's summary, and the RPC's state.
// Two hosts, each behind the stand-in for Access:
//   - the suites' Miniflare, with the deployed heartbeat and lease (15 s, 45 s), so neither can be what ends it: the
//     stand-in resets the hub's connection when its client leaves, and the close reaches the object at once, as it
//     does deployed (DX2);
//   - the local command (`pnpm --filter desk-hub local`), as DC4 and DC5 run it. wrangler dev's own proxy sits between
//     the stand-in and the hub and closes its hop gracefully, which workerd notices only when its next write fails,
//     so the command's short heartbeat is the bound.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeMachine } from '../fake-machine';
import type { GridDown, ProjectDown } from '../src/protocol/browser';
import { importOrgKey, newNonce, sealRpc } from '../src/protocol/codes';
import type { DownFrame } from '../src/protocol/machine';
import { PartAssembler } from '../src/protocol/parts';
import type { RpcDraft } from '../src/protocol/rpc';
import { ADMIN, startLocalHub, type LocalHub } from './support/local';

const RAW_KEY = new Uint8Array(32).fill(7);
const KEY = importOrgKey(RAW_KEY);
const AS_ADMIN = { 'x-desk-standin-user': ADMIN };
/** What a change may take past its bound before it counts as late, under the Mac's load rule. */
const MARGIN_MS = 3000;
let count = 0;

type Down = ProjectDown | GridDown;
type Socket = { frames: Array<{ at: number; frame: Down }>; send(frame: unknown): void; close(): void };

/** A browser's socket (a project's view, or the grid) that keeps each frame with when it arrived, parts joined. */
async function socket(url: string, path: string): Promise<Socket> {
  const frames: Socket['frames'] = [];
  const parts = new PartAssembler();
  const ws = new WebSocket(`${url.replace('http', 'ws')}${path}`, { headers: AS_ADMIN } as unknown as string[]);
  ws.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data)) as Down;
    const whole = frame.t === 'part' ? parts.add(frame) : frame;
    if (whole !== undefined) frames.push({ at: Date.now(), frame: whole as Down });
  });
  await new Promise<void>((done, fail) => {
    ws.addEventListener('open', () => done());
    ws.addEventListener('error', () => fail(new Error(`socket ${path} refused`)));
  });
  return { frames, send: (frame) => ws.send(JSON.stringify(frame)), close: () => ws.close() };
}

async function until<T>(find: () => T | undefined, ms: number, what: string): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = find();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`no ${what} within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Enrolls a fake machine, opens a project with it, has it hold a forwarded RPC, then drops its stream. Returns the
 * stream's heartbeat and how long after the drop each change reached a browser; each is waited for up to a minute, so a
 * late one is measured rather than cut off.
 */
async function dropAndMeasure(url: string) {
  const json = { ...AS_ADMIN, 'content-type': 'application/json' };
  const me = (await (await fetch(`${url}/api/me`, { headers: json })).json()) as { member: { id: string } };
  const { token } = (await (await fetch(`${url}/api/enrollments`, { method: 'POST', headers: json, body: '{}' })).json()) as { token: string };
  const name = `close-${++count}`;
  const redeemed = await fetch(`${url}/machine/enroll`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, machine: name }) });
  const { client_id, client_secret } = (await redeemed.json()) as { client_id: string; client_secret: string };
  const project = `0c1d0a8e-3b2d-4c5e-9f70-${count.toString(16).padStart(12, '0')}`;

  let release!: () => void;
  const held = new Promise<undefined>((resolve) => (release = () => resolve(undefined)));
  const fm = new FakeMachine({
    hub: url,
    machine: name,
    credentials: { clientId: client_id, clientSecret: client_secret },
    orgKey: RAW_KEY,
    project,
    checkouts: [{ path: '/src/demo', branch: 'main' }],
    // The spawn's effect does not finish while the stream is up: the RPC stays forwarded, without a result.
    script: { spawn: () => held },
  });
  await fm.connect();
  const welcome = fm.frames.find((f): f is Extract<DownFrame, { t: 'welcome' }> => f.t === 'welcome')!;
  const view = await socket(url, `/api/projects/${project}/socket`);
  const grid = await socket(url, '/api/registry/socket');
  const online = (f: Down, value: boolean) => f.t === 'machines' && f.machines.some((m) => m.machine === name && m.online === value);
  await until(() => view.frames.find(({ frame }) => online(frame, true)), 10_000, 'the machine online');

  const draft = { rpc: 'spawn', project, machine: name, member: me.member.id, created: new Date().toISOString(), nonce: newNonce(), args: { checkout: '/src/demo', brief: 'held' } };
  const rpc = await sealRpc(await KEY, draft as unknown as RpcDraft);
  view.send({ t: 'rpc', rpc });
  await until(() => (fm.rpcs.some((r) => r.nonce === rpc.nonce) ? true : undefined), 10_000, 'the RPC at the machine');

  const dropped = Date.now();
  await fm.drop();
  const after = async (frames: Socket['frames'], predicate: (f: Down) => boolean, what: string) =>
    (await until(() => frames.find(({ at, frame }) => at >= dropped && predicate(frame)), 60_000, what)).at - dropped;
  const [offline, uncertain, gridOffline] = await Promise.all([
    after(view.frames, (f) => online(f, false), 'the machine offline in the view'),
    after(view.frames, (f) => f.t === 'rpc-state' && f.nonce === rpc.nonce && f.state === 'uncertain', 'the RPC uncertain'),
    after(grid.frames, (f) => f.t === 'summary' && f.project.id === project && f.project.machines_online === 0, "the grid's summary offline"),
  ]);
  release();
  view.close();
  grid.close();
  await fm.close();
  return { heartbeatMs: welcome.heartbeat_ms, offline, uncertain, gridOffline };
}

describe("a dropped machine's stream, on the suites' runtime with the deployed heartbeat and lease", () => {
  let hub: LocalHub;
  beforeAll(async () => {
    hub = await startLocalHub();
  });
  afterAll(() => hub?.close());

  it('makes its forwarded RPC uncertain at once, and puts the machine offline in the view and in the grid once the grace runs out', { timeout: 120_000 }, async () => {
    const measured = await dropAndMeasure(hub.url);
    expect(measured.heartbeatMs).toBe(15_000);
    expect(measured.uncertain, JSON.stringify(measured)).toBeLessThan(MARGIN_MS);
    // Held online through the grace, for a reconnect that never came, then offline at its end.
    for (const ms of [measured.offline, measured.gridOffline]) {
      expect(ms, JSON.stringify(measured)).toBeGreaterThanOrEqual(measured.heartbeatMs - MARGIN_MS);
      expect(ms, JSON.stringify(measured)).toBeLessThan(measured.heartbeatMs + MARGIN_MS);
    }
  });
});

/**
 * A port n with n and n + 1 free: the local command takes n for the stand-in and n + 1 for wrangler dev. n is drawn from
 * 20000-32000, below the ephemeral range of Linux (32768-60999) and macOS (49152-65535), so no other process's outgoing
 * connection, in this suite's other workers included, is handed n + 1 between this check and the command's bind. The
 * check still catches a listener that holds one of them.
 */
async function freePorts(): Promise<number> {
  const free = (port: number) =>
    new Promise<boolean>((done) => {
      const server = createServer();
      server.once('error', () => done(false));
      server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
    });
  for (;;) {
    const port = 20_000 + Math.floor(Math.random() * 12_000);
    if ((await free(port)) && (await free(port + 1))) return port;
  }
}

/** A bind lost to another process, by the command's refusal or by the stand-in's or wrangler's own error. */
const PORT_TAKEN = /address already in use|EADDRINUSE|port \d+ is in use/i;
class PortTaken extends Error {}
const ATTEMPTS = 3;

describe("a dropped machine's stream, on the local command, as DC4 and DC5 run it", () => {
  let child: ChildProcess | undefined;
  let state: string | undefined;
  let url: string;

  /** Starts the command on a fresh pair of ports and waits until the hub answers through the stand-in. */
  async function start(): Promise<void> {
    const port = await freePorts();
    url = `http://127.0.0.1:${port}`;
    const command = spawn(process.execPath, ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'local/run.ts', '--port', String(port), '--state', state!], {
      cwd: resolve(import.meta.dirname, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child = command;
    const output: string[] = [];
    command.stdout!.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    command.stderr!.on('data', (chunk: Buffer) => output.push(chunk.toString()));
    // The command prints its banner before wrangler dev is ready, so the hub is ready once it answers through the
    // stand-in.
    const deadline = Date.now() + 120_000;
    try {
      await ready(command, output, deadline);
    } catch (error) {
      // The command may have died with wrangler dev still running (the stand-in lost its bind after wrangler started):
      // end its whole group before another attempt shares its state directory.
      try {
        process.kill(-command.pid!, 'SIGKILL');
      } catch {
        // the group is already gone
      }
      throw error;
    }
  }

  async function ready(command: ChildProcess, output: string[], deadline: number): Promise<void> {
    for (;;) {
      if (command.exitCode !== null) {
        const message = `the local command exited (${command.exitCode}):\n${output.join('')}`;
        throw PORT_TAKEN.test(message) ? new PortTaken(message) : new Error(message);
      }
      if (Date.now() > deadline) throw new Error(`the local hub did not answer within 120 s:\n${output.join('')}`);
      const answered = await fetch(`${url}/api/me`, { headers: AS_ADMIN }).then((r) => r.status === 200, () => false);
      if (answered) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  beforeAll(async () => {
    state = mkdtempSync(join(tmpdir(), 'desk-hub-local-'));
    // Even a port that was free when picked can be taken before the command binds it; start again on fresh ones.
    for (let attempt = 1; ; attempt++) {
      try {
        return await start();
      } catch (error) {
        if (!(error instanceof PortTaken) || attempt >= ATTEMPTS) throw error;
      }
    }
  }, 450_000);
  afterAll(async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child!.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    if (state) rmSync(state, { recursive: true, force: true });
  }, 60_000);

  it('makes its forwarded RPC uncertain within one of the command’s short heartbeats, and the machine offline a grace later', { timeout: 120_000 }, async () => {
    const measured = await dropAndMeasure(url);
    // The close is noticed within a heartbeat; the machine is offline a grace (one heartbeat) after that.
    expect(measured.uncertain, JSON.stringify(measured)).toBeLessThan(measured.heartbeatMs + MARGIN_MS);
    for (const ms of [measured.offline, measured.gridOffline]) expect(ms, JSON.stringify(measured)).toBeLessThan(2 * measured.heartbeatMs + MARGIN_MS);
    expect(measured.heartbeatMs, 'the local command beats more often than the deployment').toBeLessThanOrEqual(2000);
  });
});
