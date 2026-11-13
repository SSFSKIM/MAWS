import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { item } from '../../../test/support/builders';
import { ev } from '../../../test/support/events';
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
});

// UX wave U1a §H (M6, A14): a notification offers what the one rule admits for the request it reads, and each action reads
// the request again at the press, applies the rule to what it reads, and refuses an item that no longer waits.
describe('a permission’s notification actions', () => {
  const permission = (toolName: string, input: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    ev('permission.requested', { requestId: request.request.requestId, toolName, input, ...over });
  const read = permission('Read', { file_path: '/w/notes.txt' });
  const short = permission('Bash', { command: 'make build' });
  const long = permission('Bash', { command: `echo ${'x'.repeat(200)}` });
  const edit = permission('Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' });
  // the engine host's answers: the request as it now stands, and the answer's outcome
  const host = (event: SessionEvent | null, outcome = 'delivered') =>
    vi.fn<(owner: string, name: string, input?: unknown) => Promise<unknown>>(async (_owner, name) =>
      name === 'session.pendingRequest' ? { ok: true, value: { event } } : name === 'session.answer' ? { ok: true, value: { outcome } } : { ok: false, error: { code: 'internal', message: `unexpected ${name}` } });
  const setup = (event: SessionEvent | null, items: AttentionItem[] = [request], outcome?: string) => {
    const dispatch = host(event, outcome);
    const view = fakeSpineView({ attention: [[SESSION, items]] });
    return { dispatch, view, actions: notificationActions({ dispatch: dispatch as never, view }) };
  };
  const answered = (dispatch: ReturnType<typeof host>) => dispatch.mock.calls.filter(([, name]) => name === 'session.answer').map(([, , input]) => input);
  const NOTHING = { allowOnce: false, deny: false, body: null };

  it('offers Allow once and Deny on a read, with the item’s own body', async () => {
    expect(await setup(read).actions.offer(request)).toEqual({ allowOnce: true, deny: true, body: null });
  });

  it('offers Allow once and Deny on a short command, with the command as its body', async () => {
    expect(await setup(short).actions.offer(request)).toEqual({ allowOnce: true, deny: true, body: 'make build' });
  });

  it('offers Deny alone on a long command and on a file change', async () => {
    expect(await setup(long).actions.offer(request)).toEqual({ allowOnce: false, deny: true, body: null });
    expect(await setup(edit).actions.offer(request)).toEqual({ allowOnce: false, deny: true, body: null });
  });

  it('offers nothing on a question, on a request no longer read, or on an item that no longer waits, reading nothing for the last', async () => {
    const question = item('session', 'question', '2026-10-23T00:00:00Z');
    expect(await setup(read, [question]).actions.offer(question)).toEqual(NOTHING);
    expect(await setup(null).actions.offer(request)).toEqual(NOTHING);
    const gone = setup(read, [{ ...request, state: 'delivered' }]);
    expect(await gone.actions.offer(request)).toEqual(NOTHING);
    expect(gone.dispatch).not.toHaveBeenCalled();
  });

  it('Deny on a request that still waits sends the plain deny once', async () => {
    const { dispatch, actions } = setup(edit);
    await actions.deny(request);
    expect(answered(dispatch)).toEqual([{ appSessionId: SESSION, requestId: request.request.requestId, answer: { kind: 'permission', decision: 'deny' } }]);
  });

  it('Allow once sends the once-only answer once', async () => {
    const { dispatch, actions } = setup(short);
    await actions.allow(request);
    expect(answered(dispatch)).toEqual([{ appSessionId: SESSION, requestId: request.request.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }]);
  });

  it.each(['allow', 'deny'] as const)('%s refuses a request answered between the banner and the press, and answers nothing', async (act) => {
    const { dispatch, view, actions } = setup(read);
    expect(await actions.offer(request)).toEqual({ allowOnce: true, deny: true, body: null });
    view.setAttention(SESSION, [{ ...request, state: 'delivered' }]); // answered in the pane meanwhile
    await expect(actions[act](request)).rejects.toThrow('Open the session');
    view.setAttention(SESSION, []); // and gone
    await expect(actions[act](request)).rejects.toThrow('Open the session');
    expect(answered(dispatch)).toEqual([]);
  });

  it.each(['allow', 'deny'] as const)('%s answers nothing when another request has taken its place under the same session', async (act) => {
    const { dispatch, view, actions } = setup(read);
    view.setAttention(SESSION, [item('session', 'permission', '2026-10-23T00:01:00Z')]); // another item, the first one gone
    await expect(actions[act](request)).rejects.toThrow('Open the session');
    view.setAttention(SESSION, [{ ...request, request: { ...request.request, requestId: 'req-other' as RequestId } }]); // the same item naming another request
    await expect(actions[act](request)).rejects.toThrow('Open the session');
    expect(answered(dispatch)).toEqual([]);
  });

  it('Allow once applies the rule to the request read at the press', async () => {
    const { dispatch, actions } = setup(long);
    await expect(actions.allow(request)).rejects.toThrow('Open the session');
    expect(answered(dispatch)).toEqual([]);
    await actions.deny(request);
    expect(answered(dispatch)).toHaveLength(1);
  });

  it('never allows a read-only request flagged “default to no”, and denies it', async () => {
    const { dispatch, actions } = setup(permission('Read', { file_path: '/w/notes.txt' }, { defaultToNo: true }));
    expect(await actions.offer(request)).toEqual({ allowOnce: false, deny: true, body: null });
    await expect(actions.allow(request)).rejects.toThrow('Open the session');
    expect(answered(dispatch)).toEqual([]);
    await actions.deny(request);
    expect(answered(dispatch)).toHaveLength(1);
  });

  it('says so when the answer was not delivered', async () => {
    await expect(setup(read, [request], 'not_pending').actions.deny(request)).rejects.toThrow('not delivered');
    await expect(setup(read, [request], 'not_pending').actions.allow(request)).rejects.toThrow('not delivered');
  });
});
