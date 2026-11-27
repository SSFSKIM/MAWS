// The page server's decision and its binds (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §J; T2
// to T6), with `createSheetPage` alone over the fixture bundle. What it answers, through a whole daemon, is
// src/mawsd/process-sheet-page.test.ts's. No case here listens on the real port: a bind is port 0, a port this test
// holds, or the `listen` seam, which records and refuses.
import { execFileSync } from 'node:child_process';
import type * as Http from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSheetPage, listenExclusive, SHEET_PORT, STOP_MS, type SheetPage, type SheetPageOptions } from './serve';
import { registrationName } from './registration';
import { NO_SHEETS } from './sheets';

// Whether the page asked for `node:http` (T26: a daemon that serves no page loads nothing for it)
const askedForHttp = () => vi.mocked(process.getBuiltinModule).mock.calls.filter(([id]) => id === 'node:http').length;

const FIXTURE = resolve(__dirname, '../../../test/fixtures/sheet-page/bundle');
let scratch: string;
let logs: string[];
let pages: SheetPage[];
let held: Server[];

beforeEach(() => {
  vi.spyOn(process, 'getBuiltinModule');
  scratch = mkdtempSync(join(tmpdir(), 'maws-sheet-serve-'));
  logs = [];
  pages = [];
  held = [];
});
afterEach(async () => {
  await Promise.all(pages.map((page) => page.stop()));
  await Promise.all(held.map((server) => new Promise((done) => server.close(done))));
  rmSync(scratch, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function page(overrides: Partial<SheetPageOptions> = {}): SheetPage {
  const made = createSheetPage({
    kind: 'private',
    profileDir: scratch,
    dir: join(scratch, 'mawsd'),
    defaultProfile: false,
    env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: join(scratch, 'no-home') }, // a home that does not exist: nothing registered
    shell: async () => ({}),
    bundleDir: FIXTURE,
    sheets: NO_SHEETS,
    discovery: async () => {},
    onEvent: () => () => {},
    hold: () => () => {},
    log: (line) => void logs.push(line),
    ...overrides,
  });
  pages.push(made);
  return made;
}

async function settled(made: SheetPage, ms = 3_000): Promise<string> {
  const until = Date.now() + ms;
  while (made.status().detail === null && Date.now() < until) await new Promise((done) => setTimeout(done, 10)); // decided
  return made.status().state;
}

const until = async (check: () => boolean, ms = 3_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('not in time');
    await new Promise((done) => setTimeout(done, 10));
  }
};
const inUse = () => Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
const portOf = (made: SheetPage) => Number(new URL(made.status().url!).port);
const reaches = (host: string, port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host, port });
    socket.once('connect', () => (socket.destroy(), done(true)));
    socket.once('error', () => done(false));
  });
const freePort = async (): Promise<Server> => {
  const server = createServer();
  await new Promise<void>((done) => server.listen({ host: '127.0.0.1', port: 0 }, done));
  held.push(server);
  return server;
};
const ipv6 = await new Promise<boolean>((done) => {
  const probe = createServer();
  probe.once('error', () => done(false));
  probe.listen({ host: '::1', port: 0, ipv6Only: true }, () => probe.close(() => done(true)));
});

