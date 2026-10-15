// A project's log as the browser keeps it: by offset, in its own record, so a reload resumes where the record ends;
// verified before anything reads it as drawable, and locked — nothing drawable — while the browser holds no key.
import { describe, expect, it } from 'vitest';
import { importOrgKey, seal, type LogEvent } from 'desk-hub/protocol';
import { VECTOR_KEY, VECTOR_PROJECT as PROJECT } from '../../test/vectors';
import { memoryLogRecord } from './record';
import { ProjectLog } from './project-log';

const key = () => importOrgKey(VECTOR_KEY);
const sealed = async (seq: number, text: string): Promise<LogEvent> =>
  (await seal(await key(), 'log', PROJECT, { ts: '2026-10-15T08:00:00.000Z', writer: 'mini/human', seq, kind: 'say', from: 'human', to: '*', text })) as unknown as LogEvent;
const settled = (log: ProjectLog) => log.settled();

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
});
