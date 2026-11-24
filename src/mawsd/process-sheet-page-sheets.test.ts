// Sheets through the page server, in a running `mawsd` (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md,
// M3's Proves; §N): the daemon in this process with the product's options (test/support/mawsd-scene.ts), the real spine
// loaded from the services entry with C3's real sheet service, over a scratch profile and a scratch sminos home seeded
// from the pin, and C3's stand-in door named in MAWS_SMINOS_CLI, so a Send goes through the same `execFile` path the
// real one takes. The service runs the command with the login shell's environment, so the shell's capture is this
// suite's (a stand-in's knobs ride on it), never this machine's. Every request a rule refuses is sent and seen refused,
// and the record's files are read after it: the inbox and `uploads/` byte for byte, and whether the door ran at all.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { MawsdScene, until } from '../../test/support/mawsd-scene';
import { HOST, JSON_BODY, ORIGIN, exchangeBytes, jsonOf, pairedTab, request, type Answer, type Headers } from '../../test/support/sheet-page-client';
import type { DaemonOptions, RunningDaemon } from './daemon';
import type { SpineEntry } from './spine-seam';

// The login shell, as the spine captures it at each load: this suite's, so no test reads this machine's
let loginShell: Record<string, string> = {};
vi.mock('@shared/host/shell-env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/host/shell-env')>();
  return { ...actual, captureShellEnvironment: async () => ({ ...loginShell }) };
});

const REPO = resolve(__dirname, '../..');
const FIXTURE = join(REPO, 'test/fixtures/sheet-page/bundle');
const PIN = join(REPO, 'test/fixtures/sheet/set/fixtures');
const DOOR = join(REPO, 'test/support/fake-sminos-cli.mjs');
const S = '5eed0000-0000-4000-8000-000000000019'; // the pin's `references` record
const NONE = '5eed0000-0000-4000-8000-0000000000c4'; // a session with no record
const HTML = Buffer.from('<!doctype html><html><body><script>window.marker = 1</script><h1>captured</h1></body></html>\n');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.marker = 1"><text>captured</text></svg>\n');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const IMAGE_REF = '36c907715b80d7cdad0e196256966a3353b771387aefb1116d8769dacc81b675'; // the pin's image/png reference
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'); // one pixel
vi.setConfig({ testTimeout: 60_000 });

let scene: MawsdScene;
let home: string;
let ran: string; // the file the stand-in door appends its path to at every start
let types: string[]; // every Content-Type the page server answered with, across a test

