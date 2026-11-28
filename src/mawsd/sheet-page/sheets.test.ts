// The sheets through the page server, over a service stand-in (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md,
// §N; T14, T15, T29): `createSheetPage` alone over the fixture bundle, its `sheets`, `discovery`, `onEvent` and `hold`
// played by this suite, so the order of a snapshot (hold, the spine, discovery, the subscription, then the list) and the
// holds can be watched step by step. The real service behind the real spine, and every refusal it meets, are
// src/mawsd/process-sheet-page-sheets.test.ts's.
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SheetService } from '../../services/sheet/service';
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetSummary } from '@shared/sheet/model';
import { HOST, JSON_BODY, ORIGIN, Tab, exchangeBytes, jsonOf, nonce, pairedTab, request } from '../../../test/support/sheet-page-client';
import { createSheetPage, loadSheetPageChunk, type SheetPage, type SheetPageOptions } from './serve';
import { SheetsUnavailable, type SheetAccess } from './sheets';

const FIXTURE = resolve(__dirname, '../../../test/fixtures/sheet-page/bundle');
const A = '5eed0000-0000-4000-8000-00000000000a';
const B = '5eed0000-0000-4000-8000-00000000000b';
const DOOR: DoorState = { known: false };

const summary = (session: string, open = 1): SheetSummary => ({ session, appSessionId: null, title: null, live: null, seq: 1, open, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false });

type Listener = Parameters<SheetPageOptions['onEvent']>[0];

let scratch: string;
let page: SheetPage;
let steps: string[]; // what the page server did, in order
let listeners: Set<Listener>;
let holds: { reason: string; standing: boolean; released: boolean }[];
let sessions: SheetSummary[];
let listGate: Promise<void> | null;
let unavailable: SheetsUnavailable | null;
let tabs: Tab[];

const service = (): SheetService => ({
  async list() {
    steps.push('list');
    if (listGate) await listGate;
    return sessions;
  },
  read: async (session) => (steps.push(`read ${session}`), null),
  put: async () => (steps.push('put'), { ok: true, results: [] }),
  body: async () => ({ kind: 'gone' }),
  upload: async () => (steps.push('upload'), { ok: false, why: 'stand-in' }),
  onChange: () => () => {},
  door: () => DOOR,
  stop: () => {},
});
const sheets: SheetAccess = {
  service: async () => {
    steps.push('service');
    if (unavailable) throw unavailable;
    return service();
  },
};

const options = (over: Partial<SheetPageOptions> = {}): SheetPageOptions => ({
  kind: 'private',
  profileDir: scratch,
  dir: scratch,
  defaultProfile: false,
  env: { MAWS_SHEET_PAGE: '1', MAWS_SHEET_PORT: '0', SMINOS_HOME: join(scratch, 'no-home') },
  shell: async () => ({}),
  bundleDir: FIXTURE,
  sheets,
  discovery: async () => void steps.push('discovery'),
  onEvent: (listener) => {
    steps.push('subscribe');
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  hold: (reason, standing = false) => {
    steps.push(standing ? 'standing hold' : 'hold');
    const hold = { reason, standing, released: false };
    holds.push(hold);
    return () => void (hold.released = true);
  },
  log: () => {},
  ...over,
});

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-sheet-live-'));
  steps = [];
  listeners = new Set();
  holds = [];
  sessions = [summary(A), summary(B, 2)];
  listGate = null;
  unavailable = null;
  tabs = [];
  page = createSheetPage(options());
  page.start();
});
afterEach(async () => {
  for (const tab of tabs) tab.ws.terminate();
  await page.stop();
  rmSync(scratch, { recursive: true, force: true });
});

const emit = (session: string, value: SheetSummary | null, name = 'sheet.changed', owner: 'machine' | 'engine-host' = 'machine') => {
  for (const listener of listeners) listener(owner, { name, payload: { session, summary: value } });
};
const until = async (check: () => boolean, what: string, ms = 3_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`no ${what} in time`);
    await new Promise((done) => setTimeout(done, 10));
  }
};