describe('never in the way: the decision (T2, T5, T6)', () => {
  it('serves nothing in a daemon of another profile without the switch, captures no shell and asks for no node:http', async () => {
    const shell = vi.fn(async () => ({}));
    const load = vi.fn();
    const made = page({ env: {}, shell, load });
    made.start();
    expect(await settled(made)).toBe('off');
    expect(made.status()).toEqual({ state: 'off', detail: 'a private mawsd of another profile serves it only under MAWS_SHEET_PAGE=1', url: null, browsers: null, connections: null, registered: false });
    expect(shell).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(askedForHttp()).toBe(0);
  });

  it('serves nothing in the default daemon while SHEET_PAGE_DEFAULT_ON is false, and nothing under MAWS_SHEET_PAGE=0 in any', async () => {
    const shell = vi.fn(async () => ({}));
    const byDefault = page({ env: {}, defaultProfile: true, shell });
    byDefault.start();
    expect(await settled(byDefault)).toBe('off');
    const turnedOff = page({ env: { MAWS_SHEET_PAGE: '0' }, defaultProfile: true, shell });
    turnedOff.start();
    expect(await settled(turnedOff)).toBe('off');
    expect(turnedOff.status().detail).toBe('turned off by MAWS_SHEET_PAGE=0');
    expect(shell).not.toHaveBeenCalled();
    expect(askedForHttp()).toBe(0);
  });

  it('serves nothing from a build with no bundle, still asking for no node:http', async () => {
    const made = page({ bundleDir: join(scratch, 'no-bundle') });
    made.start();
    expect(await settled(made)).toBe('no-bundle');
    expect(made.status().detail).toBe('this build holds no sheet page');
    expect(askedForHttp()).toBe(0);
  });
});

describe('the port (T4)', () => {
  it('reads the login shell only for what the daemon’s own environment does not say', async () => {
    const shell = vi.fn(async () => ({ MAWS_SHEET_PORT: '0' }));
    const told = page({ shell });
    told.start();
    expect(await settled(told)).toBe('listening');
    expect(shell).not.toHaveBeenCalled(); // the switch, the port and the sminos home all its own
    expect(askedForHttp()).toBe(1);

    const fromShell = page({ env: { MAWS_SHEET_PAGE: '1' }, shell });
    fromShell.start();
    expect(await settled(fromShell)).toBe('listening');
    await until(() => logs.some((line) => line.startsWith('the registration: ')));
    expect(shell).toHaveBeenCalledOnce(); // for the port, and the same capture for the home (M3)
    expect(portOf(fromShell)).not.toBe(SHEET_PORT);
  });

  it('is 47590 when nothing names one, and a value that names no port is ignored with a log line', async () => {
    const tried: number[] = [];
    const listen = async (_server: Http.Server, _host: string, port: number) => {
      tried.push(port);
      throw inUse(); // never a real bind on the real port
    };
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '80' }, shell: async () => ({ MAWS_SHEET_PORT: 'many' }), listen });
    made.start();
    expect(await settled(made)).toBe('port-taken');
    expect(tried).toEqual([SHEET_PORT]);
    expect(logs).toContain('MAWS_SHEET_PORT in the environment names no port: ignored');
    expect(logs).toContain('MAWS_SHEET_PORT in the login shell names no port: ignored');
  });

  it('is not served while another holds it, makes no code then, and is tried again until it is free', async () => {
    const holder = await freePort();
    const port = (holder.address() as AddressInfo).port;
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: String(port) }, timing: { portRetryMs: 100 } });
    made.start();
    expect(await settled(made)).toBe('port-taken');
    expect(made.status()).toMatchObject({ state: 'port-taken', detail: `port ${port} is in use`, url: null });
    expect(await made.pair()).toEqual({ ok: false, why: `this mawsd does not serve the sheet page now: port ${port} is in use` });
    await new Promise<void>((done) => holder.close(() => done()));
    held.length = 0;
    await vi.waitFor(() => expect(made.status().state).toBe('listening'), { timeout: 3_000 });
    expect(portOf(made)).toBe(port);
  });
});

