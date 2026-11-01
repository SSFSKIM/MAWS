// The app's RL2 link to one machine (P5 O7 M1, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The link's
// states", Interfaces §A; P5 §3; RL2, RL3, RL4, RL7, RL §4): one encrypted channel to the machine's endpoint, over the
// direct carrier when one of its record's tailnet addresses answers within DIRECT_DIAL_MS, else through the hub's relay.
// To the connection manager it is a `MachineLink`; to main's consumers a `RemoteLink`, reached through
// `Machines.remote(ref)`, the only way anything in the app reaches a machine's endpoint (boundary.test.ts).
//
// The link adds no authority: the machine decides every request (RL §5.5), and every RL2, RL3 and RL4 byte is the
// protocol package's (`connectChannel`, `readMessage`, `isAction`).
//
// States. Six inside, three reported (`MachineLink.state()`):
//   connecting → connecting   the first attempt, before any `up` or verdict
//   up         → up           a channel is current (connectChannel resolves at the endpoint's first sealed message, `caps`)
//   reconnecting → up         the channel was lost within UP_GRACE_MS; an attempt runs (no new generation, nothing greyed)
//   down       → down         no channel; retrying on the backoff
//   refused    → down         a sealed `close {reason: 'removed'}`; no retry until the session changes or a person probes
//   closed     → down         `close()` was called
// `onState` listeners hear every change of the reported state, the carrier or the refusal.
//
// Only a sealed `close {reason: 'removed'}` is permanent: it arrives authenticated inside the channel. Every handshake
// verdict is transient and local to its carrier (`protocol`, `unknown-machine`, `revoked` and `contested` come from an
// unauthenticated `h2`, which a relay can rewrite; an endpoint's own refusal reaches the device as a bare carrier close),
// so the next attempt starts again from the direct carrier. Each carrier's end is reported to the channel as `carrier`
// whatever it said, so nothing but a sealed close can read as `removed`.
//
// Trust. At each attempt the link records the machine's key ids (`machineKeys` against the held head) and the identity it
// presents. A session change that retires a recorded machine key, or changes the identity, raises the trust generation:
// the current channel is closed and authenticated again at once, and an attempt begun under an older generation is
// discarded when it completes. The handshake checks the machine's key once, so a channel under a key the org retired
// would otherwise go on serving. A delegated machine's key also stops speaking for it when its delegation expires, with
// no session change: the same check runs at that instant.
import {
  ChannelError,
  connectChannel,
  keyId,
  machineKeys,
  readMessage,
  type ByteDuplex,
  type CapsMessage,
  type Certificates,
  type Channel,
  type ChannelMessage,
  type DeviceMessage,
  type EndpointMessage,
  type Executor,
  type OrgState,
  type SessionRef,
} from '../../../../apps/org-protocol/src/index.ts';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgSession, SignedIn } from '../../org/session';
import type { LinkState, MachineLink } from '../manager';
import { ActTable, type ActHandle, type ActRequest } from './acts';
import { peerLists } from './capabilities';
import { CARRIER_CLOSED, dialDirect as dialDirectCarrier, isTailnetAddress, openRelaySocket, raceDirect, RelayUpgradeError, type RelaySocket } from './carriers';
import { dispatchOverLink } from './dispatch';
import type { EndpointRecords } from './endpoint-records';
import { StreamTable, type RemoteStream, type StreamRequest, type StreamSink } from './streams';
import { SubTable, type Subscription, type SubscribeRequest, type SubscriptionSink } from './subs';
import { timingOf, TokenBucket, type RemoteTiming } from './timing';

export type { ActHandle, ActOutcome, ActProgress, ActRequest } from './acts';
export type { Subscription, SubscribeRequest, SubscriptionSink } from './subs';
export type { RemoteStream, StreamOpened, StreamRequest, StreamSink } from './streams';
export type { RelaySocket } from './carriers';

export type Carrier = 'direct' | 'relay';
export type ProbeReason = 'wake' | 'unlock' | 'focus' | 'network' | 'person';
/** RL7's device half: `{ member, device, clientClass, machine: { grades }, stateVersion }`. */
export type DeviceCaps = Omit<CapsMessage, 't'>;

