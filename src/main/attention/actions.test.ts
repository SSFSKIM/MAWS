import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { item } from '../../../test/support/builders';
import { fakeSpineView } from '../../../test/support/fake-spine-view';
import { notificationActions } from './actions';

const request = item('session', 'permission', '2026-10-23T00:00:00Z');
const SESSION = request.appSessionId as AppSessionId;
// P5 O3-C (reader R2): the actions acquire and read pending attention through the spine's view
describe('notification actions use the session command paths', () => {
  it('acquires before sending a reply through the normal queue, never steer', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, value: { disposition: 'queued' } });
    const view = fakeSpineView({ attention: [[SESSION, [request]]] });
    const actions = notificationActions({ dispatch, view });
    await actions.reply(SESSION, 'Next task');
    expect(view.acquired).toEqual([[SESSION, 'send']]);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('engine-host', 'session.send', { appSessionId: SESSION, content: 'Next task' });
  });
  it('sends nothing when the session cannot be made ready', async () => {
    const dispatch = vi.fn();
    const view = fakeSpineView();
    view.acquireWith(async () => ({ status: 'blocked' }) as never);
    await expect(notificationActions({ dispatch, view }).reply(SESSION, 'Next task')).rejects.toThrow('Open the session before sending this reply.');
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('never answers an expired or non-read-only request from a notification', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, value: { event: { kind: 'permission.requested', toolName: 'Bash' } } });
    const view = fakeSpineView({ attention: [[SESSION, [request]]] });
    const actions = notificationActions({ dispatch, view });
    expect(await actions.canAllow(request)).toBe(false);
    view.setAttention(SESSION, []); // no longer pending
    await expect(actions.allow(request)).rejects.toThrow();
    expect(dispatch.mock.calls.some(([, name]) => name === 'session.answer')).toBe(false);
  });
});
