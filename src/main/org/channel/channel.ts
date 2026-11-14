// A project's channel in main (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a and Interfaces
// §N): the app's one reader of the log plane. One per project while a tab shows it (`open`), released
// CHANNEL_RELEASE_MS after its last tab closes (`release`). Each holds the project's log (cache.ts), the hub's Project
// socket (project-socket.ts) and the owner's words (words.ts). `open` answers whole: main's verified events, the words
// not yet in the log, the count that didn't verify, "as of" and `live`. `org.channel.changed` tells, coalesced, what
// changed since the last it told (or since the first open's answer): the events new or judged again (`upserts`), the
// offsets any tab was sent (a later open's answer included) that main no longer draws (`removed`: let go by the bound,
// or failing now), the rest whole. It tells everything (`reset`)
// when a judgment at a new head or certificate set changed verdicts, when another reader's log is dropped, and after a
// closed answer. Each change takes the next `rev` of a count shared by every channel of the run, and each open answer
// carries the count as it stands, so a tab drops a change told before its answer (it describes an older state).
//
// - Opening draws the cache at once, judged again against the held head (signed out, as it was judged). The socket
//   opens only while the session has a hub, after the project's history attestations are read once, so a DX1 writer's
//   attestation is held before its events arrive (cache.ts keeps the events an authenticated attestation covers past the
//   bound); they are read again when a DX1 writer's events pass every attestation held.
// - Every event is judged again at each adopted head or certificate set. The held log is one reader's, the signed-in
//   org's member's (cache.ts): another reader's is drawn to no one signed in, and dropped at their sign-in, read again
//   from offset 0 on their own socket.
// - A socket the hub refuses the project (404) ends the channel `unknown-project` until the tab's next open or another
//   hub; one that ends `removed` or with the hub sign-in waits, as the Registry feed does, for the session's next change.
// - UX wave U11a M4 (S-09; docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, Interfaces §F): while
//   not live, every answer and change carries the channel's own reach, `connecting` until an attestation read or a socket
//   before its welcome fails, then `unreachable` through every retry until the channel is live; a live channel that loses
//   its socket reads `connecting`. The hub's end of the socket for good is told apart, as `refused` (`credentials`, or
//   `removed`), until the session's next change. A new sign-in or hub, a released channel opened again, and any start
//   after the hub ended the channel begin again at `connecting`.
// - The owner's words: a leading `@alias` addresses a session the log's lifecycle names, held past the bound (address.ts,
//   cache.ts), and untagged words go to everyone. Nothing is sent signed out, with no hub, or to a project the hub
//   refused. Main is the one source of a word's state: a channel shows only the signed-in org's, member's and device's
//   words (words.ts), another signer's kept as they are, unsent. At release an acknowledged word is dropped and the rest
//   go to the run's not-sent list, which that signer's next open of the project shows `not-sent` (`NotSent`).
// - M7b: every machine's to-human entries for the project (machines.ts), opened with the channel and closed with it, go
//   in the answer beside the events (`hosts`, `machines`); a change tells them by key (`hosts.upserts`, `hosts.removed`,
//   whole with `hosts.reset` when the log's change is a reset or the machines' entries were replaced), the machines whole.
//   A channel with nothing of the log's but to-human entries answers open.
// - The cache is written CHANNEL_WRITE_MS after a change, and last at `close()`: once the channel's own work has run
//   (joined outside the org session's commit queue), a finished snapshot is entered in that queue, and the queued write
//   awaits nothing of the channel's (M4a's rule). `close()` resolves once every final write is entered. Only the
//   project's newest channel writes its file: a released one whose work outlives the next open of the project (a
//   judgment in flight) lets its last snapshot go, so it never replaces the file its successor read and wrote.
//
// Electron-free.
import { isHubWriter, type Certificates, type HistoryAttestation, type Signed, type SignedOrgState } from '../../../../apps/org-protocol/src/index.ts';
import type { ChannelAnswer, ChannelChanged, ChannelEvent, ChannelHost, ChannelSendResult } from '@shared/ipc/schema/org';
import { hubClient } from '../hub-client';
import type { Reach } from '../../net/reach';
import type { WakeSource } from '../../net/wake';
import type { HubAccess, OrgSession, SignedIn } from '../session';
import { orgTiming, type OrgTiming } from '../timing';
import { addressOf } from './address';
import { emptyLog, isReaders, loadLog, type ChannelLimits, type ChannelReader, type ChannelStore, type Ground, type HeldLog } from './cache';
import type { ChannelMachines } from './machines';
import { CLOSE_CREDENTIALS, CLOSE_REMOVED, CLOSE_UNKNOWN_PROJECT, openProjectSocket, type ProjectSocket, type ProjectSocketDeps } from './project-socket';
import { createNotSent, createWords } from './words';

