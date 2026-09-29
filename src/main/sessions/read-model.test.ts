import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { digest, humanTurn, item, project, record, status } from '../../../test/support/builders';
import { ev } from '../../../test/support/events';
import { SessionReadModel, type ReadModelWriter, type SessionSource } from './read-model';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const { revision, ...digestInput } = digest(A, { phase: 'working', cost: { totalUsd: 2, sinceSeenUsd: 0.5 } });
void revision;

function source(): SessionSource & { writer: ReadModelWriter; visible: [AppSessionId, boolean][]; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const s = {
    writer: null as unknown as ReadModelWriter,
    visible: [] as [AppSessionId, boolean][],
    stop,
    start(writer: ReadModelWriter) {
      s.writer = writer;
      return stop;
    },
    onSetVisible(appSessionId: AppSessionId, visible: boolean) {
      s.visible.push([appSessionId, visible]);
    },
  };
  return s;
}

describe('read model snapshot matches events', () => {
  let model: SessionReadModel;
  let src: ReturnType<typeof source>;
  let emitted: SessionDigest[];

  beforeEach(() => {
    vi.restoreAllMocks();
    model = new SessionReadModel('index');
    src = source();
    model.register(src);
    src.writer.observeRecord(record(A));
    src.writer.observeRecord(record(B));
    emitted = [];
    model.on('digest', (d) => emitted.push(d));
  });

  it('answers the snapshot with exactly the last digest each session emitted', () => {
    src.writer.setDigest(digestInput);
    src.writer.fold(B, [ev('turn.started', {}), ev('tool.use', { toolName: 'Grep', input: {} })]);
    src.writer.fold(A, [ev('turn.ended', { costUsd: 3 })]);
    const last = new Map(emitted.map((d) => [d.appSessionId, d]));
    expect(model.digests().sort((x, y) => x.appSessionId.localeCompare(y.appSessionId))).toEqual([last.get(A), last.get(B)]);
  });

  it('bumps a session’s revision once per batch', () => {
    src.writer.fold(A, [ev('turn.started', {}), ev('tool.use', {}), ev('tool.result', {})]);
    src.writer.fold(A, [ev('turn.ended', {})]);
    expect(emitted.map((d) => d.revision)).toEqual([1, 2]);
  });

  it('emits nothing for a batch that changes nothing, such as a repeated one', () => {
    const batch = [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.12 })];
    src.writer.fold(A, batch);
    src.writer.fold(A, batch);
    expect(emitted).toHaveLength(1);
    expect(model.digests()[0].cost?.totalUsd).toBe(0.12);
  });

  it('sums cost across processes: a restart whose running total starts lower never lowers the session’s total', () => {
    src.writer.fold(A, [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.3 })]);
    src.writer.fold(A, [ev('process.exited', { reason: 'quit' })]);
    src.writer.fold(A, [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.05 })]);
    const totals = emitted.filter((d) => d.appSessionId === A).map((d) => d.cost?.totalUsd);
    expect(totals).toEqual([0.3, 0.3, 0.35]);
    // A scripted digest (the stub's, a seed) is the live process's running total: the next process adds to it.
    src.writer.setDigest(digestInput); // total 2
    src.writer.fold(A, [ev('process.exited', { reason: 'quit' }), ev('turn.started', {}), ev('turn.ended', { costUsd: 0.25 })]);
    expect(model.digests().find((d) => d.appSessionId === A)?.cost?.totalUsd).toBe(2.25);
  });

  it('computes cost since seen from the cost at the moment the session became visible', () => {
    src.writer.setDigest(digestInput); // total 2, since seen 0.5 → seen at 1.5
    src.writer.fold(A, [ev('usage.sample', { costUsd: 2.5 })]);
    expect(model.digests()[0].cost).toEqual({ totalUsd: 2.5, sinceSeenUsd: 1 });
    model.setVisible(A, true);
    expect(model.digests()[0].cost).toEqual({ totalUsd: 2.5, sinceSeenUsd: 0 });
    src.writer.fold(A, [ev('usage.sample', { costUsd: 2.75 })]);
    expect(model.digests()[0].cost?.sinceSeenUsd).toBe(0.25);
  });

  it('forwards visibility changes to the source, once per change', () => {
    model.setVisible(A, true);
    model.setVisible(A, true);
    model.setVisible(A, false);
    expect(src.visible).toEqual([[A, true], [A, false]]);
  });

  it('keeps records, projects and attention for main-side consumers', () => {
    const onRecord = vi.fn();
    const onAttention = vi.fn();
    model.on('record', onRecord);
    model.on('attention', onAttention);
    src.writer.observeProject(project('p1', 0));
    src.writer.observeRecord(record(A, { projectId: 'p1' as never }));
    src.writer.observeAttention(A, [item(A, 'permission', '2026-09-28T10:00:00Z')]);
    expect(model.record(A)?.appId).toBe(A);
    expect(model.project('p1' as never)?.name).toBe('p1');
    expect(model.attention(A)).toHaveLength(1);
    expect(onRecord).toHaveBeenCalledWith(A, expect.objectContaining({ appId: A }));
    expect(onAttention).toHaveBeenCalledWith(A, expect.any(Array));
    src.writer.observeRemoved(A);
    src.writer.observeProjectRemoved('p1' as never);
    expect(model.record(A)).toBeNull();
    expect(model.project('p1' as never)).toBeNull();
    expect(onRecord).toHaveBeenLastCalledWith(A, null);
  });

  it('maps engine statuses onto the digest phase', () => {
    src.writer.applyEngineStatus(status(A, { process: 'starting' }));
    expect(model.digests()[0].phase).toBe('starting');
    src.writer.applyEngineStatus(status(A, { process: 'ready', engineState: 'running', turn: humanTurn }));
    expect(model.digests()[0].phase).toBe('working');
    src.writer.applyEngineStatus(status(A, { process: 'exited', exit: { reason: 'quit' } }));
    expect(model.digests()[0].phase).toBe('exited');
    expect(model.engineStatus(A)?.process).toBe('exited');
    expect(model.engineStatus(B)).toBeNull();
  });
});

