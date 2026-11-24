// The page server in a running `mawsd` (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md, M1's Proves):
// who is let in. The daemon runs in this process with the product's options (src/mawsd/index.ts) over a scratch profile
// (test/support/mawsd-scene.ts), the fixture bundle as its page, MAWS_SHEET_PAGE=1 and port 0, in an environment this
// suite builds. Its clients are Node's `net` and `ws`, which write any header and any bytes: each request is made to a
// loopback address with its Host set by hand, so nothing depends on how the machine resolves a name. Every request a
// rule refuses is sent and seen refused, and every answer is seen to carry the standing headers.
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import { gradeOf } from '@shared/ipc/grades';
import { launchEnvironment } from '../../e2e/support/scratch-env';
import { MawsdScene, until } from '../../test/support/mawsd-scene';
import { exchangeBytes, type Headers, HOST, ORIGIN, JSON_BODY, request, jsonOf, macOf, nonce, Tab, pairedTab } from '../../test/support/sheet-page-client';
import { runCli, sheetPageLine, type CliDeps } from './cli';
import type { DaemonOptions, RunningDaemon } from './daemon';
import { NO_SHEETS } from './sheet-page/sheets';
import type { SheetPageTiming } from './sheet-page/timing';

const FIXTURE = resolve(__dirname, '../../test/fixtures/sheet-page/bundle');
const SHELL = readFileSync(join(FIXTURE, 'index.html'));
const TIMING: Partial<SheetPageTiming> = { headersMs: 400, requestMs: 800, keepAliveMs: 500, checkMs: 50, helloMs: 400, portRetryMs: 200, heartbeatMs: 100 };
const SESSION = '5eed0000-0000-4000-8000-000000000019';
const MINUTE = 60_000;
vi.setConfig({ testTimeout: 30_000 });

let scene: MawsdScene;
let clock: number;
let failWrites: boolean;
let shellCaptures: number;

beforeEach(() => {
  scene = new MawsdScene('maws-sp-');
  clock = Date.parse('2026-11-24T10:00:00.000Z');
  failWrites = false;
  shellCaptures = 0;
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  for (const method of ['error', 'warn', 'info'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

// --- the daemon -------------------------------------------------------------------------------------------------------

function options(env: Record<string, string> = {}, sheetPage: DaemonOptions['sheetPage'] = {}): Partial<DaemonOptions> {
  return {
    env: { MAWS_USER_DATA: scene.root, MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', ...env },
    // the product's options since M5b (src/mawsd/index.ts)
    permanentClient: true,
    claimSpine: true,
    spine: { wakeOnEvents: true },
    sheetPage: {
      bundleDir: FIXTURE,
      shell: async () => (shellCaptures++, {}),
      now: () => clock,
      write: (file, text) => {
        if (failWrites) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
        atomicWriteFileSync(file, text);
      },
      timing: TIMING,
      sheets: NO_SHEETS, // who is let in asks nothing of the spine: the sheets themselves are process-sheet-page-sheets.test.ts's
      ...sheetPage,
    },
  };
}

async function served(env: Record<string, string> = {}, sheetPage: DaemonOptions['sheetPage'] = {}): Promise<{ daemon: RunningDaemon; port: number }> {
  const daemon = await scene.start(options(env, sheetPage));
  await until(() => daemon.sheetPage.status().state === 'listening', 5_000, 'the sheet page listening');
  return { daemon, port: Number(new URL(daemon.sheetPage.status().url!).port) };
}

const decided = (daemon: RunningDaemon) => until(() => daemon.sheetPage.status().detail !== null, 5_000, 'the sheet page’s decision');

// --- pairing --------------------------------------------------------------------------------------------------------------

async function code(daemon: RunningDaemon): Promise<string> {
  const answer = await daemon.sheetPage.pair();
  if (!answer.ok) throw new Error(answer.why);
  return answer.code;
}

async function pairBrowser(daemon: RunningDaemon, port: number): Promise<{ id: string; credential: string }> {
  const answer = await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: await code(daemon) }));
  expect(answer.status).toBe(200);
  clock += MINUTE / 10 + 1; // ten exchanges a minute
  return jsonOf(answer) as { id: string; credential: string };
}

// --- the command line, as cli.test.ts drives it -----------------------------------------------------------------------

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const home = join(scene.root, 'home');
  mkdirSync(home, { recursive: true });
  const deps: CliDeps = {
    env: { MAWS_USER_DATA: scene.root },
    platform: 'linux',
    home,
    cwd: scene.root,
    uid: 501,
    user: 'u',
    out: (text) => void (out += text),
    err: (text) => void (err += text),
    stdin: { isTTY: false, read: async () => '', prompt: async () => '' },
    run: () => ({ status: 1, stdout: '', stderr: 'no unit manager here' }),
    sleep: async () => {},
    now: () => clock,
    self: { runtime: '/opt/maws/node', entry: '/opt/maws/out/main/mawsd.js' },
    build: 'process-sheet-page',
  };
  const code = await runCli(argv, deps);
  return { code, out, err };
}

async function heldPort(): Promise<{ port: number; holder: Server }> {
  const holder = createServer();
  await new Promise<void>((done) => holder.listen({ host: '127.0.0.1', port: 0 }, done));
  return { port: (holder.address() as AddressInfo).port, holder };
}
const freePort = async (): Promise<number> => {
  const { port, holder } = await heldPort();
  await new Promise((done) => holder.close(done));
  return port;
};
const reaches = (host: string, port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host, port });
    socket.once('connect', () => (socket.destroy(), done(true)));
    socket.once('error', () => done(false));
  });

