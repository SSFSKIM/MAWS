// The sheets through the page server, over a service stand-in (docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md,
// §N; T14, T15, T29): `createSheetPage` alone over the fixture bundle, its `sheets`, `discovery`, `onEvent` and `hold`
// played by this suite, so the order of a snapshot (hold, the spine, discovery, the subscription, then the list) and the
// holds can be watched step by step. The real service behind the real spine, and every refusal it meets, are
// src/mawsd/process-sheet-page-sheets.test.ts's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SheetService } from '../../services/sheet/service';
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetSummary } from '@shared/sheet/model';
import { HOST, JSON_BODY, ORIGIN, Tab, jsonOf, nonce, pairedTab, request } from '../../../test/support/sheet-page-client';
import { createSheetPage, type SheetPage, type SheetPageOptions } from './serve';
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
  put: async () => ({ ok: true, results: [] }),
  body: async () => ({ kind: 'gone' }),
  upload: async () => ({ ok: false, why: 'stand-in' }),
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

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-sheet-live-'));
  steps = [];
  listeners = new Set();
  holds = [];
  sessions = [summary(A), summary(B, 2)];
  listGate = null;
  unavailable = null;
  tabs = [];
  page = createSheetPage({
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
  });
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

  it('asks nothing of the sheets for a credential the page server does not know', async () => {
    const port = await listening();
    await paired(port);
    const answer = await request(port, 'GET', `/api/sheets/${A}`, [HOST(port), ['Authorization', `Bearer ${'Q'.repeat(43)}`]]);
    expect(answer.status).toBe(401);
    expect(steps).toEqual([]);
    expect(holds).toEqual([]);
  });
});