async function listening(): Promise<number> {
  await until(() => page.status().state === 'listening', 'listening');
  return Number(new URL(page.status().url!).port);
}
async function paired(port: number): Promise<{ id: string; credential: string }> {
  const answer = await page.pair();
  if (!answer.ok) throw new Error(answer.why);
  const exchanged = await request(port, 'POST', '/api/pair', [HOST(port), ORIGIN(port), JSON_BODY], JSON.stringify({ code: answer.code }));
  expect(exchanged.status).toBe(200);
  return jsonOf(exchanged) as { id: string; credential: string };
}
async function tab(port: number, browser: { id: string; credential: string }): Promise<Tab> {
  const opened = await pairedTab(port, browser);
  tabs.push(opened);
  return opened;
}
const frames = (opened: Tab) => opened.frames.slice(2); // after proof and paired
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const unreleased = () => holds.filter((hold) => !hold.released).length;

describe('the snapshot at paired (§N; T14, T15, T29)', () => {
  it('takes the connection’s standing hold, loads the spine, brings discovery up to date, subscribes, and only then lists', async () => {
    const port = await listening();
    const opened = await tab(port, await paired(port));
    expect(await opened.next(2)).toEqual({ t: 'ready', v: 1, sessions, door: DOOR });
    expect(steps).toEqual(['standing hold', 'service', 'discovery', 'subscribe', 'list']);
    expect(holds).toEqual([{ reason: expect.any(String), standing: true, released: false }]);
  });

  it('delivers a change made while the list is out after the snapshot, so none is lost', async () => {
    const port = await listening();
    let open!: () => void;
    listGate = new Promise((done) => (open = done));
    const opened = await tab(port, await paired(port));
    await until(() => steps.includes('list'), 'the list asked');
    emit(A, summary(A, 3)); // the record moved while the list was out
    open();
    expect(await opened.next(2)).toMatchObject({ t: 'ready' });
    expect(await opened.next(3)).toEqual({ t: 'changed', session: A, summary: summary(A, 3) });
  });

  it('sends one `changed` for each change after it, and nothing of another event or another owner', async () => {
    const port = await listening();
    const opened = await tab(port, await paired(port));
    await opened.next(2);
    emit(B, null);
    emit(A, summary(A), 'session.changed');
    emit(A, summary(A), 'sheet.changed', 'engine-host');
    emit(A, summary(A, 4));
    expect(await opened.next(3)).toEqual({ t: 'changed', session: B, summary: null });
    expect(await opened.next(4)).toEqual({ t: 'changed', session: A, summary: summary(A, 4) });
    await new Promise((done) => setTimeout(done, 100));
    expect(frames(opened)).toHaveLength(3);
  });

  it('says nothing of any sheet to a connection that proved itself and has not sent its credential', async () => {
    const port = await listening();
    const browser = await paired(port);
    const opened = await Tab.open(port);
    tabs.push(opened);
    opened.send({ t: 'hello', v: 1, id: browser.id, nonce: nonce() });
    expect(await opened.next(0)).toMatchObject({ t: 'proof' });
    emit(A, summary(A, 9));
    await new Promise((done) => setTimeout(done, 150));
    expect(opened.frames).toHaveLength(1);
    expect(steps).toEqual([]);
  });

  it('answers a second `list` with a second snapshot, and no second subscription nor hold; a closed connection lets both go', async () => {
    const port = await listening();
    const opened = await tab(port, await paired(port));
    await opened.next(2);
    await new Promise((done) => setTimeout(done, 1_050)); // one sooner than a second after the last is ignored
    opened.send({ t: 'list' });
    expect(await opened.next(3)).toMatchObject({ t: 'ready' });
    expect(steps.filter((step) => step === 'subscribe')).toHaveLength(1);
    expect(holds).toHaveLength(1);
    expect(listeners.size).toBe(1);
    opened.ws.close();
    await until(() => holds[0]!.released && listeners.size === 0, 'the hold released and the subscription ended');
  });

  it('says `unavailable` when the sheets cannot be had, keeps the connection, and answers the next `list` once they can', async () => {
    const port = await listening();
    unavailable = new SheetsUnavailable('refused');
    const opened = await tab(port, await paired(port));
    expect(await opened.next(2)).toEqual({ t: 'unavailable', why: 'refused' });
    expect(holds).toHaveLength(1); // the connection holds the daemon whatever the spine's state (T15)
    unavailable = null;
    await new Promise((done) => setTimeout(done, 1_050));
    opened.send({ t: 'list' });
    expect(await opened.next(3)).toMatchObject({ t: 'ready', sessions });
    expect(opened.closed).toBeNull();
  });

  // Fix round 1: a yield releases the root under the page's hold, and the old service's list does not reject at its stop
  it('sends nothing of a snapshot the spine was lost under, nor any change, until a fresh `ready`', async () => {
    const port = await listening();
    page.spineState('loaded');
    let open!: () => void;
    listGate = new Promise((done) => (open = done));
    const opened = await tab(port, await paired(port));
    await until(() => steps.includes('list'), 'the list asked');
    emit(A, summary(A, 4)); // held for that snapshot
    page.spineState('yielded');
    expect(await opened.next(2)).toEqual({ t: 'unavailable', why: 'yielded' });
    listGate = null;
    open(); // the old root's list answers after the loss
    emit(A, summary(A, 5));
    await pause(150);
    expect(frames(opened), 'no stale ready, no held or later change').toHaveLength(1);

    page.spineState('loaded');
    await pause(1_050);
    opened.send({ t: 'list' });
    expect(await opened.next(3)).toMatchObject({ t: 'ready', sessions });
    emit(A, summary(A, 6));
    expect(await opened.next(4)).toEqual({ t: 'changed', session: A, summary: summary(A, 6) });
    await pause(100);
    expect(frames(opened)).toHaveLength(3);
  });

  it('says `unavailable` on a connection when the spine leaves `loaded`, and keeps it', async () => {
    const port = await listening();
    const opened = await tab(port, await paired(port));
    page.spineState('loaded');
    await opened.next(2);
    page.spineState('releasing');
    expect(await opened.next(3)).toEqual({ t: 'unavailable', why: 'no-service' });
    page.spineState('cold');
    page.spineState('yielded');
    expect(await opened.next(4)).toEqual({ t: 'unavailable', why: 'yielded' });
    await new Promise((done) => setTimeout(done, 100));
    expect(frames(opened)).toHaveLength(3); // `cold` after `releasing` said nothing more
    expect(opened.closed).toBeNull();
  });
});

