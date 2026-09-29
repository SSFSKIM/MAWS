import { afterEach, describe, expect, it } from 'vitest';
import { fakeClient } from '../../../../test/support/fake-client';
import { createAgentWorkClient } from '../tools/agents/client';
import { connectAgentWorkEvents } from './events';
import { queryClient } from './query';

afterEach(() => queryClient.clear());

describe('agent work events', () => {
  it('invalidates the checklist query of the list fs.tasksChanged names, and no other, until disconnected', () => {
    const fake = fakeClient();
    queryClient.setQueryData(['fs.tasks', 'sess-1'], []);
    queryClient.setQueryData(['fs.tasks', 'team-list'], []);
    const disconnect = connectAgentWorkEvents(createAgentWorkClient(fake.client));

    fake.event('fs.tasksChanged', { listId: 'sess-1' });
    expect(queryClient.getQueryState(['fs.tasks', 'sess-1'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['fs.tasks', 'team-list'])?.isInvalidated).toBe(false);

    disconnect();
    fake.event('fs.tasksChanged', { listId: 'team-list' });
    expect(queryClient.getQueryState(['fs.tasks', 'team-list'])?.isInvalidated).toBe(false);
  });
});