beforeEach(() => {
  scene = new MawsdScene('maws-sps-');
  home = join(scene.root, 'sminos');
  ran = join(scene.root, 'door-ran');
  types = [];
  mkdirSync(join(home, 'sheet'), { recursive: true });
  mkdirSync(join(scene.root, 'home'), { recursive: true });
  loginShell = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: join(scene.root, 'home'), FAKE_SMINOS_RAN: ran };
  seed();
  onTestFailed(() => void process.stdout.write(`--- mawsd's log\n${scene.logs.join('\n')}\n`));
  for (const method of ['error', 'warn', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});
afterEach(async () => {
  await scene.dispose();
  vi.restoreAllMocks();
});

// The pin's `references` record (its `before`, the inbox cut to the offset its state records), with an HTML file and an
// SVG file added as text references of its second question, made here and never in the pin's copy.
function seed(): void {
  const record = join(home, 'sheet', S);
  cpSync(join(PIN, 'references/before/sheet', S), record, { recursive: true });
  writeFileSync(join(record, 'inbox.jsonl'), '');
  const state = JSON.parse(readFileSync(join(record, 'state.json'), 'utf8')) as { questions: { id: string; references: unknown[] }[] };
  const text = (bytes: Buffer, path: string) => {
    writeFileSync(join(record, 'refs', sha(bytes)), bytes);
    return { abs: `/Users/me/work/proj/${path}`, bytes: bytes.length, kind: 'text', mtimeMs: 1763888400000, numLines: 1, path, sha256: sha(bytes), size: bytes.length, startLine: 1, totalLines: 1 };
  };
  state.questions.find((question) => question.id === 'q2')!.references = [text(HTML, 'site/index.html'), text(SVG, 'site/logo.svg')];
  writeFileSync(join(record, 'state.json'), JSON.stringify(state));
}

const inbox = () => readFileSync(join(home, 'sheet', S, 'inbox.jsonl'));
const uploads = () => (existsSync(join(home, 'sheet', S, 'uploads')) ? readdirSync(join(home, 'sheet', S, 'uploads')) : []);
const doorRan = () => (existsSync(ran) ? readFileSync(ran, 'utf8').split('\n').filter(Boolean).length : 0);

function options(extra: Partial<DaemonOptions> = {}): Partial<DaemonOptions> {
  return {
    env: { MAWS_USER_DATA: scene.root, MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: home, HOME: join(scene.root, 'home'), CLAUDE_CONFIG_DIR: join(scene.root, 'claude'), MAWS_SMINOS_CLI: DOOR },
    permanentClient: true,
    claimSpine: true,
    spine: { wakeOnEvents: true },
    sheetPage: { bundleDir: FIXTURE, shell: async () => ({ ...loginShell }) },
    ...extra,
  };
}

async function served(extra: Partial<DaemonOptions> = {}): Promise<{ daemon: RunningDaemon; port: number }> {
  const daemon = await scene.start(options(extra));
  await until(() => daemon.sheetPage.status().state === 'listening', 5_000, 'the sheet page listening');
  return { daemon, port: Number(new URL(daemon.sheetPage.status().url!).port) };
}

async function pairBrowser(daemon: RunningDaemon, port: number): Promise<{ id: string; credential: string }> {
  const minted = await daemon.sheetPage.pair();
  if (!minted.ok) throw new Error(minted.why);
  const answer = await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: minted.code }));
  expect(answer.status).toBe(200);
  return jsonOf(answer) as { id: string; credential: string };
}

// A request whose answer's type is kept for the suite's last word on rule 4
async function ask(port: number, method: string, target: string, headers: Headers, body: string | Buffer = ''): Promise<Answer> {
  const answer = await request(port, method, target, headers, body);
  types.push(...(answer.headers['content-type'] ?? []));
  return answer;
}
const bearer = (credential: string): [string, string] => ['Authorization', `Bearer ${credential}`];
const line = (over: Record<string, unknown> = {}) => ({ v: 1, key: `page-${Math.random().toString(36).slice(2, 12)}`, kind: 'answer', id: 'q2', revision: 1, picks: ['Yes'], by: 'maws', ...over });

// The four requests for a sheet's data, each as the page makes it, with the credential headers given
const reads = (port: number, credential: [string, string][]) => [
  () => ask(port, 'GET', `/api/sheets/${S}`, [HOST(port), ...credential]),
  () => ask(port, 'GET', `/api/sheets/${S}/body?ref=${IMAGE_REF}`, [HOST(port), ...credential]),
];
const writes = (port: number, headers: [string, string][]) => [
  () => ask(port, 'POST', `/api/sheets/${S}/put`, [HOST(port), ...headers, JSON_BODY], JSON.stringify({ lines: [line()] })),
  () => ask(port, 'POST', `/api/sheets/${S}/uploads`, [HOST(port), ...headers, ['Content-Type', 'image/png']], PNG),
];