describe('the holders kept fresh while a page is open (S5)', () => {
  const REFRESH_MS = 150;
  beforeEach(async () => {
    await page.stop();
    page = createSheetPage(options({ timing: { refreshMs: REFRESH_MS } }));
    page.start();
  });
  const discoveries = () => steps.filter((step) => step === 'discovery').length;

  it('brings discovery up to date at each period and sends a snapshot when a session’s holder changed, with no change announced', async () => {
    const port = await listening();
    const opened = await tab(port, await paired(port));
    expect(await opened.next(2)).toEqual({ t: 'ready', v: 1, sessions, door: DOOR });
    sessions = [{ ...summary(A), live: false }, summary(B, 2)]; // its terminal session exited: no sheet.changed
    expect(await opened.next(3, 2_000)).toEqual({ t: 'ready', v: 1, sessions, door: DOOR });
    expect(discoveries()).toBeGreaterThanOrEqual(2);
  });

  it('sends nothing at a period when nothing changed, and keeps a change announced meanwhile as it is', async () => {
    const port = await listening();
    const opened = await tab(port, await paired(port));
    await opened.next(2);
    await until(() => discoveries() >= 3, 'two periods');
    expect(frames(opened)).toHaveLength(1); // the first snapshot alone
    const moved = summary(A, 5);
    emit(A, moved); // announced, and the next list holds it too
    sessions = [moved, summary(B, 2)];
    expect(await opened.next(3)).toEqual({ t: 'changed', session: A, summary: moved });
    const seen = discoveries();
    await until(() => discoveries() >= seen + 2, 'two more periods');
    expect(frames(opened)).toHaveLength(2); // what the tab holds is what the list says: no snapshot
  });

  it('answers a list that joins a refresh with a snapshot, though nothing changed: the tab asked for it (S5)', async () => {
    const port = await listening();
    const opened = await tab(port, await paired(port));
    expect(await opened.next(2)).toEqual({ t: 'ready', v: 1, sessions, door: DOOR });
    await pause(1_000); // a list sooner than a second after the last is ignored (§N)
    let release!: () => void;
    listGate = new Promise<void>((done) => (release = done));
    const listed = steps.filter((step) => step === 'list').length;
    await until(() => steps.filter((step) => step === 'list').length > listed, 'a refresh listing');
    opened.send({ t: 'list' }); // a tab recovering from `unavailable`: it holds writes until a `ready`
    await pause(50);
    listGate = null;
    release();
    expect(await opened.next(3, 2_000)).toEqual({ t: 'ready', v: 1, sessions, door: DOOR });
  });

  it('runs nothing while no paired connection is open', async () => {
    const port = await listening();
    await new Promise((done) => setTimeout(done, REFRESH_MS * 3));
    expect(steps).toEqual([]);
    const opened = await tab(port, await paired(port));
    await opened.next(2);
    opened.ws.close();
    await until(() => listeners.size === 0, 'the connection gone');
    const after = steps.length;
    await new Promise((done) => setTimeout(done, REFRESH_MS * 3));
    expect(steps.length).toBe(after);
  });
});