describe('the binds (T3)', () => {
  it('are 127.0.0.1 and ::1, each named, on one port, and no other address', async () => {
    const bound: (string | AddressInfo | null)[] = [];
    const listen = async (server: Http.Server, host: string, port: number) => {
      await listenExclusive(server, host, port);
      bound.push(server.address());
    };
    const made = page({ listen });
    made.start();
    expect(await settled(made)).toBe('listening');
    const port = portOf(made);
    const families = bound.map((address) => (address as AddressInfo).address);
    expect(families).toEqual(ipv6 ? ['127.0.0.1', '::1'] : ['127.0.0.1']);
    for (const address of bound) expect((address as AddressInfo).port).toBe(port);
    expect(await reaches('127.0.0.1', port)).toBe(true);
    if (ipv6) expect(await reaches('::1', port)).toBe(true);
    expect(made.status().detail).toBe(ipv6 ? `served on 127.0.0.1 and ::1, port ${port}` : `served on 127.0.0.1, port ${port}`);
  });

  it('serve neither address when the second is in use, and serve both once a later try succeeds', async () => {
    let refuseV6 = true;
    const listen = async (server: Http.Server, host: string, port: number) => {
      if (host === '::1' && refuseV6) throw inUse();
      if (host === '::1' && !ipv6) throw Object.assign(new Error('listen EADDRNOTAVAIL'), { code: 'EADDRNOTAVAIL' }); // served on 127.0.0.1 alone
      await listenExclusive(server, host, port);
    };
    const holder = await freePort();
    const port = (holder.address() as AddressInfo).port;
    await new Promise<void>((done) => holder.close(() => done()));
    held.length = 0;
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: String(port) }, listen, timing: { portRetryMs: 100 } });
    made.start();
    expect(await settled(made)).toBe('port-taken');
    expect(made.status().detail).toBe(`port ${port} is in use on ::1`);
    expect(await reaches('127.0.0.1', port)).toBe(false); // the first address was let go
    refuseV6 = false;
    await vi.waitFor(() => expect(made.status().state).toBe('listening'), { timeout: 3_000 });
    expect(await reaches('127.0.0.1', port)).toBe(true);
  });

  it('serve 127.0.0.1 alone on a machine with no IPv6 loopback', async () => {
    const listen = async (server: Http.Server, host: string, port: number) => {
      if (host === '::1') throw Object.assign(new Error('listen EADDRNOTAVAIL'), { code: 'EADDRNOTAVAIL' });
      await listenExclusive(server, host, port);
    };
    const made = page({ listen });
    made.start();
    expect(await settled(made)).toBe('listening');
    expect(made.status().detail).toBe(`served on 127.0.0.1, port ${portOf(made)}`);
    expect(logs).toContain('this machine has no IPv6 loopback: served on 127.0.0.1 alone');
  });

  it('try the pair again, with port 0, when the second address’s port is taken', async () => {
    const tries: string[] = [];
    let refused = 2;
    const listen = async (server: Http.Server, host: string, port: number) => {
      tries.push(`${host}:${port === 0 ? 0 : 'n'}`);
      if (host === '::1' && refused-- > 0) throw inUse();
      await listenExclusive(server, host, port);
    };
    const made = page({ listen });
    made.start();
    expect(await settled(made)).toBe('listening');
    expect(tries).toEqual(['127.0.0.1:0', '::1:n', '127.0.0.1:0', '::1:n', '127.0.0.1:0', '::1:n']);
  });
});

