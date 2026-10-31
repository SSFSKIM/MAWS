// A remote lane B session's checkout as the panel tools follow it (P5 O7 M4, docs/doperpowers/plans/
// 2026-10-28-p5-o7-remote-lane-b.md, "Changes cross as a feed, and a reconnect invalidates"; Interfaces §J, §R). The
// machine's `git.changed`, `files.changed` and `scm.remote.output` reach this app on the session's `checkout` feed, and
// are told to the renderer as a local machine's are (`emitFrom`), so its stores follow a remote checkout unchanged.
//
// - The feed. One per session whose stream main holds (M2's tabs rule), opened beside that stream and closed with it. Its
//   `ev`s are `{name, payload}`, emitted for the machine once they read as this build reads the event. A feed goes only
//   to a peer that listed `rl2.feeds`: none is asked of a peer known not to, and the link ends one `not-offered` that
//   would reach such a peer on its next channel; the next opening of the stream asks again.
// - The watches. The machine counts a `git.watch` or `files.watch` per asking client, and the endpoint makes every request
//   of one channel the same client (its `ClientRef`), which it ends with the channel. So main keeps what each page watches
//   on each remote session (its `ClientRef`, the session, the directory, how many times), gives a page's watches back to
//   the machine when the page ends (a reload, a closed window: the channel's ref outlives it), and puts them back when the
//   machine may have let them go (`src/main/sessions/watch-replay.ts`'s two rules).
// - A reopening. Every opening of a feed is a snapshot of nothing, so a `subbed` after the first is a new channel (the old
//   one's ref, and every watch it held, ended), and a feed the endpoint ended `behind` or `unavailable` (its channel
//   still up) is opened again: either way what changed meanwhile went untold. The machine counts a hold per channel
//   client and directory, not per page, so the session's watches are given back by directory, every page's together
//   (fix wave 1): each git directory released as many times as all pages hold it, then made again as many times, its
//   status told once per repository as `git.changed` (`initial`); each files directory released as many times as held,
//   forgotten, and `files.changed {kind: 'invalidated'}` told once, on which the renderer's files store lists and
//   watches again. Releasing the whole count before making any is right either way: on a new channel every release is a
//   no-op (its ref holds nothing; an unwatch of nothing does nothing), on the same one it brings the count to none. The
//   session's watch, unwatch, release and replay calls go one at a time, so a page's watch made meanwhile is counted
//   after the replay rather than inside it. `removed`, `grade` and `closed` leave the feed closed until the stream opens
//   again; any other end (`not-offered` from a next channel's peer without feeds, an unknown reason) does too, and says
//   the session is no longer followed (`unfollowed`), so a stream that waited on the record falls back to its backoff.
// - The record (O5's landing audit). The feed carries the session's `session.changed` too, handed to the session
//   (`recordChanged`) rather than told: it is how a stream that isn't live learns the session runs again, without a try
//   on the machine. While a feed is open (`follows`) the session waits for it; each opening is said (`following`), since
//   what changed before it went untold.
import type { ClientId, ClientRef } from '@shared/ipc/client';
import { REGISTRY } from '@shared/ipc/registry';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { SessionRecord } from '@shared/graph/session';
import { codecOf } from '@shared/ipc/validate';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineRef } from '@shared/machine/ref';
import type { MainContext } from '../ipc/router';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { RemoteLink, Subscription } from '../machines/remote/link';

/** The watches main keeps for a remote session: a page's call goes on to the machine, and is remembered once it answers. */
export const WATCH_COMMANDS: ReadonlySet<CommandName> = new Set<CommandName>(['git.watch', 'git.unwatch', 'files.watch', 'files.unwatch']);
/** What a checkout feed carries that is told as the machine's own (§R); its `session.changed` goes to the session. */
export const FEED_EVENTS: ReadonlySet<string> = new Set(['files.changed', 'scm.remote.output', 'git.changed']);

