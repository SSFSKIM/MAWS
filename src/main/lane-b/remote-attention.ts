// The attention of every RL2 machine (P5 O7 M6, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The feed" and
// "Counting without a record"; Interfaces §K's `remote.attention`, §R's `attention`): the items of the sessions this
// member views on each machine, which the sidebar's Needs you, ⌘⇧J, the dock's badge and the notifier read beside this
// Mac's own.
//
// - One feed per link, machine-wide (`sub {feed: 'attention'}`, no session), opened while the link is `up` and its
//   channel's peer listed `rl2.feeds`. The link keeps the subscription across its channels and sends it again on each, so
//   every reconnect opens from a snapshot; the link drops a repeated `ev` by `(epoch, seq)`. A feed the endpoint ended
//   `behind` is opened again at once (a reconnect), one ended `unavailable` on a doubling backoff.
// - Each snapshot (the endpoint's `attention.list`, filtered to the member's sessions) replaces the machine's items and is
//   said as `remote.attention {machine, items, greyed: false}`; each `ev {appSessionId, items}` replaces one session's
//   and is said as that session's `attention.changed`, from the machine (`emitFrom`).
// - A machine whose link goes `down` keeps its items greyed: said again as `remote.attention {…, greyed: true}`, left out
//   of the badge and raising no notification, until its next snapshot. A link the roster makes again keeps them greyed
//   the same way until the new link's snapshot, its old feed closed and whatever it still says ignored.
// - An endpoint older than M6 answers the feed `not-offered` (and one without `rl2.feeds` is asked for none): that
//   channel has no feed. Nothing is retried on it and nothing surfaced; the machine's items are said gone, and the next
//   channel (a different peer's `h2` list, or a new one after the link had none) asks again. Any other end but `behind`
//   and `unavailable` is taken the same way.
// - A machine the roster dropped is said gone: no items.
// - Fix wave 1: while a machine's feed follows (open, or opening again), it is its sessions' attention: their streams
//   (./remote-session.ts) say none of theirs, which are the broker's items alone and would overwrite the feed's whole
//   list, and a page's `session.get` is told the session's items from here. When the channel has no feed, the streams
//   say theirs again (`unfed`). A page that announces itself is told every machine's state again (`sayAgain`).
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { REGISTRY } from '@shared/ipc/registry';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { codecOf } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import type { RemoteLink, Subscription } from '../machines/remote/link';
import type { RemoteCheckoutTiming } from './remote-checkout';

/** One machine's attention as its feed last said it. */
export interface RemoteMachineAttention {
  readonly machine: MachineRef;
  /** The link's name for the machine, for a notification's title. */
  readonly name: string;
  /** Offline (its link `down`, or made again) since its last snapshot: out of the badge, raising nothing. */
  readonly greyed: boolean;
  /** Each session's items, by its bare id; a session with none is absent. */
  readonly sessions: ReadonlyMap<string, readonly AttentionItem[]>;
}
/** What changed: every session of the machine (a snapshot), one session (an `ev`), its greying, or the machine left. */
export type RemoteAttentionChange = { machine: MachineRef; kind: 'snapshot' | 'greyed' | 'gone' } | { machine: MachineRef; kind: 'session'; app: string };

export interface RemoteAttention {
  machines(): readonly RemoteMachineAttention[];
  machine(machine: MachineRef): RemoteMachineAttention | null;
  /**
   * Fix wave 1: whether the machine's feed is its sessions' attention now (open, or opening again), so a session's
   * stream says none of its own: the feed's items are the machine's whole list, the stream's the broker's alone.
   */
  follows(machine: MachineRef): boolean;
  /** Fix wave 1: a session's items said again from the feed (a page's `session.get`), while the feed follows. */
  replay(machine: MachineRef, app: string): void;
  /** Fix wave 1: every machine's state said again (a page that just announced itself). */
  sayAgain(): void;
  /** Heard after each change has been said to the renderer. */
  onChange(listener: (change: RemoteAttentionChange) => void): () => void;
  /** Every feed closed and every link let go. */
  stop(): void;
}

export interface RemoteAttentionDeps {
  /** Machines.remote. */
  remote(machine: MachineRef): RemoteLink | null;
  /** Machines.onRemote: the roster, each time links are made or closed. */
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;
  /** emitFrom. */
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  timing?: Partial<Pick<RemoteCheckoutTiming, 'feedRetryMs'>>;
  /** Fix wave 1: the machine's feed stopped following (no feed on this channel): its sessions' streams speak again. */
  unfed?(machine: MachineRef): void;
  log(line: string): void;
}