describe('a request for data (§N; T15)', () => {
  it('holds the daemon while it is answered, and lets the hold go after', async () => {
    const port = await listening();
    const browser = await paired(port);
    const answer = await request(port, 'GET', `/api/sheets/${A}`, [HOST(port), ['Authorization', `Bearer ${browser.credential}`]]);
    expect(answer.status).toBe(200);
    expect(jsonOf(answer)).toEqual({ model: null, door: DOOR });
    expect(holds).toEqual([{ reason: expect.any(String), standing: false, released: true }]);
    expect(steps).toEqual(['hold', 'service', `read ${A}`]);
  });

  it('is 503 with the reason when the sheets cannot be had', async () => {
    const port = await listening();
    const browser = await paired(port);
    unavailable = new SheetsUnavailable('yielded');
    const answer = await request(port, 'GET', `/api/sheets/${A}`, [HOST(port), ['Authorization', `Bearer ${browser.credential}`]]);
    expect(answer.status).toBe(503);
    expect(jsonOf(answer)).toEqual({ why: 'yielded' });
    expect(holds[0]!.released).toBe(true);
  });

  it('refuses with 413 an upload streamed past its bound with no declared length, and asks nothing of the service', async () => {
    const port = await listening();
    const browser = await paired(port);
    const chunk = Buffer.alloc(64 * 1024, 0x41);
    const chunks = Array.from({ length: 81 }, () => Buffer.concat([Buffer.from(`${chunk.length.toString(16)}\r\n`), chunk, Buffer.from('\r\n')])); // 5.06 MiB
    const head = [`POST /api/sheets/${A}/uploads HTTP/1.1`, `Host: sheet.localhost:${port}`, `Origin: http://sheet.localhost:${port}`, `Authorization: Bearer ${browser.credential}`, 'Content-Type: image/png', 'Transfer-Encoding: chunked', 'Connection: close'].join('\r\n');
    const answer = await exchangeBytes(port, Buffer.concat([Buffer.from(`${head}\r\n\r\n`), ...chunks, Buffer.from('0\r\n\r\n')]));
    expect(answer.status).toBe(413);
    expect(steps).not.toContain('upload');
    await until(() => unreleased() === 0, 'the hold released');
  });

  it('asks nothing of the sheets for a credential the page server does not know', async () => {
    const port = await listening();
    await paired(port);
    const answer = await request(port, 'GET', `/api/sheets/${A}`, [HOST(port), ['Authorization', `Bearer ${'Q'.repeat(43)}`]]);
    expect(answer.status).toBe(401);
    expect(steps).toEqual([]);
    expect(holds).toEqual([]);
  });
});