/** A hub project: the sminos project id (`smnsId`), a UUID. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Each drawn event's verdict, by offset: an event's bytes at an offset never change, so this is all a change can be. */
const verdictsOf = (events: readonly ChannelEvent[]): Map<number, string> =>
  new Map(events.map((e) => [e.offset, JSON.stringify([e.label, e.by, e.author, e.owners])]));
const sameVerdicts = (a: Map<number, string>, b: Map<number, string>): boolean => a.size === b.size && [...a].every(([offset, v]) => b.get(offset) === v);

export interface ChannelsDeps {
  session: OrgSession;
  store: ChannelStore;
  /** The org session's commit queue, through which every write under `org/` goes. */
  commit<T>(body: () => Promise<T>): Promise<T>;
  /** The project's history attestations; null when they can't be read. The hub client's by default. */
  attestations?(hub: HubAccess, project: string): Promise<Signed<HistoryAttestation>[] | null>;
  socket?: ProjectSocketDeps['socket'];
  /** P5 O15 M2b §G: each channel's socket drops at a wake and pings; none: no wake is heard. */
  wake?: WakeSource;
  /** P5 O15 M2b §G: each open waits on the hub's path while the window is open; NO_REACH by default. */
  reach?: Reach;
  /** M7b: every machine's to-human entries, opened per channel; none without it. */
  machines?: ChannelMachines;
  fetch?: typeof fetch;
  timing?: Partial<OrgTiming>;
  now?(): number;
  random?(): number;
  log(line: string): void;
}

export interface Channels {
  /** A tab shows the project: its channel, opened or kept, and its whole answer once its cache is read. */
  open(project: string): Promise<ChannelAnswer>;
  /** A tab no longer shows it: released CHANNEL_RELEASE_MS after the last. */
  release(project: string): void;
  send(project: string, text: string): Promise<ChannelSendResult>;
  onChanged(listener: (changed: ChannelChanged) => void): () => void;
  /** Every channel stops and its work is joined; resolves once each one's last cache write is entered in the commit queue. */
  close(): Promise<void>;
}

type Snapshot = { head: SignedOrgState; certificates: Certificates };
type Open = Extract<ChannelAnswer, { ok: true }>;
/** Interfaces §F: whether the channel's own connection is being tried or has failed, while it is not live. */
type Standing = NonNullable<Open['reach']>;

interface Channel {
  readonly loaded: Promise<void>;
  /** The tabs showing it. */
  refs(): number;
  /** The whole answer for a tab that opens it; the first is what the next change is told against. */
  opened(): ChannelAnswer;
  send(text: string): Promise<ChannelSendResult>;
  /** The session changed, or (`reopened`) a tab opened it: what the hub ended may open again (§F says when). */
  reconcile(reopened?: boolean): void;
  release(): void;
  retain(): void;
  close(): Promise<void>;
}