type Feed = {
  link: RemoteLink;
  sub: Subscription | null;
  timer: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
  /** The `h2` list of the channel that has no feed (an endpoint older than M6): not asked again while it is current. */
  refusedOn: readonly string[] | null;
  sessions: Map<string, AttentionItem[]>;
  greyed: boolean;
  /** A `remote.attention` was said for the machine: its state goes on being said. */
  said: boolean;
  off(): void;
};

/** Ends after which the feed is opened again on the same channel. */
const REOPENS: ReadonlySet<string> = new Set(['behind', 'unavailable']);
const events = codecOf(REGISTRY);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createRemoteAttention(deps: RemoteAttentionDeps): RemoteAttention {
  const retryMs = deps.timing?.feedRetryMs ?? [1000, 30_000];
  const feeds = new Map<MachineRef, Feed>();
  const listeners = new Set<(change: RemoteAttentionChange) => void>();
  let stopped = false;

  const changed = (change: RemoteAttentionChange) => {
    for (const listener of [...listeners]) listener(change);
  };
  const viewOf = (machine: MachineRef, feed: Feed): RemoteMachineAttention => ({ machine, name: feed.link.name, greyed: feed.greyed, sessions: feed.sessions });

  /** The machine's whole state to the renderer. */
  function sayAll(machine: MachineRef, feed: Feed): void {
    feed.said = true;
    deps.emit(machine, 'remote.attention', { machine, items: [...feed.sessions.values()].flat(), greyed: feed.greyed });
  }

  /** A session's items as this build reads them, or null (logged) when they don't read. */
  function read(feed: Feed, body: unknown): { app: string; items: AttentionItem[] } | null {
    const payload = events.readEventPayload('attention.changed', body);
    if (!payload.ok) {
      deps.log(`lane B: ${feed.link.name}: an attention change doesn’t read; left out`);
      return null;
    }
    return { app: payload.value.appSessionId, items: payload.value.items };
  }

  /** The machine's items, as a snapshot says them: each session's read on its own, one that doesn't read left out. */
  function snapshot(machine: MachineRef, feed: Feed, value: unknown): void {
    if (!Array.isArray(value)) return deps.log(`lane B: ${feed.link.name}: an attention snapshot doesn’t read; left out`);
    const grouped = new Map<unknown, unknown[]>();
    for (const raw of value) {
      const app = isObject(raw) ? raw.appSessionId : undefined;
      grouped.set(app, [...(grouped.get(app) ?? []), raw]);
    }
    feed.sessions = new Map();
    for (const [app, items] of grouped) {
      const session = read(feed, { appSessionId: app, items });
      if (session !== null && session.items.length > 0) feed.sessions.set(session.app, session.items);
    }
    feed.greyed = false;
    sayAll(machine, feed);
    changed({ machine, kind: 'snapshot' });
  }

  /** The channel has no feed: the machine's items can't be followed, so they are said gone. */
  function noFeed(machine: MachineRef, feed: Feed): void {
    feed.refusedOn = feed.link.peerCapabilities();
    feed.greyed = false;
    if (feed.said || feed.sessions.size > 0) {
      feed.sessions = new Map();
      sayAll(machine, feed);
      changed({ machine, kind: 'snapshot' });
    }
    deps.unfed?.(machine);
  }

  function subscribe(machine: MachineRef, feed: Feed): void {
    const { link } = feed;
    const mine = () => !stopped && feeds.get(machine) === feed && feed.sub === sub;
    const sub: Subscription = link.subscribe(
      { feed: 'attention' },
      {
        subbed: () => {
          if (mine()) feed.backoffMs = retryMs[0];
        },
        snapshot: (_at, value) => {
          if (mine()) snapshot(machine, feed, value);
        },
        event: (_at, body) => {
          if (!mine()) return;
          const session = read(feed, body);
          if (session === null) return;
          if (session.items.length > 0) feed.sessions.set(session.app, session.items);
          else feed.sessions.delete(session.app);
          deps.emit(machine, 'attention.changed', { appSessionId: session.app as AppSessionId, items: session.items });
          changed({ machine, kind: 'session', app: session.app });
        },
        paused: () => {},
        resumed: () => {},
        ended: (reason) => {
          if (!mine()) return;
          feed.sub = null;
          if (REOPENS.has(reason)) {
            const delay = reason === 'behind' ? 0 : feed.backoffMs;
            if (reason === 'unavailable') feed.backoffMs = Math.min(feed.backoffMs * 2, retryMs[1]);
            feed.timer = setTimeout(() => {
              feed.timer = null;
              ensure(machine, feed);
            }, delay);
            return;
          }
          deps.log(`lane B: the attention feed of ${link.name} ended ${reason}: no feed on this channel`);
          noFeed(machine, feed);
        },
      },
    );
    feed.sub = sub;
  }

  /** The feed opened if the link is up, its peer reads feeds and this channel hasn't refused one. */
  function ensure(machine: MachineRef, feed: Feed): void {
    if (stopped || feeds.get(machine) !== feed || feed.sub !== null || feed.timer !== null) return;
    const peers = feed.link.peerCapabilities();
    if (feed.link.state() !== 'up' || peers === null || peers === feed.refusedOn) return;
    if (!peers.includes('rl2.feeds')) return noFeed(machine, feed); // asked for none
    subscribe(machine, feed);
  }

  /** The link's state or caps moved: greyed at `down`, a channel gone forgets its refusal, and the feed opened if it can be. */
  function moved(machine: MachineRef, feed: Feed): void {
    if (stopped || feeds.get(machine) !== feed) return;
    if (feed.link.peerCapabilities() === null) feed.refusedOn = null;
    if (feed.link.state() === 'down' && !feed.greyed) {
      feed.greyed = true;
      if (feed.said || feed.sessions.size > 0) sayAll(machine, feed);
      changed({ machine, kind: 'greyed' });
    }
    ensure(machine, feed);
  }

  function close(feed: Feed): void {
    feed.off();
    if (feed.timer !== null) clearTimeout(feed.timer);
    feed.timer = null;
    const sub = feed.sub;
    feed.sub = null;
    sub?.close();
  }

  function attach(machine: MachineRef, link: RemoteLink, was: Feed | undefined): void {
    const feed: Feed = { link, sub: null, timer: null, backoffMs: retryMs[0], refusedOn: null, sessions: was?.sessions ?? new Map(), greyed: false, said: was?.said ?? false, off: () => {} };
    feeds.set(machine, feed);
    const offs = [link.onState(() => moved(machine, feed)), link.onCaps(() => moved(machine, feed))];
    feed.off = () => offs.forEach((off) => off());
    // A link made again: what the old one said stands, greyed, until the new one's snapshot.
    if (was !== undefined && (was.said || was.sessions.size > 0)) {
      feed.greyed = true;
      sayAll(machine, feed);
      changed({ machine, kind: 'greyed' });
    }
    moved(machine, feed);
  }

  function roster(machines: readonly MachineRef[]): void {
    if (stopped) return;
    for (const [machine, feed] of [...feeds]) {
      const link = machines.includes(machine) ? deps.remote(machine) : null;
      if (link === feed.link) continue;
      close(feed);
      feeds.delete(machine);
      if (link !== null) {
        attach(machine, link, feed);
        continue;
      }
      if (feed.said || feed.sessions.size > 0) deps.emit(machine, 'remote.attention', { machine, items: [], greyed: false });
      changed({ machine, kind: 'gone' });
    }
    for (const machine of machines) {
      const link = deps.remote(machine);
      if (link !== null && !feeds.has(machine)) attach(machine, link, undefined);
    }
  }
  const offRemote = deps.onRemote(roster);

  return {
    machines: () => [...feeds].map(([machine, feed]) => viewOf(machine, feed)),
    machine(machine) {
      const feed = feeds.get(machine);
      return feed === undefined ? null : viewOf(machine, feed);
    },
    follows(machine) {
      const feed = feeds.get(machine);
      return !stopped && feed !== undefined && (feed.sub !== null || feed.timer !== null);
    },
    replay(machine, app) {
      const feed = feeds.get(machine);
      if (stopped || feed === undefined || (feed.sub === null && feed.timer === null)) return;
      deps.emit(machine, 'attention.changed', { appSessionId: app as AppSessionId, items: feed.sessions.get(app) ?? [] });
    },
    sayAgain() {
      if (stopped) return;
      for (const [machine, feed] of feeds) if (feed.said) sayAll(machine, feed);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    stop() {
      stopped = true;
      offRemote();
      for (const feed of feeds.values()) close(feed);
      feeds.clear();
      listeners.clear();
    },
  };
}
