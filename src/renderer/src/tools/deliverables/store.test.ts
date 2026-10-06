// E2 (M4): the renderer's deliverables store over a fake main (Design §4 "The store"): a session's list read on first
// use and re-read by Retry after a refusal, the All scope's walk, one record re-read per `deliverables.changed` (into
// the session's list, the All list and the record's lookup), a change that lands while the list is still being read,
// and the console ring buffer per version with its cap and its clear.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { DeliverableRecord } from '@shared/maws/deliverable';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { connectDeliverables, consoleKey, deliverables, ensureSession, loadAll, loadSession, lookup, resetDeliverables, CONSOLE_KEPT, clearConsole } from './store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, '0')}:00.000Z`;

function fileRecord(n: number, over: Partial<DeliverableRecord> = {}): DeliverableRecord {
  const path = `/repo/out/file-${n}.txt`;
  return { id: id(n), appSessionId: A, kind: 'file', path, title: `file-${n}.txt`, versions: [{ path, at: at(n) }], createdAt: at(n), ...over };
}

const state = () => deliverables.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetDeliverables();
  fake = fakeClient();
  window.maws = fake.client;
  disconnect = connectDeliverables();
});
afterEach(() => disconnect());

describe('a session’s list', () => {
  it('is read once on first use, newest first as main answers it', async () => {
    ensureSession(A);
    ensureSession(A);
    expect(fake.invoked('deliverables.list')).toEqual([{ appSessionId: A }]);
    expect(state().sessions.get(A)?.status).toBe('reading');
    await fake.reply('deliverables.list', { records: [fileRecord(2), fileRecord(1)] });
    expect(state().sessions.get(A)).toMatchObject({ status: 'ready', error: null });
    expect(state().sessions.get(A)!.records.map((r) => r.id)).toEqual([id(2), id(1)]);
    ensureSession(A);
    expect(fake.pending('deliverables.list')).toBe(0);
  });

  it('keeps a refusal with its message, and Retry reads again', async () => {
    ensureSession(A);
    await fake.fail('deliverables.list', 'EACCES');
    expect(state().sessions.get(A)).toMatchObject({ status: 'error', error: 'EACCES', records: [] });
    ensureSession(A); // a refusal is not read again by itself
    expect(fake.pending('deliverables.list')).toBe(0);
    loadSession(A);
    await fake.reply('deliverables.list', { records: [fileRecord(1)] });
    expect(state().sessions.get(A)).toMatchObject({ status: 'ready', error: null });
  });
});

describe('deliverables.changed', () => {
  it('re-reads the one record and puts it at the top of the session’s list; an update moves it up', async () => {
    ensureSession(A);
    await fake.reply('deliverables.list', { records: [fileRecord(2), fileRecord(1)] });
    fake.event('deliverables.changed', { appSessionId: A, id: id(3), change: 'created' });
    expect(fake.invoked('deliverables.get')).toEqual([{ appSessionId: A, id: id(3) }]);
    await fake.reply('deliverables.get', { record: fileRecord(3), present: [true] });
    expect(state().sessions.get(A)!.records.map((r) => r.id)).toEqual([id(3), id(2), id(1)]);

    const updated = fileRecord(1, { kind: 'artifact', artifactId: 'dash', updatedAt: at(9), versions: [{ path: '/v1.html', at: at(1) }, { path: '/v2.html', at: at(9) }] });
    fake.event('deliverables.changed', { appSessionId: A, id: id(1), change: 'updated' });
    await fake.reply('deliverables.get', { record: updated, present: [true, true] });
    expect(state().sessions.get(A)!.records.map((r) => r.id)).toEqual([id(1), id(3), id(2)]);
    expect(state().sessions.get(A)!.records[0]!.versions).toHaveLength(2);
    expect(state().lookups.get(`${A}/${id(1)}`)).toEqual({ status: 'ready', record: updated, present: [true, true] });
  });

  it('for a session never listed here reads nothing', () => {
    fake.event('deliverables.changed', { appSessionId: B, id: id(1), change: 'created' });
    expect(fake.invoked('deliverables.get')).toEqual([]);
  });

  it('while the list is still being read starts a second read, so the write is not missed', async () => {
    ensureSession(A);
    fake.event('deliverables.changed', { appSessionId: A, id: id(2), change: 'created' });
    expect(fake.invoked('deliverables.list')).toHaveLength(2);
    await fake.reply('deliverables.list', { records: [fileRecord(1)] }); // the first read, superseded
    expect(state().sessions.get(A)?.status).toBe('reading');
    await fake.reply('deliverables.list', { records: [fileRecord(2), fileRecord(1)] });
    expect(state().sessions.get(A)!.records.map((r) => r.id)).toEqual([id(2), id(1)]);
  });

  it('refreshes a record held only by a lookup (a viewer open on it)', async () => {
    void lookup(A, id(4));
    await fake.reply('deliverables.get', { record: fileRecord(4), present: [true] });
    fake.event('deliverables.changed', { appSessionId: A, id: id(4), change: 'updated' });
    await fake.reply('deliverables.get', { record: fileRecord(4, { title: 'renamed' }), present: [false] });
    expect(state().lookups.get(`${A}/${id(4)}`)).toMatchObject({ status: 'ready', present: [false], record: { title: 'renamed' } });
  });
});