export interface RemoteLink extends MachineLink {
  /** Known from the org state at creation, never null. */
  readonly machine: MachineRef;
  /** The org state's name, updated on a rename. */
  readonly name: string;
  /** null while no channel is current. */
  carrier(): Carrier | null;
  /** The permanent verdict holding it `refused`, else null. */
  refusal(): string | null;
  /** The latest `caps`, null before the first. */
  caps(): DeviceCaps | null;
  onCaps(listener: (caps: DeviceCaps) => void): () => void;
  /** The current channel's `h2` capabilities (capabilities.ts); null while no channel is current (P5 O7 M2). */
  peerCapabilities(): readonly string[] | null;
  /**
   * `session` (P5 O7 M4): the session a path-class read is made from, sent as `call.session` only to a peer that listed
   * `rl2.call-session` (checked at each send, so a call carried to the next channel follows that channel's peer).
   * `lacking` (fix wave 2): the input sent instead to a peer that doesn't list `capability`, judged at each send the
   * same way (an input field only some peers read, as `session.events`' `maxBytes`); an answer to it says `fellBack`.
   */
  call(name: string, input: unknown, options?: CallOptions): Promise<CallResult>;
  act(request: ActRequest): ActHandle;
  /** P5 O7 M4: the machine's ledger asked again about an op settled `unknown` (ActTable.requery): query only, never the act. */
  requery(op: { opId: string; opCreated: string; executor: Executor }): ActHandle;
  subscribe(request: SubscribeRequest, sink: SubscriptionSink): Subscription;
  /**
   * P5 O7 M3 (§N): a byte stream under an act sent on this link, on the current channel (or the next, while none is);
   * closed('not-offered') at once when the peer lists no `rl2.streams`, and closed('carrier') with its channel.
   */
  openStream(request: StreamRequest, sink: StreamSink): RemoteStream;
  /** `person`: a person acted on this machine (also lifts `refused`). */
  probe(reason: ProbeReason): void;
}

export type CallResult = ({ ok: true; output: unknown } | { ok: false; error: { code: string; message?: string } }) & { fellBack?: true };
export type CallOptions = { timeoutMs?: number; session?: SessionRef; lacking?: { capability: string; input: unknown } };

export interface RemoteLinkDeps {
  machine: { ref: MachineRef; name: string };
  /** Read at every attempt. */
  session: OrgSession;
  records: EndpointRecords;
  /** carriers.ts's by default; tests map the tailnet address to loopback. */
  dialDirect?(url: string, timeoutMs: number): Promise<ByteDuplex>;
  /** carriers.ts's by default. */
  openRelay?(url: string, headers: Record<string, string>): Promise<RelaySocket>;
  /** connectChannel(dial, signedIn.identity, signedIn.view, { machine }) by default; link.test.ts runs the state machine on an in-memory Channel. */
  handshake?(dial: () => Promise<ByteDuplex>, signedIn: SignedIn, machine: MachineRef): Promise<Channel>;
  timing?: Partial<RemoteTiming>;
  now?(): number;
  /** The jitter, for tests. */
  random?(): number;
  log(line: string): void;
}

type Internal = 'connecting' | 'up' | 'reconnecting' | 'down' | 'refused' | 'closed';
type Trust = { generation: number; keys: string[]; identity: string };
type Current = { channel: Channel; carrier: Carrier; serial: number; trust: Trust };
type Attempt = { channel: Channel; carrier: Carrier; trust: Trust } | { failed: string };
type PendingCall = { id: string; name: string; input: unknown; session: SessionRef | undefined; lacking: CallOptions['lacking']; fellBack: boolean; sentOn: number | null; timer: ReturnType<typeof setTimeout>; resolve(result: CallResult): void };

const REPORTED: Record<Internal, LinkState> = { connecting: 'connecting', up: 'up', reconnecting: 'up', down: 'down', refused: 'down', closed: 'down' };

