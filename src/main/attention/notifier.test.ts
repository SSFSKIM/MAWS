import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema';
import { digest, item, project, record } from '../../../test/support/builders';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
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

import { fakeSpineView, type FakeSpineView } from '../../../test/support/fake-spine-view';
import type { MachineRef } from '@shared/machine/ref';
import type { RemoteAttentionChange } from '../lane-b/remote-attention';
import { notificationActions, type NotificationActions } from './actions';
import type { HostDispatch } from '../ipc/router';
import { startNotifier } from './notifier';
import { costLedger, emptyDigest, foldEvents } from '../../services/sessions/digest'; // UX wave U4a
import { Normalizer } from '../../engine-host/normalizer'; // UX wave U4a
import { loadUxwaveJournal } from '../../../test/support/fixtures'; // UX wave U4a

const CHARTER = 'app-charter' as AppSessionId;
const LOOSE = 'app-loose' as AppSessionId;
const T = '2026-09-28T10:00:00Z';
const SETTINGS: Settings = SETTINGS_DEFAULTS_V21;

// P5 O3-C (reader R1): the notifier reads the spine through its view alone
// `dispatch`: the engine host's answers, read by main's own notification actions over this view (UX wave U1a §H)
function harness(opts: { focused?: boolean; settings?: Settings; before?: (v: FakeSpineView) => void; actions?: NotificationActions; dispatch?: HostDispatch; remote?: FakeRemote } = {}) {
  const view = fakeSpineView({
    projects: [project('maws', 0, { name: 'MAWS' })],
    records: [record(CHARTER, { projectId: 'maws' as never, title: { text: 'Charter + research', source: 'user' } }), record(LOOSE, { title: { text: 'Terminal workflow notes', source: 'user' } })],
  });
  opts.before?.(view);
  const state = { viewing: null as AppSessionId | null, focused: opts.focused ?? false, settings: opts.settings ?? SETTINGS, clock: Date.parse(STARTED) };
  const emit = vi.fn(() => true);
  const emitFrom = vi.fn(() => true);
  const navigate = vi.fn();
  const failure = vi.fn();
  const remote = opts.remote === undefined ? {} : { remote: opts.remote.view, emitFrom, remoteTitle: (machine: MachineRef, app: string) => opts.remote!.titles.get(`${machine}/${app}`) ?? null, now: () => state.clock };
  const actions = opts.actions ?? (opts.dispatch === undefined ? undefined : notificationActions({ dispatch: opts.dispatch, view }));
  const stop = startNotifier(view, { port, actions, failure, isFocused: () => state.focused, isViewing: (id) => state.focused && state.viewing === id, navigate, settings: () => state.settings, emit, ...remote });
  const set = (appSessionId: AppSessionId, items: AttentionItem[], silent: AttentionItem['id'][] = []) => view.setAttention(appSessionId, items, silent);
  return { view, state, emit, emitFrom, navigate, failure, stop, set };
}