describe('quit decision', () => {
  it('mid-turn count follows the engine statuses', () => {
    const model = new SessionReadModel('index');
    const src = source();
    model.register(src);
    const w = src.writer;
    for (const id of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) w.observeRecord(record(id));
    w.applyEngineStatus(status('s1', { process: 'ready', engineState: 'running', turn: humanTurn }));
    w.applyEngineStatus(status('s2', { process: 'ready', engineState: 'requires_action', turn: humanTurn, pendingRequests: 1 }));
    w.applyEngineStatus(status('s3', { process: 'starting' }));
    w.applyEngineStatus(status('s4', { process: 'initializing' }));
    w.applyEngineStatus(status('s5', { process: 'ready', engineState: 'idle', turn: null }));
    w.applyEngineStatus(status('s6', { process: 'exited', exit: { reason: 'crash' } }));
    w.applyEngineStatus(status('s7', { process: 'exiting', turn: humanTurn }));
    expect(model.midTurnCount()).toBe(4);

    // A digest that says idle (a child backfill, a stale batch) does not change the count: the engine status decides.
    w.fold('s1' as AppSessionId, [ev('turn.started', {})]);
    w.fold('s1' as AppSessionId, [
      ev('turn.started', { id: 'u1', seq: null, agentId: 'agent-b' }),
      ev('turn.ended', { id: 'u1#1', seq: null, agentId: 'agent-b' }),
    ]);
    expect(model.digests().find((d) => d.appSessionId === 's1')?.phase).toBe('working');
    w.setDigest({ ...digestInput, appSessionId: 's1' as AppSessionId, phase: 'idle' });
    expect(model.midTurnCount()).toBe(4);

    w.forgetEngineStatus('s1' as AppSessionId);
    expect(model.midTurnCount()).toBe(3);
  });
});

// C10's trust bootstrap launches under the session's id before its record exists (C10 ask 5): the read model keeps no
// digest and no engine status for a session it has not observed, so nothing it says is about a session nobody lists.
describe('read model drops input for a session with no observed record', () => {
  let model: SessionReadModel;
  let src: ReturnType<typeof source>;

  beforeEach(() => {
    model = new SessionReadModel('index');
    src = source();
    model.register(src);
  });

  it('drops an engine status: no digest, no status, no mid-turn count, no events', () => {
    const onEngine = vi.fn();
    const onDigest = vi.fn();
    model.on('engine', onEngine);
    model.on('digest', onDigest);
    src.writer.applyEngineStatus(status(A, { process: 'ready', engineState: 'running', turn: humanTurn }));
    expect(model.digests()).toEqual([]);
    expect(model.engineStatus(A)).toBeNull();
    expect(model.midTurnCount()).toBe(0);
    expect(onEngine).not.toHaveBeenCalled();
    expect(onDigest).not.toHaveBeenCalled();
  });

  it('drops a fold, and does not remember its event ids for later', () => {
    const batch = [ev('turn.started', {}), ev('turn.ended', { costUsd: 0.5 })];
    src.writer.fold(A, batch);
    expect(model.digests()).toEqual([]);
    src.writer.observeRecord(record(A));
    src.writer.fold(A, batch);
    expect(model.digests()).toMatchObject([{ appSessionId: A, phase: 'idle', cost: { totalUsd: 0.5 } }]);
  });

  it('takes both once the record is observed, and drops them again after it is removed', () => {
    src.writer.observeRecord(record(A));
    src.writer.applyEngineStatus(status(A, { process: 'ready', engineState: 'running', turn: humanTurn }));
    expect(model.midTurnCount()).toBe(1);
    src.writer.observeRemoved(A);
    src.writer.applyEngineStatus(status(A, { process: 'ready', engineState: 'running', turn: humanTurn }));
    src.writer.fold(A, [ev('turn.started', {})]);
    expect(model.midTurnCount()).toBe(0);
    expect(model.digests()).toEqual([]);
  });

  it('a recreated session continues its digest revision where the removed one stopped', () => {
    const emitted: SessionDigest[] = [];
    model.on('digest', (d) => emitted.push(d));
    src.writer.observeRecord(record(A));
    src.writer.fold(A, [ev('turn.started', {})]);
    src.writer.fold(A, [ev('turn.ended', { costUsd: 0.2 })]);
    src.writer.observeRemoved(A);
    src.writer.observeRecord(record(A));
    src.writer.fold(A, [ev('turn.started', {})]);
    expect(emitted.map((d) => d.revision)).toEqual([1, 2, 3]);
    expect(model.digests()).toMatchObject([{ appSessionId: A, phase: 'working', revision: 3 }]);
  });
});

describe('stub source plays a timeline', () => {
  it('scenario mode refuses the index source', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const model = new SessionReadModel('scenario');
    const index = { start: vi.fn(() => { throw new Error('the index must never start in scenario mode'); }) };
    model.register(index);
    expect(index.start).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith('read-model: scenario mode, source ignored');
    const stub = source();
    model.registerScenario(stub);
    expect(stub.writer).not.toBeNull();
  });

  it('index mode refuses a scenario source', () => {
    expect(() => new SessionReadModel('index').registerScenario(source())).toThrow(/scenario/);
  });

  it('stops a source through the disposer register returns', () => {
    const model = new SessionReadModel('index');
    const src = source();
    const dispose = model.register(src);
    dispose();
    expect(src.stop).toHaveBeenCalledOnce();
  });
});