describe('no credential (Acceptance 11, "a request for a sheet’s data without the credential"; rule 1)', () => {
  it('refuses the read, the body, the put and the upload with none, an unknown one and a revoked one: 401, nothing of a model, and the door never ran', async () => {
    const { daemon, port } = await served();
    const revoked = await pairBrowser(daemon, port);
    expect((await daemon.sheetPage.unpair(revoked.id)).removed).toBe(1);
    const before = inbox();
    for (const credential of [[], [bearer('Q'.repeat(43))], [bearer(revoked.credential)]] as [string, string][][]) {
      for (const make of [...reads(port, credential), ...writes(port, [ORIGIN(port), ...credential])]) {
        const answer = await make();
        expect(answer.status, JSON.stringify(credential)).toBe(401);
        expect(answer.body.toString('utf8')).not.toMatch(/model|q1|Session check/);
      }
    }
    expect(inbox().equals(before)).toBe(true);
    expect(uploads()).toEqual([]);
    expect(doorRan()).toBe(0);
  });
});

describe('another Origin on a write (Acceptance 11; rule 2)', () => {
  it('refuses the put and the upload with each foreign Origin and with none, 403, the record untouched and the door never run; a read refuses only another’s', async () => {
    const { daemon, port } = await served();
    const browser = await pairBrowser(daemon, port);
    const before = inbox();
    const foreign: [string, string][][] = [[], [['Origin', `http://localhost:${port}`]], [['Origin', `http://sheet.localhost:${port + 1}`]], [['Origin', `https://sheet.localhost:${port}`]], [['Origin', 'null']], [ORIGIN(port), ['Origin', `http://localhost:${port}`]]];
    for (const origin of foreign) for (const make of writes(port, [...origin, bearer(browser.credential)])) expect((await make()).status, JSON.stringify(origin)).toBe(403);
    expect(inbox().equals(before)).toBe(true);
    expect(uploads()).toEqual([]);
    expect(doorRan()).toBe(0);

    expect((await ask(port, 'GET', `/api/sheets/${S}`, [HOST(port), ['Origin', `http://localhost:${port}`], bearer(browser.credential)])).status).toBe(403);
    const read = await ask(port, 'GET', `/api/sheets/${S}`, [HOST(port), bearer(browser.credential)]);
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toEqual(['no-store']);
    expect(jsonOf(read)).toMatchObject({ model: { v: 1, session: S, open: [{ id: 'q1' }, { id: 'q2' }] }, door: expect.any(Object) });
  });
});

describe('the read', () => {
  it('passes on what the service answers: a name it does not hold, and a session with no record, are a null model', async () => {
    const { daemon, port } = await served();
    const browser = await pairBrowser(daemon, port);
    for (const session of [NONE, 'not-a-session', '..%2F..%2Fetc']) {
      const answer = await ask(port, 'GET', `/api/sheets/${session}`, [HOST(port), bearer(browser.credential)]);
      expect(answer.status, session).toBe(200);
      expect(jsonOf(answer)).toMatchObject({ model: null });
    }
  });
});

describe('a body’s type (Acceptance 11, "a referenced HTML or SVG file is shown as text"; rule 4, T16)', () => {
  it('answers the HTML and the SVG reference as plain text, their bytes unchanged; the image as its raster type; an unnamed hash as 404', async () => {
    const { daemon, port } = await served();
    const browser = await pairBrowser(daemon, port);
    const body = (query: string) => ask(port, 'GET', `/api/sheets/${S}/body?${query}`, [HOST(port), bearer(browser.credential)]);
    for (const bytes of [HTML, SVG]) {
      const answer = await body(`ref=${sha(bytes)}`);
      expect(answer.status).toBe(200);
      expect(answer.headers['content-type']).toEqual(['text/plain; charset=utf-8']);
      expect(answer.headers['x-content-type-options']).toEqual(['nosniff']);
      expect(answer.body.equals(bytes)).toBe(true);
    }
    const image = await body(`ref=${IMAGE_REF}`);
    expect(image.headers['content-type']).toEqual(['image/png']);
    expect(image.body.equals(readFileSync(join(home, 'sheet', S, 'refs', IMAGE_REF)))).toBe(true);
    for (const query of [`ref=${sha(Buffer.from('nothing listed'))}`, `text=${'c'.repeat(64)}`, 'upload=maws-none.png', 'upload=../state.json', 'other=1', `ref=${IMAGE_REF}&text=${IMAGE_REF}`]) {
      expect((await body(query)).status, query).toBe(404);
    }
    // the suite's last word: no answer of the page server had an HTML or an SVG type (the shell is not asked here)
    expect(types.filter((type) => /html|svg/i.test(type))).toEqual([]);
  });
});

