// The machines' attention as main follows it (P5 O7 M6, "The feed"; Interfaces §K's `remote.attention`, §R's `attention`):
// one machine-wide feed per RL2 link while it is up, its snapshot said as `remote.attention`, each change as the session's
// `attention.changed` from the machine; a machine offline keeps its items greyed until its next snapshot; an endpoint
// older than M6 has no feed on that channel; a link replaced or dropped leaves no feed behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI, type FakeSub } from '../../../test/lane-b/fake-link';
import { item } from '../../../test/support/builders';
import { createRemoteAttention, type RemoteAttentionChange } from './remote-attention';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const T = '2026-11-01T10:00:00.000Z';
const STUDIO = 'StudioMachineRef000000' as MachineRef;
const EPOCH = 'attention:boot-1';

function lab() {
  const links = new Map<MachineRef, FakeLink>();
  const add = (machine: MachineRef, peers = ['rl2.executor.machine', 'rl2.feeds']) => {
    const link = new FakeLink(machine);
    link.peers = peers;
    links.set(machine, link);
    return link;
  };
  const mini = add(MINI);
  const roster = new Set<(machines: readonly MachineRef[]) => void>();
  const emitted: Array<{ machine: MachineRef; name: EventName; payload: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const changes: RemoteAttentionChange[] = [];
  const unfed: MachineRef[] = [];
  /** What the machine's sessions' streams hold (fix wave 3). */
  const streams = new Map<MachineRef, AttentionItem[]>();
  const attention = createRemoteAttention({
    unfed: (machine) => void unfed.push(machine),
    streamItems: (machine) => streams.get(machine) ?? [],
    remote: (machine) => links.get(machine) ?? null,
    onRemote: (listener) => (roster.add(listener), () => void roster.delete(listener)),
    emit: (machine, name, payload) => {
      const checked = validateEventPayload(name, payload);
      if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
      emitted.push({ machine, name, payload: payload as Record<string, unknown> });
    },
    timing: { feedRetryMs: [1000, 30_000] },
    log: (line) => void logs.push(line),
  });
  attention.onChange((change) => void changes.push(change));
  const rosterIs = (...machines: MachineRef[]) => {
    for (const listener of [...roster]) listener(machines);
  };
  const feeds = (link: FakeLink = mini) => link.subs.filter((s) => s.request.feed === 'attention');
  const feed = (link: FakeLink = mini) => link.open().find((s) => s.request.feed === 'attention')!;
  /** An opening: the `subbed` and the snapshot's value, the filtered `attention.list`. */
  const snapshot = (items: AttentionItem[], sub: FakeSub = feed(), epoch = EPOCH) => {
    sub.sink.subbed('snapshot', { epoch, seq: 0 });
    sub.sink.snapshot({ epoch, seq: 0 }, items);
  };
  let seq = 0;
  const change = (app: string, items: AttentionItem[], sub: FakeSub = feed()) => sub.sink.event({ epoch: EPOCH, seq: ++seq }, { appSessionId: app, items });
  const said = (name: EventName, machine: MachineRef = MINI) => emitted.filter((e) => e.name === name && e.machine === machine).map((e) => e.payload);
  return { links, add, mini, attention, emitted, logs, changes, unfed, streams, rosterIs, feeds, feed, snapshot, change, said };
}

const permission = (app: string, at = T) => item(app, 'permission', at);
const question = (app: string, at = T) => item(app, 'question', at);

describe('the attention feed', () => {
  it('opens one machine-wide feed per up link at the roster, says its snapshot as `remote.attention` and each change as the session’s `attention.changed`', () => {
    const l = lab();
    l.rosterIs(MINI);
    l.rosterIs(MINI);
    expect(l.feeds().map((s) => s.request)).toEqual([{ feed: 'attention' }]);
    const a = permission('app-1');
    const b = question('app-2');
    l.snapshot([a, b]);
    expect(l.said('remote.attention')).toEqual([{ machine: MINI, items: [a, b], greyed: false }]);
    expect(l.attention.machine(MINI)).toMatchObject({ machine: MINI, name: 'mini', greyed: false });
    expect([...l.attention.machine(MINI)!.sessions]).toEqual([['app-1', [a]], ['app-2', [b]]]);

    l.change('app-1', []);
    const c = question('app-3');
    l.change('app-3', [c]);
    expect(l.said('attention.changed')).toEqual([{ appSessionId: 'app-1', items: [] }, { appSessionId: 'app-3', items: [c] }]);
    expect([...l.attention.machine(MINI)!.sessions]).toEqual([['app-2', [b]], ['app-3', [c]]]);
    expect(l.changes).toEqual([
      { machine: MINI, kind: 'snapshot' },
      { machine: MINI, kind: 'session', app: 'app-1' },
      { machine: MINI, kind: 'session', app: 'app-3' },
    ]);
  });

  it('opens the feed when a link that was not up at the roster comes up, and asks none of a peer without `rl2.feeds`', () => {
    const l = lab();
    const studio = l.add(STUDIO, ['rl2.executor.machine']);
    l.mini.set('connecting', null);
    l.rosterIs(MINI, STUDIO);
    expect(l.feeds()).toEqual([]);
    l.mini.set('up');
    expect(l.feeds()).toHaveLength(1);
    studio.set('down', null);
    studio.set('up');
    expect(l.feeds(studio)).toEqual([]);
    expect(l.attention.machine(STUDIO)).toMatchObject({ greyed: false, sessions: new Map() });
  });

  it('greys a machine’s items when its link goes down, says them greyed, and restores them only at the next snapshot', () => {
    const l = lab();
    l.rosterIs(MINI);
    const a = permission('app-1');
    l.snapshot([a]);
    l.mini.set('down', null);
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [a], greyed: true });
    expect(l.attention.machine(MINI)!.greyed).toBe(true);
    expect(l.changes.at(-1)).toEqual({ machine: MINI, kind: 'greyed' });
    // the link's subscription is kept across its channels (the link sends it again): no second feed
    l.mini.set('up');
    expect(l.feeds()).toHaveLength(1);
    expect(l.attention.machine(MINI)!.greyed).toBe(true);
    const b = question('app-2');
    l.snapshot([a, b]);
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [a, b], greyed: false });
    expect(l.attention.machine(MINI)!.greyed).toBe(false);
  });

  it('opens a feed the endpoint ended `behind` again at once, from a snapshot, and one ended `unavailable` on a doubling backoff', () => {
    const l = lab();
    l.rosterIs(MINI);
    l.snapshot([permission('app-1')]);
    l.feed().sink.ended('behind');
    expect(l.feeds()).toHaveLength(1);
    vi.advanceTimersByTime(0);
    expect(l.feeds()).toHaveLength(2);
    l.snapshot([]);
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [], greyed: false });

    l.feed().sink.ended('unavailable');
    vi.advanceTimersByTime(999);
    expect(l.feeds()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(l.feeds()).toHaveLength(3);
    l.feed().sink.ended('unavailable');
    vi.advanceTimersByTime(1999);
    expect(l.feeds()).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(l.feeds()).toHaveLength(4);
  });

  it('takes an endpoint older than M6 (`not-offered`) as no feed on that channel: no retry, no error, its items said gone; the next channel asks again', () => {
    const l = lab();
    l.rosterIs(MINI);
    l.snapshot([permission('app-1')]);
    l.feed().sink.ended('not-offered');
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [], greyed: false });
    vi.advanceTimersByTime(60_000);
    l.mini.setCaps({ ...l.mini.caps()!, stateVersion: 3 }); // a caps refresh on the same channel
    l.mini.set('up', 'relay'); // a carrier change on the same channel's peer
    expect(l.feeds()).toHaveLength(1);
    expect(l.logs.filter((line) => line.includes('not-offered'))).toHaveLength(1);
    // a channel to another peer (the endpoint upgraded within the grace): its h2 list is another
    l.mini.peers = [...l.mini.peers];
    l.mini.setCaps({ ...l.mini.caps()!, stateVersion: 4 });
    expect(l.feeds()).toHaveLength(2);
    // and one after a loss
    l.feed().sink.ended('not-offered');
    l.mini.set('down', null);
    l.mini.set('up');
    expect(l.feeds()).toHaveLength(3);
  });

  it('closes the old link’s feed when the roster makes the machine’s link again, ignoring what it still says, and keeps the items greyed until the new feed’s snapshot', () => {
    const l = lab();
    l.rosterIs(MINI);
    const a = permission('app-1');
    l.snapshot([a]);
    const old = l.feed();
    const next = new FakeLink(MINI);
    next.peers = ['rl2.feeds'];
    l.links.set(MINI, next);
    l.rosterIs(MINI);
    expect(old.closed).toBe(true);
    expect(l.feeds(next)).toHaveLength(1);
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [a], greyed: true });
    old.sink.event({ epoch: EPOCH, seq: 99 }, { appSessionId: 'app-9', items: [question('app-9')] });
    old.sink.ended('behind');
    vi.advanceTimersByTime(0);
    l.mini.set('down', null);
    expect(l.said('attention.changed')).toEqual([]);
    expect(l.feeds(l.mini)).toHaveLength(1);
    expect(l.attention.machine(MINI)!.greyed).toBe(true);
    l.snapshot([], l.feed(next));
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [], greyed: false });
  });

  it('closes the feed of a machine the roster dropped and says its items gone', () => {
    const l = lab();
    l.rosterIs(MINI);
    l.snapshot([permission('app-1')]);
    l.links.delete(MINI);
    l.rosterIs();
    expect(l.mini.open()).toEqual([]);
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [], greyed: false });
    expect(l.attention.machine(MINI)).toBeNull();
    expect(l.changes.at(-1)).toEqual({ machine: MINI, kind: 'gone' });
  });

  it('leaves out a change or a session’s snapshot items that don’t read, logging them, and the rest goes on', () => {
    const l = lab();
    l.rosterIs(MINI);
    const a = permission('app-1');
    l.snapshot([a, { ...question('app-2'), kind: 'unknown-kind' } as unknown as AttentionItem]);
    expect(l.said('remote.attention')).toEqual([{ machine: MINI, items: [a], greyed: false }]);
    l.change('app-1', [{ nope: true } as unknown as AttentionItem]);
    l.feed().sink.event({ epoch: EPOCH, seq: 50 }, 'not an object');
    expect(l.said('attention.changed')).toEqual([]);
    expect(l.logs.filter((line) => line.includes('doesn’t read'))).toHaveLength(3);
  });

  it('closes every feed at stop', () => {
    const l = lab();
    const studio = l.add(STUDIO);
    l.rosterIs(MINI, STUDIO);
    l.attention.stop();
    expect([...l.mini.open(), ...studio.open()]).toEqual([]);
    l.rosterIs(MINI, STUDIO);
    l.mini.set('down', null);
    expect(l.feeds()).toHaveLength(1);
    expect(l.emitted).toEqual([]);
  });

  // fix wave 1: the feed speaks for the machine's sessions while it follows
  it('follows a machine while its feed is open or opening again, and tells a page a session’s items, or every machine’s, from its cache', () => {
    const l = lab();
    expect(l.attention.follows(MINI)).toBe(false);
    l.rosterIs(MINI);
    expect(l.attention.follows(MINI)).toBe(true); // opening: its snapshot will speak
    const a = permission('app-1');
    l.snapshot([a]);
    l.attention.replay(MINI, 'app-1');
    l.attention.replay(MINI, 'app-2');
    expect(l.said('attention.changed')).toEqual([{ appSessionId: 'app-1', items: [a] }, { appSessionId: 'app-2', items: [] }]);
    l.attention.sayAgain();
    expect(l.said('remote.attention')).toEqual([{ machine: MINI, items: [a], greyed: false }, { machine: MINI, items: [a], greyed: false }]);
    l.feed().sink.ended('unavailable');
    expect(l.attention.follows(MINI)).toBe(true); // opening again on the backoff
    expect(l.unfed).toEqual([]);
  });

  it('stops following at a channel with no feed, saying so (`unfed`) so the sessions’ streams speak again; it tells a page nothing then, neither a session nor an announcement', () => {
    const l = lab();
    l.add(STUDIO, ['rl2.executor.machine']);
    l.rosterIs(MINI, STUDIO);
    expect(l.attention.follows(STUDIO)).toBe(false);
    expect(l.unfed).toEqual([STUDIO]); // asked for none
    l.snapshot([permission('app-1')]);
    l.feed().sink.ended('not-offered');
    expect(l.attention.follows(MINI)).toBe(false);
    expect(l.unfed).toEqual([STUDIO, MINI]);
    const fallback = question('app-1');
    l.streams.set(MINI, [fallback]); // what the session's stream holds, said again on `unfed`
    const said = l.emitted.length;
    l.attention.replay(MINI, 'app-1');
    l.attention.sayAgain();
    // the ended feed's emptied cache speaks for nobody: the streams' items stand for the machine
    expect(l.emitted.slice(said)).toEqual([{ machine: MINI, name: 'remote.attention', payload: { machine: MINI, items: [fallback], greyed: false } }]);
  });

  // fix wave 3 (the milestone review): an ended feed's machine greys and restores the streams' items, never its own empty cache
  it('greys the streams’ items when the link of a machine whose feed ended goes down, and lifts them at `up` with no feed', () => {
    const l = lab();
    l.rosterIs(MINI);
    l.snapshot([permission('app-1')]);
    const fallback = permission('app-1');
    l.streams.set(MINI, [fallback]);
    l.feed().sink.ended('not-offered');
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [fallback], greyed: false });
    l.mini.set('down', null);
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [fallback], greyed: true });
    expect(l.attention.machine(MINI)!.greyed).toBe(true);
    l.mini.peers = ['rl2.executor.machine']; // the next channel's peer reads no feeds either
    l.mini.set('up');
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [fallback], greyed: false });
    expect(l.feeds()).toHaveLength(1);
  });

  it('lets the feed go for its channel when a change or a snapshot couldn’t be carried (`omitted`), giving the machine back to its streams, once', () => {
    const l = lab();
    l.rosterIs(MINI);
    l.snapshot([permission('app-1')]);
    const fallback = permission('app-1');
    l.streams.set(MINI, [fallback]);
    const sub = l.feed();
    sub.sink.event({ epoch: EPOCH, seq: 7 }, { omitted: 'too-large', bytes: 5 * 1024 * 1024 });
    expect(sub.closed).toBe(true);
    expect(l.attention.follows(MINI)).toBe(false);
    expect(l.unfed).toEqual([MINI]);
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [fallback], greyed: false });
    expect(l.logs.filter((line) => line.includes('too large'))).toHaveLength(1);
    l.mini.setCaps({ ...l.mini.caps()!, stateVersion: 9 }); // the same channel: no reopening
    vi.advanceTimersByTime(60_000);
    expect(l.feeds()).toHaveLength(1);
    // the next channel asks again, from a snapshot; one that is itself omitted ends it the same way
    l.mini.set('down', null);
    l.mini.set('up');
    expect(l.feeds()).toHaveLength(2);
    l.feed().sink.subbed('snapshot', { epoch: EPOCH, seq: 0 });
    l.feed().sink.snapshot({ epoch: EPOCH, seq: 0 }, { omitted: 'too-large', bytes: 5 * 1024 * 1024 });
    expect(l.attention.follows(MINI)).toBe(false);
    expect(l.unfed).toEqual([MINI, MINI]);
  });

  // fix wave 4: the machine's effective items, which the badge and the notifier read
  it('exposes the streams’ items as the machine’s once its feed no longer speaks, and says when they change; the feed’s again at its snapshot', () => {
    const l = lab();
    l.rosterIs(MINI);
    const a = permission('app-1');
    l.snapshot([a]);
    l.streams.set(MINI, [a]);
    l.attention.streamsChanged(MINI, 'app-1');
    expect(l.changes.filter((c) => c.kind === 'session')).toEqual([]); // fed: the feed speaks
    l.feed().sink.ended('not-offered');
    expect([...l.attention.machine(MINI)!.sessions]).toEqual([['app-1', [a]]]);
    l.streams.set(MINI, []);
    l.attention.streamsChanged(MINI, 'app-1');
    expect(l.changes.at(-1)).toEqual({ machine: MINI, kind: 'session', app: 'app-1' });
    expect(l.attention.machine(MINI)!.sessions.size).toBe(0);
    // a feed back on the next channel speaks once its snapshot came
    l.streams.set(MINI, [a]);
    l.mini.set('down', null);
    l.mini.set('up');
    expect(l.attention.follows(MINI)).toBe(true);
    expect([...l.attention.machine(MINI)!.sessions]).toEqual([['app-1', [a]]]);
    const b = question('app-2');
    l.snapshot([b]);
    expect([...l.attention.machine(MINI)!.sessions]).toEqual([['app-2', [b]]]);
  });

  it('keeps saying the streams’ items, greyed, at a page’s announcement while a returning feed has not sent its snapshot', () => {
    const l = lab();
    l.rosterIs(MINI);
    const a = permission('app-1');
    l.snapshot([a]);
    l.streams.set(MINI, [a]);
    l.feed().sink.ended('not-offered');
    l.mini.set('down', null);
    l.mini.set('up'); // a new channel: the feed asked again
    expect(l.attention.follows(MINI)).toBe(true);
    l.attention.sayAgain();
    expect(l.said('remote.attention').at(-1)).toEqual({ machine: MINI, items: [a], greyed: true });
  });
});

