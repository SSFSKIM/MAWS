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
import type { CommandBudgets } from '../budgets';
import type { LinkState, MachineLink } from '../manager';
import { ActTable, type ActHandle, type ActManyResult, type ActRequest } from './acts';
import { fromWire, needsCodec, toWire } from '@shared/host/json-bytes';
import { ANSWERS_BYTES } from './bytes';
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
  /**
   * P5 O7 M5c: the machine's client-port requests (`client`, sent only to a device that listed `rl2.client-port`): each
   * goes to the listeners with its `answer`, which sends one `clientAnswer` on the channel that asked and nothing once that
   * channel ended (the endpoint settles its pending requests `noClient` at the channel's end). With no listener the link
   * answers `{noClient: true}` at once.
   */
  onClient(listener: (request: ClientRequest, answer: (answer: unknown) => void) => void): () => void;
  /**
   * P5 O7 M5c: each channel's own life as it happens: `current` when one becomes current, `lost` when it ends (a loss, the
   * relay-to-direct swap, a refusal or `close()`), which `onState` doesn't say through the grace's `up`.
   */
  onChannel(listener: (event: 'current' | 'lost') => void): () => void;
  /**
   * P5 O7 M3: the link's end, heard on `onState`: `closed` once `close()` ran (for good), `removed` while a sealed
   * `removed` holds it refused (until the session changes or a person acts on the machine); null while it lives.
   */
  ended(): 'removed' | 'closed' | null;
  /** The latest `caps`, null before the first. */
  caps(): DeviceCaps | null;
  /** P5 O7 M5a: each command's budget, which `dispatchOverLink` gives a call of it (../budgets.ts); none by default. */
  readonly budgets?: CommandBudgets;
  onCaps(listener: (caps: DeviceCaps) => void): () => void;
  /** The current channel's `h2` capabilities (capabilities.ts); null while no channel is current (P5 O7 M2). */
  peerCapabilities(): readonly string[] | null;
  /**
   * `session` (P5 O7 M4): the session a path-class read is made from, sent as `call.session` only to a peer that listed
   * `rl2.call-session` (checked at each send, so a call carried to the next channel follows that channel's peer).
   * `lacking` (fix wave 2): the input sent instead to a peer that doesn't list `capability`, judged at each send the
   * same way (an input field only some peers read, as `session.events`' `maxBytes`); an answer to it says `fellBack`.
   * P5 O7 M5a: bytes in the input go tagged, and an answer is read back, with a peer that lists `rl2.bytes`; a call that
   * carries bytes either way (./bytes.ts) is refused `not-offered` by a peer that doesn't, judged at each send too.
   */
  call(name: string, input: unknown, options?: CallOptions): Promise<CallResult>;
  act(request: ActRequest): ActHandle;
  /** P5 O8 M6b: several step-up acts signed under one confirmation, each sent when its caller says (acts.ts's `actMany`). */
  actMany(requests: readonly ActRequest[]): Promise<ActManyResult>;
  /** P5 O7 M4: the machine's ledger asked again about an op settled `unknown` (ActTable.requery): query only, never the act. */
  requery(op: { opId: string; opCreated: string; executor: Executor }): ActHandle;
  subscribe(request: SubscribeRequest, sink: SubscriptionSink): Subscription;
  /**
   * P5 O7 M3 (§N): a byte stream under an act sent on this link, on the current channel (or the next, while none is);
   * closed('not-offered') at once when the peer lists no `rl2.streams`, and closed('carrier') with its channel. P5 O7
   * M5b: or a read open (no `op`: an artifact page's `http` request, its `document`), closed('not-offered') at once when
   * the peer lists no `rl2.read-open`.
   */
  openStream(request: StreamRequest, sink: StreamSink): RemoteStream;
  /** `person`: a person acted on this machine (also lifts `refused`). */
  probe(reason: ProbeReason): void;
  /**
   * P5 O7 M7 (`rl2.pong-clock`): one `ping` on the current channel, answered with its pong's stamps; null with no
   * channel, when the channel is lost first, or with no pong within `timeoutMs` (5 s). Unlike a probe it closes nothing
   * and rechecks no carrier, so the remote bench can measure a carrier by its pings without moving it.
   */
  ping(options?: { timeoutMs?: number }): Promise<PongStamps | null>;
  /** P5 O7 M7: the stamps of the newest PONG_STAMPS_KEPT pongs this link heard (a probe's, `ping`'s, any other), oldest first. */
  pongs(): readonly PongStamps[];
  /**
   * P5 O7 M7, the live bench's resume (the bench seam's `drop`, never the app's own): the current channel closed as a
   * loss and the link held off its machine, no attempt made (no retry, no probe) and no channel adopted (a direct
   * recheck's included) until `benchRelease`, so the machine's session writes a turn while the link is down, with no
   * routing touched. Only with a channel current: false, and nothing held, without one.
   */
  benchHold(): boolean;
  /** The hold lifted: an attempt at once, as on a network's return. */
  benchRelease(): void;
}