// =========================================================================================================================

describe('another Host (Acceptance 11, “any request with another Host”; T7)', () => {
  it('is answered 421 with the standing headers and no byte of the shell, for every route and an upgrade; the name in upper case passes', async () => {
    const { port } = await served();
    const hosts: Headers[] = [
      [['Host', `127.0.0.1:${port}`]],
      [['Host', `localhost:${port}`]],
      [['Host', `[::1]:${port}`]],
      [['Host', `rebound.example:${port}`]],
      [['Host', 'sheet.localhost']],
      [['Host', `sheet.localhost:${port + 1}`]],
      [['Host', `sheet.localhost.:${port}`]],
      [HOST(port), ['Host', `rebound.example:${port}`]],
      [],
    ];
    const asks: [string, string, Headers][] = [
      ['GET', '/', []],
      ['GET', `/s/${SESSION}`, []],
      ['GET', '/assets/page.js', []],
      ['POST', '/api/pair', [ORIGIN(port)]],
      ['POST', '/api/unpair', [ORIGIN(port), ['Authorization', `Bearer ${'A'.repeat(43)}`]]],
      ['GET', '/live', [ORIGIN(port), ['Upgrade', 'websocket'], ['Connection', 'Upgrade'], ['Sec-WebSocket-Version', '13'], ['Sec-WebSocket-Key', randomBytes(16).toString('base64')]]],
    ];
    for (const host of hosts) {
      for (const [method, target, extra] of asks) {
        const answer = await request(port, method, target, [...host, ...extra]);
        expect(answer.status, `${method} ${target} ${JSON.stringify(host)}`).toBe(421);
        expect(answer.body.includes(SHELL)).toBe(false);
        expect(answer.body.toString()).not.toMatch(/rebound|localhost|::1|127\.0/);
      }
    }
    const upper = await request(port, 'GET', '/', [['Host', `SHEET.LOCALHOST:${port}`]]);
    expect(upper.status).toBe(200);
  });
});

describe('the shell on the Host alone (Acceptance 11, “an unpaired browser still gets the pairing screen”)', () => {
  it('answers GET / and GET /s/<anything> with no credential, the same bytes each time, and the bundle’s files', async () => {
    const { port } = await served();
    for (const target of ['/', `/s/${SESSION}`, '/s/names-nothing', '/s/x?code=AAAA-AAAA']) {
      const answer = await request(port, 'GET', target, [HOST(port)]);
      expect(answer.status, target).toBe(200);
      expect(answer.body.equals(SHELL)).toBe(true);
      expect(answer.headers['content-type']).toEqual(['text/html; charset=utf-8']);
      expect(answer.headers['cache-control']).toEqual(['no-cache']);
    }
    const script = await request(port, 'GET', '/assets/page.js', [HOST(port)]);
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toEqual(['text/javascript; charset=utf-8']);
    const again = await request(port, 'GET', '/assets/page.js', [HOST(port), ['If-None-Match', script.headers.etag![0]!]]);
    expect(again.status).toBe(304);
  });
});

describe('the exchange is a write (§8.2’s rule 2)', () => {
  it('is 403 with any Origin but the page’s, and with none, and the code is still live; with the page’s it is 200', async () => {
    const { daemon, port } = await served();
    const live = await code(daemon);
    const body = JSON.stringify({ code: live });
    for (const origin of [`http://localhost:${port}`, `http://sheet.localhost:${port + 1}`, `https://sheet.localhost:${port}`, 'null', null]) {
      const answer = await request(port, 'POST', '/api/pair', [HOST(port), ...(origin === null ? [] : [['Origin', origin] as [string, string]]), JSON_BODY], body);
      expect(answer.status, String(origin)).toBe(403);
      expect(answer.body.toString()).toBe('This request did not come from the sheet page.');
    }
    const paired = await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], body);
    expect(paired.status).toBe(200);
    expect(jsonOf(paired)).toEqual({ id: expect.stringMatching(/^[0-9a-f]{8}$/), credential: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(paired.headers['cache-control']).toEqual(['no-store']);
  });
});

