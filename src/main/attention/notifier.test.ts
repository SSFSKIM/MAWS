import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { Settings } from '@shared/ipc/schema';
import { item, project, record } from '../../../test/support/builders';
import { SETTINGS_DEFAULTS_V3 } from '@shared/settings/defaults';

// A stand-in for Electron's Notification: records every instance, and lets a test fire its events.
const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class FakeNotification {
    static supported = true;
    static instances: FakeNotification[] = [];
    static isSupported = () => FakeNotification.supported;
    listeners = new Map<string, Listener[]>();
    shown = 0;
    constructor(readonly options: { title: string; body: string; silent: boolean }) {
      FakeNotification.instances.push(this);
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }
    show() {
      this.shown += 1;
    }
    fire(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener({}, ...args);
    }
  }
  return { FakeNotification, bounce: vi.fn(), setBadge: vi.fn() };
});
vi.mock('electron', () => ({
  Notification: electron.FakeNotification,
  app: { dock: { bounce: electron.bounce, setBadge: electron.setBadge } },
}));

const { SessionReadModel } = await import('../sessions/read-model');
const { startNotifier } = await import('./notifier');
type Writer = import('../sessions/read-model').ReadModelWriter;

const CHARTER = 'app-charter' as AppSessionId;
const LOOSE = 'app-loose' as AppSessionId;
const T = '2026-09-28T10:00:00Z';
const SETTINGS: Settings = SETTINGS_DEFAULTS_V3;

function harness(opts: { focused?: boolean; settings?: Settings; before?: (w: Writer) => void } = {}) {
  const model = new SessionReadModel('index');
  let writer!: Writer;
  model.register({ start: (w) => ((writer = w), () => {}) });
  writer.observeProject(project('maws', 0, { name: 'MAWS' }));
  writer.observeRecord(record(CHARTER, { projectId: 'maws' as never, title: { text: 'Charter + research', source: 'user' } }));
  writer.observeRecord(record(LOOSE, { title: { text: 'Terminal workflow notes', source: 'user' } }));
  opts.before?.(writer);
  const state = { focused: opts.focused ?? false, settings: opts.settings ?? SETTINGS };
  const emit = vi.fn(() => true);
  const focusWindow = vi.fn();
  const navigate = vi.fn();
  const stop = startNotifier(model, { isFocused: () => state.focused, focusWindow, navigate, settings: () => state.settings, emit });
  const set = (appSessionId: AppSessionId, items: AttentionItem[]) => writer.observeAttention(appSessionId, items);
  return { model, writer, state, emit, focusWindow, navigate, stop, set };
}

const posted = () => electron.FakeNotification.instances;
const emitted = (emit: ReturnType<typeof vi.fn>, name: string) => emit.mock.calls.filter(([n]) => n === name).map(([, payload]) => payload);

beforeEach(() => {
  electron.FakeNotification.instances = [];
  electron.FakeNotification.supported = true;
  electron.bounce.mockClear();
  electron.setBadge.mockClear();
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
    const kinds = { approvals: false, questions: true, planReviews: false, errors: true, heldPeerMessages: true };
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
    expect(electron.bounce).toHaveBeenCalledTimes(2);
    expect(electron.bounce).toHaveBeenCalledWith('informational');
    expect(emitted(h.emit, 'attention.notified')).toEqual([
      { appSessionId: CHARTER, attentionId: first.id, delivery: 'fallback', at: expect.any(String) },
      { appSessionId: LOOSE, attentionId: next.id, delivery: 'fallback', at: expect.any(String) },
    ]);
    expect(log).toHaveBeenCalledExactlyOnceWith('notifier: OS notifications unavailable (Notifications are not allowed for this application); using dock bounce and toasts');
  });

  it('uses the fallback from the start when notifications are not supported', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    electron.FakeNotification.supported = false;
    const h = harness();
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    expect(posted()).toHaveLength(0);
    expect(electron.bounce).toHaveBeenCalledOnce();
    expect(emitted(h.emit, 'attention.notified')).toMatchObject([{ delivery: 'fallback' }]);
  });

  it('a click focuses the window and hands the navigation to the relay, which emits or queues it', () => {
    const h = harness();
    const read = item(CHARTER, 'permission', T);
    h.set(CHARTER, [read]);
    posted()[0].fire('click');
    expect(h.focusWindow).toHaveBeenCalledOnce();
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
    expect(electron.setBadge).toHaveBeenLastCalledWith('1');
    h.set(LOOSE, [item(LOOSE, 'question', T), item(LOOSE, 'plan', T)]);
    expect(electron.setBadge).toHaveBeenLastCalledWith('2');
    h.set(LOOSE, [item(LOOSE, 'held_peer_message', T)]); // tier 2 only
    expect(electron.setBadge).toHaveBeenLastCalledWith('1');
    h.set(CHARTER, [{ ...waiting, state: 'confirmed' }]);
    expect(electron.setBadge).toHaveBeenLastCalledWith('');
  });

  it('leaves out archived sessions and sessions with no record', () => {
    const h = harness();
    h.writer.observeRecord(record(CHARTER, { archived: true }));
    h.set(CHARTER, [item(CHARTER, 'permission', T)]);
    h.set('app-unknown' as AppSessionId, [item('app-unknown', 'permission', T)]);
    expect(electron.setBadge).toHaveBeenLastCalledWith('');
    expect(posted()).toHaveLength(0); // neither is in Needs you, so neither is announced
  });
});