/**
 * One pong as the remote bench reads it (P5 O7 M7), each stamp in milliseconds: `at`, this device's clock at the ping's
 * send (the ping's own `at`, which the pong echoes); `received` and `sent`, the machine's clock at the ping's arrival and
 * at the pong's send, from a peer that listed `rl2.pong-clock` (else null); `arrived`, this device's clock at the pong's
 * arrival; `carrier`, the channel's.
 */
export type PongStamps = { at: number; received: number | null; sent: number | null; arrived: number; carrier: Carrier };
/** How many pongs' stamps a link keeps (the bench reads at most a few hundred per run). */
export const PONG_STAMPS_KEPT = 512;
const PING_ANSWER_MS = 5_000;
/** The most `ping()` exchanges pending at once; one past it answers null and sends nothing. */
export const PINGS_PENDING_MAX = 16;

export type CallResult = ({ ok: true; output: unknown } | { ok: false; error: { code: string; message?: string } }) & { fellBack?: true };
/**
 * `oneChannel` (P5 O7 M5c): a call that names what only one channel holds (a page's lease, the channel's window report) is
 * sent only on the channel current when it was made: with none current it fails `offline` at once, and it fails
 * `offline` at that channel's end, never carried to the next one.
 */
export type CallOptions = { timeoutMs?: number; session?: SessionRef; lacking?: { capability: string; input: unknown }; oneChannel?: true };
/** P5 O7 M5c: a machine service's request of this device through the client port (`client`; `src/shared/client/port.ts`'s kinds). */
export type ClientRequest = { id: string; kind: string; request: unknown };

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
  /** P5 O7 M5a: the services' COMMAND_BUDGETS_MS, from the composition root (../budgets.ts). */
  budgets?: CommandBudgets;
  now?(): number;
  /** The jitter, for tests. */
  random?(): number;
  log(line: string): void;
}

type Internal = 'connecting' | 'up' | 'reconnecting' | 'down' | 'refused' | 'closed';
type Trust = { generation: number; keys: string[]; identity: string };
type Current = { channel: Channel; carrier: Carrier; serial: number; trust: Trust };
type Attempt = { channel: Channel; carrier: Carrier; trust: Trust } | { failed: string };
type PendingCall = { id: string; name: string; input: unknown; session: SessionRef | undefined; lacking: CallOptions['lacking']; oneChannel: boolean; fellBack: boolean; sentOn: number | null; timer: ReturnType<typeof setTimeout>; resolve(result: CallResult): void };