export function createChannels(deps: ChannelsDeps): Channels {
  const timing = orgTiming(deps.timing);
  const now = deps.now ?? Date.now;
  const limits: ChannelLimits = { events: timing.CHANNEL_CACHE_EVENTS, bytes: timing.CHANNEL_CACHE_BYTES };
  const attestations =
    deps.attestations ??
    (async (hub: HubAccess, project: string) => {
      const read = await hubClient({ url: hub.url, headers: hub.headers, fetch: deps.fetch, timing: deps.timing }).attestations(project);
      if (read.ok) return read.value;
      deps.log(`[org-channel] ${project.slice(0, 8)}: the attestations did not read (${read.kind})`);
      return null;
    });
  const channels = new Map<string, Channel>();
  /** Each project's newest channel, by the count of channels made for it: only that one writes the project's file. */
  const generations = new Map<string, number>();
  /** Released channels still closing. */
  const closing = new Set<Promise<void>>();
  const listeners = new Set<(changed: ChannelChanged) => void>();
  let closed = false;
  /** The changes told so far, every channel's: an open answer's `rev`, and the last change's. */
  let revision = 0;
  /** The words channels let go unacknowledged, for their signer's next open of the project. */
  const notSent = createNotSent();

  const readerOf = (current: SignedIn): ChannelReader => ({ org: current.identity.org, member: current.identity.member });
  /** The head and certificates a judgment reads, sampled once: what is judged under them is what is recorded judged. */
  const snapshotOf = (current: SignedIn): Snapshot => ({ head: current.view.head(), certificates: current.view.certificates() });
  const groundOf = (current: SignedIn, project: string, snapshot: Snapshot = snapshotOf(current)): Ground => ({
    ctx: { org: current.identity.org, project },
    state: snapshot.head.state,
    certificates: snapshot.certificates,
    now: new Date(now()),
  });

  function createChannel(project: string): Channel {
    const log = (line: string) => deps.log(`[org-channel] ${project.slice(0, 8)}: ${line}`);
    const generation = (generations.get(project) ?? 0) + 1;
    generations.set(project, generation);
    let held: HeldLog | null = null;
    let queue: Promise<void> = Promise.resolve();
    let stopped = false;
    let refs = 0;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    // the socket, and the hub it was opened for (a new hub, or none, closes it)
    let socket: ProjectSocket | null = null;
    let socketHub: HubAccess | null = null;
    let connecting: HubAccess | null = null;
    let welcomed = false;
    let caughtUp = false;
    /**
     * The hub refused the project (`unknown-project`), or ended the sign-in's access (`credentials`) or the member's
     * (`removed`): those two are the answer's `refused`, and wait for the session's next change.
     */
    let ended: 'unknown-project' | NonNullable<Open['refused']> | null = null;
    /** §F: the reach told while not live (`deps.reach` is the network path's). */
    let standing: Standing = 'connecting';
    /** The session value the last reconcile saw: another (a sign-in, a sign-out, another hub) starts reach again. */
    let seen: SignedIn | null | undefined;
    let attested = false;
    let reading: Promise<void> | null = null;
    /** The snapshot the held log was last judged under, whole; another (a head or certificates since) judges it again. */
    let judged: Snapshot | null = null;
    let dirty = false;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    let emitTimer: ReturnType<typeof setTimeout> | null = null;
    // what tabs were last told: each event's verdict by offset (null: nothing yet, or a closed answer), the rest whole
    let told: Map<number, string> | null = null;
    let toldRest = '';
    let toldClosed = '';
    /** Every offset any tab may hold: those sent in an open answer or a change since the last change told. */
    let exposed = new Set<number>();
    let baselined = false;
    /** The next change tells everything. */
    let resetDue = false;
    // M7b: every machine's to-human entries, told by key as the events are by offset (null told: the next tells them whole)
    const hosts = deps.machines?.open(project) ?? null;
    let toldHosts: Set<string> | null = null;
    let exposedHosts = new Set<string>();
    let hostsResetDue = false;
    hosts?.onChanged((reset) => {
      if (reset) hostsResetDue = true;
      scheduleEmit();
    });

    const words = createWords({
      project,
      signer: () => {
        const current = deps.session.current();
        return current === null ? null : { org: current.identity.org, member: current.identity.member, device: current.identity.device, key: current.identity.channelKey };
      },
      send: (human) => socket?.send(human) ?? false,
      notSent,
      now,
    });
    words.onChanged(() => scheduleEmit());

    function enqueue(what: string, step: () => Promise<void> | void): Promise<void> {
      if (stopped) return Promise.resolve(); // nothing new once `close` joins the queue
      const run = queue.then(async () => {
        try {
          await step();
        } catch (error) {
          log(`${what} failed: ${(error as Error).message}`);
        }
      });
      queue = run;
      return run;
    }

    /** The member's word is in the log held, the signed-in reader's: delivered. */
    const inLog = (nonce: string, member: string): boolean =>
      signedIn() !== null && (held?.events() ?? []).some(({ writer, event }) => isHubWriter(writer) && event.nonce === nonce && event.member === member);

    /** The session, while the log held is its reader's. */
    const signedIn = (): SignedIn | null => {
      const current = deps.session.current();
      return current !== null && held !== null && isReaders(held, readerOf(current)) ? current : null;
    };

    /** The log held, as far as `current` may draw or address it: signed out, the file's own reader's stands. */
    const visible = (current: SignedIn | null): HeldLog | null => (held !== null && (current === null || isReaders(held, readerOf(current))) ? held : null);

    function answer(): ChannelAnswer {
      const rev = revision;
      if (ended === 'unknown-project') return { ok: false, reason: 'unknown-project', rev };
      const current = deps.session.current();
      const shown = visible(current); // another reader's, until the queued session change replaces it: nothing
      const events = shown?.events() ?? [];
      const sessions = shown?.sessions() ?? [];
      const unverified = shown?.unverified() ?? 0;
      const asOf = shown?.asOf() ?? null;
      const pending = words.pending();
      const toHuman = hosts === null ? null : { hosts: hosts.entries(), machines: hosts.machines() };
      if (events.length === 0 && sessions.length === 0 && unverified === 0 && asOf === null && pending.length === 0 && (toHuman?.hosts.length ?? 0) === 0) {
        if (current === null) return { ok: false, reason: 'signed-out', rev };
        if (current.hub === null) return { ok: false, reason: 'no-hub', rev };
      }
      const live = socket !== null && welcomed && caughtUp && current !== null && current.hub === socketHub;
      const refused = ended === 'credentials' || ended === 'removed' ? { refused: ended } : {};
      return { ok: true, rev, events, sessions, pending, unverified, asOf, live, ...(live ? {} : { reach: standing }), ...refused, ...toHuman };
    }

    function scheduleEmit(): void {
      if (stopped || emitTimer !== null) return;
      emitTimer = setTimeout(() => {
        emitTimer = null;
        if (!stopped) tell();
      }, timing.CHANNEL_COALESCE_MS);
      (emitTimer as { unref?: () => void }).unref?.();
    }

    const restOf = (a: Open) => JSON.stringify([a.sessions, a.pending, a.unverified, a.asOf, a.live, a.reach, a.refused, a.machines]);
    /** The to-human entries' change since those told: whole (`reset`) after a reset or with none told, else by key. */
    function hostsDelta(now: readonly ChannelHost[], whole: boolean) {
      const before = toldHosts;
      const keys = new Set(now.map((h) => h.key));
      const reset = whole || hostsResetDue || before === null;
      const upserts = reset || before === null ? [...now] : now.filter((h) => !before.has(h.key));
      const removed = reset ? [] : [...exposedHosts].filter((key) => !keys.has(key)).sort();
      hostsResetDue = false;
      toldHosts = keys;
      exposedHosts = new Set(keys);
      return { ...(reset ? { reset: true as const } : {}), upserts, removed };
    }

    /** The change since what was last told, if any. */
    function tell(): void {
      const now = answer();
      let change: ChannelChanged;
      if (!now.ok) {
        told = null;
        exposed = new Set(); // a tab drawing a closed answer holds no event
        toldHosts = null;
        exposedHosts = new Set();
        const text = now.reason;
        if (text === toldClosed) return;
        toldClosed = text;
        change = { project, ...now, rev: (revision += 1) };
      } else {
        toldClosed = '';
        const verdicts = verdictsOf(now.events);
        const before = told;
        const reset = resetDue || before === null;
        const upserts = reset || before === null ? now.events : now.events.filter((e) => before.get(e.offset) !== verdicts.get(e.offset));
        // whatever any tab was sent and main no longer draws, a later open's included
        const removed = reset || before === null ? [] : [...exposed].filter((offset) => !verdicts.has(offset)).sort((a, b) => a - b);
        const rest = restOf(now);
        resetDue = false;
        told = verdicts;
        exposed = new Set(verdicts.keys());
        const toHuman = now.hosts === undefined ? null : hostsDelta(now.hosts, reset);
        const hostsMoved = toHuman !== null && (toHuman.reset === true || toHuman.upserts.length > 0 || toHuman.removed.length > 0);
        if (!reset && upserts.length === 0 && removed.length === 0 && rest === toldRest && !hostsMoved) return;
        toldRest = rest;
        const { sessions, pending, unverified, asOf, live, reach, refused, machines } = now;
        change = {
          project,
          ok: true,
          rev: (revision += 1),
          upserts,
          removed,
          sessions,
          pending,
          unverified,
          asOf,
          live,
          ...(reach === undefined ? {} : { reach }),
          ...(refused === undefined ? {} : { refused }),
          ...(reset ? { reset: true as const } : {}),
          ...(toHuman === null ? {} : { hosts: toHuman, machines }),
        };
      }
      for (const listener of [...listeners]) listener(change);
    }

    function opened(): ChannelAnswer {
      const whole = answer();
      if (whole.ok) for (const event of whole.events) exposed.add(event.offset);
      if (whole.ok) for (const host of whole.hosts ?? []) exposedHosts.add(host.key);
      if (!baselined) {
        baselined = true;
        if (whole.ok) {
          told = verdictsOf(whole.events);
          toldRest = restOf(whole);
          if (whole.hosts !== undefined) toldHosts = new Set(whole.hosts.map((h) => h.key));
        } else toldClosed = whole.reason;
      }
      return whole;
    }

    function changed(): void {
      dirty = true;
      scheduleEmit();
      if (stopped || writeTimer !== null) return;
      writeTimer = setTimeout(() => {
        writeTimer = null;
        void write();
      }, timing.CHANNEL_WRITE_MS);
      (writeTimer as { unref?: () => void }).unref?.();
    }

    /** The cache as it stands, a finished snapshot, entered in the commit queue. */
    function enterWrite(): void {
      if (!dirty || held === null || held.reader === null) return;
      if (generations.get(project) !== generation) return void log('a newer channel holds the cache: the last snapshot is let go');
      dirty = false;
      const file = held.file();
      deps.commit(() => deps.store.write(project, file)).catch((error: unknown) => log(`the cache was not written: ${(error as Error).message}`));
    }

    /** The cache once everything queued has run, joined here, outside the commit queue. */
    async function write(): Promise<void> {
      await queue;
      if (!stopped) enterWrite(); // a stopped channel's last write is `close`'s
    }

    /** §F: reach moved, told even when nothing else changed. */
    function moveReach(to: Standing): void {
      if (standing === to) return;
      standing = to;
      scheduleEmit();
    }

    function dropSocket(): void {
      socket?.close();
      socket = null;
      socketHub = null;
      welcomed = false;
      caughtUp = false;
    }

    function readAttestations(hub: HubAccess): Promise<void> {
      reading ??= (async () => {
        const records = await attestations(hub, project).catch((error: unknown) => {
          log(`the attestations did not read: ${(error as Error).message}`);
          return null;
        });
        if (stopped) return;
        if (records === null) {
          if (deps.session.current()?.hub === hub) moveReach('unreachable'); // a read for a hub no longer the session's says nothing
          return;
        }
        await enqueue('the attestations', async () => {
          const current = signedIn();
          if (current !== null && held !== null && (await held.attest(records, groundOf(current, project)))) changed();
        });
      })().finally(() => {
        reading = null;
      });
      return reading;
    }

    async function connect(hub: HubAccess): Promise<void> {
      connecting = hub;
      try {
        await queue;
        if (!attested) {
          attested = true;
          await readAttestations(hub);
        }
      } finally {
        connecting = null;
      }
      if (stopped || socket !== null || ended !== null || deps.session.current()?.hub !== hub || held === null) return;
      socketHub = hub;
      welcomed = false;
      caughtUp = false;
      const mine = (): boolean => !stopped && socketHub === hub && socket === current;
      const current: ProjectSocket = openProjectSocket({
        hub: () => (deps.session.current()?.hub === hub ? hub : null),
        project,
        after: held.after(),
        onWelcome: () => {
          if (!mine()) return;
          welcomed = true;
          caughtUp = false;
          words.resend();
          scheduleEmit();
        },
        onLog: (events) => {
          if (!mine()) return;
          void enqueue('a log page', async () => {
            const signed = signedIn();
            if (signed === null || held === null) return;
            await held.add(events, groundOf(signed, project));
            words.logged(events);
            changed();
            if (held.attestationsDue()) void readAttestations(hub);
          });
        },
        onCaughtUp: (offset) => {
          if (!mine()) return;
          void enqueue('caught up', () => {
            held?.caughtUp(offset, new Date(now()).toISOString());
            caughtUp = true;
            standing = 'connecting'; // §F: live, reach absent; what the next loss of the socket starts from
            changed();
          });
        },
        onAnswer: (answered) => {
          if (mine()) words.answered(answered);
        },
        onClosed: (code) => {
          if (!mine()) return;
          const wasLive = welcomed && caughtUp;
          const beforeWelcome = !welcomed;
          welcomed = false;
          caughtUp = false;
          const terminal = code === CLOSE_UNKNOWN_PROJECT || code === CLOSE_CREDENTIALS || code === CLOSE_REMOVED;
          if (terminal) {
            ended = code === CLOSE_UNKNOWN_PROJECT ? 'unknown-project' : code === CLOSE_CREDENTIALS ? 'credentials' : 'removed';
            socket = null; // the hub it was for stays `socketHub`, so a change that keeps it keeps the refusal
          }
          // §F: a live channel that loses its socket is connecting again; one that fails before its welcome is unreachable,
          // and a refusal leaves reach as it was
          if (wasLive) standing = 'connecting';
          else if (beforeWelcome && !terminal) standing = 'unreachable';
          scheduleEmit();
        },
        socket: deps.socket,
        wake: deps.wake,
        reach: deps.reach,
        timing: deps.timing,
        random: deps.random,
        log: deps.log,
      });
      socket = current;
      scheduleEmit();
    }

    function reconcile(reopened = false): void {
      if (stopped) return;
      words.recall(inLog); // the signer's words the project's last channel let go, but none its log holds
      const current = deps.session.current();
      // §F: a new sign-in or hub, a sign-out, or a released channel opened again starts reach again
      const released = reopened && refs === 0;
      const started = current !== seen || released;
      seen = current;
      const anotherHub = (current?.hub ?? null) !== socketHub;
      // a refusal (`credentials`, `removed`) stands, as the Registry feed's does, until the session's next change or a
      // released channel opened again: another tab's open of a channel still held keeps it. A project the hub refused
      // opens again at any tab's open or with another hub. Either way the channel starts again.
      const clears = ended === 'unknown-project' ? reopened || anotherHub : !reopened || released || anotherHub;
      if (ended !== null && clears) {
        ended = null;
        standing = 'connecting';
      }
      if (started) standing = 'connecting';
      if (current === null) {
        dropSocket();
        scheduleEmit();
        return;
      }
      void enqueue('a session change', async () => {
        if (held === null) return;
        if (!isReaders(held, readerOf(current))) {
          log('another reader is signed in: the cache held is dropped');
          held = emptyLog(readerOf(current), project, limits);
          judged = null;
          attested = false;
          resetDue = true;
          dropSocket();
          changed();
          if (current.hub !== null && ended === null) void connect(current.hub); // that reader's log, from offset 0
        }
        const snapshot = snapshotOf(current);
        if (judged === null || judged.head !== snapshot.head || judged.certificates !== snapshot.certificates) {
          judged = snapshot;
          const before = verdictsOf(held.events());
          await held.rejudge(groundOf(current, project, snapshot));
          if (!sameVerdicts(before, verdictsOf(held.events()))) resetDue = true;
          changed();
        }
      });
      const hub = current.hub;
      if (hub !== socketHub) dropSocket();
      if (hub !== null && socket === null && ended === null && connecting !== hub) void connect(hub);
      scheduleEmit();
    }

    const logLoaded = enqueue('the cache', async () => {
      const raw = await deps.store.read(project).catch((error: unknown) => {
        log(`the cache did not read: ${(error as Error).message}`);
        return null;
      });
      const current = deps.session.current();
      // the snapshot the load judges under is the one recorded: a head adopted during the load is judged at the reconcile after it
      const snapshot = current === null ? null : snapshotOf(current);
      const ground = current === null || snapshot === null ? null : groundOf(current, project, snapshot);
      held = await loadLog(raw, { reader: current === null ? null : readerOf(current), project, limits, ground, log });
      judged = snapshot;
    }).then(() => reconcile());
    const loaded = Promise.all([logLoaded, hosts?.loaded]).then(() => undefined);

    async function send(text: string): Promise<ChannelSendResult> {
      if (text.trim() === '') return { ok: false, reason: 'empty' };
      const current = deps.session.current();
      if (current === null) return { ok: false, reason: 'signed-out' };
      if (current.hub === null) return { ok: false, reason: 'no-hub' };
      if (ended !== null) return { ok: false, reason: 'unreadable' };
      const addressed = addressOf(text, visible(current)?.sessions() ?? []);
      if (!addressed.ok) return { ok: false, reason: addressed.reason, detail: addressed.detail };
      const said = await words.say(text, addressed.to);
      return said.ok ? said : { ok: false, reason: said.reason };
    }

    function retain(): void {
      refs++;
      if (releaseTimer !== null) clearTimeout(releaseTimer);
      releaseTimer = null;
    }

    function release(): void {
      refs = Math.max(0, refs - 1);
      if (refs > 0 || releaseTimer !== null || stopped) return;
      releaseTimer = setTimeout(() => {
        releaseTimer = null;
        if (refs > 0) return;
        if (channels.get(project) === channel) channels.delete(project);
        words.release();
        const done = close();
        closing.add(done); // `Channels.close` joins a released channel's last write too
        void done.finally(() => closing.delete(done));
      }, timing.CHANNEL_RELEASE_MS);
      (releaseTimer as { unref?: () => void }).unref?.();
    }

    let stopping: Promise<void> | null = null;
    function close(): Promise<void> {
      stopping ??= (async () => {
        stopped = true;
        for (const timer of [releaseTimer, writeTimer, emitTimer]) if (timer !== null) clearTimeout(timer);
        releaseTimer = writeTimer = emitTimer = null;
        dropSocket();
        await Promise.all([queue, hosts?.close()]);
        enterWrite();
      })();
      return stopping;
    }

    const channel: Channel = { loaded, refs: () => refs, opened, send, reconcile, retain, release, close };
    return channel;
  }

  const unsubscribe = deps.session.onChanged(() => {
    for (const channel of channels.values()) channel.reconcile();
  });

  return {
    async open(project) {
      if (closed || !PROJECT_ID.test(project)) return { ok: false, reason: 'unknown-project', rev: revision };
      let channel = channels.get(project);
      if (channel === undefined) channels.set(project, (channel = createChannel(project)));
      else channel.reconcile(true);
      channel.retain();
      await channel.loaded;
      return channel.opened();
    },
    release(project) {
      channels.get(project)?.release();
    },
    async send(project, text) {
      const channel = channels.get(project);
      if (channel === undefined || channel.refs() === 0) return { ok: false, reason: 'not-open' };
      return channel.send(text);
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      unsubscribe();
      const all = [...[...channels.values()].map((channel) => channel.close()), ...closing];
      channels.clear();
      return Promise.all(all).then(() => undefined);
    },
  };
}
