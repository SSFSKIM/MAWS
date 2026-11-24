// The page server's decision and its binds (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, §J; T2
// to T6), with `createSheetPage` alone over the fixture bundle. What it answers, through a whole daemon, is
// src/mawsd/process-sheet-page.test.ts's. No case here listens on the real port: a bind is port 0, a port this test
// holds, or the `listen` seam, which records and refuses.
import type * as Http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, createServer, type AddressInfo, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSheetPage, listenExclusive, NO_SHEETS, SHEET_PORT, type SheetPage, type SheetPageOptions } from './serve';

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
    env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0' },
    shell: async () => ({}),
    bundleDir: FIXTURE,
    sheets: NO_SHEETS,
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
    expect(shell).not.toHaveBeenCalled(); // the switch and the port both its own
    expect(askedForHttp()).toBe(1);

    const fromShell = page({ env: { MAWS_SHEET_PAGE: '1' }, shell });
    fromShell.start();
    expect(await settled(fromShell)).toBe('listening');
    expect(shell).toHaveBeenCalledOnce();
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
});