describe('the code (T8)', () => {
  const exchange = (port: number, typed: string) => request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: typed }));

  it('works once; a second pair voids the first; five minutes end it', async () => {
    const { daemon, port } = await served();
    const first = await code(daemon);
    const second = await code(daemon);
    expect(jsonOf(await exchange(port, first))).toEqual({ why: 'wrong', left: 4 });
    expect((await exchange(port, second)).status).toBe(200);
    expect(jsonOf(await exchange(port, second))).toEqual({ why: 'none' });
    const third = await code(daemon);
    clock += 5 * MINUTE;
    const expired = await exchange(port, third);
    expect(expired.status).toBe(403);
    expect(jsonOf(expired)).toEqual({ why: 'expired' });
  });

  it('reads a malformed code as a wrong try, 403, never a 500', async () => {
    const { daemon, port } = await served();
    await code(daemon);
    for (const [typed, left] of [['ÄÄÄÄ-ÄÄÄÄ', 4], ['\u{1F600}'.repeat(8), 3], ['IIII-LLLL', 2]] as const) {
      const answer = await exchange(port, typed);
      expect(answer.status, typed).toBe(403);
      expect(jsonOf(answer)).toEqual({ why: 'wrong', left });
    }
  });

  it('is voided by the fifth wrong try; the eleventh exchange in a minute is 429', async () => {
    const { daemon, port } = await served();
    const live = await code(daemon);
    const wrong = live.startsWith('0') ? '1111-1111' : '0000-0000';
    for (const left of [4, 3, 2, 1, 0]) expect(jsonOf(await exchange(port, wrong))).toEqual({ why: 'wrong', left });
    expect(jsonOf(await exchange(port, live))).toEqual({ why: 'none' });
    for (let i = 0; i < 4; i++) await exchange(port, wrong); // ten in this minute
    const busy = await exchange(port, await code(daemon));
    expect(busy.status).toBe(429);
  });

  it('is made by `mawsd sheet pair` alone on its first line, and no log line and no file holds it or the credential', async () => {
    const { daemon, port } = await served();
    const ran = await cli(['sheet', 'pair']);
    expect(ran.code).toBe(0);
    const [printed, sentence] = ran.out.split('\n');
    expect(printed).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(sentence).toBe(`Type this code into the page at http://sheet.localhost:${port}/ within 5 minutes. It works once.`);
    const answer = await exchange(port, printed!);
    const { credential } = jsonOf(answer) as { credential: string };
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : entry.isFile() ? [join(dir, entry.name)] : []));
    for (const file of files(scene.root)) {
      const text = readFileSync(file, 'latin1');
      for (const secret of [printed!, printed!.replace('-', ''), credential]) expect(text.includes(secret), file).toBe(false);
    }
    for (const secret of [printed!, printed!.replace('-', ''), credential]) expect(scene.logs.join('\n')).not.toContain(secret);
    expect(daemon.sheetPage.status()).toMatchObject({ browsers: 1, connections: 0 });
  });

  it('is not made while the port is taken: `mawsd sheet pair` exits 2 with the reason; with no mawsd it exits 3', async () => {
    const { port, holder } = await heldPort();
    try {
      const daemon = await scene.start(options({ MAWS_SHEET_PORT: String(port) }));
      await until(() => daemon.sheetPage.status().state === 'port-taken', 5_000, 'the port taken');
      const ran = await cli(['sheet', 'pair']);
      expect(ran).toMatchObject({ code: 2, out: '' });
      expect(ran.err).toBe(`this mawsd does not serve the sheet page now: port ${port} is in use\n`);
      expect(sheetPageLine(daemon.sheetPage.status())).toBe(`sheet page: not served (port ${port} is in use)`);
      await daemon.stop('test');
    } finally {
      await new Promise((done) => holder.close(done));
    }
    expect((await cli(['sheet', 'pair'])).code).toBe(3);
  });
});

describe('the credential (§8.2’s rule 1; T9)', () => {
  it('is required on unpair: no header, another scheme, an unknown one, two headers, a cookie and the query are 401 and revoke nothing', async () => {
    const { daemon, port } = await served();
    const { credential } = await pairBrowser(daemon, port);
    const tries: [string, Headers][] = [
      ['/api/unpair', []],
      ['/api/unpair', [['Authorization', `Basic ${credential}`]]],
      ['/api/unpair', [['Authorization', `Bearer ${randomBytes(32).toString('base64url')}`]]],
      ['/api/unpair', [['Authorization', `Bearer ${credential}`], ['Authorization', `Bearer ${randomBytes(32).toString('base64url')}`]]],
      ['/api/unpair', [['Cookie', `credential=${credential}`]]],
      [`/api/unpair?credential=${credential}`, []],
    ];
    for (const [target, extra] of tries) {
      const answer = await request(port, 'POST', target, [HOST(port), ORIGIN(port), ...extra]);
      expect(answer.status, JSON.stringify(extra)).toBe(401);
      expect(answer.body.toString()).toBe('This browser is not paired.');
    }
    expect((await daemon.sheetPage.browsers()).browsers).toHaveLength(1);
    const unpaired = await request(port, 'POST', '/api/unpair', [HOST(port), ORIGIN(port), ['Authorization', `Bearer ${credential}`]]);
    expect(unpaired.status).toBe(204);
    expect(await daemon.sheetPage.browsers()).toEqual({ browsers: [] });
  });

  it('is not enough on unpair without exactly the page’s Origin: each foreign Origin and none are 403 and revoke nothing', async () => {
    const { daemon, port } = await served();
    const { credential } = await pairBrowser(daemon, port);
    for (const origin of [`http://localhost:${port}`, `http://sheet.localhost:${port + 1}`, `https://sheet.localhost:${port}`, 'null', null]) {
      const answer = await request(port, 'POST', '/api/unpair', [HOST(port), ...(origin === null ? [] : [['Origin', origin] as [string, string]]), ['Authorization', `Bearer ${credential}`]]);
      expect(answer.status, String(origin)).toBe(403);
    }
    expect((await daemon.sheetPage.browsers()).browsers).toHaveLength(1);
  });

  it('revokes nothing when the unpair’s request is cut off before its body ends, and answers nothing', async () => {
    const { daemon, port } = await served();
    const { credential } = await pairBrowser(daemon, port);
    const heard = await new Promise<string>((done) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      let text = '';
      socket.on('data', (chunk) => void (text += chunk.toString('latin1')));
      socket.on('error', () => {});
      socket.on('connect', () => {
        socket.write(`POST /api/unpair HTTP/1.1\r\nHost: sheet.localhost:${port}\r\nOrigin: http://sheet.localhost:${port}\r\nAuthorization: Bearer ${credential}\r\nContent-Length: 50\r\n\r\n0123456789`);
        setTimeout(() => (socket.destroy(), done(text)), 150);
      });
    });
    expect(heard).toBe('');
    await new Promise((done) => setTimeout(done, 200));
    expect((await daemon.sheetPage.browsers()).browsers).toHaveLength(1);
    expect(scene.logs.join('\n')).not.toMatch(/unpaired/);
  });

  it('is kept as its hash and the proof key, never itself, in a file of mode 0600; `mawsd sheet browsers` lists it', async () => {
    const { daemon, port } = await served();
    const { id, credential } = await pairBrowser(daemon, port);
    const file = join(scene.paths.dir, 'sheet-page.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const kept = JSON.parse(readFileSync(file, 'utf8')) as { v: number; browsers: Record<string, string>[] };
    expect(kept.browsers[0]).toMatchObject({ id, hash: createHash('sha256').update(Buffer.from(credential, 'base64url')).digest('hex') });
    expect(readFileSync(file, 'utf8')).not.toContain(credential);
    const listed = await cli(['sheet', 'browsers']);
    expect(listed.code).toBe(0);
    expect(listed.out).toMatch(new RegExp(`^${id}  A browser · paired \\S+ · last seen \\S+\\n$`));
    expect(JSON.parse((await cli(['sheet', 'browsers', '--json'])).out)).toMatchObject({ served: true, browsers: [{ id, label: 'A browser' }] });
  });
});