describe('the All scope', () => {
  it('reads every session’s records and takes a change of any session into them', async () => {
    loadAll();
    expect(state().all.status).toBe('reading');
    expect(fake.invoked('deliverables.listAll')).toEqual([{}]);
    await fake.reply('deliverables.listAll', { records: [fileRecord(2, { appSessionId: B }), fileRecord(1)] });
    expect(state().all).toMatchObject({ status: 'ready', error: null });
    fake.event('deliverables.changed', { appSessionId: B, id: id(5), change: 'created' });
    await fake.reply('deliverables.get', { record: fileRecord(5, { appSessionId: B }), present: [true] });
    expect(state().all.records.map((r) => [r.appSessionId, r.id])).toEqual([[B, id(5)], [B, id(2)], [A, id(1)]]);
  });

  it('keeps a refusal and reads again on the next entry', async () => {
    loadAll();
    await fake.fail('deliverables.listAll', 'boom');
    expect(state().all).toMatchObject({ status: 'error', error: 'boom' });
    loadAll();
    await fake.reply('deliverables.listAll', { records: [] });
    expect(state().all).toMatchObject({ status: 'ready', records: [] });
  });
});

describe('lookup', () => {
  it('answers the record and its presence per version, and a record that is gone', async () => {
    const found = lookup(A, id(1));
    expect(state().lookups.get(`${A}/${id(1)}`)).toEqual({ status: 'reading' });
    await fake.reply('deliverables.get', { record: fileRecord(1), present: [false] });
    expect(await found).toEqual({ status: 'ready', record: fileRecord(1), present: [false] });
    const gone = lookup(A, id(2));
    await fake.reply('deliverables.get', { record: null, present: [] });
    expect(await gone).toEqual({ status: 'ready', record: null, present: [] });
  });

  it('keeps a refused read as an error with its message', async () => {
    const refused = lookup(A, id(1));
    await fake.fail('deliverables.get', 'EIO');
    expect(await refused).toEqual({ status: 'error', error: 'EIO' });
  });
});

describe('the console ring buffer', () => {
  const message = (n: number, over: Record<string, unknown> = {}) => ({ appSessionId: A, deliverableId: id(1), version: 1, level: 'error', message: `boom ${n}`, line: n, source: null, ...over });

  it('keeps each version’s messages apart, the last CONSOLE_KEPT of them, and clears one version', async () => {
    for (let n = 1; n <= CONSOLE_KEPT + 3; n++) fake.event('deliverables.console', message(n));
    fake.event('deliverables.console', message(99, { version: 2, level: 'warning' }));
    const v1 = state().console.get(consoleKey(A, id(1), 1))!;
    expect(v1).toHaveLength(CONSOLE_KEPT);
    expect(v1[0]).toEqual({ level: 'error', message: 'boom 4', line: 4, source: null });
    expect(v1.at(-1)!.message).toBe(`boom ${CONSOLE_KEPT + 3}`);
    expect(state().console.get(consoleKey(A, id(1), 2))).toEqual([{ level: 'warning', message: 'boom 99', line: 99, source: null }]);
    clearConsole(A, id(1), 1);
    expect(state().console.has(consoleKey(A, id(1), 1))).toBe(false);
    expect(state().console.has(consoleKey(A, id(1), 2))).toBe(true);
    await settle();
  });
});