export interface RemoteCheckoutTiming {
  /** A feed ended `unavailable` is opened again after this, doubling to the cap; `behind` at once. */
  feedRetryMs: readonly [number, number];
}
export const REMOTE_CHECKOUT_TIMING: RemoteCheckoutTiming = { feedRetryMs: [1000, 30_000] };

export interface RemoteCheckoutDeps {
  /** Machines.remote: the link a page's watches are given back over when the page ends. */
  remote(machine: MachineRef): RemoteLink | null;
  emit<N extends EventName>(machine: MachineRef, name: N, payload: EventPayload<N>): void;
  timing?: Partial<RemoteCheckoutTiming>;
  /** The session's record as the machine changed it, from its feed. */
  recordChanged?(machine: MachineRef, app: string, record: SessionRecord): void;
  /** The session's feed opened (again): what changed before it went untold. */
  following?(machine: MachineRef, app: string): void;
  /** The session's feed ended without reopening, and not as a stop (`removed`, `grade`, `closed`): no record follows. */
  unfollowed?(machine: MachineRef, app: string): void;
  log(line: string): void;
}

export interface RemoteCheckout {
  /** A page's watch or unwatch on a session of an RL2 machine: sent on, and kept. */
  dispatch(link: RemoteLink, name: CommandName, input: Record<string, unknown>, ctx: MainContext): Promise<CommandResult<CommandName>>;
  /** The session's feed, beside its stream; a no-op while one is open or about to open again. */
  open(link: RemoteLink, app: string): void;
  /** The session's stream was let go: its feed with it. */
  close(machine: MachineRef, app: string): void;
  /** Whether the session's feed is open now, carrying its record. */
  follows(machine: MachineRef, app: string): boolean;
  stop(): void;
}

type Watch = { kind: 'git' | 'files'; machine: MachineRef; app: string; target: string; input: Record<string, unknown>; count: number };
type Page = { watches: Map<string, Watch>; off(): void };
type Feed = { link: RemoteLink; app: string; sub: Subscription | null; opened: boolean; live: boolean; timer: ReturnType<typeof setTimeout> | null; backoffMs: number; refusal: string | null };
/** Ends of a feed that say nothing will follow for this caller: the stream says so too. */
const STOPS: ReadonlySet<string> = new Set(['removed', 'grade', 'closed']);

const events = codecOf(REGISTRY);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const feedKey = (machine: MachineRef, app: string) => `${machine}\n${app}`;

