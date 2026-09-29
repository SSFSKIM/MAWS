import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import { fakeClient } from '../../../../../test/support/fake-client';
import { agentWorkClient, createAgentWorkClient, setAgentWorkClient } from './client';

const A = 'A' as AppSessionId;

describe('agent-work client', () => {
  afterEach(() => setAgentWorkClient(null));

  it('reaches each X2 command with its input and answers the value', async () => {
    const fake = fakeClient({
      'fs.subagents': { agents: [] },
      'fs.workflows': { runs: [] },
      'fs.tasks': { tasks: [] },
      'fs.readSpill': { content: 'x', bytes: 1, offset: 0, length: 1, truncated: false },
      'session.events': { events: [], lastSeq: 7, complete: true },
      'session.steer': { messageUuid: 'u1' },
      'session.stopTask': undefined,
    });
    const client = createAgentWorkClient(fake.client);
    expect(await client.subagents(A)).toEqual([]);
    expect(await client.workflows(A)).toEqual([]);
    expect(await client.tasks('list-1')).toEqual([]);
    expect(await client.readSpill({ path: '/p', offset: 0, length: 4 })).toMatchObject({ content: 'x', length: 1 });
    expect(await client.events(A, 3)).toEqual({ events: [], lastSeq: 7, complete: true });
    expect(await client.steer(A, 'hello', 'next')).toEqual({ messageUuid: 'u1' });
    await client.stopTask(A, 't1' as TaskId);
    expect(fake.invoked('fs.subagents')).toEqual([{ appSessionId: 'A' }]);
    expect(fake.invoked('fs.tasks')).toEqual([{ listId: 'list-1' }]);
    expect(fake.invoked('session.events')).toEqual([{ appSessionId: 'A', afterSeq: 3, limit: null }]);
    expect(fake.invoked('session.steer')).toEqual([{ appSessionId: 'A', content: 'hello', priority: 'next' }]);
    expect(fake.invoked('session.stopTask')).toEqual([{ appSessionId: 'A', taskId: 't1' }]);
  });

  it('throws the X2 error’s message', async () => {
    const fake = fakeClient();
    const client = createAgentWorkClient(fake.client);
    const answer = expect(client.steer(A, 'x', 'next')).rejects.toThrow('the session is not ready');
    await fake.fail('session.steer', 'the session is not ready');
    await answer;
  });

  it('passes the events through and unsubscribes', () => {
    const fake = fakeClient();
    const client = createAgentWorkClient(fake.client);
    const seen: unknown[] = [];
    const off = client.onTasksChanged((p) => seen.push(p));
    client.onEventBatch((p) => seen.push(p.appSessionId));
    fake.event('fs.tasksChanged', { listId: 'l' });
    fake.event('session.eventBatch', { appSessionId: 'A', events: [] });
    off();
    fake.event('fs.tasksChanged', { listId: 'm' });
    expect(seen).toEqual([{ listId: 'l' }, 'A']);
  });

  it('is replaceable by the harness and the tests, and null restores the bridge’s', () => {
    const product = agentWorkClient();
    expect(agentWorkClient()).toBe(product);
    const fake = createAgentWorkClient(fakeClient().client);
    setAgentWorkClient(fake);
    expect(agentWorkClient()).toBe(fake);
    setAgentWorkClient(null);
    expect(agentWorkClient()).toBe(product);
  });
});