/** The carrier's end as `carrier`, whatever reason it gave: only a sealed close names the far side's word. */
function sealedOnly(io: ByteDuplex): ByteDuplex {
  return {
    send: (bytes) => io.send(bytes),
    onBytes: (listener) => io.onBytes(listener),
    close: (reason) => io.close(reason),
    onClose: (listener) => io.onClose?.(() => listener(CARRIER_CLOSED)),
  };
}

/**
 * The next instant, strictly after `now`, at which a delegation of one of `certificates` (of machine `ref`'s only, when
 * given) expires, which `machineKeys` reads as the certificate's key no longer speaking for its machine; null for none.
 */
export function nextCertExpiry(state: OrgState, certificates: Certificates, now: number, ref?: string): number | null {
  let next: number | null = null;
  for (const cert of certificates.certs) {
    if (ref !== undefined && cert.body.machine !== ref) continue;
    const expires = Date.parse(state.delegations.find((d) => d.id === cert.body.delegation)?.expires ?? '');
    if (expires > now && (next === null || expires < next)) next = expires;
  }
  return next;
}

/** setTimeout's delay overflows past 2^31-1 ms: a later instant is reached in steps of at most a day. */
const MAX_TIMER_MS = 24 * 3600 * 1000;

/** Runs `run` at the absolute instant `at`, on an unref'd timer; returns its cancel. */
export function timeoutAt(at: number, now: () => number, run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;
  const arm = (): void => {
    const left = at - now();
    timer = setTimeout(left > MAX_TIMER_MS ? arm : run, Math.max(0, Math.min(left, MAX_TIMER_MS)));
    timer.unref?.();
  };
  arm();
  return () => clearTimeout(timer);
}

const relayUrl = (hub: string, ref: MachineRef) => `${hub.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/machines/${encodeURIComponent(ref)}/socket`;