describe('an upload (T17)', () => {
  it('refuses bytes that are not the type they claim and writes nothing; 413 past 5 MiB; writes a good one once at 0600 and reads it back; refuses a session with no record', async () => {
    const { daemon, port } = await served();
    const browser = await pairBrowser(daemon, port);
    const upload = (session: string, bytes: Buffer, type = 'image/png') => ask(port, 'POST', `/api/sheets/${session}/uploads`, [HOST(port), ORIGIN(port), bearer(browser.credential), ['Content-Type', type]], bytes);

    const html = await upload(S, HTML);
    expect(html.status).toBe(200);
    expect(jsonOf(html)).toEqual({ ok: false, why: expect.any(String) });
    expect(uploads()).toEqual([]);

    // past 5 MiB: refused as soon as it is known, from the length the request declares, before its body is read
    const head = [`POST /api/sheets/${S}/uploads HTTP/1.1`, `Host: sheet.localhost:${port}`, `Origin: http://sheet.localhost:${port}`, `Authorization: Bearer ${browser.credential}`, 'Content-Type: image/png', `Content-Length: ${5 * 1024 * 1024 + 1}`, 'Connection: close'];
    expect((await exchangeBytes(port, `${head.join('\r\n')}\r\n\r\n${'x'.repeat(16)}`)).status).toBe(413);
    expect((await upload(S, PNG, 'text/html')).status).toBe(400); // not one of the four types
    expect(uploads()).toEqual([]);

    const good = await upload(S, PNG);
    expect(jsonOf(good)).toEqual({ ok: true, path: expect.stringMatching(/^uploads\/maws-[0-9a-f]{32}\.png$/) });
    const name = (jsonOf(good).path as string).slice('uploads/'.length);
    expect(uploads()).toEqual([name]);
    expect(statSync(join(home, 'sheet', S, 'uploads', name)).mode & 0o777).toBe(0o600);
    const back = await ask(port, 'GET', `/api/sheets/${S}/body?upload=${name}`, [HOST(port), bearer(browser.credential)]); // before any line names it
    expect(back.headers['content-type']).toEqual(['image/png']);
    expect(back.body.equals(PNG)).toBe(true);

    const none = await upload(NONE, PNG);
    expect(jsonOf(none)).toEqual({ ok: false, why: expect.any(String) });
    expect(existsSync(join(home, 'sheet', NONE))).toBe(false);
  });
});