describe('a revocation’s two moments (T10)', () => {
  it('with the replace failing: 500, the credential refused at once and its connection closed 4403; a restart accepts it; once a retry saved it, a restart refuses it', async () => {
    const first = await served();
    const browser = await pairBrowser(first.daemon, first.port);
    const other = await pairBrowser(first.daemon, first.port);
    const tab = await pairedTab(first.port, browser);
    failWrites = true;
    const refused = await request(first.port, 'POST', '/api/unpair', [HOST(first.port), ORIGIN(first.port), ['Authorization', `Bearer ${browser.credential}`]]);
    expect(refused.status).toBe(500);
    expect(jsonOf(refused)).toEqual({ why: 'not-saved' });
    expect(await tab.closedWith()).toBe(4403);
    expect((await request(first.port, 'POST', '/api/unpair', [HOST(first.port), ORIGIN(first.port), ['Authorization', `Bearer ${browser.credential}`]])).status).toBe(401);
    const ran = await cli(['sheet', 'unpair', other.id]);
    expect(ran).toEqual({ code: 1, out: '', err: 'unpaired 1 browser for now: the change could not be saved (ENOSPC). It is paired again if mawsd restarts before a save succeeds.\n' });
    await first.daemon.stop('a restart');

    failWrites = false;
    const second = await served();
    await pairedTab(second.port, browser); // what the answer said: paired again after a restart
    failWrites = true;
    expect((await cli(['sheet', 'unpair', '--all'])).code).toBe(1);
    failWrites = false;
    await until(() => readFileSync(join(scene.paths.dir, 'sheet-page.json'), 'utf8').includes('"browsers":[]'), 5_000, 'the retry at a tick');
    await second.daemon.stop('a restart');

    const third = await served();
    const tabAfter = await Tab.open(third.port);
    tabAfter.send({ t: 'hello', v: 1, id: browser.id, nonce: nonce() });
    expect(await tabAfter.next(0)).toEqual({ closed: 4401 });
  });

  it('with the replace failing, an exchange answers not-saved and hands out nothing, and the code pairs once the replace works', async () => {
    const { daemon, port } = await served();
    const live = await code(daemon);
    failWrites = true;
    const refused = await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: live }));
    expect(refused.status).toBe(503);
    expect(jsonOf(refused)).toEqual({ why: 'not-saved' });
    failWrites = false;
    expect((await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: live }))).status).toBe(200);
  });

  it('answers `mawsd sheet unpair` when saved, and refuses an id that is not one', async () => {
    const { daemon, port } = await served();
    const { id } = await pairBrowser(daemon, port);
    expect(await cli(['sheet', 'unpair', id])).toEqual({ code: 0, out: 'unpaired 1 browser\n', err: '' });
    expect((await cli(['sheet', 'unpair', 'not-an-id'])).code).toBe(1);
  });
});

