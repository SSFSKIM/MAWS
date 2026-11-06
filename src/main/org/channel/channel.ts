// A project's channel in main (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a and Interfaces
// §N): the app's one reader of the log plane. One per project while a tab shows it (`open`), released
// CHANNEL_RELEASE_MS after its last tab closes (`release`). Each holds the project's log (cache.ts), the hub's Project
// socket (project-socket.ts) and the owner's words (words.ts), and tells `org.channel.changed` its whole answer,
// coalesced: main's verified events, the words not yet in the log, the count that didn't verify, "as of" and `live`.
//
// - Opening draws the cache at once, judged again against the held head (signed out, as it was judged). The socket
//   opens only while the session has a hub, after the project's history attestations are read once, so a DX1 writer's
//   attestation is held before its events arrive (cache.ts keeps an awaited writer's events past the bound); they are
//   read again when a DX1 writer's events pass every attestation held.
// - Every event is judged again at each adopted head or certificate set; another org's log is dropped at sign-in.
// - A socket the hub refuses the project (404) ends the channel `unknown-project` until the tab's next open or another
//   hub; one that ends `removed` or with the hub sign-in waits, as the Registry feed does, for the session's next change.
// - The owner's words: a leading `@alias` addresses a session the log names (address.ts), and untagged words go to
//   everyone. Nothing is sent signed out, with no hub, or to a project the hub refused.
// - The cache is written CHANNEL_WRITE_MS after a change, through the org session's commit queue, and last at `close()`,
//   whose writes enter the queue before it returns.
//
// Electron-free.
import type { HistoryAttestation, Signed } from '../../../../apps/org-protocol/src/index.ts';
import type { ChannelAnswer, ChannelChanged, ChannelSendResult } from '@shared/ipc/schema/org';
import { hubClient } from '../hub-client';
import type { HubAccess, OrgSession, SignedIn } from '../session';
import { orgTiming, type OrgTiming } from '../timing';
import { addressOf, projectSessions } from './address';
import { emptyLog, loadLog, type ChannelLimits, type ChannelStore, type Ground, type HeldLog } from './cache';
import { CLOSE_CREDENTIALS, CLOSE_REMOVED, CLOSE_UNKNOWN_PROJECT, openProjectSocket, type ProjectSocket, type ProjectSocketDeps } from './project-socket';
import { createWords } from './words';

/** A hub project: the sminos project id (`smnsId`), a UUID. */
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ChannelsDeps {
  session: OrgSession;
  store: ChannelStore;
  /** The org session's commit queue, through which every write under `org/` goes. */
  commit<T>(body: () => Promise<T>): Promise<T>;
  /** The project's history attestations; null when they can't be read. The hub client's by default. */
  attestations?(hub: HubAccess, project: string): Promise<Signed<HistoryAttestation>[] | null>;
  socket?: ProjectSocketDeps['socket'];
  fetch?: typeof fetch;
  timing?: Partial<OrgTiming>;
  now?(): number;
  random?(): number;
  log(line: string): void;
}

export interface Channels {
  /** A tab shows the project: its channel, opened or kept, and its answer once its cache is read. */
  open(project: string): Promise<ChannelAnswer>;
  /** A tab no longer shows it: released CHANNEL_RELEASE_MS after the last. */
  release(project: string): void;
  send(project: string, text: string): Promise<ChannelSendResult>;
  onChanged(listener: (changed: ChannelChanged) => void): () => void;
  /** Every channel stops; its last cache write enters the commit queue before this returns, and resolves with it. */
  close(): Promise<void>;
}

interface Channel {
  readonly loaded: Promise<void>;
  /** The tabs showing it. */
  refs(): number;
  answer(): ChannelAnswer;
  send(text: string): Promise<ChannelSendResult>;
  /** The session changed, or (`reopened`) a tab opened it again: what was parked may open again. */
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
  const listeners = new Set<(changed: ChannelChanged) => void>();
  let closed = false;

  const groundOf = (current: SignedIn, project: string): Ground => ({
    ctx: { org: current.identity.org, project },
    state: current.view.head().state,
    certificates: current.view.certificates(),
    now: new Date(now()),
  });

