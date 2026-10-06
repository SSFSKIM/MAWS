import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { SubagentEntry, WorkflowRun } from '@shared/ipc/schema/fs';
import type { PersistedTask } from '@shared/wire/store';
import { event } from '../../../../../test/support/agents-events';
import { createFakeAgentWorkClient, FAKE_STOP_REFUSAL, snapshotOf, type FakeWire } from './fakeClient';

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function wire(events: SessionEvent[] = []) {
  const listeners = new Set<(batch: SessionEvent[]) => void>();
  const w: FakeWire & { push(batch: SessionEvent[]): void } = {
    snapshot: (afterSeq) => snapshotOf(events, new Set(events.map((e) => e.id)), afterSeq),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    push: (batch) => listeners.forEach((listener) => listener(batch)),
  };
  return w;
}

describe('agents harness fake client', () => {
  it('answers a snapshot of the released events above afterSeq, lastSeq the highest kept', () => {
    const events = [event('tasks.snapshot', {}, { seq: 3 }), event('task.started', {}, { seq: 5 }), event('task.updated', {}, { seq: 5, n: 1 }), event('task.updated', {}, { seq: 9 })];
    const released = new Set(events.slice(0, 3).map((e) => e.id));
    expect(snapshotOf(events, released, null)).toEqual({ events: events.slice(0, 3), lastSeq: 5, complete: true });
    expect(snapshotOf(events, released, 3)).toEqual({ events: events.slice(1, 3), lastSeq: 5, complete: true });
    expect(snapshotOf(events, released, 5)).toEqual({ events: [], lastSeq: 5, complete: true });
    expect(snapshotOf(events, new Set(), null)).toEqual({ events: [], lastSeq: 0, complete: true });
  });

  it('holds session.events until the wire is bound, then reads the bound wire and forwards its batches as the session’s', async () => {
    const fake = createFakeAgentWorkClient({ session: A });
    let early: unknown = null;
    void fake.client.events(A, null).then((answer) => (early = answer));
    await settle();
    expect(early, 'an unbound wire answers nothing').toBeNull();

    const batches: { appSessionId: string; events: SessionEvent[] }[] = [];
    const off = fake.client.onEventBatch((batch) => batches.push(batch));
    const first = wire([event('task.started', {}, { seq: 2 })]);
    fake.bindWire(A, first);
    expect(await fake.client.events(A, null)).toMatchObject({ lastSeq: 2 });
    const one = [event('task.updated', {}, { seq: 3 })];
    first.push(one);
    const second = wire();
    fake.bindWire(A, second);
    first.push([event('task.updated', {}, { seq: 4 })]); // the old wire is unbound
    const two = [event('task.updated', {}, { seq: 7 })];
    second.push(two);
    off();
    second.push([event('task.updated', {}, { seq: 8 })]);
    expect(batches).toEqual([
      { appSessionId: A, events: one },
      { appSessionId: A, events: two },
    ]);
  });

  it('pages a spill one byte short of the request, ending on a character boundary, and refuses an unknown path as C4 does', async () => {
    const text = 'a'.repeat(10) + 'é' + 'b'.repeat(5); // é is two bytes: 17 bytes in all
    const fake = createFakeAgentWorkClient({ session: A, spills: { '/tmp/x.output': text } });
    expect(await fake.client.readSpill({ path: '/tmp/x.output', offset: 0, length: 8 })).toEqual({ content: 'a'.repeat(7), bytes: 17, offset: 0, length: 7, truncated: true });
    // bytes 7-11 asked; one short ends inside é (bytes 10-11), so the page backs off to the character boundary
    expect(await fake.client.readSpill({ path: '/tmp/x.output', offset: 7, length: 5 })).toEqual({ content: 'aaa', bytes: 17, offset: 7, length: 3, truncated: true });
    expect(await fake.client.readSpill({ path: '/tmp/x.output', offset: 10, length: 64 })).toEqual({ content: 'ébbbbb', bytes: 17, offset: 10, length: 7, truncated: false });
    await expect(fake.client.readSpill({ path: '/tmp/nothing' })).rejects.toThrow('spill not found: /tmp/nothing');
    expect(fake.calls().readSpill.map((input) => input.offset ?? 0)).toEqual([0, 7, 10, 0]);
  });

  it('merges fakeFs data, serves it for its session only and announces it as the fs.*Changed events do', async () => {
    const sidecar = (agentId: string, runId: string | null = null): SubagentEntry => ({ agentId: agentId as never, meta: null, transcriptPath: `/x/agent-${agentId}.jsonl`, size: 1, mtimeMs: 1, runId });
    const task = (id: string): PersistedTask => ({ id, subject: `task ${id}`, description: '', status: 'pending', blocks: [], blockedBy: [] }) as unknown as PersistedTask;
    const run: WorkflowRun = { runId: 'wf_1', snapshot: null, journal: [] };
    const fake = createFakeAgentWorkClient({ session: A });
    const seen: string[] = [];
    fake.client.onSubagentsChanged(({ appSessionId, agents }) => seen.push(`subagents ${appSessionId} ${agents.map((a) => a.agentId).join(',')}`));
    fake.client.onWorkflowChanged(({ appSessionId, runId }) => seen.push(`workflow ${appSessionId} ${runId}`));
    fake.client.onTasksChanged(({ listId }) => seen.push(`tasks ${listId}`));

    fake.fakeFs({ sidecars: [sidecar('a1'), sidecar('a2')] });
    fake.fakeFs({ sidecars: [sidecar('a2'), sidecar('w1', 'wf_1')], runs: [run], tasks: { 'sess-1': [task('1')] } });
    expect((await fake.client.subagents(A)).map((a) => a.agentId)).toEqual(['a1', 'a2', 'w1']);
    expect(await fake.client.subagents(B)).toEqual([]);
    expect(await fake.client.workflows(A)).toEqual([run]);
    expect(await fake.client.tasks('sess-1')).toHaveLength(1);
    expect(await fake.client.tasks('other')).toEqual([]);
    expect(seen).toEqual(['subagents A a1,a2', 'subagents A a1,a2,w1', 'workflow A wf_1', 'tasks sess-1']);
  });

  // E7 (Design §7): the durable cron file, answered as main answers files.read with `hash: true` (E5's rule).
  it('serves fakeFs files to files.read with their hash and utf8 for its session, watches any directory, and announces a file as files.changed', async () => {
    const fake = createFakeAgentWorkClient({ session: A });
    const seen: string[] = [];
    fake.client.onFilesChanged(({ appSessionId, path, kind }) => seen.push(`${appSessionId} ${path} ${kind}`));
    const path = '/repo/.claude/scheduled_tasks.json';
    await expect(fake.client.readFile({ appSessionId: A, path, hash: true })).rejects.toThrow(`not found: ${path}`);
    fake.fakeFs({ files: { [path]: '{"tasks":[]}' } });
    const read = await fake.client.readFile({ appSessionId: A, path, hash: true });
    expect(read).toMatchObject({ encoding: 'utf8', content: '{"tasks":[]}', bytes: 12, offset: 0, length: 12, truncated: false, utf8: true });
    expect(read.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await fake.client.readFile({ appSessionId: A, path })).hash).toBeNull();
    await expect(fake.client.readFile({ appSessionId: B, path, hash: true })).rejects.toThrow(`not found: ${path}`);
    await expect(fake.client.watchDir(A, '/repo/.claude')).resolves.toBeUndefined();
    await expect(fake.client.unwatchDir(A, '/repo/.claude')).resolves.toBeUndefined();
    expect(seen).toEqual([`A ${path} changed`]);
  });

  // E7 (M7): a refusal staged for a path is answered as main refuses it, while the session's root still resolves, so the
  // durable file's reader shows the reason rather than taking the root for gone.
  it('answers a staged refusal with its message, announced as a change, and lists the session’s roots', async () => {
    const fake = createFakeAgentWorkClient({ session: A, roots: ['/repo'] });
    const seen: string[] = [];
    fake.client.onFilesChanged(({ path }) => seen.push(path));
    const path = '/repo/.claude/scheduled_tasks.json';
    fake.fakeFs({ files: { [path]: '{"tasks":[]}' }, refusals: { [path]: 'path outside the session’s directories' } });
    await expect(fake.client.readFile({ appSessionId: A, path, hash: true })).rejects.toThrow('path outside the session’s directories');
    expect(seen).toEqual([path, path]);
    expect(await fake.client.listRoots(A)).toEqual(['/repo']);
    expect(await fake.client.listRoots(B)).toEqual([]);
    expect(await createFakeAgentWorkClient({ session: A }).client.listRoots(A)).toEqual([]);
  });

  it('records steers and stops, answering a stop as answerStop set it (ok by default)', async () => {
    const fake = createFakeAgentWorkClient({ session: A });
    const { messageUuid } = await fake.client.steer(A, 'Relay to agent x …', 'next');
    expect(messageUuid).toMatch(/^harness-steer-/);
    await expect(fake.client.stopTask(A, 't1' as never)).resolves.toBeUndefined();
    fake.answerStop('t2', 'error');
    await expect(fake.client.stopTask(A, 't2' as never)).rejects.toThrow(FAKE_STOP_REFUSAL);
    fake.answerStop('t2', 'ok');
    await expect(fake.client.stopTask(A, 't2' as never)).resolves.toBeUndefined();
    expect(fake.calls()).toMatchObject({
      steer: [{ appSessionId: A, content: 'Relay to agent x …', priority: 'next' }],
      stopTask: [{ appSessionId: A, taskId: 't1' }, { appSessionId: A, taskId: 't2' }, { appSessionId: A, taskId: 't2' }],
    });
  });
});