describe('a browser dropped or aged out (T10)', () => {
  const unpairWith = (port: number, credential: string) => request(port, 'POST', '/api/unpair', [HOST(port), ORIGIN(port), ['Authorization', `Bearer ${credential}`]]);
  const helloOf = async (port: number, id: string) => {
    const tab = await Tab.open(port);
    tab.send({ t: 'hello', v: 1, id, nonce: nonce() });
    return tab.next(0);
  };

  it('a seventeenth pairing drops the one seen longest ago: its paired socket is closed 4403, and it is refused over HTTP and on a new connection', async () => {
    const { daemon, port } = await served();
    const browsers = [];
    for (let i = 0; i < 16; i++) browsers.push(await pairBrowser(daemon, port));
    const oldest = browsers[0]!;
    const tab = await pairedTab(port, oldest);
    await pairBrowser(daemon, port);
    expect(await tab.closedWith()).toBe(4403);
    expect((await unpairWith(port, oldest.credential)).status).toBe(401);
    expect(await helloOf(port, oldest.id)).toEqual({ closed: 4401 });
    expect((await daemon.sheetPage.browsers()).browsers.map((browser) => browser.id)).not.toContain(oldest.id);
  });

  it('a credential unused for 90 days leaves no socket paired: closed 4403 at the next ping, and refused over HTTP and on a new connection', async () => {
    const { daemon, port } = await served({}, { timing: { ...TIMING, pingMs: 150 } });
    const browser = await pairBrowser(daemon, port);
    const tab = await pairedTab(port, browser);
    await new Promise((done) => setTimeout(done, 400));
    expect(tab.closed).toBeNull(); // pinged and still paired
    clock += 90 * 24 * 60 * MINUTE;
    expect(await tab.closedWith()).toBe(4403);
    expect((await unpairWith(port, browser.credential)).status).toBe(401);
    expect(await helloOf(port, browser.id)).toEqual({ closed: 4401 });
  });
});

describe('the server’s proof (T28) and the live connection (Acceptance 11, “a live connection from another Origin”)', () => {
  it('answers a known hello with the MAC the test computes, having sent nothing before it; then pairs on the credential', async () => {
    const { daemon, port } = await served();
    const browser = await pairBrowser(daemon, port);
    const tab = await Tab.open(port);
    await new Promise((done) => setTimeout(done, 100));
    expect(tab.frames).toEqual([]);
    const once = nonce();
    tab.send({ t: 'hello', v: 1, id: browser.id, nonce: once });
    expect(await tab.next(0)).toEqual({ t: 'proof', mac: macOf(browser.credential, browser.id, once) });
    tab.send({ t: 'credential', credential: browser.credential });
    expect(await tab.next(1)).toEqual({ t: 'paired' });
    expect(await tab.next(2)).toEqual({ t: 'unavailable', why: 'no-service' }); // this suite's sheets are none
    expect(daemon.sheetPage.status().connections).toBe(1);
  });

  it('heals at a hello once an unreadable browsers’ file reads again; the status counts in memory alone, null while it is unread', async () => {
    const first = await served();
    const browser = await pairBrowser(first.daemon, first.port);
    await first.daemon.stop('a restart');
    const file = join(scene.paths.dir, 'sheet-page.json');
    const kept = readFileSync(file, 'utf8');
    rmSync(file);
    mkdirSync(file); // read fails EISDIR
    const { daemon, port } = await served();
    expect((await request(port, 'GET', '/', [HOST(port)])).status).toBe(200); // the handler loaded
    const refused = await Tab.open(port);
    refused.send({ t: 'hello', v: 1, id: browser.id, nonce: nonce() });
    expect(await refused.next(0)).toEqual({ closed: 4401 });
    expect(daemon.sheetPage.status().browsers).toBeNull(); // not known, not 0

    rmSync(file, { recursive: true });
    writeFileSync(file, kept, { mode: 0o600 });
    expect(daemon.sheetPage.status().browsers).toBeNull(); // the status read no file: still unread
    const tab = await pairedTab(port, browser); // no status or command in between: the hello read it again
    expect(daemon.sheetPage.status()).toMatchObject({ browsers: 1, connections: 1 });
    tab.ws.close();
  });

  it('gives two MACs for two nonces, and two for one nonce under two browsers', async () => {
    const { daemon, port } = await served();
    const [a, b] = [await pairBrowser(daemon, port), await pairBrowser(daemon, port)];
    const proofOf = async (id: string, once: string) => {
      const tab = await Tab.open(port);
      tab.send({ t: 'hello', v: 1, id, nonce: once });
      const proof = (await tab.next(0)) as { mac: string };
      tab.ws.close();
      return proof.mac;
    };
    const once = nonce();
    const macs = [await proofOf(a.id, once), await proofOf(a.id, nonce()), await proofOf(b.id, once)];
    expect(new Set(macs).size).toBe(3);
    expect(macs[2]).toBe(macOf(b.credential, b.id, once));
  });

  it('closes an unknown id with 4401, a credential sent first with 1008, a late credential, and a wrong one with 4401', async () => {
    const { daemon, port } = await served();
    const a = await pairBrowser(daemon, port);
    const b = await pairBrowser(daemon, port);

    const unknown = await Tab.open(port);
    unknown.send({ t: 'hello', v: 1, id: '0badc0de', nonce: nonce() });
    expect(await unknown.next(0)).toEqual({ closed: 4401 });

    const first = await Tab.open(port);
    first.send({ t: 'credential', credential: a.credential });
    expect(await first.next(0)).toEqual({ closed: 1008 });

    const late = await Tab.open(port);
    late.send({ t: 'hello', v: 1, id: a.id, nonce: nonce() });
    expect(await late.next(0)).toMatchObject({ t: 'proof' });
    expect(await late.next(1, 2_000)).toEqual({ closed: 4401 }); // helloMs passed with no credential

    const wrong = await Tab.open(port);
    wrong.send({ t: 'hello', v: 1, id: a.id, nonce: nonce() });
    await wrong.next(0);
    wrong.send({ t: 'credential', credential: b.credential }); // another browser's
    expect(await wrong.next(1)).toEqual({ closed: 4401 });
    expect(daemon.sheetPage.status().connections).toBe(0);
  });

  it('refuses an upgrade with another Origin, or none, before the handshake: no 101', async () => {
    const { port } = await served();
    for (const origin of [`http://localhost:${port}`, `http://sheet.localhost:${port + 1}`, 'null', undefined]) {
      const tab = await Tab.open(port, origin === undefined ? {} : { Origin: origin });
      if (origin === undefined) {
        // ws's own client sends no Origin unless told: the bare handshake, by hand
        const answer = await request(port, 'GET', '/live', [HOST(port), ['Upgrade', 'websocket'], ['Connection', 'Upgrade'], ['Sec-WebSocket-Version', '13'], ['Sec-WebSocket-Key', randomBytes(16).toString('base64')]]);
        expect(answer.status).toBe(403);
        tab.ws.terminate();
        continue;
      }
      expect(tab.refused?.status, origin).toBe(403);
    }
  });

  it('ends an upgraded connection that never says hello at helloMs, and refuses a ninth unpaired one', async () => {
    const { port } = await served({}, { timing: { ...TIMING, helloMs: 1_500 } });
    const tabs = await Promise.all(Array.from({ length: 8 }, () => Tab.open(port)));
    const ninth = await Tab.open(port);
    expect(ninth.refused?.status).toBe(503);
    for (const tab of tabs) expect(await tab.closedWith(3_000)).toBe(4401);
  });
});

