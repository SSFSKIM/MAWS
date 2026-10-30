// The socket link (P5 O6 M3, "The socket link"), against O1's real socket server and host runtime in this process over a
// fixture registry: connect then up, a request carrying its client and that client's end, an event delivered, a close
// then down then a reconnect, a request while down, and never an `exit`. P5 O3-D M6: the far side is a profile's
// `mawsd`, so the link reaches `machine.sock` and `mawsd.token` where @shared/daemon/files puts them for that profile,
// the socket's fallback directory included.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as z from 'zod';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import type { WireRegistry } from '@shared/ipc/registry';
import { MachineIdentitySchema } from '@shared/ipc/schema/machine';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { createHostRuntime, HostCommandError, type HostEmit, type HostRuntime } from '@shared/host/runtime';
import { serveSocketClients, type SocketClients } from '@shared/host/socket-server';
import { ipcError } from '@shared/ipc/errors';
import type { MachineRef } from '@shared/machine/ref';
import { DAEMON_FILES, daemonPaths, socketFallbackDir } from '@shared/daemon/files';
import type { MachineLink } from './manager';
import { createSocketLink, LINK_TIMING, retryDelay } from './socket-link';

const REF = 'FarMachineRef000000000' as MachineRef;
const TOKEN = 'b'.repeat(64);
const PROBE = {
  commands: {
    'machine.identity': { input: z.void(), output: MachineIdentitySchema, owner: 'machine' },
    'probe.echo': { input: z.strictObject({ text: z.string() }), output: z.strictObject({ text: z.string(), client: z.string() }), owner: 'machine' },
    'probe.slow': { input: z.void(), output: z.void(), owner: 'machine' },
    'probe.fail': { input: z.void(), output: z.void(), owner: 'machine' },
  },
  events: { 'probe.event': z.strictObject({ n: z.number() }) },
  hostEvents: [],
  ptyHostEvents: [],
  machineEvents: [],
  mainOnly: new Set<string>(),
} satisfies WireRegistry;
const TIMING = { fastRetryMs: 30, slowRetryMs: 60, fastWindowMs: 60_000, helloTimeoutMs: 500, requestTimeoutMs: 300 };
const until = (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { timeout: 3_000, interval: 5 });

