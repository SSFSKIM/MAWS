// P5 O2 M2 (P5 Decision Log 46): the durable crons, read from the project's scheduled-tasks file for the engine
// session ids the app session has had (durable-crons.ts).
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { MemorySessionStateStore } from './store/memory-session-state-store';
import { DurableCronSource, durableCronsOf, scheduledTasksPath } from './durable-crons';
import type { SessionCron } from './work-state';

const ID = 'e12639e3-7f62-4cf5-8a24-fd50f3a4c993';
const OTHER = '55555555-5555-4555-8555-555555555555';
// The file as the Stop-hook probe recorded it after a durable CronCreate (fixtures/p5/p5-o2-stop-crons-durable.jsonl,
// seq 48: `durable_file`), the creator's id this test's ID
const recorded = (over: Record<string, unknown> = {}) => ({
  id: 'efd35f19', cron: '* * * * *', prompt: '[[P5O2:FIRE]] durable minute job', createdAt: 1793094929539, recurring: true,
  createdBySessionId: ID, createdByPid: 6191, createdByProcStart: '123882', createdInProject: '/tmp/maws-e0a-p5o2-durable-wOXr7C/repo-MTmxt7', ...over,
});
const ours = (createdBySessionId: string) => createdBySessionId === ID;
const file = (tasks: unknown[]) => `${JSON.stringify({ tasks }, null, 2)}\n`;
const reader = (files: Record<string, string>) => (path: string) => files[path] ?? null;

describe('durableCronsOf', () => {
  it('reads <dir>/.claude/scheduled_tasks.json, taking the jobs one of the ids created', () => {
    const read = reader({ [scheduledTasksPath('/w')]: file([recorded(), recorded({ id: 'theirs', createdBySessionId: OTHER })]) });
    expect(durableCronsOf(read, ['/w'], ours, () => {})).toEqual([{ id: 'efd35f19', schedule: '* * * * *', recurring: true, prompt: '[[P5O2:FIRE]] durable minute job' }]);
    expect(scheduledTasksPath('/w')).toBe('/w/.claude/scheduled_tasks.json');
  });

  it('a one-shot job (no `recurring` key) reads as not recurring', () => {
    const oneShot = recorded({ recurring: undefined }); // left out of the file's JSON
    expect(durableCronsOf(reader({ [scheduledTasksPath('/w')]: file([oneShot]) }), ['/w'], ours, () => {})).toEqual([expect.objectContaining({ id: 'efd35f19', recurring: false })]);
  });

  it('no file means no durable crons, and a job with no creator (a legacy or hand-written one) is no session\'s', () => {
    const legacy = recorded({ createdBySessionId: undefined }); // left out of the file's JSON
    expect(durableCronsOf(reader({}), ['/w'], ours, () => {})).toEqual([]);
    expect(durableCronsOf(reader({ [scheduledTasksPath('/w')]: file([legacy]) }), ['/w'], ours, () => {})).toEqual([]);
  });

  it('a file that exists but cannot be read, is not JSON or holds no task list is unreadable', () => {
    const throws = () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    };
    expect(durableCronsOf(throws, ['/w'], ours, () => {})).toBe('unreadable');
    for (const text of ['{"tasks": [', '[]', '{"tasks": {}}', 'null']) expect(durableCronsOf(reader({ [scheduledTasksPath('/w')]: text }), ['/w'], ours, () => {}), text).toBe('unreadable');
  });

  it('drops an entry of the wrong shape with a log line, as the engine\'s loader skips it', () => {
    const dropped: string[] = [];
    const read = reader({ [scheduledTasksPath('/w')]: file([recorded({ cron: 5 }), recorded({ createdAt: 'yesterday' }), 'junk', recorded({ id: 'ok' })]) });
    expect(durableCronsOf(read, ['/w'], ours, (line) => dropped.push(line))).toEqual([expect.objectContaining({ id: 'ok' })]);
    expect(dropped).toHaveLength(3);
  });

  it('reads every directory once and a job once, by its id', () => {
    const read = reader({ [scheduledTasksPath('/w')]: file([recorded()]), [scheduledTasksPath('/w/wt')]: file([recorded(), recorded({ id: 'two' })]) });
    expect((durableCronsOf(read, ['/w', '/w/wt', '/w'], ours, () => {}) as SessionCron[]).map((c) => c.id)).toEqual(['efd35f19', 'two']);
  });
});