/** P5 O7 M5c: the client port's answer when this device performs nothing (`src/shared/client/port.ts`'s `NO_CLIENT`). */
const NO_CLIENT_ANSWER = { noClient: true } as const;

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
  let held = false; // P5 O7 M7: the bench seam's hold (`benchHold`)
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
  const clientListeners = new Set<(request: ClientRequest, answer: (answer: unknown) => void) => void>();
  const channelListeners = new Set<(event: 'current' | 'lost') => void>();
  const channelSaid = (event: 'current' | 'lost'): void => {
    for (const listener of [...channelListeners]) listener(event);
  };
  let skippedRecord: string | null = null;

  const isCurrent = () => current !== null && (state === 'up' || state === 'reconnecting');
  const send = (message: DeviceMessage): boolean => {
    if (current === null || current.channel.closed) return false;
    current.channel.send(message as ChannelMessage).catch(() => {});
    return true;
  };
  const ended = (): 'removed' | 'closed' | null => (state === 'closed' ? 'closed' : state === 'refused' ? 'removed' : null);
  // P5 O7 M7: the pongs heard, and the pings `ping()` waits on, each on the channel it was sent on (`serial`)
  const pongStamps: PongStamps[] = [];
  // Keyed by `<serial>:<at>`: one exchange per channel and millisecond, which a second `ping()` in that millisecond joins.
  // The link's own pings (a probe's, a silence period's) never share a pending exchange's `at` on its channel: one sent
  // while an exchange of that millisecond is pending is left out (the exchange's pong answers it, as any message does),
  // and `ping()` in the millisecond of one of theirs waits for the next, so each pong settles only the ping it answers.
  const pingWaiters = new Map<string, { promise: Promise<PongStamps | null>; serial: number; settle(stamps: PongStamps | null): void }>();
  const pingKey = (on: number, at: number) => `${on}:${at}`;
  let ownPing: { serial: number; at: number } | null = null;
  /** The link's own ping (a probe's, a silence period's) on the current channel. */
  const sendOwnPing = (): void => {
    if (current === null) return;
    const at = now();
    if (pingWaiters.has(pingKey(current.serial, at))) return;
    ownPing = { serial: current.serial, at };
    send({ t: 'ping', at });
  };
  /** Settles with null every pending `ping()` (of channel `on` only, when given). */
  const settlePings = (on?: number): void => {
    for (const waiter of [...pingWaiters.values()]) if (on === undefined || waiter.serial === on) waiter.settle(null);
  };

  const peerCapabilities = (): readonly string[] | null => current?.channel.peer.capabilities ?? null;
  const acts = new ActTable({ machine: ref, signedIn: () => deps.session.current(), send, current: () => current !== null, peerCapabilities, timing, now, log });
  const subs = new SubTable({ send, current: () => current !== null, peerCapabilities, timing, log });
  const streams = new StreamTable({ send, current: () => current !== null, peerCapabilities, log });

  // The carrier a reported `up` stands on: the last current channel's, so a reconnect within the grace over the same
  // carrier is heard as nothing, and a switch is heard.
  let standing: Carrier | null = null;
  function notify(): void {
    if (current !== null) standing = current.carrier;
    // P5 O7 M3: `close()` is heard too, also when the link was down already: its consumers end what they hold on it (`ended`)
    const next = `${REPORTED[state]}|${REPORTED[state] === 'up' ? (standing ?? '') : ''}|${refusal ?? ''}${state === 'closed' ? '|closed' : ''}`;
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
    if (state === 'closed' || state === 'refused' || held) return;
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
    // The listener charges a source only for an upgrade it accepts, so the link spends a token only on a socket that
    // opened: a dial refused, timed out or answered 503 spends none. One attempt runs at a time, so the token `holds`
    // saw is still there when the socket opens. An accepted upgrade whose 101 is lost is counted by the listener alone;
    // at worst the link's next dial is answered 503 and goes through the hub, while the listener refills.
    if (!bucket.holds()) {
      once('bucket', 'direct attempts are over the listener’s handshake limit; going through the hub until the bucket refills');
      return null;
    }
    let won: { url: string; carrier: ByteDuplex };
    try {
      won = await raceDirect(addresses, timing.DIRECT_DIAL_MS, dialDirect);
    } catch {
      return null;
    }
    bucket.take();
    let first: ByteDuplex | null = won.carrier;
    const dial = async (): Promise<ByteDuplex> => {
      if (first !== null) {
        const carrier = first;
        first = null;
        return sealedOnly(carrier);
      }
      // A catch-up's next page takes another connection, and another token once it opens.
      if (!bucket.holds()) throw new Error('the direct bucket is empty');
      const carrier = await dialDirect(won.url, timing.DIRECT_DIAL_MS);
      bucket.take();
      return sealedOnly(carrier);
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
      if (held) {
        result.channel.close('closed'); // the bench's hold: its release attempts again
        return;
      }
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
    if (held) {
      result.channel.close('closed'); // every path that adopts: a held link adopts nothing
      return;
    }
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
    channelSaid('current'); // P5 O7 M5c
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
      case 'client':
        return clientAsked(message);
      case 'pong':
        return heardPong(message);
      case 'state': {
        const signedIn = deps.session.current();
        signedIn?.view.advance(message.states, message.transitions).catch((error: unknown) => log(`a state the endpoint sent did not advance the view: ${(error as Error).message}`));
        return;
      }
      default:
        return;
    }
  }

  /**
   * P5 O7 M5c: a client-port request, answered once and only on the channel that asked, and only from a peer that listed
   * `rl2.client-port` (a request of any other is not this device's to answer: it is left unread).
   */
  function clientAsked(message: Extract<EndpointMessage, { t: 'client' }>): void {
    const on = current;
    if (on === null || !on.channel.peer.capabilities.includes('rl2.client-port')) return;
    let answered = false;
    const answer = (value: unknown): void => {
      if (answered) return;
      answered = true;
      if (current === on) send({ t: 'clientAnswer', id: message.id, answer: value ?? NO_CLIENT_ANSWER });
    };
    if (clientListeners.size === 0) return answer(NO_CLIENT_ANSWER);
    for (const listener of [...clientListeners]) listener({ id: message.id, kind: message.kind, request: message.request }, answer);
  }

  /** P5 O7 M5c: the calls bound to the channel that just ended fail `offline`, never carried to the next one. */
  function dropOneChannelCalls(): void {
    for (const pending of [...calls.values()]) {
      if (!pending.oneChannel) continue;
      calls.delete(pending.id);
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: { code: 'offline', message: `${pending.name}: the channel to machine ${name} it was made on ended` } });
    }
  }

  /** P5 O7 M7: a pong's stamps kept, and the `ping()` it answers settled. */
  function heardPong(message: Extract<EndpointMessage, { t: 'pong' }>): void {
    if (current === null) return;
    const clock = current.channel.peer.capabilities.includes('rl2.pong-clock');
    const stamps: PongStamps = { at: message.at, received: clock ? (message.received ?? null) : null, sent: clock ? (message.sent ?? null) : null, arrived: now(), carrier: current.carrier };
    pongStamps.push(stamps);
    if (pongStamps.length > PONG_STAMPS_KEPT) pongStamps.splice(0, pongStamps.length - PONG_STAMPS_KEPT);
    pingWaiters.get(pingKey(current.serial, message.at))?.settle(stamps);
  }

  async function ping(options: { timeoutMs?: number } = {}): Promise<PongStamps | null> {
    if (!isCurrent()) return null;
    // not in the millisecond of the link's own ping on this channel, whose pong would answer this one's `at` too
    while (ownPing !== null && ownPing.serial === current!.serial && ownPing.at === now()) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (!isCurrent()) return null;
    }
    const at = now();
    const on = current!.serial;
    const key = pingKey(on, at);
    const joined = pingWaiters.get(key);
    if (joined !== undefined) return joined.promise;
    if (pingWaiters.size >= PINGS_PENDING_MAX) return null;
    let settle!: (stamps: PongStamps | null) => void;
    const promise = new Promise<PongStamps | null>((resolve) => {
      const timer = setTimeout(() => settle(null), options.timeoutMs ?? PING_ANSWER_MS);
      settle = (stamps) => {
        clearTimeout(timer);
        pingWaiters.delete(key);
        resolve(stamps);
      };
    });
    pingWaiters.set(key, { promise, serial: on, settle });
    send({ t: 'ping', at });
    return promise;
  }

  /** The current channel ended. A sealed `removed` refuses the link; anything else is a loss, retried at once. */
  function lost(reason: string): void {
    const was = current;
    current = null;
    dropOneChannelCalls();
    channelSaid('lost');
    settlePings();
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
          sendOwnPing();
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
        if (held) return void result.channel.close('closed'); // the bench's hold: a held link adopts nothing
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
        dropOneChannelCalls();
        settlePings(old.serial); // the old channel's close is not a loss: its pings are answered nowhere now
        acts.onLost();
        channelSaid('lost');
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
      sendOwnPing();
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
    // P5 O7 M5a: bytes, in the input or the answer, cross only to a peer that tags them (./bytes.ts)
    const tagged = needsCodec(input);
    if ((tagged || ANSWERS_BYTES.has(pending.name)) && !peerLists({ peerCapabilities }, 'rl2.bytes')) {
      calls.delete(pending.id);
      clearTimeout(pending.timer);
      return pending.resolve({ ok: false, error: { code: 'not-offered', message: `${pending.name}: machine ${name} carries no bytes (it lists no rl2.bytes)` } });
    }
    if (send({ t: 'call', id: pending.id, name: pending.name, input: (tagged ? toWire(input) : input) ?? null, ...session })) [pending.sentOn, pending.fellBack] = [current.serial, fellBack];
  }

  function answered(message: Extract<EndpointMessage, { t: 'result' }>): void {
    const pending = calls.get(message.id);
    if (pending === undefined) return;
    calls.delete(message.id);
    clearTimeout(pending.timer);
    const fellBack = pending.fellBack ? { fellBack: true as const } : {};
    // P5 O7 M5a: a peer that lists `rl2.bytes` answers in the tagged form, read back before the link's codec check
    const output = message.ok && peerLists({ peerCapabilities }, 'rl2.bytes') ? fromWire(message.output) : message.ok ? message.output : undefined;
    pending.resolve(message.ok ? { ok: true, output, ...fellBack } : { ok: false, error: message.error, ...fellBack });
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
    ...(deps.budgets !== undefined && { budgets: deps.budgets }),
    state: () => REPORTED[state],
    carrier: () => (isCurrent() ? current!.carrier : null),
    refusal: () => refusal,
    ended,
    caps: () => caps,
    peerCapabilities,
    onCaps(listener) {
      capsListeners.add(listener);
      return () => void capsListeners.delete(listener);
    },
    onClient(listener) {
      clientListeners.add(listener);
      return () => void clientListeners.delete(listener);
    },
    onChannel(listener) {
      channelListeners.add(listener);
      return () => void channelListeners.delete(listener);
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
      if (options.oneChannel === true && current === null) return Promise.resolve({ ok: false, error: { code: 'offline', message: `${callName}: no channel to machine ${name} is current` } });
      return new Promise<CallResult>((resolve) => {
        const id = `c${++nextCall}`;
        const timeoutMs = options.timeoutMs ?? timing.CALL_TIMEOUT_MS;
        const pending: PendingCall = {
          id,
          name: callName,
          input,
          session: options.session,
          lacking: options.lacking,
          oneChannel: options.oneChannel === true,
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
    actMany: (requests) => acts.actMany(requests, ended),
    requery: (op) => acts.requery(op, ended()),
    subscribe: (request, sink) => subs.subscribe(request, sink, ended()),
    openStream: (request, sink) => streams.open(request, sink, ended()),
    probe,
    ping,
    pongs: () => [...pongStamps],
    benchHold() {
      // no channel, no hold: a link already reconnecting is left to its own attempts
      if (state === 'closed' || held || current === null) return false;
      held = true;
      retryTimer = clear(retryTimer);
      current.channel.close('closed');
      return true;
    },
    benchRelease() {
      if (!held) return;
      held = false;
      failures = 0;
      lossAt = now();
      startAttempt();
    },
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
      if (was !== null) channelSaid('lost');
      subs.close('closed');
      streams.close('closed');
      acts.close('closed');
      failCalls('closed');
      settlePings();
      was?.channel.close('closed');
      closeRelay();
      notify();
    },
  };
  queueMicrotask(startAttempt); // after the manager has subscribed, so it hears even a first attempt that fails at once
  return link;
}