interface Far {
  profile: string; // the far profile, which the link is configured with
  dir: string; // its `mawsd` directory, which holds the token (and the socket unless it falls back)
  socketDir: string;
  server: Server;
  runtime: HostRuntime;
  clients: SocketClients;
  emit: HostEmit<typeof PROBE>;
  exits: string[];
  gone: string[]; // the clients whose end the far side heard
  seen: ClientRef[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// A far machine: the runtime over PROBE behind O1's socket server, as a profile's `mawsd` serves it: listening on
// `machine.sock` with its token in `<profile>/mawsd/mawsd.token`, the socket in `<profile>/mawsd/` or, for a profile
// whose path is too long for it, in the fallback directory.
async function farMachine(profile = mkdtempSync(join(tmpdir(), 'maws-link-'))): Promise<Far> {
  const paths = daemonPaths(profile);
  const dir = paths.dir;
  const socketPath = paths.sockets.machine;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  if (paths.socketDir !== dir) mkdirSync(paths.socketDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, DAEMON_FILES.token), TOKEN, { mode: 0o600 });
  let emit!: HostEmit<typeof PROBE>;
  const gone: string[] = [];
  const seen: ClientRef[] = [];
  const runtime = createHostRuntime<typeof PROBE>(
    (on, e) => {
      emit = e;
      on('machine.identity', async () => ({ ref: REF, name: 'far', project: { key: `machine:${REF}`, name: 'far', smnsId: null } }));
      on('probe.echo', async ({ text }, { client }) => {
        if (!seen.includes(client)) client.onGone(() => void gone.push(client.id));
        seen.push(client);
        return { text, client: client.id };
      });
      on('probe.slow', () => new Promise<void>(() => {}));
      on('probe.fail', async () => {
        throw new HostCommandError(ipcError('timeout', 'the far side ran out of time'));
      });
    },
    { registry: PROBE },
  );
  const exits: string[] = [];
  let server = createServer();
  let clients!: SocketClients;
  const far: Far = {
    profile,
    dir,
    socketDir: paths.socketDir,
    get server() {
      return server;
    },
    runtime,
    get clients() {
      return clients;
    },
    get emit() {
      return emit;
    },
    exits,
    gone,
    seen,
    async start() {
      server = createServer();
      clients = serveSocketClients(server, {
        runtime,
        identity: () => ({ protocol: 3, minor: 1, buildId: 'far-build', capabilities: [], wire: 'w', pid: 99, startedAt: '2026-10-27T00:00:00.000Z' }),
        counts: () => ({ liveSessions: 0, rows: 0 }),
        token: () => TOKEN,
        onExit: (when) => void exits.push(when),
        log: () => {},
      });
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      chmodSync(socketPath, 0o600);
    },
    async stop() {
      clients.closeClient();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  } as Far;
  await far.start();
  cleanups.push(async () => {
    if (server.listening) await far.stop();
    rmSync(profile, { recursive: true, force: true });
    if (paths.socketDir !== dir) rmSync(paths.socketDir, { recursive: true, force: true });
  });
  return far;
}

function link(profile: string, timing = TIMING): { link: MachineLink; states: string[]; events: [EventName, unknown][]; log: Mock<(line: string) => void> } {
  const log = vi.fn<(line: string) => void>();
  const made = createSocketLink({ profile, build: 'near-build', log, registry: PROBE, timing });
  cleanups.push(() => made.close());
  const states: string[] = [];
  const events: [EventName, unknown][] = [];
  made.onState((state) => void states.push(state));
  made.onEvent((name, payload) => void events.push([name, payload]));
  return { link: made, states, events, log };
}

const page = (n: number) => endableClientRef(`page:${n}.1`);

describe('the socket link', () => {
  it('connects, learns the far identity, then is up, saying at connect the far build, wire and ref, and that main-owned commands cross unversioned', async () => {
    const far = await farMachine();
    const { link: made, states, log } = link(far.profile);
    expect(made.state()).toBe('connecting');
    expect(made.machine).toBeNull();
    await until(() => made.state() === 'up');
    expect(states).toEqual(['up']);
    expect(made.machine).toBe(REF);
    expect(made.name).toBe('far');
    const line = log.mock.calls.map(([l]) => l).find((l) => l.includes(REF));
    expect(line).toMatch(/far-build/);
    expect(line).toMatch(/wire 3\.1/);
    expect(line).toMatch(/unversioned/);
  });

  it('reaches the far profile’s mawsd: machine.sock and mawsd.token under <profile>/mawsd, and nothing at the stand-in’s old files', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'maws-link-'));
    // the stand-in's layout alone (`<profile>/machine-serve/machine.{sock,token}`) is not a machine any more
    mkdirSync(join(profile, 'machine-serve'), { mode: 0o700 });
    writeFileSync(join(profile, 'machine-serve', 'machine.token'), TOKEN, { mode: 0o600 });
    const { link: made, log } = link(profile);
    await until(() => made.state() === 'down');
    expect(log.mock.calls.some(([line]) => line.includes('nothing serves there'))).toBe(true);
    const far = await farMachine(profile);
    expect(far.socketDir).toBe(far.dir);
    await until(() => made.state() === 'up');
    expect(made.machine).toBe(REF);
  });

  it('reaches a far profile whose path is too long for its socket through the fallback directory, its token still in <profile>/mawsd', async () => {
    const profile = join(mkdtempSync(join(tmpdir(), 'maws-link-')), 'a-profile-path-long-enough-that-its-mawsd-sockets-pass-sun-path-on-this-machine');
    mkdirSync(profile);
    const far = await farMachine(profile);
    expect(far.socketDir).toBe(socketFallbackDir(profile));
    const { link: made } = link(profile);
    await until(() => made.state() === 'up');
    expect(made.machine).toBe(REF);
    cleanups.push(() => rmSync(join(profile, '..'), { recursive: true, force: true }));
  });