  function createChannel(project: string): Channel {
    const log = (line: string) => deps.log(`[org-channel] ${project.slice(0, 8)}: ${line}`);
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
    /** The hub refused the project (`unknown-project`), or ended the member's or the sign-in's access (`parked`). */
    let ended: 'unknown-project' | 'parked' | null = null;
    let attested = false;
    let reading: Promise<void> | null = null;
    let judged: { head: unknown; certificates: unknown } | null = null;
    let dirty = false;
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    let emitTimer: ReturnType<typeof setTimeout> | null = null;
    let lastEmitted = '';

    const words = createWords({
      project,
      signer: () => {
        const current = deps.session.current();
        return current === null ? null : { org: current.identity.org, member: current.identity.member, key: current.identity.channelKey };
      },
      send: (human) => socket?.send(human) ?? false,
      now,
    });
    words.onChanged(() => scheduleEmit());

    function enqueue(what: string, step: () => Promise<void> | void): Promise<void> {
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

    const signedIn = (): SignedIn | null => {
      const current = deps.session.current();
      return current !== null && held !== null && current.identity.org === held.org ? current : null;
    };

    function answer(): ChannelAnswer {
      if (ended === 'unknown-project') return { ok: false, reason: 'unknown-project' };
      const current = deps.session.current();
      const events = held?.events() ?? [];
      const unverified = held?.unverified() ?? 0;
      const asOf = held?.asOf() ?? null;
      const pending = words.pending();
      if (events.length === 0 && unverified === 0 && asOf === null && pending.length === 0) {
        if (current === null) return { ok: false, reason: 'signed-out' };
        if (current.hub === null) return { ok: false, reason: 'no-hub' };
      }
      const live = socket !== null && welcomed && caughtUp && current !== null && current.hub === socketHub;
      return { ok: true, events, pending, unverified, asOf, live };
    }

    function scheduleEmit(): void {
      if (stopped || emitTimer !== null) return;
      emitTimer = setTimeout(() => {
        emitTimer = null;
        if (stopped) return;
        const changed: ChannelChanged = { project, ...answer() };
        const text = JSON.stringify(changed);
        if (text === lastEmitted) return;
        lastEmitted = text;
        for (const listener of [...listeners]) listener(changed);
      }, timing.CHANNEL_COALESCE_MS);
      (emitTimer as { unref?: () => void }).unref?.();
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

    /** The cache as it stands once everything queued has run, through the commit queue. */
    function write(): Promise<void> {
      return deps
        .commit(async () => {
          await queue;
          if (!dirty || held === null || held.org === '') return;
          dirty = false;
          await deps.store.write(project, held.file());
        })
        .catch((error: unknown) => log(`the cache was not written: ${(error as Error).message}`));
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
        if (records === null || stopped) return;
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
            changed();
          });
        },
        onAnswer: (answered) => {
          if (mine()) words.answered(answered);
        },
        onClosed: (code) => {
          if (!mine()) return;
          welcomed = false;
          caughtUp = false;
          if (code === CLOSE_UNKNOWN_PROJECT || code === CLOSE_CREDENTIALS || code === CLOSE_REMOVED) {
            ended = code === CLOSE_UNKNOWN_PROJECT ? 'unknown-project' : 'parked';
            socket = null; // the hub it was for stays `socketHub`, so a change that keeps it keeps the refusal
          }
          scheduleEmit();
        },
        socket: deps.socket,
        timing: deps.timing,
        random: deps.random,
        log: deps.log,
      });
      socket = current;
      scheduleEmit();
    }

    function reconcile(reopened = false): void {
      if (stopped) return;
      const current = deps.session.current();
      // a parked socket opens again at any change, as the Registry feed does; a project the hub refused, only at the
      // tab's next open or with another hub
      if (reopened || ended === 'parked' || (current?.hub ?? null) !== socketHub) ended = null;
      if (current === null) {
        dropSocket();
        scheduleEmit();
        return;
      }
      void enqueue('a session change', async () => {
        if (held === null) return;
        if (held.org !== current.identity.org) {
          log('another org is signed in: the cache held is dropped');
          held = emptyLog(current.identity.org, project, limits);
          judged = null;
          attested = false;
          dropSocket();
          changed();
        }
        const head = current.view.head();
        const certificates = current.view.certificates();
        if (judged === null || judged.head !== head || judged.certificates !== certificates) {
          judged = { head, certificates };
          await held.rejudge(groundOf(current, project));
          changed();
        }
      });
      const hub = current.hub;
      if (hub !== socketHub) dropSocket();
      if (hub !== null && socket === null && ended === null && connecting !== hub) void connect(hub);
      scheduleEmit();
    }

    const loaded = enqueue('the cache', async () => {
      const raw = await deps.store.read(project).catch((error: unknown) => {
        log(`the cache did not read: ${(error as Error).message}`);
        return null;
      });
      const current = deps.session.current();
      held = await loadLog(raw, { org: current?.identity.org ?? null, project, limits, ground: current === null ? null : groundOf(current, project), log });
      if (current !== null) judged = { head: current.view.head(), certificates: current.view.certificates() };
    }).then(() => reconcile());

    async function send(text: string): Promise<ChannelSendResult> {
      if (text.trim() === '') return { ok: false, reason: 'empty' };
      const current = deps.session.current();
      if (current === null) return { ok: false, reason: 'signed-out' };
      if (current.hub === null) return { ok: false, reason: 'no-hub' };
      if (ended !== null) return { ok: false, reason: 'unreadable' };
      const events = (held?.events() ?? []).map((e) => ({ ...e.event, writer: e.writer }));
      const addressed = addressOf(text, projectSessions(events));
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
        void close();
      }, timing.CHANNEL_RELEASE_MS);
      (releaseTimer as { unref?: () => void }).unref?.();
    }

    function close(): Promise<void> {
      if (stopped) return Promise.resolve();
      stopped = true;
      for (const timer of [releaseTimer, writeTimer, emitTimer]) if (timer !== null) clearTimeout(timer);
      releaseTimer = writeTimer = emitTimer = null;
      dropSocket();
      return write();
    }

    const channel: Channel = { loaded, refs: () => refs, answer, send, reconcile, retain, release, close };
    return channel;
  }

  const unsubscribe = deps.session.onChanged(() => {
    for (const channel of channels.values()) channel.reconcile();
  });

  return {
    async open(project) {
      if (closed || !PROJECT_ID.test(project)) return { ok: false, reason: 'unknown-project' };
      let channel = channels.get(project);
      if (channel === undefined) channels.set(project, (channel = createChannel(project)));
      else channel.reconcile(true);
      channel.retain();
      await channel.loaded;
      return channel.answer();
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
      const all = [...channels.values()].map((channel) => channel.close());
      channels.clear();
      return Promise.all(all).then(() => undefined);
    },
  };
}
