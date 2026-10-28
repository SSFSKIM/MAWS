import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema';
import { digest, item, project, record } from '../../../test/support/builders';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import type { ClientPort, NotifyEvent, NotifyRequest } from '@shared/client/port';

// A stand-in for the client port's notifications, badge and focus: records every notification asked for, and lets a
// test fire the events the port relays, by Electron's names for them.
const os = {
  supported: true,
  instances: [] as FakeNotification[],
  badge: vi.fn<ClientPort['badge']>(),
  focus: vi.fn<ClientPort['focus']>(),
};
class FakeNotification {
  shown = 1;
  close = vi.fn();
  constructor(readonly options: NotifyRequest, private readonly onEvent: (event: NotifyEvent) => void) {}
  fire(event: string, ...args: unknown[]) {
    const kinds: Record<string, () => NotifyEvent> = {
      show: () => ({ kind: 'shown' }), failed: () => ({ kind: 'failed', error: args[0] as string }), click: () => ({ kind: 'clicked' }),
      reply: () => ({ kind: 'replied', text: args[0] as string }), action: () => ({ kind: 'action', index: args[0] as number }), close: () => ({ kind: 'closed' }),
    };
    this.onEvent(kinds[event]!());
  }
}
const port: Pick<ClientPort, 'notify' | 'badge' | 'focus'> = {
  notify: (_client, request, onEvent) => {
    if (!os.supported) return { unsupported: 'notifications are not supported' };
    const notification = new FakeNotification(request, onEvent);
    os.instances.push(notification);
    return notification;
  },
  badge: (client, count) => os.badge(client, count),
  focus: (client, mode) => os.focus(client, mode),
};
const bounces = () => os.focus.mock.calls.filter(([, mode]) => mode === 'request');
const brought = () => os.focus.mock.calls.filter(([, mode]) => mode === 'bring');

import { SessionReadModel } from '../sessions/read-model';
import { startNotifier } from './notifier';
type Writer = import('../sessions/read-model').ReadModelWriter;

const CHARTER = 'app-charter' as AppSessionId;
const LOOSE = 'app-loose' as AppSessionId;
const T = '2026-09-28T10:00:00Z';
const SETTINGS: Settings = SETTINGS_DEFAULTS_V19;

function harness(opts: { focused?: boolean; settings?: Settings; before?: (w: Writer) => void; actions?: import('./actions').NotificationActions } = {}) {
  const model = new SessionReadModel('index');
  let writer!: Writer;
  model.register({ start: (w) => ((writer = w), () => {}) });
  writer.observeProject(project('maws', 0, { name: 'MAWS' }));
  writer.observeRecord(record(CHARTER, { projectId: 'maws' as never, title: { text: 'Charter + research', source: 'user' } }));
  writer.observeRecord(record(LOOSE, { title: { text: 'Terminal workflow notes', source: 'user' } }));
  opts.before?.(writer);
  const state = { viewing: null as AppSessionId | null, focused: opts.focused ?? false, settings: opts.settings ?? SETTINGS };
  const emit = vi.fn(() => true);
  const navigate = vi.fn();
  const failure = vi.fn();
  const stop = startNotifier(model, { port, actions: opts.actions, failure, isFocused: () => state.focused, isViewing: (id) => state.focused && state.viewing === id, navigate, settings: () => state.settings, emit });
  const set = (appSessionId: AppSessionId, items: AttentionItem[]) => writer.observeAttention(appSessionId, items);
  return { model, writer, state, emit, navigate, failure, stop, set };
}

const posted = () => os.instances;
const emitted = (emit: ReturnType<typeof vi.fn>, name: string) => emit.mock.calls.filter(([n]) => n === name).map(([, payload]) => payload);

beforeEach(() => {
  os.instances = [];
  os.supported = true;
  os.badge.mockClear();
  os.focus.mockClear();
  vi.restoreAllMocks();
});