describe('the bind decision (T3)', () => {
  // A raw request on 127.0.0.1, its answer read to the close: '' when the connection was ended unanswered
  const ask = (port: number) =>
    new Promise<string>((done) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      let text = '';
      socket.on('data', (chunk) => void (text += chunk.toString('latin1')));
      socket.on('error', () => {});
      socket.on('close', () => done(text));
      socket.on('connect', () => socket.write(`GET / HTTP/1.1\r\nHost: sheet.localhost:${port}\r\nConnection: close\r\n\r\n`));
    });

  it('serves neither address while the second bind is pending: a request on the first is not served', async () => {
    let release!: () => void;
    const pending = new Promise<void>((done) => (release = done));
    let first = 0;
    const load = vi.fn(async () => import('./handler'));
    const listen = async (server: Http.Server, host: string, port: number) => {
      if (host === '::1') await pending;
      await listenExclusive(server, ipv6 || host !== '::1' ? host : '127.0.0.1', ipv6 || host !== '::1' ? port : 0);
      if (host === '127.0.0.1') first = (server.address() as AddressInfo).port;
    };
    const made = page({ listen, load });
    made.start();
    await vi.waitFor(() => expect(first).not.toBe(0));
    expect(await ask(first)).toBe(''); // ended, nothing served
    expect(load).not.toHaveBeenCalled(); // no handler cached with port 0
    release();
    await vi.waitFor(() => expect(made.status().state).toBe('listening'));
    expect(await ask(first)).toMatch(/^HTTP\/1\.1 200 /);
  });

  it('closes the provisional listener when stopped while the second bind is pending', async () => {
    let release!: () => void;
    const pending = new Promise<void>((done) => (release = done));
    let first = 0;
    const listen = async (server: Http.Server, host: string, port: number) => {
      if (host === '::1') await pending;
      await listenExclusive(server, ipv6 || host !== '::1' ? host : '127.0.0.1', ipv6 || host !== '::1' ? port : 0);
      if (host === '127.0.0.1') first = (server.address() as AddressInfo).port;
    };
    const made = page({ listen });
    made.start();
    await vi.waitFor(() => expect(first).not.toBe(0));
    await made.stop();
    expect(await reaches('127.0.0.1', first)).toBe(false);
    release();
    await new Promise((done) => setTimeout(done, 100));
    expect(await reaches('127.0.0.1', first)).toBe(false);
    expect(made.status().state).not.toBe('listening');
  });
});

describe('the chunk and the stop (T1, T6)', () => {
  it('loads nothing at a start with no request made, and stops within half a second', async () => {
    const load = vi.fn();
    const made = page({ load });
    made.start();
    expect(await settled(made)).toBe('listening');
    const port = portOf(made);
    expect(load).not.toHaveBeenCalled();
    expect(made.status()).toMatchObject({ browsers: null, connections: null });
    const before = Date.now();
    await made.stop();
    expect(Date.now() - before).toBeLessThan(600);
    expect(made.status().state).toBe('stopped');
    expect(await reaches('127.0.0.1', port)).toBe(false);
  });
  it('acts on no command whose load outlasted the stop: no code is made and the browsers’ file is not written', async () => {
    const stamp = new Date().toISOString();
    mkdirSync(join(scratch, 'mawsd'), { recursive: true });
    const kept = { id: '0a1b2c3d', label: 'Chrome on macOS', pairedAt: stamp, lastSeenAt: stamp, hash: 'a'.repeat(64), proof: 'b'.repeat(64) };
    writeFileSync(join(scratch, 'mawsd', 'sheet-page.json'), JSON.stringify({ v: 1, browsers: [kept] }));
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    const load = vi.fn(async () => (await gate, import('./handler')));
    const write = vi.fn();
    const made = page({ load, write });
    made.start();
    expect(await settled(made)).toBe('listening');
    const pairing = made.pair();
    const listing = made.browsers();
    const unpairing = made.unpair(kept.id);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    await made.stop();
    release();
    expect(await pairing).toMatchObject({ ok: false });
    expect(await listing).toEqual({ browsers: [] });
    expect(await unpairing).toEqual({ removed: 0, saved: false, why: 'stopping' });
    expect(write).not.toHaveBeenCalled();
  });
});