export function createRemoteCheckout(deps: RemoteCheckoutDeps): RemoteCheckout {
  const timing: RemoteCheckoutTiming = { ...REMOTE_CHECKOUT_TIMING, ...deps.timing };
  const feeds = new Map<string, Feed>();
  const pages = new Map<ClientId, Page>();
  /** Each session's watch calls, one at a time (machine and session). */
  const queues = new Map<string, Promise<unknown>>();
  let stopped = false;

  function serial<T>(machine: MachineRef, app: string, run: () => Promise<T>): Promise<T> {
    const key = feedKey(machine, app);
    const next = (queues.get(key) ?? Promise.resolve()).then(run, run);
    const settled = next.then(
      () => {},
      () => {},
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return next;
  }

  // ---- The watches ---------------------------------------------------------------------------------------------------

  /** The session a watch is on: git's names it in the call (`call.session`), files' in its input. */
  const sessionOf = (name: CommandName, input: Record<string, unknown>, ctx: MainContext): string | undefined =>
    name.startsWith('git.') ? ctx.session : typeof input.appSessionId === 'string' ? input.appSessionId : undefined;

  function pageOf(client: ClientRef): Page | null {
    const held = pages.get(client.id);
    if (held !== undefined) return held;
    const page: Page = { watches: new Map(), off: () => {} };
    pages.set(client.id, page);
    page.off = client.onGone(() => gone(client.id, page));
    return pages.get(client.id) === page ? page : null; // a page already gone ended at once
  }

  /** A page that ended can no longer unwatch: what it held on each machine is given back there. */
  function gone(id: ClientId, page: Page): void {
    if (pages.get(id) !== page) return;
    pages.delete(id);
    for (const watch of page.watches.values()) {
      const link = deps.remote(watch.machine);
      if (link !== null) void serial(watch.machine, watch.app, () => release(link, watch, watch.count));
    }
    page.watches.clear();
  }

  /** `count` unwatches of the watch on the machine, one at a time, so a watch made after them is counted after. */
  async function release(link: RemoteLink, watch: Watch, count: number): Promise<void> {
    const name = watch.kind === 'git' ? 'git.unwatch' : 'files.unwatch';
    for (let i = 0; i < count; i++) {
      const result = await dispatchOverLink(link, name, watch.input, watch.kind === 'git' ? (watch.app as AppSessionId) : undefined);
      if (!result.ok) deps.log(`lane B: ${name} of ${link.name}/${watch.app} ${watch.target} failed: ${result.error.message}`);
    }
  }

  function dispatch(link: RemoteLink, name: CommandName, input: Record<string, unknown>, ctx: MainContext): Promise<CommandResult<CommandName>> {
    const app = sessionOf(name, input, ctx);
    if (app === undefined) return dispatchOverLink(link, name, input, ctx.session);
    return serial(link.machine, app, () => watchOrUnwatch(link, name, input, ctx, app));
  }

  async function watchOrUnwatch(link: RemoteLink, name: CommandName, input: Record<string, unknown>, ctx: MainContext, app: string): Promise<CommandResult<CommandName>> {
    const result = await dispatchOverLink(link, name, input, ctx.session);
    if (stopped) return result;
    const kind = name.startsWith('git.') ? 'git' : 'files';
    const target = String(kind === 'git' ? input.directory : input.path);
    const key = `${kind}\n${link.machine}\n${app}\n${target}`;
    if (name === 'git.watch' || name === 'files.watch') {
      if (!result.ok) return result;
      const page = pageOf(ctx.client);
      if (page === null) {
        void release(link, { kind, machine: link.machine, app, target, input, count: 1 }, 1);
        return result;
      }
      const held = page.watches.get(key);
      if (held !== undefined) held.count += 1;
      else page.watches.set(key, { kind, machine: link.machine, app, target, input, count: 1 });
      return result;
    }
    const watches = pages.get(ctx.client.id)?.watches;
    const held = watches?.get(key);
    if (held !== undefined && --held.count <= 0) watches!.delete(key);
    return result;
  }

  /**
   * The session's watches given back to the machine by directory, every page's together: git's released and made again
   * and its status told, files' released and invalidated.
   */
  async function replay(link: RemoteLink, app: string): Promise<void> {
    const machine = link.machine;
    const groups = new Map<string, { kind: 'git' | 'files'; target: string; input: Record<string, unknown>; count: number; held: Array<{ page: Page; key: string }> }>();
    for (const page of pages.values()) {
      for (const [key, watch] of page.watches) {
        if (watch.machine !== machine || watch.app !== app) continue;
        const id = `${watch.kind}\n${watch.target}`;
        const group = groups.get(id) ?? { kind: watch.kind, target: watch.target, input: watch.input, count: 0, held: [] };
        group.count += watch.count;
        group.held.push({ page, key });
        groups.set(id, group);
      }
    }
    const told = new Set<string>();
    for (const group of groups.values()) {
      await release(link, { ...group, machine, app }, group.count);
      if (group.kind === 'files') {
        // The renderer's files store lists and watches again on the invalidation: that watch is what this opening counts.
        for (const { page, key } of group.held) page.watches.delete(key);
        deps.emit(machine, 'files.changed', { appSessionId: app as AppSessionId, path: group.target, kind: 'invalidated' });
        continue;
      }
      let status: GitStatus | null = null;
      for (let i = 0; i < group.count; i++) {
        const result = await dispatchOverLink(link, 'git.watch', group.input, app as AppSessionId);
        if (result.ok) status = result.value as GitStatus;
        else deps.log(`lane B: git.watch of ${link.name}/${app} ${group.target} again failed: ${result.error.message}`);
      }
      if (status !== null && !told.has(status.repoRoot)) {
        told.add(status.repoRoot);
        deps.emit(machine, 'git.changed', { repoRoot: status.repoRoot, status, reason: 'initial' });
      }
    }
  }

  // ---- The feeds -----------------------------------------------------------------------------------------------------

  function subscribe(feed: Feed): void {
    const { link, app } = feed;
    const mine = () => feeds.get(feedKey(link.machine, app)) === feed && !stopped;
    feed.sub = link.subscribe(
      { session: { lane: 'B', id: app }, feed: 'checkout' },
      {
        subbed: () => {
          if (!mine()) return;
          feed.backoffMs = timing.feedRetryMs[0];
          feed.refusal = null;
          feed.live = true;
          deps.following?.(link.machine, app);
          if (!feed.opened) return void (feed.opened = true);
          // A new channel, or the feed opened again after the endpoint ended it: what changed meanwhile went untold.
          serial(link.machine, app, () => replay(link, app)).catch((error: unknown) => deps.log(`lane B: the checkout of ${link.name}/${app} could not be given back: ${(error as Error).message}`));
        },
        snapshot: () => {},
        event: (_at, body) => {
          if (!mine() || !isObject(body) || typeof body.name !== 'string') return;
          if (body.name === 'session.changed') {
            const read = events.readEventPayload('session.changed', body.payload);
            if (!read.ok) return deps.log(`lane B: ${link.name}/${app}: a session.changed on the checkout feed doesn't read; left out`);
            if (read.value.record.appId === app) deps.recordChanged?.(link.machine, app, read.value.record);
            return;
          }
          if (!FEED_EVENTS.has(body.name)) return;
          const read = events.readEventPayload(body.name as EventName, body.payload);
          if (!read.ok) return deps.log(`lane B: ${link.name}/${app}: a ${body.name} on the checkout feed doesn't read; left out`);
          deps.emit(link.machine, body.name as EventName, read.value as never);
        },
        paused: () => {},
        resumed: () => {},
        ended: (reason) => {
          if (!mine()) return;
          feed.sub = null;
          feed.live = false;
          if (reason === 'behind' || reason === 'unavailable') {
            const delay = reason === 'behind' ? 0 : feed.backoffMs;
            feed.backoffMs = Math.min(feed.backoffMs * 2, timing.feedRetryMs[1]);
            feed.timer = setTimeout(() => {
              feed.timer = null;
              if (mine()) subscribe(feed);
            }, delay);
            return;
          }
          if (feed.refusal !== reason) deps.log(`lane B: the checkout feed of ${link.name}/${app} ended ${reason}`);
          feed.refusal = reason;
          if (!STOPS.has(reason)) deps.unfollowed?.(link.machine, app);
        },
      },
    );
  }

  function close(machine: MachineRef, app: string): void {
    const key = feedKey(machine, app);
    const feed = feeds.get(key);
    if (feed === undefined) return;
    feeds.delete(key);
    if (feed.timer !== null) clearTimeout(feed.timer);
    feed.sub?.close();
  }

  return {
    dispatch,
    open(link, app) {
      if (stopped) return;
      // A peer known not to read feeds is asked for none (while no channel is current, the link holds the feed and asks
      // the next channel's peer itself).
      const peers = link.peerCapabilities();
      if (peers !== null && !peers.includes('rl2.feeds')) return;
      const key = feedKey(link.machine, app);
      const held = feeds.get(key);
      if (held !== undefined && held.link === link && (held.sub !== null || held.timer !== null)) return;
      if (held !== undefined && held.link !== link) close(link.machine, app);
      const feed: Feed = held?.link === link ? held : { link, app, sub: null, opened: false, live: false, timer: null, backoffMs: timing.feedRetryMs[0], refusal: null };
      feeds.set(key, feed);
      subscribe(feed);
    },
    close,
    follows: (machine, app) => feeds.get(feedKey(machine, app))?.live === true,
    stop() {
      stopped = true;
      for (const key of [...feeds.keys()]) {
        const [machine, app] = key.split('\n') as [MachineRef, string];
        close(machine, app);
      }
      for (const page of pages.values()) page.off();
      pages.clear();
    },
  };
}