describe('notifier fires once per item when unfocused', () => {
  it('posts a new pending permission item while the window is unfocused, titled with the project and the session', () => {
    const h = harness();
    const read = item(CHARTER, 'permission', T, { summary: 'Read docs/charter.md' });
    h.set(CHARTER, [read]);
    expect(posted()).toHaveLength(1);
    expect(posted()[0].options).toEqual({ title: 'MAWS · Charter + research', body: 'Read docs/charter.md', silent: true });
    expect(posted()[0].shown).toBe(1);
  });

  // E11 F2b (plan 2.6): the body is the summary's owner-aware preview
  it('posts the preview of a summary carrying the owner’s marks', () => {
    const h = harness();
    h.set(CHARTER, [item(CHARTER, 'error', T, { summary: '<to-human>\nBackground task failed: npm test exited 1\n</to-human>' })]);
    expect(posted()[0].options.body).toBe('Background task failed: npm test exited 1');
  });

  it('titles a session with no project by its title alone, and plays the sound when asked', () => {
    const h = harness({ settings: { ...SETTINGS, notifications: { ...SETTINGS.notifications, sound: true } } });
    h.set(LOOSE, [item(LOOSE, 'question', T)]);
    expect(posted()[0].options).toMatchObject({ title: 'Terminal workflow notes', silent: false });
  });

  it('does not post while the window is focused, nor later for the same item', () => {
    const h = harness({ focused: true });
    const read = item(CHARTER, 'permission', T);
    h.set(CHARTER, [read]);
    h.state.focused = false;
    h.set(CHARTER, [read]);
    expect(posted()).toHaveLength(0);
  });

  it('never posts twice for the same id, though its session list is sent again', () => {
    const h = harness();
    const first = item(CHARTER, 'permission', T);
    h.set(CHARTER, [first]);
    h.set(CHARTER, [first]);
    h.set(CHARTER, [first, item(CHARTER, 'question', '2026-09-28T10:01:00Z')]);
    expect(posted()).toHaveLength(2);
  });

  it('does not post for a held peer message, an item first seen delivered, or with notifications off', () => {
    const h = harness();
    h.set(CHARTER, [item(CHARTER, 'held_peer_message', T)]);
    h.set(LOOSE, [item(LOOSE, 'permission', T, { state: 'delivered' })]);
    expect(posted()).toHaveLength(0);
    const off = harness({ settings: { ...SETTINGS, notifications: { ...SETTINGS.notifications, enabled: false } } });
    off.set(CHARTER, [item(CHARTER, 'plan', T)]);
    expect(posted()).toHaveLength(0);
  });

  it('with C11’s notifications.kinds, posts only for a group that is on (approvals, questions, plan reviews, errors)', () => {
    const kinds = { turnFinished: true, approvals: false, questions: true, planReviews: false, errors: true, heldPeerMessages: true, asyncInput: true, essential: true /* P2-C */ };
    const settings: Settings = { ...SETTINGS, notifications: { ...SETTINGS.notifications, kinds } };
    const h = harness({ settings });
    const at = (n: number) => `2026-09-28T10:0${n}:00Z`;
    h.set(CHARTER, [
      item(CHARTER, 'permission', at(0)), item(CHARTER, 'dialog', at(1)), item(CHARTER, 'elicitation', at(2)),
      item(CHARTER, 'question', at(3)), item(CHARTER, 'plan', at(4)),
      item(CHARTER, 'error', at(5)), item(CHARTER, 'interrupted', at(6)), item(CHARTER, 'auto_mode_unavailable', at(7)),
    ]);
    expect(posted().map((n) => n.options.body)).toEqual([
      `question for ${CHARTER}`, `error for ${CHARTER}`, `interrupted for ${CHARTER}`, `auto_mode_unavailable for ${CHARTER}`,
    ]);
    // A held peer message is not actionable, so its flag being on changes nothing today.
    h.set(LOOSE, [item(LOOSE, 'held_peer_message', T)]);
    expect(posted()).toHaveLength(4);
  });

  it('P2-C: posts an owner-channel question and must-read under their own groups (asyncInput, essential), and counts them in the badge', () => {
    for (const [asyncInput, essential, bodies] of [[true, false, ['async_input']], [false, true, ['essential_unread']]] as const) {
      os.instances = [];
      const settings: Settings = { ...SETTINGS, notifications: { ...SETTINGS.notifications, kinds: { ...SETTINGS.notifications.kinds, asyncInput, essential } } };
      const h = harness({ settings });
      h.set(CHARTER, [item(CHARTER, 'async_input', T), item(CHARTER, 'essential_unread', '2026-09-28T10:01:00Z')]);
      expect(posted().map((n) => n.options.body)).toEqual(bodies.map((kind) => `${kind} for ${CHARTER}`));
      expect(os.badge).toHaveBeenLastCalledWith(null, 1);
      h.stop();
    }
  });

  it('never posts for the items that were already waiting when it started', () => {
    const waiting = item(CHARTER, 'permission', T);
    const h = harness({ before: (w) => w.observeAttention(CHARTER, [waiting]) });
    h.set(CHARTER, [waiting, item(CHARTER, 'question', '2026-09-28T10:01:00Z')]);
    expect(posted().map((n) => n.options.body)).toEqual([`question for ${CHARTER}`]);
  });

  it('reports a shown notification as attention.notified with delivery os', () => {
    const h = harness();
    const read = item(CHARTER, 'permission', T);
    h.set(CHARTER, [read]);
    expect(emitted(h.emit, 'attention.notified')).toEqual([]);
    posted()[0].fire('show');
    expect(emitted(h.emit, 'attention.notified')).toEqual([{ appSessionId: CHARTER, attentionId: read.id, delivery: 'os', at: expect.any(String) }]);
  });

  it('switches to the fallback on the first failure: that item and every later one bounce the dock and report fallback', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = harness();
    const first = item(CHARTER, 'permission', T);
    h.set(CHARTER, [first]);
    posted()[0].fire('failed', 'Notifications are not allowed for this application');
    const next = item(LOOSE, 'question', T);
    h.set(LOOSE, [next]);
    expect(posted()).toHaveLength(1); // the second never reached Notification
    expect(bounces()).toEqual([[null, 'request'], [null, 'request']]);
    expect(emitted(h.emit, 'attention.notified')).toEqual([
      { appSessionId: CHARTER, attentionId: first.id, delivery: 'fallback', at: expect.any(String) },
      { appSessionId: LOOSE, attentionId: next.id, delivery: 'fallback', at: expect.any(String) },
    ]);
    expect(log).toHaveBeenCalledExactlyOnceWith('notifier: OS notifications unavailable (Notifications are not allowed for this application); using dock bounce and toasts');
  });

  it('uses the fallback when the port says notifications are not supported', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    os.supported = false;
    const h = harness();
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    expect(posted()).toHaveLength(0);
    expect(bounces()).toHaveLength(1);
    expect(emitted(h.emit, 'attention.notified')).toMatchObject([{ delivery: 'fallback' }]);
  });

  it('a click focuses the window and hands the navigation to the relay, which emits or queues it', () => {
    const h = harness();
    const read = item(CHARTER, 'permission', T);
    h.set(CHARTER, [read]);
    posted()[0].fire('click');
    expect(brought()).toEqual([[null, 'bring']]);
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith({ appSessionId: CHARTER, attentionId: read.id, source: 'notification' });
    expect(emitted(h.emit, 'attention.navigate')).toEqual([]); // never emitted around the relay
  });

  it('stops listening when stopped', () => {
    const h = harness();
    h.stop();
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    expect(posted()).toHaveLength(0);
  });
});