// P5 O7 M6: other machines' attention as remote lane B's feeds hold it (src/main/lane-b/remote-attention.ts)
const MINI = 'MiniMachineRef00000000' as MachineRef;
const STARTED = '2026-09-28T09:00:00Z'; // the notifier's start, by this Mac's clock
type FakeRemote = ReturnType<typeof fakeRemote>;
function fakeRemote() {
  const machines = new Map<MachineRef, { machine: MachineRef; name: string; greyed: boolean; sessions: Map<string, AttentionItem[]> }>();
  const listeners = new Set<(change: RemoteAttentionChange) => void>();
  const tell = (change: RemoteAttentionChange) => listeners.forEach((listener) => listener(change));
  const held = (machine: MachineRef) => machines.get(machine) ?? machines.set(machine, { machine, name: 'mini', greyed: false, sessions: new Map() }).get(machine)!;
  return {
    titles: new Map<string, string>(),
    view: {
      machines: () => [...machines.values()],
      machine: (machine: MachineRef) => machines.get(machine) ?? null,
      onChange: (listener: (change: RemoteAttentionChange) => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    },
    /** A feed's snapshot: the machine's items whole, no longer greyed. */
    snapshot(items: AttentionItem[], machine = MINI) {
      const m = held(machine);
      m.greyed = false;
      m.sessions = new Map();
      for (const i of items) m.sessions.set(i.appSessionId, [...(m.sessions.get(i.appSessionId) ?? []), i]);
      tell({ machine, kind: 'snapshot' });
    },
    session(app: string, items: AttentionItem[], machine = MINI) {
      const m = held(machine);
      if (items.length > 0) m.sessions.set(app, items);
      else m.sessions.delete(app);
      tell({ machine, kind: 'session', app });
    },
    grey(machine = MINI) {
      held(machine).greyed = true;
      tell({ machine, kind: 'greyed' });
    },
    gone(machine = MINI) {
      machines.delete(machine);
      tell({ machine, kind: 'gone' });
    },
  };
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
    h.set(CHARTER, [item(CHARTER, 'error', T, { summary: '<to-human>\nThe turn ended with an error (overloaded)\n</to-human>' })]);
    expect(posted()[0].options.body).toBe('The turn ended with an error (overloaded)');
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

  // P5 O3-C (O3 §7: the restored marks in band): an item the change marks silent is never announced, then or later
  it('never posts for an item its change marks silent (restored, or re-projected by the owner channel), though it is badged', () => {
    const h = harness();
    const restored = item(CHARTER, 'permission', T);
    h.set(CHARTER, [restored], [restored.id]);
    h.set(CHARTER, [restored, item(CHARTER, 'question', '2026-09-28T10:01:00Z')]);
    expect(posted().map((n) => n.options.body)).toEqual([`question for ${CHARTER}`]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
  });

  it('titles a session whose project is hidden by its title alone, as for no project', () => {
    const h = harness({ before: (v) => v.setProjects([], [project('maws', 0, { name: 'MAWS', hidden: true })]) });
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    expect(posted()[0].options.title).toBe('Charter + research');
  });

  it('never posts for the items that were already waiting when it started', () => {
    const waiting = item(CHARTER, 'permission', T);
    const h = harness({ before: (v) => v.setAttention(CHARTER, [waiting]) });
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
    const h = harness({ focused: true, before: (v) => v.setAttention(CHARTER, [waiting]) });
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
    h.view.putRecord(record(CHARTER, { archived: true }));
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
    h.view.putDigest(digest(CHARTER, { lastTurnEndedAt: T }));
    expect(posted()).toHaveLength(0);
    h.view.putDigest(digest(CHARTER, { phase: 'working', turnStartedAt: T }));
    const done = digest(CHARTER, { turnStartedAt: T, lastTurnEndedAt: '2026-09-28T10:01:00Z', lastAssistantLine: 'All tests pass.' });
    h.view.putDigest(done);
    h.view.putDigest(done);
    expect(posted()).toHaveLength(1);
    expect(posted()[0].options.body).toBe('All tests pass.');
  });
  // UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, decision 6): the notifier is fed the digests of
  // a recorded session in which a waiting message was sent now (u4p2-a-1): the cut turn's end (47) leaves lastTurnEndedAt
  // where it was, so it posts nothing; the message's own end (191) posts once. The notifier's source is not edited.
  it('UX wave U4a: posts nothing for the turn a sent-now message ended, and once for the message’s own turn', () => {
    const h = harness();
    const normalizer = new Normalizer({ appSessionId: CHARTER, launchId: 'L1', sessionId: null });
    const seen = new Set<string>();
    let current = emptyDigest(CHARTER);
    const ledger = costLedger(current);
    const postedAfter = new Map<number, number>();
    for (const row of loadUxwaveJournal('u4p2-a-1')) {
      if (row.seq > 191) break;
      current = foldEvents(current, seen, normalizer.push(row), ledger);
      h.view.putDigest(current);
      postedAfter.set(row.seq, posted().length);
    }
    expect(postedAfter.get(46)).toBe(0);
    expect(postedAfter.get(190)).toBe(0);
    expect(postedAfter.get(191)).toBe(1);
  });
  it('hands a failed reply to the ready-page relay rather than emitting it to a just-created window', async () => {
    const actions = { reply: vi.fn().mockRejectedValue(new Error('Session unavailable')), offer: vi.fn(), allow: vi.fn(), deny: vi.fn() };
    const h = harness({ actions });
    h.view.putDigest(digest(CHARTER, { phase: 'working', turnStartedAt: T }));
    h.view.putDigest(digest(CHARTER, { lastTurnEndedAt: '2026-09-28T10:01:00Z' }));
    posted()[0].fire('reply', 'Do not lose these words');
    await vi.waitFor(() => expect(brought()).toEqual([[null, 'bring']]));
    expect(h.navigate).toHaveBeenCalledWith({ appSessionId: CHARTER, attentionId: null, source: 'notification' });
    expect(h.failure).toHaveBeenCalledExactlyOnceWith({ appSessionId: CHARTER, attentionId: null, delivery: 'in-app', at: expect.any(String), error: 'Session unavailable', reply: 'Do not lose these words' });
    expect(emitted(h.emit, 'attention.notified')).toEqual([]);
  });

  it('hands a failed Allow once action to the same ready-page relay', async () => {
    const actions = { reply: vi.fn(), offer: vi.fn().mockResolvedValue({ allowOnce: true, deny: true, body: null }), allow: vi.fn().mockRejectedValue(new Error('Request expired')), deny: vi.fn() };
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

// UC-1 (A17): the dock badge and the notifications read the one predicate: an answered request is not counted, its banner
// closes at the answer, and its Allow once takes no action.
describe('an answered request', () => {
  it('is not counted in the badge, here or from another machine, and its banner closes at the answer', () => {
    const r = fakeRemote();
    const h = harness({ remote: r });
    const request = item(CHARTER, 'permission', T);
    h.set(CHARTER, [request]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    h.set(CHARTER, [{ ...request, state: 'delivered' }]);
    expect(posted()[0].close).toHaveBeenCalledOnce();
    expect(os.badge).toHaveBeenLastCalledWith(null, 0);
    const remote = item('app-mini', 'permission', T);
    r.session('app-mini', [remote]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    r.session('app-mini', [{ ...remote, state: 'delivered' }]);
    expect(posted()[1].close).toHaveBeenCalledOnce();
    expect(os.badge).toHaveBeenLastCalledWith(null, 0);
  });

  it('takes no action at its banner’s Allow once or Deny', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, value: { event: { kind: 'permission.requested', toolName: 'Read', input: { file_path: '/made/up.md' } } } });
    const view = fakeSpineView();
    const request = item(CHARTER, 'permission', T);
    view.setAttention(CHARTER, [{ ...request, state: 'delivered' }]);
    const actions = notificationActions({ dispatch, view });
    expect(await actions.offer(request)).toEqual({ allowOnce: false, deny: false, body: null });
    await expect(actions.allow(request)).rejects.toThrow();
    await expect(actions.deny(request)).rejects.toThrow();
    expect(dispatch.mock.calls.some(([, name]) => name === 'session.answer')).toBe(false);
  });
});

// UX wave U1a §H (M6, A14): a permission's notification carries what the one rule admits for the request it reads, in the
// order Allow once, Deny; a short command is its body; each button's index reaches its own act, read again at the press.
describe('a permission’s notification buttons', () => {
  const ev = (toolName: string, input: Record<string, unknown>) => ({ kind: 'permission.requested', requestId: 'req-x', toolName, input });
  const READ = ev('Read', { file_path: '/w/notes.txt' });
  const SHORT = ev('Bash', { command: 'make build' });
  const LONG = ev('Bash', { command: `echo ${'x'.repeat(200)}` });
  const EDIT = ev('Edit', { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' });
  // the engine host: the request as it now stands, and every answer delivered
  const host = (event: unknown) =>
    vi.fn<(owner: string, name: string, input?: unknown) => Promise<unknown>>(async (_owner, name) => (name === 'session.pendingRequest' ? { ok: true, value: { event } } : { ok: true, value: { outcome: 'delivered' } }));
  const answers = (dispatch: ReturnType<typeof host>) => dispatch.mock.calls.filter(([, name]) => name === 'session.answer').map(([, , input]) => (input as { answer: unknown }).answer);
  const raise = async (event: unknown, kind: 'permission' | 'question' = 'permission') => {
    const dispatch = host(event);
    const h = harness({ dispatch: dispatch as unknown as HostDispatch });
    const request = item(CHARTER, kind, T);
    h.set(CHARTER, [request]);
    await vi.waitFor(() => expect(posted()).toHaveLength(1));
    return { h, dispatch, request, banner: posted()[0]! };
  };
  const ALLOW = { kind: 'permission', decision: 'allow', scope: 'once' };
  const DENY = { kind: 'permission', decision: 'deny' };

  it.each([
    ['a read', READ, ['Allow once', 'Deny'], 'permission for app-charter'],
    ['a short command', SHORT, ['Allow once', 'Deny'], 'make build'],
    ['a long command', LONG, ['Deny'], 'permission for app-charter'],
    ['an edit', EDIT, ['Deny'], 'permission for app-charter'],
  ])('sends %s its buttons and its body', async (_, event, actions, body) => {
    const { banner } = await raise(event);
    expect(banner.options.actions).toEqual(actions);
    expect(banner.options.body).toBe(body);
  });

  it('sends a question no button, reading no request', async () => {
    const { banner, dispatch } = await raise(READ, 'question');
    expect(banner.options.actions).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('with Allow once and Deny, index 0 allows once and index 1 denies, each once', async () => {
    const first = await raise(READ);
    first.banner.fire('action', 0);
    await vi.waitFor(() => expect(answers(first.dispatch)).toEqual([ALLOW]));
    first.h.stop();
    os.instances = [];
    const second = await raise(SHORT);
    second.banner.fire('action', 1);
    await vi.waitFor(() => expect(answers(second.dispatch)).toEqual([DENY]));
  });

  it('with Deny alone, index 0 denies and no other index acts', async () => {
    const { banner, dispatch } = await raise(EDIT);
    banner.fire('action', 1);
    banner.fire('action', 0);
    await vi.waitFor(() => expect(answers(dispatch)).toEqual([DENY]));
  });

  it('a press after the request was answered elsewhere answers nothing, opens the session and says so', async () => {
    const { h, dispatch, request, banner } = await raise(READ);
    h.set(CHARTER, []); // answered in the pane: the banner closes, and a press may still arrive
    expect(banner.close).toHaveBeenCalledOnce();
    banner.fire('action', 1);
    await vi.waitFor(() => expect(h.failure).toHaveBeenCalledOnce());
    expect(answers(dispatch)).toEqual([]);
    expect(brought()).toEqual([[null, 'bring']]);
    expect(h.navigate).toHaveBeenCalledWith({ appSessionId: CHARTER, attentionId: request.id, source: 'notification' });
  });

  it('posts the notification with no button when the request cannot be read', async () => {
    const dispatch = vi.fn(async () => ({ ok: false, error: { code: 'internal', message: 'no host' } }));
    const h = harness({ dispatch: dispatch as unknown as HostDispatch });
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    await vi.waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]!.options.actions).toBeUndefined();
    expect(posted()[0]!.options.body).toBe('permission for app-charter');
  });
});

// P5 O9 M6 (the owner's Q5): a terminal session's prompt shows in the terminal the owner may be looking at, so its items
// join Needs you and the dock badge, with a toast while MAWS is focused, but raise no system notification and no bounce.
describe('a terminal session’s requests', () => {
  const TERMINAL = 'app-terminal' as AppSessionId;
  const held = (v: FakeSpineView) => v.putRecord(record(TERMINAL, { title: { text: 'In the terminal', source: 'user' }, holder: { kind: 'terminal', pid: 4242 } }));
  // a request its bridge raised: the lane A list's item (src/services/lane-a/attention.ts)
  const raised = (kind: 'permission' | 'question', request: string) => item(TERMINAL, kind, T, { id: `lane-a:eng-1:${request}` as AttentionItem['id'] });

  it('post no notification and bounce nothing while unfocused, and still count in the badge', () => {
    const h = harness({ before: held });
    h.set(TERMINAL, [raised('permission', 'toolu_1')]);
    expect(posted()).toHaveLength(0);
    expect(bounces()).toHaveLength(0);
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    os.supported = false; // nor the fallback's bounce where OS notifications are unavailable
    h.set(TERMINAL, [raised('permission', 'toolu_1'), raised('question', 'toolu_2')]);
    expect(bounces()).toHaveLength(0);
  });

  it('silence only the prompts the terminal shows: its session’s other items notify as any session’s', () => {
    const h = harness({ before: held });
    h.set(TERMINAL, [item(TERMINAL, 'async_input', T)]);
    expect(posted()).toHaveLength(1);
  });

  it('are told in-app while MAWS is focused, as any session’s', () => {
    const h = harness({ focused: true, before: held });
    h.set(TERMINAL, [raised('permission', 'toolu_1')]);
    expect(posted()).toHaveLength(0);
    expect(emitted(h.emit, 'attention.notified')).toMatchObject([{ appSessionId: TERMINAL, delivery: 'in-app' }]);
  });
});

// P5 O7 M6 ("Counting without a record"): an item of a session on another machine is raised as a local one is, once per
// item for the whole app (main raises it, not a window), keyed by its address; a greyed machine raises none and counts
// in no badge; a click opens the session on its machine.
describe('another machine’s items', () => {
  const REMOTE_APP = 'app-mini';
  const remoteItem = (kind: AttentionItem['kind'], at = T) => item(REMOTE_APP, kind, at);

  it('raises one notification per remote item, titled by its machine and row, however often its feed says it (a snapshot again after a reconnect, both windows unfocused)', () => {
    const r = fakeRemote();
    r.titles.set(`${MINI}/${REMOTE_APP}`, 'Nightly build');
    const h = harness({ remote: r });
    r.snapshot([]);
    const asked = remoteItem('permission');
    r.session(REMOTE_APP, [asked]);
    r.session(REMOTE_APP, [asked]);
    r.grey();
    r.snapshot([asked]); // the reconnect's snapshot
    expect(posted().map((n) => n.options)).toEqual([{ title: 'mini · Nightly build', body: `permission for ${REMOTE_APP}`, silent: true }]);
    posted()[0].fire('show');
    expect(emitted(h.emitFrom, 'attention.notified')).toEqual([]);
    expect(h.emitFrom.mock.calls).toEqual([[MINI, 'attention.notified', { appSessionId: REMOTE_APP, attentionId: asked.id, delivery: 'os', at: expect.any(String) }]]);
  });

  it('titles one whose machine lists no row by the machine alone', () => {
    const r = fakeRemote();
    harness({ remote: r });
    r.session(REMOTE_APP, [remoteItem('question')]);
    expect(posted()[0].options.title).toBe('mini');
  });

  it('raises none for a greyed machine, counting its items in no badge, and none again for them at its next snapshot; a new item then is raised', () => {
    const r = fakeRemote();
    const h = harness({ remote: r });
    const held = remoteItem('permission', '2026-09-28T08:00:00Z'); // in the first snapshot at startup: silent, as a restored item
    r.snapshot([held]);
    expect(posted()).toHaveLength(0);
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    r.grey();
    expect(os.badge).toHaveBeenLastCalledWith(null, 0);
    const meanwhile = remoteItem('question');
    r.session(REMOTE_APP, [held, meanwhile]); // what a greyed machine still holds raises nothing
    r.view.machine(MINI)!.greyed = true;
    expect(posted()).toHaveLength(0);
    expect(os.badge).toHaveBeenLastCalledWith(null, 0);
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    const fresh = remoteItem('plan', '2026-09-28T10:05:00Z');
    r.snapshot([held, fresh]);
    expect(posted().map((n) => n.options.body)).toEqual([`permission for ${CHARTER}`, `plan for ${REMOTE_APP}`]);
    expect(os.badge).toHaveBeenLastCalledWith(null, 2);
  });

  it('retracts a remote notification once its item is answered (here or on another device) or its machine leaves', () => {
    const r = fakeRemote();
    harness({ remote: r });
    const asked = remoteItem('permission');
    r.session(REMOTE_APP, [asked]);
    r.session(REMOTE_APP, []);
    expect(posted()[0].close).toHaveBeenCalledOnce();
    r.session('app-2', [item('app-2', 'question', T)]);
    r.gone();
    expect(posted()[1].close).toHaveBeenCalledOnce();
    expect(os.badge).toHaveBeenLastCalledWith(null, 0);
  });

  it('opens the session on its machine at a click: the navigation, with its bare ids, is the machine’s', () => {
    const r = fakeRemote();
    const h = harness({ remote: r });
    const asked = remoteItem('permission');
    r.session(REMOTE_APP, [asked]);
    posted()[0].fire('click');
    expect(brought()).toEqual([[null, 'bring']]);
    expect(h.navigate).toHaveBeenCalledExactlyOnceWith({ appSessionId: REMOTE_APP, attentionId: asked.id, source: 'notification' }, MINI);
  });

  it('tells one in-app from the machine while MAWS is focused, and offers no reply or Allow once (no action crosses here)', () => {
    const r = fakeRemote();
    const actions = { offer: vi.fn(async () => ({ allowOnce: true, deny: true, body: null })), allow: vi.fn(), deny: vi.fn(), reply: vi.fn() } as unknown as NotificationActions;
    const h = harness({ remote: r, focused: true, actions });
    r.session(REMOTE_APP, [remoteItem('permission')]);
    expect(posted()).toHaveLength(0);
    expect(h.emitFrom.mock.calls).toMatchObject([[MINI, 'attention.notified', { appSessionId: REMOTE_APP, delivery: 'in-app' }]]);
    h.state.focused = false;
    r.session(REMOTE_APP, [remoteItem('permission'), remoteItem('question')]);
    expect(posted().map((n) => n.options)).toEqual([{ title: 'mini', body: `question for ${REMOTE_APP}`, silent: true }]);
    expect(actions.offer).not.toHaveBeenCalled();
  });

  // Fix wave 1: startup silence is this Mac's own clock, never the machine's `createdAt`
  it('silences a machine’s first snapshot at startup whatever its items’ clocks say, and raises every later item once whatever they say', () => {
    const r = fakeRemote();
    harness({ remote: r });
    const ahead = remoteItem('permission', '2026-09-28T10:00:00Z'); // a machine an hour ahead
    const behind = remoteItem('question', '2026-09-28T08:00:00Z'); // one an hour behind
    r.snapshot([ahead, behind]);
    expect(posted()).toHaveLength(0);
    expect(os.badge).toHaveBeenLastCalledWith(null, 1);
    const fresh = item('app-2', 'permission', '2026-09-28T08:00:01Z'); // raised now, stamped an hour behind
    r.session('app-2', [fresh]);
    const early = item('app-3', 'question', '2026-09-28T10:00:01Z'); // raised now, stamped an hour ahead
    r.session('app-3', [early]);
    expect(posted().map((n) => n.options.body)).toEqual(['permission for app-2', 'question for app-3']);
    r.snapshot([ahead, behind, fresh, early]); // a reconnect's snapshot re-announces nothing seen
    expect(posted()).toHaveLength(2);
  });

  it('raises the first snapshot’s items of a machine first reached after the startup window (unreachable at launch)', async () => {
    const { REMOTE_STARTUP_SILENCE_MS } = await import('./notifier');
    const r = fakeRemote();
    const h = harness({ remote: r });
    h.state.clock += REMOTE_STARTUP_SILENCE_MS + 1;
    r.snapshot([remoteItem('permission', '2026-09-28T08:00:00Z')]);
    expect(posted().map((n) => n.options.body)).toEqual([`permission for ${REMOTE_APP}`]);
  });
});