describe('a response that makes no write progress (S2)', () => {
  it('is ended, and its connection’s slot released, when its client stops reading a large asset', async () => {
    const bundle = join(scratch, 'bundle');
    mkdirSync(join(bundle, 'assets'), { recursive: true });
    writeFileSync(join(bundle, 'index.html'), '<!doctype html>');
    writeFileSync(join(bundle, 'assets', 'large.js'), Buffer.alloc(32 * 1024 * 1024, 0x61)); // past any loopback socket's buffers
    const servers: Http.Server[] = [];
    const made = page({
      bundleDir: bundle,
      timing: { checkMs: 50, stallMs: 400 },
      listen: (server, host, port) => (servers.push(server), listenExclusive(server, host, port)),
    });
    made.start();
    expect(await settled(made)).toBe('listening');
    const port = portOf(made);
    const connections = () => Promise.all(servers.map((server) => new Promise<number>((done) => server.getConnections((_, count) => done(count))))).then((counts) => counts.reduce((a, b) => a + b, 0));

    const reader = createConnection({ host: '127.0.0.1', port });
    reader.on('error', () => {});
    await new Promise<void>((done) => reader.once('connect', () => done()));
    let received = 0;
    reader.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > 256 * 1024) reader.pause(); // it read the start, and stops
    });
    reader.write(`GET /assets/large.js HTTP/1.1\r\nHost: sheet.localhost:${port}\r\n\r\n`);
    await until(() => received > 0);
    expect(await connections()).toBe(1);
    await until(() => logs.some((line) => /made no write progress/.test(line)), 5_000);
    await vi.waitFor(async () => expect(await connections()).toBe(0), { timeout: 2_000 });
    reader.destroy();
  }, 15_000);

  it('is not ended while its client reads, however slowly the whole of it arrives', async () => {
    const bundle = join(scratch, 'bundle');
    mkdirSync(join(bundle, 'assets'), { recursive: true });
    writeFileSync(join(bundle, 'index.html'), '<!doctype html>');
    const size = 12 * 1024 * 1024;
    writeFileSync(join(bundle, 'assets', 'large.js'), Buffer.alloc(size, 0x62));
    const made = page({ bundleDir: bundle, timing: { checkMs: 50, stallMs: 400 } });
    made.start();
    expect(await settled(made)).toBe('listening');
    const port = portOf(made);
    const reader = createConnection({ host: '127.0.0.1', port });
    reader.on('error', () => {});
    await new Promise<void>((done) => reader.once('connect', () => done()));
    let received = 0;
    const ended = new Promise<void>((done) => reader.once('close', () => done()));
    // reads a part at a time, pausing 20 ms after each: the whole takes far longer than stallMs
    reader.on('data', (chunk: Buffer) => {
      received += chunk.length;
      reader.pause();
      setTimeout(() => reader.resume(), 20);
    });
    reader.setNoDelay(true);
    reader.write(`GET /assets/large.js HTTP/1.1\r\nHost: sheet.localhost:${port}\r\nConnection: close\r\n\r\n`);
    await ended;
    expect(received).toBeGreaterThan(size);
    expect(logs.some((line) => /made no write progress/.test(line))).toBe(false);
  }, 60_000);
});