describe('a write whose body finishes after the browser was unpaired (S3)', () => {
  // The request's head, authorized at its headers, and a part of its body; the rest is sent after `mawsd sheet unpair`
  async function begun(port: number, credential: string, path: string, type: string, length: number) {
    const socket = createConnection({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    socket.on('data', (chunk) => void chunks.push(chunk));
    socket.on('error', () => {});
    await new Promise<void>((done) => socket.once('connect', () => done()));
    const head = [`POST ${path} HTTP/1.1`, `Host: sheet.localhost:${port}`, `Origin: http://sheet.localhost:${port}`, `Authorization: Bearer ${credential}`, `Content-Type: ${type}`, `Content-Length: ${length}`, 'Connection: close'].join('\r\n');
    socket.write(`${head}\r\n\r\n`);
    const closed = new Promise<string>((done) => socket.once('close', () => done(Buffer.concat(chunks).toString('latin1'))));
    return { socket, closed };
  }

  it('refuses a put with 401, and the door is not run', async () => {
    const port = await listening();
    const browser = await paired(port);
    const body = JSON.stringify({ lines: [{ v: 1, kind: 'dismiss', question: 'q1', key: 'k1' }] });
    const { socket, closed } = await begun(port, browser.credential, `/api/sheets/${A}/put`, 'application/json', Buffer.byteLength(body));
    socket.write(body.slice(0, 10));
    await until(() => holds.length === 1, 'the put admitted');
    expect(await page.unpair(browser.id)).toMatchObject({ removed: 1, saved: true });
    socket.write(body.slice(10));
    expect((await closed).split('\r\n', 1)[0]).toBe('HTTP/1.1 401 Unauthorized');
    expect(steps).not.toContain('put');
    expect(unreleased()).toBe(0);
  });

  it('refuses an upload with 401, and nothing is uploaded', async () => {
    const port = await listening();
    const browser = await paired(port);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    const { socket, closed } = await begun(port, browser.credential, `/api/sheets/${A}/uploads`, 'image/png', png.length);
    socket.write(png.subarray(0, 8));
    await until(() => holds.length === 1, 'the upload admitted');
    expect(await page.unpair(browser.id)).toMatchObject({ removed: 1, saved: true });
    socket.write(png.subarray(8));
    expect((await closed).split('\r\n', 1)[0]).toBe('HTTP/1.1 401 Unauthorized');
    expect(steps).not.toContain('upload');
    expect(unreleased()).toBe(0);
  });
});

describe('a request whose client left while the handler loaded (fix round 1)', () => {
  it('takes no hold it cannot release: the count returns to zero', async () => {
    const browser = await paired(await listening());
    await page.stop(); // the pairing stands in the browsers' file; a fresh page has no handler loaded
    let loadAsked = false;
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    page = createSheetPage(options({ load: async () => ((loadAsked = true), await gate, loadSheetPageChunk()) }));
    page.start();
    const port = await listening();

    const socket = createConnection({ host: '127.0.0.1', port });
    socket.on('error', () => {});
    await new Promise<void>((done) => socket.once('connect', () => done()));
    const head = [`POST /api/sheets/${A}/put HTTP/1.1`, `Host: sheet.localhost:${port}`, `Origin: http://sheet.localhost:${port}`, `Authorization: Bearer ${browser.credential}`, 'Content-Type: application/json', 'Content-Length: 100'].join('\r\n');
    socket.write(`${head}\r\n\r\n{"lines":`); // a part of its body
    await until(() => loadAsked, 'the handler’s load asked');
    socket.destroy(); // it leaves while the handler loads
    await pause(100);
    release();
    await pause(200);
    expect(unreleased(), 'every hold taken was released').toBe(0);
    expect(steps).not.toContain('service');
  });
});