export function createRemoteLink(deps: RemoteLinkDeps): RemoteLink & { rename(name: string): void } {
  const ref = deps.machine.ref;
  const timing = timingOf(deps.timing);
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const dialDirect = deps.dialDirect ?? dialDirectCarrier;
  const openRelay = deps.openRelay ?? openRelaySocket;
  const handshake = deps.handshake ?? ((dial, signedIn, machine) => connectChannel(dial, signedIn.identity, signedIn.view, { machine }));
  const log = (line: string) => deps.log(`${ref}: ${line}`);
  const logged = new Set<string>();
  const once = (key: string, line: string) => {
    if (logged.has(key)) return;
    logged.add(key);
    log(line);
  };

  let name = deps.machine.name;
  let state: Internal = 'connecting';
  let refusal: string | null = null;
  let current: Current | null = null;
  let serial = 0;
  let caps: DeviceCaps | null = null;
  let relay: RelaySocket | null = null;
  let relayOpening: Promise<RelaySocket> | null = null;
  let trustGeneration = 0;
  let attemptTrust: Trust | null = null;
  let attempting = false;
  let again = false;
  let failures = 0;
  let lossAt = now();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let recheckTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let heard = false;
  let unanswered = 0;
  let received = 0;
  let nextCall = 0;
  let reported = `${REPORTED[state]}||`;
  const bucket = new TokenBucket(timing.DIRECT_BUCKET, now);
  const calls = new Map<string, PendingCall>();
  const stateListeners = new Set<(state: LinkState) => void>();
  const capsListeners = new Set<(caps: DeviceCaps) => void>();
  let skippedRecord: string | null = null;

  const isCurrent = () => current !== null && (state === 'up' || state === 'reconnecting');
  const send = (message: DeviceMessage): boolean => {
    if (current === null || current.channel.closed) return false;
    current.channel.send(message as ChannelMessage).catch(() => {});
    return true;
  };
  const ended = (): 'removed' | 'closed' | null => (state === 'closed' ? 'closed' : state === 'refused' ? 'removed' : null);

  const peerCapabilities = (): readonly string[] | null => current?.channel.peer.capabilities ?? null;
  const acts = new ActTable({ machine: ref, signedIn: () => deps.session.current(), send, current: () => current !== null, peerCapabilities, timing, now, log });
  const subs = new SubTable({ send, current: () => current !== null, peerCapabilities, timing, log });
  const streams = new StreamTable({ send, current: () => current !== null, peerCapabilities, log });

  // The carrier a reported `up` stands on: the last current channel's, so a reconnect within the grace over the same
  // carrier is heard as nothing, and a switch is heard.
  let standing: Carrier | null = null;
  function notify(): void {
    if (current !== null) standing = current.carrier;
    const next = `${REPORTED[state]}|${REPORTED[state] === 'up' ? (standing ?? '') : ''}|${refusal ?? ''}`;
    if (next === reported) return;
    reported = next;
    for (const listener of [...stateListeners]) listener(REPORTED[state]);
  }

  function clear(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer !== null) clearTimeout(timer);
    return null;
  }

  // ---- Attempts ------------------------------------------------------------------------------------------------------

  /** `generation` is the trust generation read before the session was: a change during the computation supersedes it. */
  async function trustOf(signedIn: SignedIn, generation: number): Promise<Trust> {
    const { keys } = await machineKeys(signedIn.view.head().state, ref, signedIn.view.certificates(), new Date(now()));
    const id = signedIn.identity;
    return {
      generation,
      keys: await Promise.all(keys.map((pub) => keyId(pub))),
      identity: `${id.org} ${id.member} ${id.device} ${await keyId(id.channelKey.pub)}`,
    };
  }

  function retired(trust: Trust, next: Trust | null): boolean {
    return next === null || next.identity !== trust.identity || trust.keys.some((kid) => !next.keys.includes(kid));
  }

  function startAttempt(): void {
    if (state === 'closed' || state === 'refused') return;
    if (attempting) {
      again = true;
      return;
    }
    attempting = true;
    retryTimer = clear(retryTimer);
    void connect(false).then(finish, (error: unknown) => finish({ failed: error instanceof Error ? error.message : String(error) }));
  }

  /** One attempt: the direct carrier when the record names a tailnet address and the bucket holds a token, else the relay. */
  async function connect(directOnly: boolean): Promise<Attempt> {
    const generation = trustGeneration;
    const signedIn = deps.session.current();
    if (signedIn === null) return { failed: 'signed out' };
    const trust = await trustOf(signedIn, generation);
    attemptTrust = trust;
    const direct = await viaDirect(signedIn);
    if (direct !== null) return { channel: direct, carrier: 'direct', trust };
    if (directOnly) return { failed: 'no direct carrier' };
    if (signedIn.hub === null) return { failed: 'no direct carrier, and no hub' };
    let socket: RelaySocket;
    try {
      socket = await relaySocket(signedIn);
    } catch (error) {
      if (error instanceof RelayUpgradeError && (error.status === 401 || error.status === 403)) once('relay-auth', `the hub refused the relay socket (${error.status}): the hub session needs renewing`);
      return { failed: `no relay (${error instanceof Error ? error.message : String(error)})` };
    }
    try {
      return { channel: await handshake(async () => sealedOnly(await socket.dial()), signedIn, ref), carrier: 'relay', trust };
    } catch (error) {
      return { failed: verdict('relay', error) };
    }
  }

  async function viaDirect(signedIn: SignedIn): Promise<Channel | null> {
    const record = await deps.records.resolve(ref, signedIn);
    if (record === null) return null;
    const addresses = record.body.addresses.filter(isTailnetAddress);
    if (addresses.length < record.body.addresses.length && skippedRecord !== record.body.issued) {
      skippedRecord = record.body.issued;
      log(`skipped ${record.body.addresses.length - addresses.length} address(es) of the endpoint record issued ${record.body.issued}: not a tailnet ws:// address`);
    }
    if (addresses.length === 0) return null;
    if (!bucket.take()) {
      once('bucket', 'direct attempts are over the listener’s handshake limit; going through the hub until the bucket refills');
      return null;
    }
    let won: { url: string; carrier: ByteDuplex };
    try {
      won = await raceDirect(addresses, timing.DIRECT_DIAL_MS, dialDirect);
    } catch {
      return null;
    }
    let first: ByteDuplex | null = won.carrier;
    const dial = async (): Promise<ByteDuplex> => {
      if (first !== null) {
        const carrier = first;
        first = null;
        return sealedOnly(carrier);
      }
      // A catch-up's next page takes another connection, and another token.
      if (!bucket.take()) throw new Error('the direct bucket is empty');
      return sealedOnly(await dialDirect(won.url, timing.DIRECT_DIAL_MS));
    };
    try {
      return await handshake(dial, signedIn, ref);
    } catch (error) {
      verdict('direct', error);
      return null;
    }
  }

  function verdict(carrier: Carrier, error: unknown): string {
    const reason = error instanceof ChannelError ? error.reason : error instanceof Error ? error.message : String(error);
    once(`verdict ${carrier} ${reason}`, `a handshake over the ${carrier} carrier failed: ${reason} (transient; logged once per reason)`);
    return reason;
  }

  function relaySocket(signedIn: SignedIn): Promise<RelaySocket> {
    if (relay !== null) return Promise.resolve(relay);
    relayOpening ??= (async () => {
      const hub = signedIn.hub!;
      const socket = await openRelay(relayUrl(hub.url, ref), await hub.headers());
      socket.onClose(() => {
        if (relay === socket) relay = null;
      });
      if (state === 'closed') socket.close();
      else relay = socket;
      return socket;
    })().finally(() => (relayOpening = null));
    return relayOpening;
  }

  function closeRelay(): void {
    relay?.close();
    relay = null;
  }

  function finish(result: Attempt): void {
    attempting = false;
    attemptTrust = null;
    if ('channel' in result) {
      if (state === 'closed' || state === 'refused' || result.trust.generation !== trustGeneration) {
        result.channel.close('closed');
        if (state === 'closed' || state === 'refused') return;
        again = false;
        return startAttempt(); // discarded under an older trust generation: authenticate again now
      }
      return adopt(result);
    }
    failures += 1;
    if (state === 'connecting') {
      state = 'down';
      notify();
    }
    if (again) {
      again = false;
      return startAttempt();
    }
    scheduleRetry();
  }

  function scheduleRetry(): void {
    if (state === 'closed' || state === 'refused' || retryTimer !== null) return;
    const since = now() - lossAt;
    const base = since >= timing.RESUME_WINDOW_MS ? timing.SLOW_RETRY_MS : timing.BACKOFF_MS[Math.min(failures, timing.BACKOFF_MS.length - 1)];
    const delay = base * (1 + (random() * 2 - 1) * timing.BACKOFF_JITTER);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      startAttempt();
    }, delay);
  }

  // ---- A current channel ---------------------------------------------------------------------------------------------

  function adopt(result: { channel: Channel; carrier: Carrier; trust: Trust }): void {
    const mine: Current = { channel: result.channel, carrier: result.carrier, serial: ++serial, trust: result.trust };
    current = mine;
    mine.channel.onMessage((message) => {
      if (current === mine) receive(message);
    });
    mine.channel.onClose((reason) => {
      if (current === mine) lost(reason);
    });
    const resumed = state === 'reconnecting';
    state = 'up';
    failures = 0;
    graceTimer = clear(graceTimer);
    retryTimer = clear(retryTimer);
    logged.clear();
    log(`up over the ${result.carrier} carrier${resumed ? ' (within the grace)' : ''}`);
    heard = false;
    unanswered = 0;
    armSilence();
    armExpiry();
    acts.onCurrent();
    subs.onCurrent();
    streams.onCurrent();
    flushCalls();
    if (result.carrier === 'direct') closeRelay();
    else armRecheck();
    notify();
  }

  function receive(raw: ChannelMessage): void {
    received += 1;
    heard = true;
    const read = readMessage('endpoint', raw);
    if (read.kind === 'unknown') return;
    if (read.kind === 'malformed') {
      log(`a malformed ${typeof raw.t === 'string' ? raw.t : 'message'}; closing the channel`);
      return current?.channel.close('malformed');
    }
    const message: EndpointMessage = read.message;
    switch (message.t) {
      case 'caps': {
        const rest: DeviceCaps = { member: message.member, device: message.device, clientClass: message.clientClass, machine: message.machine, stateVersion: message.stateVersion };
        caps = rest;
        for (const listener of [...capsListeners]) listener(rest);
        return;
      }
      case 'result':
        return answered(message);
      case 'ack':
      case 'done':
      case 'queried':
        return acts.receive(message);
      case 'subbed':
      case 'ev':
      case 'snap':
      case 'paused':
      case 'resumed':
      case 'ended':
        return subs.receive(message);
      case 'streamOpened':
      case 'streamRefused':
      case 'streamData':
      case 'streamCredit':
      case 'streamClose':
        return streams.receive(message);
      case 'ping':
        send({ t: 'pong', at: message.at });
        return;
      case 'state': {
        const signedIn = deps.session.current();
        signedIn?.view.advance(message.states, message.transitions).catch((error: unknown) => log(`a state the endpoint sent did not advance the view: ${(error as Error).message}`));
        return;
      }
      default:
        return;
    }
  }

  /** The current channel ended. A sealed `removed` refuses the link; anything else is a loss, retried at once. */
  function lost(reason: string): void {
    const was = current;
    current = null;
    silenceTimer = clear(silenceTimer);
    probeTimer = clear(probeTimer);
    recheckTimer = clear(recheckTimer);
    acts.onLost();
    if (reason === 'removed') return refuse('removed');
    streams.onLost();
    if (state === 'closed' || state === 'refused') return;
    log(`the ${was?.carrier ?? ''} channel was lost (${reason}); reconnecting`);
    if (state === 'up') {
      state = 'reconnecting';
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (state !== 'reconnecting') return;
        state = 'down';
        subs.onOffline();
        notify();
      }, timing.UP_GRACE_MS);
    }
    failures = 0;
    lossAt = now();
    notify();
    startAttempt();
  }

  function refuse(reason: string): void {
    state = 'refused';
    refusal = reason;
    log(`the machine closed the channel ${reason}: no retry until the org session changes or a person acts on this machine`);
    for (const timer of [retryTimer, graceTimer, recheckTimer, silenceTimer, probeTimer]) clear(timer);
    retryTimer = graceTimer = recheckTimer = silenceTimer = probeTimer = null;
    clearExpiry?.();
    clearExpiry = null;
    closeRelay();
    subs.close('removed');
    streams.close('removed');
    acts.close('removed');
    failCalls('removed');
    notify();
  }

  function lift(): void {
    state = 'down';
    refusal = null;
    failures = 0;
    lossAt = now();
    notify();
    startAttempt();
  }

  // ---- Liveness, probes and the direct recheck -------------------------------------------------------------------

  /**
   * One liveness period, as the endpoint's (src/endpoint/channels.ts `#arm`): a period in which anything was heard resets
   * the count; a silent one sends a ping; the third silent period in a row closes the channel `timeout`.
   */
  function armSilence(): void {
    silenceTimer = clear(silenceTimer);
    if (current === null) return;
    const [min, max] = timing.PING_SILENCE_MS;
    silenceTimer = setTimeout(
      () => {
        silenceTimer = null;
        if (current === null) return;
        if (heard) {
          heard = false;
          unanswered = 0;
        } else if (unanswered >= 2) {
          return void current.channel.close('timeout');
        } else {
          unanswered += 1;
          send({ t: 'ping', at: now() });
        }
        armSilence();
      },
      min + random() * (max - min),
    );
  }

  function armRecheck(): void {
    recheckTimer = clear(recheckTimer);
    recheckTimer = setTimeout(() => {
      recheckTimer = null;
      recheckDirect();
    }, timing.DIRECT_RECHECK_MS);
  }

  /** While up on the relay: a direct handshake, which becomes the channel once it completes (the switch). */
  function recheckDirect(): void {
    if (state !== 'up' || current?.carrier !== 'relay' || attempting) {
      if (state === 'up' && current?.carrier === 'relay') armRecheck();
      return;
    }
    attempting = true;
    const generation = trustGeneration;
    void connect(true)
      .catch((error: unknown) => ({ failed: String(error) }) as Attempt)
      .then((result) => {
        attempting = false;
        attemptTrust = null;
        if (!('channel' in result)) {
          if (state === 'up' && current?.carrier === 'relay') armRecheck();
          if (again) {
            again = false;
            if (state !== 'up') startAttempt();
          }
          return;
        }
        if (state === 'closed' || state === 'refused' || generation !== trustGeneration || result.trust.generation !== trustGeneration) {
          result.channel.close('closed');
          if (state !== 'closed' && state !== 'refused') startAttempt();
          return;
        }
        if (current === null) {
          // The relay channel was lost while this ran: the direct channel is the reconnect.
          again = false;
          return adopt(result);
        }
        if (current.carrier !== 'relay') return void result.channel.close('closed');
        // The swap is the linearization point: sends go to the new channel only, and the old one's messages are dropped.
        const old = current;
        current = null;
        acts.onLost();
        streams.onLost(); // a stream is its channel's: the old channel's end at the endpoint ends them there too
        log('the direct carrier answers again: switching from the relay');
        adopt(result);
        old.channel.close('closed');
      });
  }

  function probe(reason: ProbeReason): void {
    if (state === 'closed') return;
    if (state === 'refused') {
      if (reason === 'person') lift();
      return;
    }
    if (state === 'up' && current !== null) {
      const mine = current;
      const before = received;
      send({ t: 'ping', at: now() });
      probeTimer = clear(probeTimer);
      probeTimer = setTimeout(() => {
        probeTimer = null;
        if (current === mine && received === before) mine.channel.close('timeout');
      }, timing.PROBE_PONG_MS);
      if (mine.carrier === 'relay') recheckDirect();
      return;
    }
    failures = 0;
    lossAt = now();
    startAttempt();
  }

  // ---- The org session -----------------------------------------------------------------------------------------------

  let trustCheck: Promise<void> = Promise.resolve();
  /** At each session change and each delegation expiry: retires a channel or an attempt the org no longer trusts. */
  function checkTrust(): void {
    trustCheck = trustCheck.then(async () => {
      if (state === 'closed' || state === 'refused') return;
      const signedIn = deps.session.current();
      const next = signedIn === null ? null : await trustOf(signedIn, trustGeneration);
      armExpiry();
      const channelRetired = current !== null && retired(current.trust, next);
      // An attempt that has not yet recorded its trust may have read the session before this change: discarded too.
      const attemptRetired = attempting && (attemptTrust === null || retired(attemptTrust, next));
      if (!channelRetired && !attemptRetired) return;
      trustGeneration += 1;
      log('the org session retired a key this link was authenticated against, or changed this device: authenticating again');
      if (channelRetired && current !== null) current.channel.close('closed');
    });
  }

  let clearExpiry: (() => void) | null = null;
  function armExpiry(): void {
    clearExpiry?.();
    clearExpiry = null;
    const signedIn = deps.session.current();
    if (state === 'closed' || state === 'refused' || signedIn === null) return;
    const at = nextCertExpiry(signedIn.view.head().state, signedIn.view.certificates(), now(), ref);
    if (at !== null) clearExpiry = timeoutAt(at, now, checkTrust);
  }

  const unsubscribeSession = deps.session.onChanged(() => {
    if (state === 'closed') return;
    if (state === 'refused') return lift();
    checkTrust();
  });

  // ---- Calls ---------------------------------------------------------------------------------------------------------

  function flushCalls(): void {
    if (current === null) return;
    for (const pending of calls.values()) {
      if (pending.sentOn === current.serial) continue;
      sendCall(pending);
    }
  }

  /**
   * A call on the current channel. A void input goes as null: JSON drops an undefined `input`, and a `call` without one is
   * malformed, which closes the channel with every stream on it; the endpoint reads null back as no input. Its session
   * goes only to a peer that reads it (P5 O7 M4: an older endpoint offers no row that needs it).
   */
  function sendCall(pending: PendingCall): void {
    if (current === null) return;
    const session = pending.session !== undefined && peerLists({ peerCapabilities }, 'rl2.call-session') ? { session: pending.session } : {};
    const fellBack = pending.lacking !== undefined && peerCapabilities()?.includes(pending.lacking.capability) !== true;
    const input = fellBack ? pending.lacking!.input : pending.input;
    if (send({ t: 'call', id: pending.id, name: pending.name, input: input ?? null, ...session })) [pending.sentOn, pending.fellBack] = [current.serial, fellBack];
  }

  function answered(message: Extract<EndpointMessage, { t: 'result' }>): void {
    const pending = calls.get(message.id);
    if (pending === undefined) return;
    calls.delete(message.id);
    clearTimeout(pending.timer);
    const fellBack = pending.fellBack ? { fellBack: true as const } : {};
    pending.resolve(message.ok ? { ok: true, output: message.output, ...fellBack } : { ok: false, error: message.error, ...fellBack });
  }

  function failCalls(code: string): void {
    for (const pending of calls.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: { code, message: `${pending.name}: the link to machine ${name} is ${code}` } });
    }
    calls.clear();
  }

  // ---- The link ------------------------------------------------------------------------------------------------------

  const link: RemoteLink & { rename(name: string): void } = {
    machine: ref,
    get name() {
      return name;
    },
    rename(next: string) {
      name = next;
    },
    state: () => REPORTED[state],
    carrier: () => (isCurrent() ? current!.carrier : null),
    refusal: () => refusal,
    caps: () => caps,
    peerCapabilities,
    onCaps(listener) {
      capsListeners.add(listener);
      return () => void capsListeners.delete(listener);
    },
    // The caller is the channel's member and device (RL §5.5): its ClientRef is not sent. P5 O7 M4: the session a
    // path-class read is made from goes as the call's `session`.
    dispatch(commandName: CommandName, input: unknown, _client: unknown, session?: AppSessionId): Promise<CommandResult<CommandName>> {
      return dispatchOverLink(link, commandName, input, session);
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => void stateListeners.delete(listener);
    },
    onEvent() {
      return () => {}; // M2 turns lane B subscriptions into renderer events
    },
    call(callName, input, options = {}) {
      const end = ended();
      if (end !== null) return Promise.resolve({ ok: false, error: { code: end, message: `${callName}: the link to machine ${name} is ${end}` } });
      return new Promise<CallResult>((resolve) => {
        const id = `c${++nextCall}`;
        const timeoutMs = options.timeoutMs ?? timing.CALL_TIMEOUT_MS;
        const pending: PendingCall = {
          id,
          name: callName,
          input,
          session: options.session,
          lacking: options.lacking,
          fellBack: false,
          sentOn: null,
          resolve,
          timer: setTimeout(() => {
            calls.delete(id);
            const answering = current !== null && pending.sentOn === current.serial;
            resolve({ ok: false, error: answering ? { code: 'timeout', message: `${callName}: machine ${name} did not answer within ${timeoutMs / 1000} s` } : { code: 'offline', message: `${callName}: machine ${name} was not reachable within ${timeoutMs / 1000} s` } });
          }, timeoutMs),
        };
        calls.set(id, pending);
        sendCall(pending);
      });
    },
    act: (request) => acts.act(request, ended()),
    requery: (op) => acts.requery(op, ended()),
    subscribe: (request, sink) => subs.subscribe(request, sink, ended()),
    openStream: (request, sink) => streams.open(request, sink, ended()),
    probe,
    close() {
      if (state === 'closed') return;
      state = 'closed';
      unsubscribeSession();
      for (const timer of [retryTimer, graceTimer, recheckTimer, silenceTimer, probeTimer]) clear(timer);
      retryTimer = graceTimer = recheckTimer = silenceTimer = probeTimer = null;
      clearExpiry?.();
      clearExpiry = null;
      const was = current;
      current = null;
      subs.close('closed');
      streams.close('closed');
      acts.close('closed');
      failCalls('closed');
      was?.channel.close('closed');
      closeRelay();
      notify();
    },
  };
  queueMicrotask(startAttempt); // after the manager has subscribed, so it hears even a first attempt that fails at once
  return link;
}