describe('the headers (§8.2’s rule 3; T12)', () => {
  it('are on what Node would have answered alone: a request line that is not HTTP, headers past 16 KiB, Expect, and a stalled request', async () => {
    const { port } = await served();
    const notHttp = await exchangeBytes(port, 'HELLO THERE\r\n\r\n');
    expect(notHttp.status).toBe(400);
    const huge = await request(port, 'GET', '/', [HOST(port), ['X-Big', 'x'.repeat(17 * 1024)]]);
    expect(huge.status).toBe(431);
    const expect100 = await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), ['Expect', '100-continue']], '{}');
    expect(expect100.status).toBe(417);
    const stalled = await exchangeBytes(port, `GET / HTTP/1.1\r\nHost: sheet.localhost:${port}\r\n`);
    expect(stalled.status).toBe(408);
  });

  it('carry a content policy that names no source but the page’s own', async () => {
    const { port } = await served();
    const answer = await request(port, 'GET', '/', [HOST(port)]);
    const policy = answer.headers['content-security-policy']![0]!;
    const directives = new Map(policy.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...sources]) => [name!, sources]));
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('default-src')).toEqual(["'none'"]);
    for (const [name, sources] of directives) {
      for (const source of sources) {
        const allowed = ["'self'", "'none'", 'data:', 'blob:', `ws://sheet.localhost:${port}`, ...(name === 'style-src' ? ["'unsafe-inline'"] : [])];
        expect(allowed, `${name} ${source}`).toContain(source);
      }
    }
  });
});

describe('the count of headers (§J)', () => {
  const filler = (n: number): Headers => Array.from({ length: n }, (_, i) => [`X-Filler-${i}`, 'x']);
  const handshake = (): Headers => [['Upgrade', 'websocket'], ['Connection', 'Upgrade'], ['Sec-WebSocket-Version', '13'], ['Sec-WebSocket-Key', randomBytes(16).toString('base64')]];

  it('passes 64 and refuses 65 with 431, as a GET and as an upgrade; 70 whose last is a foreign Origin or a second Host are 431', async () => {
    const { port } = await served();
    // `request` adds Connection: close, one header more
    expect((await request(port, 'GET', '/', [HOST(port), ...filler(62)])).status).toBe(200);
    const over = await request(port, 'GET', '/', [HOST(port), ...filler(63)]);
    expect(over.status).toBe(431);
    const upgrade = [HOST(port), ORIGIN(port), ...handshake()];
    // with Connection: close beside Connection: Upgrade, 65 and 64
    expect((await request(port, 'GET', '/live', [...upgrade, ...filler(64 - upgrade.length)])).status).toBe(431);
    expect((await request(port, 'GET', '/live', [...upgrade, ...filler(63 - upgrade.length)])).status).toBe(101); // then ended at helloMs and the grace
    expect((await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), ...filler(67), ['Origin', 'http://evil.example']], '{}')).status).toBe(431);
    expect((await request(port, 'GET', '/', [HOST(port), ...filler(68), ['Host', 'rebound.example']])).status).toBe(431);
  });
});

