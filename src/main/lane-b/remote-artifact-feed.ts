// Every RL2 machine's artifact and library changes (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "Events that cross"; Interfaces §R's `artifacts`): `artifacts.changed` and `library.changed` are a machine's client
// events, which reach a device only on this machine-wide feed, said to the renderer as the machine's own (`emitFrom`), so
// its artifact and library stores follow another machine's as they follow this Mac's.
//
// - One feed per link (`sub {feed: 'artifacts'}`, no session), opened while the link is `up` and its channel's peer
//   listed `rl2.feeds` and `rl2.artifacts`. The link keeps it across its channels and sends it again on each; every
//   opening is a snapshot of nothing (the endpoint sends no `snap`).
// - A lost feed is a re-read (M6's rule): what changed while it didn't follow went untold. Its every opening (the first,
//   a new channel, a new epoch: the endpoint restarted, or the feed opened again here) is said as `artifacts.resync` from
//   the machine, the store's own reconcile hook (a view that mirrors the store reads it afresh): what changed before an
//   opening reached no one, the first's included (a view read the machine before its feed opened, or while its first
//   `subbed` was on a channel that was lost).
//   An event the channel couldn't carry (`{omitted: 'too-large'}`) is a lost feed, never a delivered one: the feed is let
//   go and opened again at once, and its reopening says the re-read. One the endpoint ended `behind` is opened again at
//   once, `unavailable` on a doubling backoff. Any other end (`not-offered`, `grade`, `removed`, `closed`) leaves that
//   channel without the feed; the next channel asks again.
// - An `artifacts.changed` names its artifact's machine (./../artifacts/machines.ts).
import { REGISTRY } from '@shared/ipc/registry';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { codecOf } from '@shared/ipc/validate';
import type { MachineRef } from '@shared/machine/ref';
import type { ArtifactMachines } from '../artifacts/machines';
import type { RemoteLink, Subscription } from '../machines/remote/link';

/** What the feed carries, said as the machine's own. */
export const ARTIFACT_FEED_EVENTS: ReadonlySet<string> = new Set(['artifacts.changed', 'library.changed']);

export interface RemoteArtifactFeedDeps {
  remote(machine: MachineRef): RemoteLink | null;
  onRemote(listener: (machines: readonly MachineRef[]) => void): () => void;
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  machines: ArtifactMachines;
  /** An `unavailable` end's first wait and its cap. */
  retryMs: readonly [number, number];
  log(line: string): void;
}

type Feed = {
  link: RemoteLink;
  sub: Subscription | null;
  timer: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
  /** The `h2` list of the channel that ended the feed for good: not asked again while it is current. */
  refusedOn: readonly string[] | null;
  off(): void;
};

const events = codecOf(REGISTRY);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export function createRemoteArtifactFeed(deps: RemoteArtifactFeedDeps): { stop(): void } {
  const feeds = new Map<MachineRef, Feed>();
  let stopped = false;

  function subscribe(machine: MachineRef, feed: Feed): void {
    const { link } = feed;
    const mine = () => !stopped && feeds.get(machine) === feed && feed.sub === sub;
    const sub: Subscription = link.subscribe(
      { feed: 'artifacts' },
      {
        subbed: () => {
          if (!mine()) return;
          feed.backoffMs = deps.retryMs[0];
          deps.emit(machine, 'artifacts.resync', {});
        },
        snapshot: () => {},
        event: (_at, body) => {
          if (!mine()) return;
          if (isObject(body) && body.omitted !== undefined) {
            deps.log(`lane B: the artifacts feed of ${link.name} lost a change too large to carry: opened again, its views read afresh`);
            feed.sub = null;
            sub.close();
            return ensure(machine, feed);
          }
          if (!isObject(body) || typeof body.name !== 'string' || !ARTIFACT_FEED_EVENTS.has(body.name)) return;
          const read = events.readEventPayload(body.name as EventName, body.payload);
          if (!read.ok) return deps.log(`lane B: ${link.name}: a ${body.name} on the artifacts feed doesn't read; left out`);
          if (body.name === 'artifacts.changed') deps.machines.record((read.value as EventPayload<'artifacts.changed'>).artifactId, machine);
          deps.emit(machine, body.name as EventName, read.value as never);
        },
        paused: () => {},
        resumed: () => {},
        ended: (reason) => {
          if (!mine()) return;
          feed.sub = null;
          if (reason === 'behind' || reason === 'unavailable') {
            const delay = reason === 'behind' ? 0 : feed.backoffMs;
            if (reason === 'unavailable') feed.backoffMs = Math.min(feed.backoffMs * 2, deps.retryMs[1]);
            feed.timer = setTimeout(() => {
              feed.timer = null;
              ensure(machine, feed);
            }, delay);
            return;
          }
          deps.log(`lane B: the artifacts feed of ${link.name} ended ${reason}: no feed on this channel`);
          feed.refusedOn = link.peerCapabilities();
        },
      },
    );
    feed.sub = sub;
  }

  /** The feed opened if the link is up, its peer reads it and this channel hasn't ended it for good. */
  function ensure(machine: MachineRef, feed: Feed): void {
    if (stopped || feeds.get(machine) !== feed || feed.sub !== null || feed.timer !== null) return;
    const peers = feed.link.peerCapabilities();
    if (feed.link.state() !== 'up' || peers === null || peers === feed.refusedOn) return;
    if (!peers.includes('rl2.feeds') || !peers.includes('rl2.artifacts')) return;
    subscribe(machine, feed);
  }

  function moved(machine: MachineRef, feed: Feed): void {
    if (feed.link.peerCapabilities() === null) feed.refusedOn = null;
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

  const offRemote = deps.onRemote((machines) => {
    if (stopped) return;
    for (const [machine, feed] of [...feeds]) {
      if (machines.includes(machine) && deps.remote(machine) === feed.link) continue;
      close(feed);
      feeds.delete(machine);
    }
    for (const machine of machines) {
      const link = deps.remote(machine);
      if (link === null || feeds.has(machine)) continue;
      const feed: Feed = { link, sub: null, timer: null, backoffMs: deps.retryMs[0], refusedOn: null, off: () => {} };
      feeds.set(machine, feed);
      const offs = [link.onState(() => moved(machine, feed)), link.onCaps(() => moved(machine, feed))];
      feed.off = () => offs.forEach((off) => off());
      moved(machine, feed);
    }
  });

  return {
    stop() {
      stopped = true;
      offRemote();
      for (const feed of feeds.values()) close(feed);
      feeds.clear();
    },
  };
}