describe('DurableCronSource: the lineage', () => {
  const APP = 'app-1' as AppSessionId;
  const source = (store: MemorySessionStateStore, files: Record<string, string>, launchId = ID) =>
    new DurableCronSource({
      engineSessionId: launchId, dirs: () => ['/w'], read: reader(files), log: () => {},
      loadLineage: () => store.loadEngineSessionIds(APP), saveLineage: (ids) => void store.saveEngineSessionIds(APP, ids),
    });

  it('matches every engine session id the app session has had, kept in its state file across launches', async () => {
    const store = new MemorySessionStateStore();
    const files = { [scheduledTasksPath('/w')]: file([recorded({ id: 'before-clear', createdBySessionId: OTHER }), recorded()]) };
    const first = source(store, files, OTHER);
    await first.load();
    first.note(ID); // a /clear moved the process to a new id
    expect((first.read() as { id: string }[]).map((c) => c.id).sort()).toEqual(['before-clear', 'efd35f19']);
    await Promise.resolve();
    expect((await store.loadEngineSessionIds(APP)).sort()).toEqual([OTHER, ID].sort());
    const resumed = source(store, files, ID); // the next launch resumes the current id
    await resumed.load();
    expect((resumed.read() as { id: string }[]).map((c) => c.id).sort()).toEqual(['before-clear', 'efd35f19']);
  });

  it('an id noted before the state loads joins the lineage it loads', async () => {
    const store = new MemorySessionStateStore();
    await store.saveEngineSessionIds(APP, [OTHER]);
    const s = source(store, {}, ID);
    s.note(ID);
    await s.load();
    expect((await store.loadEngineSessionIds(APP)).sort()).toEqual([OTHER, ID].sort());
  });

  it('a lineage that did not load still matches the launch\'s own ids, and is never saved over the stored one', async () => {
    const store = new MemorySessionStateStore();
    await store.saveEngineSessionIds(APP, [OTHER]);
    const load = store.loadEngineSessionIds.bind(store);
    store.loadEngineSessionIds = async () => {
      throw new Error('disk gone');
    };
    const s = source(store, { [scheduledTasksPath('/w')]: file([recorded()]) });
    await s.load();
    s.note('77777777-7777-4777-8777-777777777777');
    expect(s.read()).toHaveLength(1);
    expect(await load(APP)).toEqual([OTHER]);
  });

  it('fails closed while the lineage is unavailable: a job another id created may be the session\'s (before a /clear)', async () => {
    const store = new MemorySessionStateStore();
    await store.saveEngineSessionIds(APP, [OTHER]); // the id before the /clear, which the launch does not know
    store.loadEngineSessionIds = async () => {
      throw Object.assign(new Error('EACCES: permission denied, open state file'), { code: 'EACCES' });
    };
    const priorJob = { [scheduledTasksPath('/w')]: file([recorded({ id: 'before-clear', createdBySessionId: OTHER })]) };
    const s = source(store, priorJob, ID);
    await s.load();
    expect(s.read()).toBe('unreadable'); // not [], which would clear the resumed unknown and make the session releasable
    const none = source(store, { [scheduledTasksPath('/w')]: file([]) }, ID);
    await none.load();
    expect(none.read()).toEqual([]); // a file with no job any id could own still reads as it is
    const own = source(store, { [scheduledTasksPath('/w')]: file([recorded()]) }, ID);
    await own.load();
    expect(own.read()).toEqual([expect.objectContaining({ id: 'efd35f19' })]); // only its own id's job: read as it is
    const both = source(store, { [scheduledTasksPath('/w')]: file([recorded(), recorded({ id: 'x', createdBySessionId: OTHER })]) }, ID);
    await both.load();
    expect(both.read()).toBe('unreadable'); // its own job is known, but another id's could be its too
  });
});
