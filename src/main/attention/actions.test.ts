import { describe, expect, it, vi } from 'vitest';
import { item } from '../../../test/support/builders';
import { notificationActions } from './actions';

const request = item('session', 'permission', '2026-10-23T00:00:00Z');
describe('notification actions use the session command paths', () => {
  it('acquires before sending a reply through the normal queue, never steer', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, value: { disposition: 'queued' } });
    const acquire = vi.fn().mockResolvedValue({ status: 'ready' });
    const actions = notificationActions({ dispatch, acquire, pending: () => request });
    await actions.reply(request.appSessionId, 'Next task');
    expect(acquire).toHaveBeenCalledWith(request.appSessionId, 'send');
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('engine-host', 'session.send', { appSessionId: request.appSessionId, content: 'Next task' });
  });
  it('never answers an expired or non-read-only request from a notification', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, value: { event: { kind: 'permission.requested', toolName: 'Bash' } } });
    let pending = true;
    const actions = notificationActions({ dispatch, acquire: vi.fn(), pending: () => pending ? request : undefined });
    expect(await actions.canAllow(request)).toBe(false);
    pending = false;
    await expect(actions.allow(request)).rejects.toThrow();
    expect(dispatch.mock.calls.some(([, name]) => name === 'session.answer')).toBe(false);
  });
});