describe('dock badge', () => {
  it('counts the tier-1 Needs-you sessions whatever the focus, and clears at zero', () => {
    const waiting = item(CHARTER, 'permission', T);
    const h = harness({ focused: true, before: (w) => w.observeAttention(CHARTER, [waiting]) });
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    h.set(LOOSE, [item(LOOSE, 'question', T), item(LOOSE, 'plan', T)]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 2);
    h.set(LOOSE, [item(LOOSE, 'held_peer_message', T)]); // tier 2 only
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    h.set(CHARTER, [{ ...waiting, state: 'confirmed' }]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 0);
  });

  it('leaves out archived sessions and sessions with no record', () => {
    const h = harness();
    h.writer.observeRecord(record(CHARTER, { archived: true }));
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    h.set('app-unknown' as AppSessionId, [item('app-unknown', 'permission', T)]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 0);
    expect(posted()).toHaveLength(0); // neither is in Needs you, so neither is announced
  });
});

 describe('per-session notifications', () => {
  it('uses an in-app notice for another session, suppressing only the focused session', () => {
    const h = harness({ focused: true });
    h.state.viewing = LOOSE;
    h.set(CHARTER, [item(CHARTER, 'question', T)]);
    h.set(LOOSE, [item(LOOSE, 'question', T)]);
    expect(posted()).toHaveLength(0);
    expect(emitted(h.emit, 'attention.notified')).toMatchObject([{ appSessionId: CHARTER, delivery: 'in-app' }]);
  });
  it('announces a new completed turn once, not a restored idle digest', () => {
    const h = harness();
    h.writer.setDigest(digest(CHARTER, { lastTurnEndedAt: T }));
    expect(posted()).toHaveLength(0);
    h.writer.setDigest(digest(CHARTER, { phase: 'working', turnStartedAt: T }));
    const done = digest(CHARTER, { turnStartedAt: T, lastTurnEndedAt: '2026-09-28T10:01:00Z', lastAssistantLine: 'All tests pass.' });
    h.writer.setDigest(done);
    h.writer.setDigest(done);
    expect(posted()).toHaveLength(1);
    expect(posted()[0].options.body).toBe('All tests pass.');
  });
  it('hands a failed reply to the ready-page relay rather than emitting it to a just-created window', async () => {
    const actions = { reply: vi.fn().mockRejectedValue(new Error('Session unavailable')), canAllow: vi.fn(), allow: vi.fn() };
    const h = harness({ actions });
    h.writer.setDigest(digest(CHARTER, { phase: 'working', turnStartedAt: T }));
    h.writer.setDigest(digest(CHARTER, { lastTurnEndedAt: '2026-09-28T10:01:00Z' }));
    posted()[0].fire('reply', 'Do not lose these words');
    await vi.waitFor(() => expect(brought()).toEqual([[null, 'bring']]));
    expect(h.navigate).toHaveBeenCalledWith({ appSessionId: CHARTER, attentionId: null, source: 'notification' });
    expect(h.failure).toHaveBeenCalledExactlyOnceWith({ appSessionId: CHARTER, attentionId: null, delivery: 'in-app', at: expect.any(String), error: 'Session unavailable', reply: 'Do not lose these words' });
    expect(emitted(h.emit, 'attention.notified')).toEqual([]);
  });

  it('hands a failed Allow once action to the same ready-page relay', async () => {
    const actions = { reply: vi.fn(), canAllow: vi.fn().mockResolvedValue(true), allow: vi.fn().mockRejectedValue(new Error('Request expired')) };
    const h = harness({ actions });
    const request = item(CHARTER, 'permission', T);
    h.set(CHARTER, [request]);
    await vi.waitFor(() => expect(posted()).toHaveLength(1));
    posted()[0].fire('action', 0);
    await vi.waitFor(() => expect(brought()).toEqual([[null, 'bring']]));
    expect(h.failure).toHaveBeenCalledExactlyOnceWith({ appSessionId: CHARTER, attentionId: request.id, delivery: 'in-app', at: expect.any(String), error: 'Request expired' });
    expect(emitted(h.emit, 'attention.notified')).toEqual([]);
  });

  it('withdraws a request banner when the request resolves', () => {
    const h = harness();
    const request = item(CHARTER, 'permission', T);
    h.set(CHARTER, [request]);
    h.set(CHARTER, [{ ...request, state: 'confirmed' } as AttentionItem]);
    expect(posted()[0].close).toHaveBeenCalledOnce();
  });
 });