describe('the line’s author', () => {
  it('appends a line sent as by maws as by page, through the door, and answers the door’s own entries', async () => {
    const { daemon, port } = await served();
    const browser = await pairBrowser(daemon, port);
    const sent = line({ by: 'maws' });
    const put = await ask(port, 'POST', `/api/sheets/${S}/put`, [HOST(port), ORIGIN(port), bearer(browser.credential), JSON_BODY], JSON.stringify({ lines: [sent] }));
    expect(put.status).toBe(200);
    expect(jsonOf(put)).toEqual({ ok: true, results: [{ key: sent.key, state: 'queued' }] });
    const appended = inbox().toString('utf8').trim().split('\n').map((text) => JSON.parse(text) as Record<string, unknown>);
    expect(appended).toEqual([{ ...sent, by: 'page', at: expect.any(String) }]);
  });

  it('answers a verdict the door printed as it stands, and passes the service’s own refusal on with 200', async () => {
    const results = join(scene.root, 'results.json');
    const sent = line();
    writeFileSync(results, JSON.stringify({ session: S, results: [{ key: sent.key, state: 'applied', kind: 'answer', at: '2026-11-24T10:00:00.000Z' }] }));
    loginShell.FAKE_SMINOS_RESULTS = results; // the door's environment is the login shell's
    const { daemon, port } = await served();
    const browser = await pairBrowser(daemon, port);
    const put = (lines: unknown[]) => ask(port, 'POST', `/api/sheets/${S}/put`, [HOST(port), ORIGIN(port), bearer(browser.credential), JSON_BODY], JSON.stringify({ lines }));
    expect(jsonOf(await put([sent]))).toEqual({ ok: true, results: [{ key: sent.key, state: 'applied', kind: 'answer', at: '2026-11-24T10:00:00.000Z' }] });
    const before = inbox();
    // a line no surface writes, and a field the door fills: the service's own `refused`, nothing appended
    for (const lines of [[line({ kind: 'delivered' })], [{ ...line(), at: '2026-11-24T10:00:00.000Z' }], ['not a line']]) {
      const answer = await put(lines);
      expect(answer.status).toBe(200);
      expect(jsonOf(answer)).toMatchObject({ ok: false, why: 'refused' });
    }
    expect(inbox().equals(before)).toBe(true);
  });
});

describe('the snapshot and the changes (T14), with the real service', () => {
  it('sends every record’s summary at paired, and one `changed` for a change of the record', async () => {
    const { daemon, port } = await served();
    const tab = await pairedTab(port, await pairBrowser(daemon, port));
    const ready = (await tab.next(2, 30_000)) as { t: string; sessions: { session: string; open: number }[] };
    expect(ready).toMatchObject({ t: 'ready', v: 1, door: expect.any(Object) });
    expect(ready.sessions).toEqual([expect.objectContaining({ session: S, open: 2, unreadable: false })]);

    // the agent withdrew q2: the record's state moves on
    const file = join(home, 'sheet', S, 'state.json');
    const state = JSON.parse(readFileSync(file, 'utf8')) as { seq: number; questions: { id: string }[]; closed: Record<string, unknown> };
    state.seq += 1;
    state.questions = state.questions.filter((question) => question.id !== 'q2');
    state.closed.q2 = { asker: 'main', at: '2026-11-24T10:00:00.000Z', header: 'Migration', how: 'withdrawn', question: 'Ship the migration today?', revision: 1 }; // as the pin's closed-withdrawn
    writeFileSync(`${file}.next`, JSON.stringify(state));
    renameSync(`${file}.next`, file); // by replace, as the writer does
    expect(await tab.next(3, 5_000)).toEqual({ t: 'changed', session: S, summary: expect.objectContaining({ session: S, open: 1 }) });
    await new Promise((done) => setTimeout(done, 500));
    expect(tab.frames.slice(3)).toHaveLength(1);
    tab.ws.close();
  });
});

describe('a spine that is refused (T15)', () => {
  it('still answers the shell, the exchange and the opening; a read is 503 and the connection is told `unavailable`', async () => {
    const load = async (): Promise<SpineEntry> => ({ ...((await import('../services/entry')) as SpineEntry), takeSpineLock: async () => ({ refused: 'another process holds the spine’s lock' }) as never });
    const { daemon, port } = await served({ spine: { wakeOnEvents: true, load } });
    expect((await ask(port, 'GET', '/', [HOST(port)])).status).toBe(200);
    const browser = await pairBrowser(daemon, port);
    const tab = await pairedTab(port, browser);
    expect(await tab.next(2, 30_000)).toEqual({ t: 'unavailable', why: 'refused' });
    const read = await ask(port, 'GET', `/api/sheets/${S}`, [HOST(port), bearer(browser.credential)]);
    expect(read.status).toBe(503);
    expect(jsonOf(read)).toEqual({ why: 'refused' });
    expect(tab.closed).toBeNull();
    tab.ws.close();
  });
});
