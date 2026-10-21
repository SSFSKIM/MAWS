// A project's log as the browser keeps it: by offset, in its own record, so a reload resumes where the record ends;
// verified before anything reads it as drawable, and locked — nothing drawable — while the browser holds no key.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importOrgKey, seal, type LogEvent } from 'desk-hub/protocol';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { memoryLogRecord } from './record';
import { ProjectLog } from './project-log';

const key = () => importOrgKey(VECTOR_KEY);
const sealed = async (seq: number, text: string): Promise<LogEvent> =>
  (await seal(await key(), 'log', PROJECT, { ts: '2026-10-15T08:00:00.000Z', writer: 'mini/human', seq, kind: 'say', from: 'human', to: '*', text })) as unknown as LogEvent;
const settled = (log: ProjectLog) => log.settled();
const otherKey = () => importOrgKey(Uint8Array.from({ length: 32 }, (_, i) => 255 - i));
const sealedUnder = async (k: Awaited<ReturnType<typeof key>>, seq: number, text: string): Promise<LogEvent> =>
  (await seal(k, 'log', PROJECT, { ts: '2026-10-15T08:00:00.000Z', writer: 'mini/human', seq, kind: 'say', from: 'human', to: '*', text })) as unknown as LogEvent;

/** Holds every WebCrypto verification until `release()`, so a test can act while one is in flight. */
function gateVerify() {
  const original = crypto.subtle.verify.bind(crypto.subtle);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const inFlight = new Promise<void>((r) => (entered = r));
  vi.spyOn(crypto.subtle, 'verify').mockImplementation(async (...args: Parameters<SubtleCrypto['verify']>) => {
    entered();
    await gate;
    return original(...args);
  });
  return { inFlight, release };
}

afterEach(() => vi.restoreAllMocks());