describe('the registration (T18, §O): the heartbeat, on the page server’s own timer', () => {
  const heartbeatMs = 40;
  const fileIn = (home: string, name: string) => join(home, 'sheet', 'surfaces', `${name}.json`);
  const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

  it('is written as soon as the listeners are up, with no request made and nothing loaded, and again at each tick, the clock injected', async () => {
    const home = join(scratch, 'sminos');
    mkdirSync(home);
    let clock = Date.parse('2026-11-24T10:00:00.000Z');
    const load = vi.fn(() => Promise.reject(new Error('not loaded by a heartbeat')));
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home }, now: () => clock, load, timing: { heartbeatMs } });
    made.start();
    expect(await settled(made)).toBe('listening');
    const file = fileIn(home, registrationName(false, scratch));
    await until(() => existsSync(file));
    expect(read(file)).toEqual({ v: 1, name: registrationName(false, scratch), pid: process.pid, url: made.status().url, reach: 'local', heartbeatAt: '2026-11-24T10:00:00.000Z' });
    expect(made.status().url).toMatch(/^http:\/\/sheet\.localhost:\d+$/); // an origin: no path, no trailing slash
    expect(made.status().registered).toBe(true);
    clock += 10_000;
    await until(() => read(file).heartbeatAt === '2026-11-24T10:00:10.000Z');
    expect(load).not.toHaveBeenCalled();
    await made.stop();
    expect(existsSync(file)).toBe(false); // a clean stop removes it
    expect(made.status().registered).toBe(false);
  });

  it('is named mawsd for the default profile', async () => {
    const home = join(scratch, 'sminos');
    mkdirSync(home);
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home }, defaultProfile: true, timing: { heartbeatMs } });
    made.start();
    await until(() => existsSync(fileIn(home, 'mawsd')));
  });

  it('writes nothing and makes no directory where the home does not exist, and writes once it appears', async () => {
    const home = join(scratch, 'sminos');
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home }, timing: { heartbeatMs } });
    made.start();
    expect(await settled(made)).toBe('listening');
    await new Promise((done) => setTimeout(done, heartbeatMs * 3));
    expect(existsSync(home)).toBe(false);
    expect(made.status().registered).toBe(false);
    mkdirSync(home);
    await until(() => existsSync(fileIn(home, registrationName(false, scratch))));
    expect(made.status().registered).toBe(true);
  });

  it('does not remove a file that names another process at a stop', async () => {
    const home = join(scratch, 'sminos');
    mkdirSync(home);
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home }, timing: { heartbeatMs: 60_000 } });
    made.start();
    const file = fileIn(home, registrationName(false, scratch));
    await until(() => existsSync(file));
    writeFileSync(file, JSON.stringify({ ...read(file), pid: process.pid + 1 })); // another daemon took the name meanwhile
    await made.stop();
    expect(read(file).pid).toBe(process.pid + 1);
  });

  it('writes nothing while the port is taken', async () => {
    const home = join(scratch, 'sminos');
    mkdirSync(home);
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home }, listen: async () => Promise.reject(inUse()), timing: { heartbeatMs, portRetryMs: heartbeatMs } });
    made.start();
    expect(await settled(made)).toBe('port-taken');
    await made.browsers(); // the chunk loaded, and with it the timer: its ticks still write nothing
    await new Promise((done) => setTimeout(done, heartbeatMs * 4));
    expect(existsSync(join(home, 'sheet'))).toBe(false);
    expect(made.status().registered).toBe(false);
  });

  // Fix round 2 (T6): the removal is best effort, and STOP_MS bounds the stop with it in. A home whose permissions
  // changed while mawsd ran, or an entry at the registration's name that is no regular file, never holds the stop.
  it.each([
    ['sheet/ unreadable', (home: string) => chmodSync(join(home, 'sheet'), 0o000)],
    ['surfaces/ unreadable', (home: string) => chmodSync(join(home, 'sheet', 'surfaces'), 0o000)],
    ['a FIFO in the registration’s place', (home: string, file: string) => (rmSync(file), execFileSync('mkfifo', [file]))],
    ['a directory in the registration’s place', (home: string, file: string) => (rmSync(file), mkdirSync(file))],
  ])('a stop with %s ends within its bound, its removal logged if it failed', async (_case, spoil) => {
    const home = join(scratch, 'sminos');
    mkdirSync(home);
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home }, timing: { heartbeatMs: 60_000 } });
    made.start();
    const file = fileIn(home, registrationName(false, scratch));
    await until(() => existsSync(file));
    spoil(home, file);
    try {
      const began = Date.now();
      await made.stop();
      expect(Date.now() - began).toBeLessThan(STOP_MS + 250);
      expect(made.status().state).toBe('stopped');
    } finally {
      chmodSync(join(home, 'sheet'), 0o700);
      chmodSync(join(home, 'sheet', 'surfaces'), 0o700);
    }
    if (_case.includes('unreadable')) expect(logs).toContainEqual(expect.stringMatching(/^the registration: not removed at the stop \(EACCES\)$/));
    expect(logs.filter((line) => line.includes(scratch))).toEqual([]); // a failure is logged with no path
  });

  it('logs no path and no change but a change of what the tick did', async () => {
    const home = join(scratch, 'sminos');
    mkdirSync(home);
    const made = page({ env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home }, timing: { heartbeatMs } });
    made.start();
    await until(() => existsSync(join(home, 'sheet', 'surfaces')) && readdirSync(join(home, 'sheet', 'surfaces')).length > 0);
    await new Promise((done) => setTimeout(done, heartbeatMs * 4));
    const lines = logs.filter((line) => line.startsWith('the registration: '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(scratch);
  });
});