describe('the deadlines and the count of connections (T1)', () => {
  it('end 128 stalled connections within the header deadline; a request after them is answered; a 129th while they are open is ended at once', async () => {
    const { port } = await served();
    const sockets: Socket[] = [];
    const ended = Array.from({ length: 128 }, () => {
      const socket = createConnection({ host: '127.0.0.1', port });
      sockets.push(socket);
      return new Promise<number>((done) => {
        const began = Date.now();
        socket.on('data', () => {});
        socket.on('error', () => {});
        socket.on('close', () => done(Date.now() - began));
        socket.on('connect', () => socket.write('GET / HT'));
      });
    });
    await Promise.all(sockets.map((socket) => new Promise((done) => (socket.connecting ? socket.once('connect', done) : done(null)))));
    await new Promise((done) => setTimeout(done, 50)); // each accepted by the server
    const extra = await exchangeBytes(port, `GET / HTTP/1.1\r\nHost: sheet.localhost:${port}\r\n\r\n`);
    expect(extra.status).toBe(0); // destroyed, nothing answered
    expect(extra.closedAfterMs).toBeLessThan(300);
    const times = await Promise.all(ended);
    expect(Math.max(...times)).toBeLessThan(400 + 50 + 600); // the deadline, a check's tick, a loaded runner
    expect((await request(port, 'GET', '/', [HOST(port)])).status).toBe(200);
  });
});

describe('the table (T13)', () => {
  it('reads nothing outside the bundle, serves no link and no unlisted extension', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'maws-sp-bundle-'));
    try {
      const bundle = join(scratch, 'bundle');
      cpSync(FIXTURE, bundle, { recursive: true });
      writeFileSync(join(scratch, 'secret.js'), 'the secret');
      writeFileSync(join(bundle, 'notes.txt'), 'not listed');
      symlinkSync(join(scratch, 'secret.js'), join(bundle, 'assets', 'linked.js'));
      const { port } = await served({}, { bundleDir: bundle });
      for (const target of ['/../secret.js', '/assets/../../secret.js', '/assets%2F..%2F..%2Fsecret.js', '/%2e%2e/secret.js', '/assets/linked.js', '/notes.txt', '//secret.js']) {
        const answer = await request(port, 'GET', target, [HOST(port)]);
        expect(answer.status, target).toBe(404);
        expect(answer.body.toString()).not.toContain('the secret');
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe('limits', () => {
  it('refuses a body over its bound with 413, OPTIONS with 405, and writes nothing of a refused request back', async () => {
    const { port } = await served();
    const big = await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: 'x'.repeat(2048) }));
    expect(big.status).toBe(413);
    const chunked = await exchangeBytes(port, `POST /api/pair HTTP/1.1\r\nHost: sheet.localhost:${port}\r\nOrigin: http://sheet.localhost:${port}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n800\r\n${'x'.repeat(2048)}\r\n0\r\n\r\n`);
    expect(chunked.status).toBe(413);
    const options = await request(port, 'OPTIONS', '/api/pair', [HOST(port), ORIGIN(port), ['Access-Control-Request-Method', 'POST']]);
    expect(options.status).toBe(405);
    expect(options.headers['access-control-allow-origin']).toBeUndefined();
    const echoed = await request(port, 'GET', '/%3Cscript%3E', [['Host', '<script>marker</script>']]);
    expect(echoed.body.toString()).not.toMatch(/script|marker/);
  });
});

describe('loopback only (T3)', () => {
  it('answers on 127.0.0.1 (and ::1 where the machine has it) and refuses a connection to any other address of the machine', async () => {
    const { port } = await served();
    expect(await reaches('127.0.0.1', port)).toBe(true);
    const outside = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address !== undefined && !address.internal && address.family === 'IPv4');
    for (const address of outside) expect(await reaches(address!.address, port), address!.address).toBe(false);
  });
});