describe('ProjectLog', () => {
  it('loads its record, holds its last offset, and verifies what it holds', async () => {
    const record = memoryLogRecord();
    await record.append(PROJECT, [
      { offset: 1, event: await sealed(1, 'one') },
      { offset: 2, event: await sealed(2, 'two') },
    ]);
    const log = new ProjectLog(PROJECT, record);
    await log.load();
    log.setKey(await key());
    await settled(log);
    expect(log.held()).toBe(2);
    expect(log.drawable().map((e) => e.event.text)).toEqual(['one', 'two']);
  });

  it('takes only offsets above what it holds, and records them', async () => {
    const record = memoryLogRecord();
    const log = new ProjectLog(PROJECT, record);
    await log.load();
    log.setKey(await key());
    log.receive([{ offset: 1, event: await sealed(1, 'one') }]);
    log.receive([
      { offset: 1, event: await sealed(1, 'one again') },
      { offset: 2, event: await sealed(2, 'two') },
    ]);
    await settled(log);
    expect(log.drawable().map((e) => e.offset)).toEqual([1, 2]);
    expect((await record.load(PROJECT)).map((e) => e.offset)).toEqual([1, 2]);
  });

  it('draws nothing while locked, and everything that verifies once the key arrives', async () => {
    const log = new ProjectLog(PROJECT, memoryLogRecord());
    await log.load();
    log.receive([{ offset: 1, event: await sealed(1, 'one') }]);
    await settled(log);
    expect(log.store.getState().locked).toBe(true);
    expect(log.drawable()).toEqual([]);
    log.setKey(await key());
    await settled(log);
    expect(log.store.getState().locked).toBe(false);
    expect(log.drawable()).toHaveLength(1);
  });

  it('keeps an event whose code fails out of what is drawn, and reports it', async () => {
    const log = new ProjectLog(PROJECT, memoryLogRecord());
    await log.load();
    log.setKey(await key());
    const forged = { ...(await sealed(2, 'genuine')), text: 'altered' };
    log.receive([
      { offset: 1, event: await sealed(1, 'one') },
      { offset: 2, event: forged },
      { offset: 3, event: { not: 'an event' } as unknown as LogEvent },
    ]);
    await settled(log);
    expect(log.drawable().map((e) => e.offset)).toEqual([1]);
    expect(log.refused().map((e) => [e.offset, e.verdict])).toEqual([
      [2, 'bad-code'],
      [3, 'malformed'],
    ]);
  });

  it('starts over from the hub when the hub holds less than the record (its log was replaced)', async () => {
    const record = memoryLogRecord();
    await record.append(PROJECT, [{ offset: 5, event: await sealed(1, 'old') }]);
    const log = new ProjectLog(PROJECT, record);
    await log.load();
    log.welcome(2);
    await settled(log);
    expect(log.held()).toBe(0);
    expect(await record.load(PROJECT)).toEqual([]);
  });

  it('records only a contiguous prefix: a failed write is retried with the next batch, never skipped', async () => {
    const record = memoryLogRecord();
    let fails = 1;
    const flaky = {
      ...record,
      append: async (project: string, entries: Parameters<typeof record.append>[1]) => {
        if (fails === 0) return record.append(project, entries);
        fails--;
        throw new Error('quota');
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new ProjectLog(PROJECT, flaky);
    await log.load();
    log.receive([{ offset: 1, event: await sealed(1, 'one') }]);
    await settled(log);
    log.receive([{ offset: 2, event: await sealed(2, 'two') }]);
    await settled(log);
    const reloaded = new ProjectLog(PROJECT, record);
    await reloaded.load();
    expect(reloaded.held()).toBe(2);
    expect((await record.load(PROJECT)).map((e) => e.offset)).toEqual([1, 2]);
  });

  it('resumes after the stored prefix when a write keeps failing, so the hub sends the missing entries again', async () => {
    const record = memoryLogRecord();
    // A batch holding offset 1 never fits (a quota): a later, smaller batch must not be stored past it.
    const quota = { ...record, append: async (project: string, entries: Parameters<typeof record.append>[1]) => (entries.some((e) => e.offset === 1) ? Promise.reject(new Error('quota')) : record.append(project, entries)) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = new ProjectLog(PROJECT, quota);
    await log.load();
    log.receive([{ offset: 1, event: await sealed(1, 'one') }]);
    log.receive([{ offset: 2, event: await sealed(2, 'two') }]);
    await settled(log);
    expect(log.held()).toBe(2); // this page keeps both
    const reloaded = new ProjectLog(PROJECT, record);
    await reloaded.load();
    expect(reloaded.held()).toBe(0);
  });

  it('never lets a write queued before the log was replaced store an entry of the new log', async () => {
    const record = memoryLogRecord();
    const log = new ProjectLog(PROJECT, record);
    await log.load();
    log.receive([{ offset: 5, event: await sealed(1, 'old') }]);
    log.welcome(0); // replaced before the old write ran
    log.receive([{ offset: 1, event: await sealed(1, 'new') }]);
    await settled(log);
    expect((await record.load(PROJECT)).map((e) => [e.offset, e.event.text])).toEqual([[1, 'new']]);
  });

  it('discards a verification in flight when the log is replaced, so an old verdict never lands on a new entry', async () => {
    const record = memoryLogRecord();
    await record.append(PROJECT, [{ offset: 1, event: await sealed(1, 'old, genuine') }]);
    const log = new ProjectLog(PROJECT, record);
    await log.load();
    const gate = gateVerify();
    log.setKey(await key());
    await gate.inFlight; // the old entry's verification has started
    log.welcome(0); // the hub holds another log
    const forged = { ...(await sealed(1, 'genuine')), text: 'replaced, forged' };
    log.receive([{ offset: 1, event: forged }]);
    gate.release();
    await settled(log);
    expect(log.drawable()).toEqual([]);
    expect(log.refused().map((e) => [e.offset, e.verdict])).toEqual([[1, 'bad-code']]);
  });

  it('checks every entry again under a new key: what only the old key verified is no longer drawn, and the reverse', async () => {
    const k1 = await key();
    const k2 = await otherKey();
    const log = new ProjectLog(PROJECT, memoryLogRecord());
    await log.load();
    log.receive([
      { offset: 1, event: await sealedUnder(k1, 1, 'under the first key') },
      { offset: 2, event: await sealedUnder(k2, 2, 'under the second key') },
    ]);
    log.setKey(k1);
    await settled(log);
    expect(log.drawable().map((e) => e.offset)).toEqual([1]);
    log.setKey(null);
    log.setKey(k2);
    await settled(log);
    expect(log.drawable().map((e) => e.offset)).toEqual([2]);
    expect(log.refused().map((e) => e.offset)).toEqual([1]);
  });

  it('never commits a verdict reached under a key that has since been replaced', async () => {
    const k1 = await key();
    const k2 = await otherKey();
    const log = new ProjectLog(PROJECT, memoryLogRecord());
    await log.load();
    log.receive([{ offset: 1, event: await sealedUnder(k1, 1, 'under the first key') }]);
    const gate = gateVerify();
    log.setKey(k1);
    await gate.inFlight;
    log.setKey(k2);
    gate.release();
    await settled(log);
    expect(log.drawable()).toEqual([]);
    expect(log.refused().map((e) => e.offset)).toEqual([1]);
  });
});