  it('carries the asking page’s client id with a request, and relays the page’s end as clientGone', async () => {
    const far = await farMachine();
    const { link: made } = link(far.profile);
    await until(() => made.state() === 'up');
    const asker = page(3);
    const answer = await made.dispatch('probe.echo' as CommandName, { text: 'hi' }, asker);
    expect(answer).toEqual({ ok: true, value: { text: 'hi', client: expect.stringMatching(/\/page:3\.1$/) } });
    await made.dispatch('probe.echo' as CommandName, { text: 'again' }, asker);
    expect(far.seen[1]).toBe(far.seen[0]); // one remote ref per page
    expect(far.gone).toEqual([]);
    asker.end();
    await until(() => far.gone.length > 0);
    expect(far.gone).toEqual([far.seen[0]!.id]);
  });

  it('answers a typed failure with the far side’s IpcError, a name off the link and a request past its deadline at once or in time', async () => {
    const far = await farMachine();
    const { link: made } = link(far.profile);
    await until(() => made.state() === 'up');
    await expect(made.dispatch('probe.fail' as CommandName, undefined, page(1))).resolves.toEqual({ ok: false, error: { code: 'timeout', message: 'the far side ran out of time' } });
    await expect(made.dispatch('session.list', {}, page(1))).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    await expect(made.dispatch('probe.slow' as CommandName, undefined, page(1))).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
  });

  it('delivers an event the far side emits once it is up', async () => {
    const far = await farMachine();
    const { link: made, events } = link(far.profile);
    await until(() => made.state() === 'up');
    await until(() => far.runtime.hasClient()); // the link said ready after the identity
    expect(far.emit('probe.event', { n: 7 })).toBe(true);
    await until(() => events.length === 1);
    expect(events).toEqual([['probe.event', { n: 7 }]]);
  });

  it('goes down when the far side closes, answers host_unavailable at once while down, and comes back up when it returns', async () => {
    const far = await farMachine();
    const { link: made, states } = link(far.profile);
    await until(() => made.state() === 'up');
    const slow = made.dispatch('probe.slow' as CommandName, undefined, page(1));
    await far.stop();
    await until(() => made.state() === 'down');
    await expect(slow).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } }); // a request in flight ends with the link
    const started = Date.now();
    await expect(made.dispatch('probe.echo' as CommandName, { text: 'x' }, page(1))).resolves.toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
    expect(Date.now() - started).toBeLessThan(50);
    await far.start();
    await until(() => made.state() === 'up');
    expect(states).toEqual(['up', 'down', 'up']);
    await expect(made.dispatch('probe.echo' as CommandName, { text: 'back' }, page(2))).resolves.toMatchObject({ ok: true, value: { text: 'back' } });
  });

  it('is down, and keeps trying, when nothing listens or the directory is not private', async () => {
    const far = await farMachine();
    await far.stop();
    const { link: made, log } = link(far.profile);
    await until(() => made.state() === 'down');
    chmodSync(far.dir, 0o755);
    await far.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(made.state()).toBe('down'); // a socket in a directory others can enter is not this user's alone
    expect(log.mock.calls.some(([line]) => /more open than 0700/.test(line))).toBe(true);
    chmodSync(far.dir, 0o700);
    await until(() => made.state() === 'up');
  });

  it('never sends exit: not at connect, not at a close of either side, not at its own close', async () => {
    const far = await farMachine();
    const { link: made } = link(far.profile);
    await until(() => made.state() === 'up');
    await far.stop();
    await far.start();
    await until(() => made.state() === 'up');
    made.close();
    await until(() => !far.clients.connected());
    expect(far.exits).toEqual([]);
    expect(far.server.listening).toBe(true); // the far machine runs on
    expect(made.state()).toBe('down');
  });

  it('retries every second for the first minute it is down, and every two seconds after', () => {
    expect(retryDelay(0, LINK_TIMING)).toBe(1_000);
    expect(retryDelay(59_999, LINK_TIMING)).toBe(1_000);
    expect(retryDelay(60_000, LINK_TIMING)).toBe(2_000);
    expect(retryDelay(3_600_000, LINK_TIMING)).toBe(2_000);
  });
});