describe('never in the way (T2, T5, T6)', () => {
  it('opens no socket, captures no shell and loads nothing without the switch', async () => {
    const port = await freePort();
    const load = vi.fn();
    const daemon = await scene.start(options({ MAWS_SHEET_PAGE: '', MAWS_SHEET_PORT: String(port) }, { load }));
    await decided(daemon);
    expect(daemon.sheetPage.status()).toMatchObject({ state: 'off', url: null });
    expect(await reaches('127.0.0.1', port)).toBe(false);
    expect(shellCaptures).toBe(0);
    expect(load).not.toHaveBeenCalled();
    expect(sheetPageLine(daemon.sheetPage.status())).toBe('sheet page: not served (a private mawsd of another profile serves it only under MAWS_SHEET_PAGE=1)');
  });

  it('opens no socket under the test launchers’ environment, from a runner that opted in', async () => {
    const port = await freePort();
    const env = launchEnvironment({ PATH: '/usr/bin:/bin', MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: String(port) }, scene.root);
    const daemon = await scene.start({ ...options(), env });
    await decided(daemon);
    expect(daemon.sheetPage.status()).toMatchObject({ state: 'off', detail: 'turned off by MAWS_SHEET_PAGE=0' });
    expect(await reaches('127.0.0.1', port)).toBe(false);
  });

  it('serves nothing from a build with no bundle', async () => {
    const daemon = await scene.start(options({}, { bundleDir: join(scene.root, 'no-such-bundle') }));
    await decided(daemon);
    expect(daemon.sheetPage.status()).toMatchObject({ state: 'no-bundle', url: null });
  });

  it('reads and changes the browsers’ file with the page off or without a bundle: `sheet browsers` lists, `sheet unpair` revokes', async () => {
    const first = await served();
    const a = await pairBrowser(first.daemon, first.port);
    const b = await pairBrowser(first.daemon, first.port);
    await first.daemon.stop('a restart');

    const bare = await scene.start(options({}, { bundleDir: join(scene.root, 'no-such-bundle') }));
    await decided(bare);
    expect(JSON.parse((await cli(['sheet', 'browsers', '--json'])).out)).toMatchObject({ served: false, browsers: [{ id: a.id }, { id: b.id }] });
    expect((await cli(['sheet', 'pair'])).code).toBe(2);
    await bare.stop('a restart');

    const off = await scene.start(options({ MAWS_SHEET_PAGE: '' }));
    await decided(off);
    const listed = await cli(['sheet', 'browsers']);
    expect(listed).toMatchObject({ code: 0, err: 'this mawsd does not serve the sheet page now\n' });
    expect(listed.out.split('\n').filter(Boolean)).toHaveLength(2);
    expect(await cli(['sheet', 'unpair', a.id])).toEqual({ code: 0, out: 'unpaired 1 browser\n', err: '' });
    expect(readFileSync(join(scene.paths.dir, 'sheet-page.json'), 'utf8')).not.toContain(a.id);
    expect(await reaches('127.0.0.1', first.port)).toBe(false); // still no socket
  });

  it('surfaces a browsers’ file it could not read, by its error’s code: `sheet browsers` and `sheet unpair --all` claim nothing', async () => {
    mkdirSync(scene.paths.dir, { recursive: true, mode: 0o700 }); // mawsd's own directory, as it requires it
    mkdirSync(join(scene.paths.dir, 'sheet-page.json')); // read fails EISDIR
    const off = await scene.start(options({ MAWS_SHEET_PAGE: '' }));
    await decided(off);
    const listed = await cli(['sheet', 'browsers']);
    expect(listed).toEqual({ code: 1, out: '', err: 'this mawsd does not serve the sheet page now\nthe browsers’ file could not be read (EISDIR)\n' });
    const json = await cli(['sheet', 'browsers', '--json']);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.out)).toEqual({ served: false, browsers: [], why: 'EISDIR' });
    const unpaired = await cli(['sheet', 'unpair', '--all']);
    expect(unpaired).toEqual({ code: 1, out: '', err: 'nothing was unpaired: the browsers’ file could not be read (EISDIR)\n' });
    expect(`${listed.err}${unpaired.err}`).not.toContain(scene.root); // a code, never a path
  });

  it('loads its chunk at the first request, not at the start; a chunk that cannot load answers 503 and the daemon serves the rest', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('the chunk is gone');
      return import('./sheet-page/handler');
    });
    const { daemon, port } = await served({}, { load });
    expect(load).not.toHaveBeenCalled();
    expect(daemon.sheetPage.status()).toMatchObject({ browsers: null, connections: null });
    const unavailable = await request(port, 'GET', '/', [HOST(port)]);
    expect(unavailable.status).toBe(503);
    const app = await scene.app('machine');
    expect(await app.request('daemon.status')).toMatchObject({ ok: true, value: { sheetPage: { state: 'listening', browsers: null } } });
    fail = false;
    expect((await request(port, 'GET', '/', [HOST(port)])).status).toBe(200);
    expect(load).toHaveBeenCalledTimes(2);
    expect(sheetPageLine(daemon.sheetPage.status())).toBe(`sheet page: http://sheet.localhost:${port} (0 browsers paired, 0 open)`);
  });

  it('stops first in the exit order: the listeners closed and the live connections told 1001', async () => {
    const { daemon, port } = await served();
    const tab = await pairedTab(port, await pairBrowser(daemon, port));
    await daemon.stop('test');
    expect(await tab.closedWith()).toBe(1001);
    expect(await reaches('127.0.0.1', port)).toBe(false);
    expect(daemon.sheetPage.status().state).toBe('stopped');
  });
});

describe('the three commands (T11)', () => {
  it('are graded internal, which no caller through the endpoint holds', () => {
    for (const name of ['daemon.sheetPair', 'daemon.sheetBrowsers', 'daemon.sheetUnpair']) expect(gradeOf(name), name).toBe('internal');
  });

  it('answer through machine.sock, and status carries the page', async () => {
    const { port } = await served();
    const app = await scene.app('machine');
    expect(await app.request('daemon.sheetPair')).toMatchObject({ ok: true, value: { ok: true, url: `http://sheet.localhost:${port}` } });
    expect(await app.request('daemon.sheetBrowsers')).toMatchObject({ ok: true, value: { served: true, browsers: [] } });
    expect(await app.request('daemon.sheetUnpair', { id: null })).toMatchObject({ ok: true, value: { removed: 0, saved: true } });
    expect(await app.request('daemon.status')).toMatchObject({ ok: true, value: { sheetPage: { state: 'listening', url: `http://sheet.localhost:${port}`, browsers: 0, connections: 0, registered: false } } });
  });
});
