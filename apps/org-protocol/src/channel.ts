// RL2, the channel between a device and a machine's endpoint (docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md,
// Interfaces §A), over any byte duplex: the hub's multiplex or the endpoint's direct listener.
//
// The handshake is SIGMA's sign-and-MAC with the identities in the clear (the hub sees them as routing anyway). Each
// side signs the transcript of both ephemeral keys, both nonces and every identity field with its long-term key, and
// MACs its own identity under a key derived from the shared secret: the signature proves who, the MAC this exchange.
//
//     h1 (device → endpoint)  { t, protocol, build, capabilities, org, machine, member, device, clientClass, stateVersion, e, n }
//     h2 (endpoint → device)  { t, protocol, build, capabilities, stateVersion, keyId, e, n, states?, transitions?, sig, mac }
//     h3 (device → endpoint)  { t, states?, transitions?, sig, mac }
//
//     sig(h2) = Sign(machine key, { role: 'machine', h1, h2: h2 without sig and mac })
//     mac(h2) = HMAC(kmR, { role: 'machine', machine, keyId })
//     sig(h3) = Sign(channel key, { role: 'device', h1, h2: h2 without sig and mac, h3: h3 without sig and mac })
//     mac(h3) = HMAC(kmI, { role: 'device', member, device })
//
// Signatures are `signBody` under `smns-rl2-v1`; a MAC covers the same domain-prefixed canonical bytes a signature
// would. The key schedule (Z = ECDH of the ephemerals; salt = SHA-256(canonical(h1) ‖ canonical(h2 without sig and
// mac)); PRK = HKDF-Extract(salt, Z)) gives kmR, kmI, a key and an iv per direction and the channel's id. Handshake
// messages travel as canonical JSON, one carrier message each; everything after them is a sealed frame (frames.ts).
//
// Org-state catch-up rides the handshake a page at a time: `h2` and `h3` may carry the successors and transitions that
// bring the peer up to the sender's head, in chain order from the peer's head, the whole message at most `pageBytes`
// (`HANDSHAKE_PAGE_BYTES` on both carriers). Each side adopts what verifies (`OrgView.advance`) before it checks the
// other's signature, whether or not the handshake then succeeds. A catch-up longer than a page takes one connection per
// page: an endpoint still below the device's `stateVersion` that doesn't hold the device as it signed (no entry, or an
// older one of another key or class) closes with a sealed `close {reason: 'behind', stateVersion}`; a device still
// below the endpoint's and missing the machine's key (absent, or rotated in a later state) closes after `h2`. `connectChannel` reconnects while each connection advanced a head.
//
// The endpoint's first sealed message is `caps` (M4) or a `close`; `openChannel` resolves on it, so a device learns its
// refusal before it sends anything.
import { base64urlDecode, base64urlEncode, isBase64urlOf } from './base64url.ts';
import { canonicalize } from './canonical.ts';
import { FRAME_PLAINTEXT_MAX, FrameOpener, FrameSealer, hkdfExpand, hkdfExtract, type DirectionKeys } from './frames.ts';
import { isPublicKey, isSig, keyId, signBody, signingInput, utf8, verifyInput, type B64, type Sig, type SigningKey } from './keys.ts';
import { isMachineRef, isMemberId } from './names.ts';
import type { OrgView } from './org-view.ts';
import { machineKeys } from './records.ts';
import { CHANNEL_HEADER_BYTES, RL1_MESSAGE_LIMIT } from './relay.ts';
import { SIGNING_DOMAINS, type DeviceClass, type RootTransition, type Signed, type SignedOrgState } from './types.ts';

export const RL2_PROTOCOL = { major: 1, minor: 0 } as const;
/** The most an `h2` or `h3` message is, on both carriers: an RL1 message less the multiplex header. */
export const HANDSHAKE_PAGE_BYTES = RL1_MESSAGE_LIMIT - CHANNEL_HEADER_BYTES;
/** The most an `h1` is. */
export const H1_MAX_BYTES = 64 * 1024;
/** How long either side waits for each handshake message, and a device for the endpoint's first sealed one. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** The largest JSON message a channel carries, in parts beyond a frame. */
export const MESSAGE_MAX_BYTES = 4 * 1024 * 1024;
/** The bytes of a message each `part` carries, base64url in its `data`, so a part's frame stays under 256 KiB. */
export const PART_CHUNK_BYTES = 180 * 1024;
/** How many connections `connectChannel` makes for one catch-up before it gives up. */
export const MAX_CATCH_UP_CONNECTIONS = 16;
const MAX_PARTS = Math.ceil(MESSAGE_MAX_BYTES / PART_CHUNK_BYTES);
const KIND_JSON = 0;
const NONCE_BYTES = 32;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
/** UTF-8 that refuses a malformed sequence and keeps a byte-order mark (which JSON then refuses). */
const STRICT_UTF8 = { fatal: true, ignoreBOM: true };

/** A message-oriented carrier: each `send` is one message to the other end, delivered whole and in order. */
export interface ByteDuplex {
  send(bytes: Uint8Array): void;
  onBytes(listener: (bytes: Uint8Array) => void): void;
  close(reason: string): void;
  /** The carrier ended (the peer or the transport closed it). Every real carrier has one; without it a closed peer is a timeout. */
  onClose?(listener: (reason: string) => void): void;
}

/** A channel message: JSON with its kind in `t` (messages.ts holds the vocabulary and its checks). */
export type ChannelMessage = { t: string; [field: string]: unknown };
/** What each side learns of the other from the handshake. */
export type PeerInfo = { protocol: { major: number; minor: number }; build: string; capabilities: string[]; stateVersion: number };
export type DevicePeer = PeerInfo & { member: string; device: string; clientClass: DeviceClass; channelPub: B64 };

export interface Channel {
  readonly id: string;
  readonly peer: PeerInfo;
  readonly closed: boolean;
  send(message: ChannelMessage): Promise<void>;
  /** Messages arriving while no listener is subscribed wait for the next one. */
  onMessage(listener: (message: ChannelMessage) => void): () => void;
  onClose(listener: (reason: string, stateVersion?: number) => void): () => void;
  /** Sends a sealed `close {reason, stateVersion?}` and ends the carrier. */
  close(reason: string, stateVersion?: number): void;
}

export type DeviceIdentity = { org: string; member: string; device: string; clientClass: DeviceClass; channelKey: SigningKey; build: string; capabilities: string[] };
export type MachineIdentity = { ref: string; key: SigningKey; build: string; capabilities: string[] };
/** An ephemeral ECDH key: generated per handshake, or fixed by the vectors. */
export type Ephemeral = { privateKey: CryptoKey; pub: B64 };
export type HandshakeOptions = {
  /** The clock certificates are judged by, and the sealers' 24-hour rekey. */
  now?: () => Date;
  timeoutMs?: number;
  /** The largest `h2` or `h3` this side sends or reads; `HANDSHAKE_PAGE_BYTES` unless a suite pages smaller. */
  pageBytes?: number;
  ephemeral?: Ephemeral;
  nonce?: B64;
};

/**
 * Why a handshake or a channel ended. A handshake refusal names its first failing check (`malformed`, `protocol`,
 * `too-large`, `timeout`, `closed`, `wrong-machine`, `unknown-machine`, `contested`, `unknown-device`, `class`,
 * `revoked`, `bad-mac`, `bad-signature`, `behind`); a frame's is frames.ts's (`sequence`, `epoch`, `tag`, …) or `kind`;
 * a sealed `close` carries the peer's. `behind` carries the endpoint's `stateVersion`, and `advanced` when this
 * connection moved either side's head, so another connection can carry the next page.
 */
export class ChannelError extends Error {
  readonly reason: string;
  readonly stateVersion?: number;
  readonly advanced?: boolean;
  constructor(reason: string, detail: { stateVersion?: number; advanced?: boolean } = {}) {
    super(`channel: ${reason}`);
    this.name = 'ChannelError';
    this.reason = reason;
    this.stateVersion = detail.stateVersion;
    this.advanced = detail.advanced;
  }
}

// ---- The key schedule -----------------------------------------------------------------------------------------------

export type HandshakeSecrets = { salt: Uint8Array<ArrayBuffer>; kmR: Uint8Array<ArrayBuffer>; kmI: Uint8Array<ArrayBuffer>; i2r: DirectionKeys; r2i: DirectionKeys; channelId: B64 };

export async function generateEphemeral(): Promise<Ephemeral> {
  const pair = (await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, pub: base64urlEncode(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)) };
}

/** An ephemeral from a private P-256 JWK (the vectors' fixed keys); its `key_ops` and `alg`, if any, are left out. */
export async function importEphemeral(jwk: JsonWebKey): Promise<Ephemeral> {
  const { kty, crv, x, y, d } = jwk;
  if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string' || typeof d !== 'string') throw new TypeError('an ephemeral is a private P-256 JWK');
  const privateKey = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, ECDH, false, ['deriveBits']);
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(base64urlDecode(x), 1);
  point.set(base64urlDecode(y), 33);
  return { privateKey, pub: base64urlEncode(point) };
}

/** Z: ECDH of `own` and the peer's raw point (32 bytes). Throws for a point that is not on the curve. */
export async function sharedSecret(own: Ephemeral, peer: B64): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', base64urlDecode(peer), ECDH, true, []);
  // WebCrypto's member is `public` everywhere at runtime; the Workers' types spell it `$public`, so the object is cast.
  const algorithm: { name: 'ECDH'; public: CryptoKey } = { name: 'ECDH', public: key };
  return new Uint8Array(await crypto.subtle.deriveBits(algorithm as never, own.privateKey, 256));
}

/** The keys both sides derive from Z, `h1` and `h2` without its sig and mac. */
export async function handshakeSecrets(z: Uint8Array<ArrayBuffer>, h1: object, h2bare: object): Promise<HandshakeSecrets> {
  const transcript = utf8(canonicalize(h1) + canonicalize(h2bare));
  const salt = new Uint8Array(await crypto.subtle.digest('SHA-256', transcript));
  const prk = await hkdfExtract(salt, z);
  const expand = (label: string, length: number) => hkdfExpand(prk, `smns-rl2-v1 ${label}`, length);
  return {
    salt,
    kmR: await expand('mac r', 32),
    kmI: await expand('mac i', 32),
    i2r: { key: await expand('key i2r', 32), iv: await expand('iv i2r', 4) },
    r2i: { key: await expand('key r2i', 32), iv: await expand('iv r2i', 4) },
    channelId: base64urlEncode(await expand('id', 16)),
  };
}

/** What the machine signs: `{ role: 'machine', h1, h2 }`, `h2` without its sig and mac. */
export const machineTranscript = (h1: object, h2bare: object) => signingInput(SIGNING_DOMAINS.rl2, { role: 'machine', h1, h2: h2bare });
/** What the device signs: `{ role: 'device', h1, h2, h3 }`, each without its sig and mac. */
export const deviceTranscript = (h1: object, h2bare: object, h3bare: object) => signingInput(SIGNING_DOMAINS.rl2, { role: 'device', h1, h2: h2bare, h3: h3bare });
export const machineMacInput = (machine: string, kid: string) => signingInput(SIGNING_DOMAINS.rl2, { role: 'machine', machine, keyId: kid });
export const deviceMacInput = (member: string, device: string) => signingInput(SIGNING_DOMAINS.rl2, { role: 'device', member, device });

const hmacKey = (key: Uint8Array<ArrayBuffer>) => crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
export async function handshakeMac(key: Uint8Array<ArrayBuffer>, input: Uint8Array<ArrayBuffer>): Promise<B64> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(key), input)));
}
async function macVerifies(key: Uint8Array<ArrayBuffer>, input: Uint8Array<ArrayBuffer>, mac: B64): Promise<boolean> {
  return crypto.subtle.verify('HMAC', await hmacKey(key), base64urlDecode(mac), input);
}

// ---- The handshake's messages ---------------------------------------------------------------------------------------

type Fields = Record<string, unknown>;
type Protocol = { major: number; minor: number };
type Page = { states?: SignedOrgState[]; transitions?: Signed<RootTransition>[] };
type H1 = { t: 'h1'; protocol: Protocol; build: string; capabilities: string[]; org: string; machine: string; member: string; device: string; clientClass: DeviceClass; stateVersion: number; e: B64; n: B64 };
type H2 = Page & { t: 'h2'; protocol: Protocol; build: string; capabilities: string[]; stateVersion: number; keyId: string; e: B64; n: B64; sig: Sig; mac: B64 };
type H3 = Page & { t: 'h3'; sig: Sig; mac: B64 };

const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 256): v is string => typeof v === 'string' && v !== '' && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isProtocol = (v: unknown): v is Protocol => isObject(v) && isCount(v.major) && isCount(v.minor);
const isCapabilities = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 64 && v.every((c) => isText(c, 64));
const isPage = (v: Fields) => (v.states === undefined || Array.isArray(v.states)) && (v.transitions === undefined || Array.isArray(v.transitions));
const isMac = (v: unknown): v is B64 => isBase64urlOf(v, 32);

// Within a major, changes are additive (OX1): a field these checks don't name is carried, covered by the transcript.
function isH1(v: unknown): v is H1 {
  return (
    isObject(v) &&
    v.t === 'h1' &&
    isProtocol(v.protocol) &&
    isText(v.build) &&
    isCapabilities(v.capabilities) &&
    isText(v.org) &&
    isMachineRef(v.machine) &&
    typeof v.member === 'string' &&
    isMemberId(v.member) &&
    isText(v.device) &&
    (v.clientClass === 'native-mac' || v.clientClass === 'web-cards') &&
    isCount(v.stateVersion) &&
    isPublicKey(v.e) &&
    isBase64urlOf(v.n, NONCE_BYTES)
  );
}

function isH2(v: unknown): v is H2 {
  return (
    isObject(v) &&
    v.t === 'h2' &&
    isProtocol(v.protocol) &&
    isText(v.build) &&
    isCapabilities(v.capabilities) &&
    isCount(v.stateVersion) &&
    isBase64urlOf(v.keyId, 16) &&
    isPublicKey(v.e) &&
    isBase64urlOf(v.n, NONCE_BYTES) &&
    isPage(v) &&
    isSig(v.sig) &&
    isMac(v.mac)
  );
}

const isH3 = (v: unknown): v is H3 => isObject(v) && v.t === 'h3' && isPage(v) && isSig(v.sig) && isMac(v.mac);

function bare<T extends Fields>(message: T): Fields {
  const out: Fields = { ...message };
  delete out.sig;
  delete out.mac;
  return out;
}

/** A handshake message read from its bytes: `too-large` past `limit`, `malformed` for anything but a JSON object. */
function readJson(bytes: Uint8Array, limit: number): unknown {
  if (bytes.length > limit) throw new ChannelError('too-large');
  try {
    const value = JSON.parse(new TextDecoder('utf-8', STRICT_UTF8).decode(Uint8Array.from(bytes))) as unknown;
    canonicalize(value); // the transcript must be writable
    return value;
  } catch {
    throw new ChannelError('malformed');
  }
}

const random = (bytes: number) => base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
const encoded = (message: object) => utf8(canonicalize(message));
const SIG_PLACEHOLDER: Sig = { kid: 'A'.repeat(22), value: 'A'.repeat(86) };
const MAC_PLACEHOLDER = 'A'.repeat(43);

/**
 * The page of the chain after `from` that fits beside `base` (the message with placeholder sig and mac) within `limit`
 * bytes: states in version order, each with the transitions from the version before it.
 */
function pageFrom(org: OrgView, from: number, base: Fields, limit: number): Page {
  const { states, transitions } = org.since(from);
  if (states.length === 0) return {};
  const size = (value: unknown) => encoded(value as object).length;
  let total = size(base) + '"states":[],"transitions":[],'.length;
  const page: { states: SignedOrgState[]; transitions: Signed<RootTransition>[] } = { states: [], transitions: [] };
  for (const s of states) {
    const needed = transitions.filter((t) => t.body.fromVersion === s.state.version - 1);
    const added = [s, ...needed].reduce((n, item) => n + size(item) + 1, 0);
    if (total + added > limit) break;
    total += added;
    page.states.push(s);
    page.transitions.push(...needed);
  }
  const shaped = (): Page => (page.states.length === 0 ? {} : page.transitions.length === 0 ? { states: page.states } : page);
  while (page.states.length > 0 && size({ ...base, ...shaped() }) > limit) {
    const dropped = page.states.pop() as SignedOrgState;
    page.transitions = page.transitions.filter((t) => t.body.fromVersion < dropped.state.version - 1);
  }
  return shaped();
}

/** The carrier's messages, held for the handshake one at a time, then handed whole to the sealed channel. */
class Inbox {
  private queue: Uint8Array[] = [];
  private waiter: { resolve: (bytes: Uint8Array) => void; reject: (error: ChannelError) => void } | null = null;
  private ended: string | null = null;
  private overflow = false;
  private sink: ((bytes: Uint8Array) => void) | null = null;
  private endSink: ((reason: string) => void) | null = null;

  constructor(io: ByteDuplex) {
    io.onBytes((bytes) => this.push(bytes));
    io.onClose?.((reason) => this.end(reason));
  }

  private push(bytes: Uint8Array): void {
    if (this.sink !== null) return this.sink(bytes);
    if (this.waiter !== null) {
      const { resolve } = this.waiter;
      this.waiter = null;
      return resolve(bytes);
    }
    // The handshake is lockstep: a peer that sends ahead of its turn sends what nothing reads before it verifies.
    if (this.queue.length >= 1) this.overflow = true;
    else this.queue.push(bytes);
  }

  private end(reason: string): void {
    if (this.ended !== null) return;
    this.ended = reason;
    if (this.endSink !== null) return this.endSink(reason);
    if (this.waiter !== null) {
      const { reject } = this.waiter;
      this.waiter = null;
      reject(new ChannelError('closed'));
    }
  }

  next(timeoutMs: number): Promise<Uint8Array> {
    if (this.overflow) return Promise.reject(new ChannelError('malformed'));
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.ended !== null) return Promise.reject(new ChannelError('closed'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new ChannelError('timeout'));
      }, timeoutMs);
      this.waiter = {
        resolve: (bytes) => {
          clearTimeout(timer);
          resolve(bytes);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  handOff(sink: (bytes: Uint8Array) => void, endSink: (reason: string) => void): void {
    this.sink = sink;
    this.endSink = endSink;
    for (const bytes of this.queue.splice(0)) sink(bytes);
    if (this.ended !== null) endSink(this.ended);
  }
}

function closeQuietly(io: ByteDuplex, reason: string): void {
  try {
    io.close(reason);
  } catch {
    // already closed
  }
}

// ---- The sealed channel ---------------------------------------------------------------------------------------------

type Assembly = { id: number; count: number; next: number; chunks: Uint8Array[]; bytes: number };

function messageOf(bytes: Uint8Array): ChannelMessage | null {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', STRICT_UTF8).decode(Uint8Array.from(bytes))) as unknown;
    return isObject(value) && typeof value.t === 'string' ? (value as ChannelMessage) : null;
  } catch {
    return null;
  }
}

function framed(json: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(json.length + 1);
  out[0] = KIND_JSON;
  out.set(json, 1);
  return out;
}

class SealedChannel implements Channel {
  closed = false;
  private readonly listeners = new Set<(message: ChannelMessage) => void>();
  private readonly closeListeners = new Set<(reason: string, stateVersion?: number) => void>();
  private readonly buffered: ChannelMessage[] = [];
  private flushing = false;
  private ending: { reason: string; stateVersion?: number } | null = null;
  private sending: Promise<void> = Promise.resolve();
  private receiving: Promise<void> = Promise.resolve();
  private assembly: Assembly | null = null;
  private partId = 0;
  private firstSeen = false;
  private readonly firstWaiters: Array<{ ok: () => void; fail: (reason: string, stateVersion?: number) => void }> = [];

  private readonly io: ByteDuplex;
  private readonly sealer: FrameSealer;
  private readonly opener: FrameOpener;
  readonly id: string;
  readonly peer: PeerInfo;

  constructor(io: ByteDuplex, inbox: Inbox, sealer: FrameSealer, opener: FrameOpener, id: string, peer: PeerInfo) {
    this.io = io;
    this.sealer = sealer;
    this.opener = opener;
    this.id = id;
    this.peer = peer;
    // The carrier's end waits behind every frame it delivered first: a sealed close just before it (a `behind` with
    // its stateVersion) is still read, whatever turns the carrier delivers on.
    inbox.handOff(
      (bytes) => {
        this.receiving = this.receiving.then(() => this.receive(bytes));
      },
      (reason) => {
        this.receiving = this.receiving.then(() => this.ended(reason));
      },
    );
  }

  send(message: ChannelMessage): Promise<void> {
    if (this.closed) return Promise.reject(new ChannelError('closed'));
    let json: Uint8Array<ArrayBuffer>;
    try {
      json = utf8(JSON.stringify(message));
    } catch {
      return Promise.reject(new ChannelError('malformed'));
    }
    if (json.length > MESSAGE_MAX_BYTES) return Promise.reject(new ChannelError('too-large'));
    return this.write(json.length + 1 <= FRAME_PLAINTEXT_MAX ? [framed(json)] : this.parts(json));
  }

  onMessage(listener: (message: ChannelMessage) => void): () => void {
    this.listeners.add(listener);
    this.scheduleFlush();
    return () => this.listeners.delete(listener);
  }

  onClose(listener: (reason: string, stateVersion?: number) => void): () => void {
    if (this.ending !== null) {
      const { reason, stateVersion } = this.ending;
      void Promise.resolve().then(() => listener(reason, stateVersion));
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(reason: string, stateVersion?: number): void {
    void this.closeWith(reason, stateVersion);
  }

  /** Sends the sealed close, then ends the carrier; resolves once both are done. */
  async closeWith(reason: string, stateVersion?: number): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const message: ChannelMessage = stateVersion === undefined ? { t: 'close', reason } : { t: 'close', reason, stateVersion };
    await this.write([framed(utf8(JSON.stringify(message)))], true).catch(() => {});
    closeQuietly(this.io, reason);
    this.finish(reason, stateVersion);
  }

  /** Resolves at the first message the peer sends, or rejects with its close. */
  whenFirst(timeoutMs: number): Promise<void> {
    if (this.firstSeen) return Promise.resolve();
    if (this.ending !== null) return Promise.reject(new ChannelError(this.ending.reason, { stateVersion: this.ending.stateVersion }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        void this.closeWith('timeout');
      }, timeoutMs);
      this.firstWaiters.push({
        ok: () => {
          clearTimeout(timer);
          resolve();
        },
        fail: (reason, stateVersion) => {
          clearTimeout(timer);
          reject(new ChannelError(reason, { stateVersion }));
        },
      });
    });
  }

  private write(plaintexts: Uint8Array<ArrayBuffer>[], closing = false): Promise<void> {
    const run = this.sending.then(async () => {
      for (const plaintext of plaintexts) {
        if (this.closed && !closing) throw new ChannelError('closed');
        this.io.send(await this.sealer.seal(plaintext));
      }
    });
    this.sending = run.catch(() => {});
    return run;
  }

  private parts(json: Uint8Array): Uint8Array<ArrayBuffer>[] {
    const id = this.partId++;
    const count = Math.ceil(json.length / PART_CHUNK_BYTES);
    const out: Uint8Array<ArrayBuffer>[] = [];
    for (let index = 0; index < count; index++) {
      const data = base64urlEncode(json.subarray(index * PART_CHUNK_BYTES, (index + 1) * PART_CHUNK_BYTES));
      out.push(framed(utf8(JSON.stringify({ t: 'part', id, index, count, data }))));
    }
    return out;
  }

  private async receive(bytes: Uint8Array): Promise<void> {
    if (this.closed) return;
    const opened = await this.opener.open(bytes);
    if (!opened.ok) return this.fail(opened.reason);
    const { plaintext } = opened;
    if (plaintext.length === 0 || plaintext[0] !== KIND_JSON) return this.fail('kind');
    const message = messageOf(plaintext.subarray(1));
    if (message === null) return this.fail('malformed');
    if (message.t === 'part') return this.part(message);
    if (this.assembly !== null) return this.fail('malformed');
    this.deliver(message);
  }

  private part(message: ChannelMessage): void {
    const { id, index, count, data } = message;
    if (!isCount(id) || !isCount(index) || !isCount(count) || count < 2 || count > MAX_PARTS || typeof data !== 'string') return this.fail('malformed');
    if (this.assembly === null) {
      if (index !== 0) return this.fail('malformed');
      this.assembly = { id, count, next: 0, chunks: [], bytes: 0 };
    }
    const a = this.assembly;
    if (id !== a.id || count !== a.count || index !== a.next) return this.fail('malformed');
    let chunk: Uint8Array;
    try {
      chunk = base64urlDecode(data);
    } catch {
      return this.fail('malformed');
    }
    a.chunks.push(chunk);
    a.bytes += chunk.length;
    a.next++;
    if (a.bytes > MESSAGE_MAX_BYTES) return this.fail('too-large');
    if (a.next < a.count) return;
    this.assembly = null;
    const whole = new Uint8Array(a.bytes);
    let at = 0;
    for (const c of a.chunks) {
      whole.set(c, at);
      at += c.length;
    }
    const joined = messageOf(whole);
    if (joined === null || joined.t === 'part') return this.fail('malformed');
    this.deliver(joined);
  }

  private deliver(message: ChannelMessage): void {
    if (message.t === 'close') {
      const reason = typeof message.reason === 'string' && message.reason !== '' ? message.reason : 'closed';
      const stateVersion = isCount(message.stateVersion) ? message.stateVersion : undefined;
      this.closed = true;
      closeQuietly(this.io, reason);
      return this.finish(reason, stateVersion);
    }
    if (!this.firstSeen) {
      this.firstSeen = true;
      for (const w of this.firstWaiters.splice(0)) w.ok();
    }
    this.buffered.push(message);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushing || this.buffered.length === 0 || this.listeners.size === 0) return;
    this.flushing = true;
    void Promise.resolve().then(() => {
      this.flushing = false;
      while (this.buffered.length > 0 && this.listeners.size > 0) {
        const message = this.buffered.shift() as ChannelMessage;
        for (const listener of [...this.listeners]) listener(message);
      }
    });
  }

  private fail(reason: string): void {
    void this.closeWith(reason);
  }

  private ended(reason: string): void {
    if (this.ending !== null) return;
    this.closed = true;
    this.finish(reason || 'closed');
  }

  private finish(reason: string, stateVersion?: number): void {
    if (this.ending !== null) return;
    this.ending = { reason, stateVersion };
    for (const w of this.firstWaiters.splice(0)) w.fail(reason, stateVersion);
    for (const listener of [...this.closeListeners]) listener(reason, stateVersion);
    this.closeListeners.clear();
  }
}

// ---- The two ends ---------------------------------------------------------------------------------------------------

/** Ends the carrier and answers the refusal. */
function refused(io: ByteDuplex, error: unknown): ChannelError {
  const failure = error instanceof ChannelError ? error : new ChannelError('malformed');
  closeQuietly(io, failure.reason);
  return failure;
}

/**
 * The device's end: sends `h1`, adopts `h2`'s page, checks the machine's key for `options.machine` in its head, and
 * answers `h3` with its own page; resolves at the endpoint's first sealed message.
 */
export async function openChannel(io: ByteDuplex, me: DeviceIdentity, org: OrgView, options: HandshakeOptions & { machine: string }): Promise<Channel> {
  const inbox = new Inbox(io);
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const pageBytes = options.pageBytes ?? HANDSHAKE_PAGE_BYTES;
  const now = options.now ?? (() => new Date());
  try {
    const ephemeral = options.ephemeral ?? (await generateEphemeral());
    const before = org.head().state.version;
    const h1: H1 = {
      t: 'h1',
      protocol: { ...RL2_PROTOCOL },
      build: me.build,
      capabilities: me.capabilities,
      org: me.org,
      machine: options.machine,
      member: me.member,
      device: me.device,
      clientClass: me.clientClass,
      stateVersion: before,
      e: ephemeral.pub,
      n: options.nonce ?? random(NONCE_BYTES),
    };
    io.send(encoded(h1));
    const h2 = readJson(await inbox.next(timeoutMs), pageBytes);
    if (!isH2(h2)) throw new ChannelError('malformed');
    if (h2.protocol.major !== RL2_PROTOCOL.major) throw new ChannelError('protocol');
    await org.advance(h2.states ?? [], h2.transitions ?? []);
    const head = org.head().state;
    const { keys, contested } = await machineKeys(head, options.machine, org.certificates(), now());
    const machinePub = h2.sig.kid === h2.keyId ? ((await Promise.all(keys.map(async (k) => ((await keyId(k)) === h2.keyId ? k : null)))).find((k) => k !== null) ?? null) : null;
    if (machinePub === null) {
      if (head.version < h2.stateVersion) throw new ChannelError('behind', { stateVersion: h2.stateVersion, advanced: head.version > before });
      if (contested) throw new ChannelError('contested');
      throw new ChannelError(head.revoked.some((r) => r.keyId === h2.keyId) ? 'revoked' : 'unknown-machine');
    }
    const h2bare = bare(h2);
    let z: Uint8Array<ArrayBuffer>;
    try {
      z = await sharedSecret(ephemeral, h2.e);
    } catch {
      throw new ChannelError('malformed');
    }
    const secrets = await handshakeSecrets(z, h1, h2bare);
    if (!(await macVerifies(secrets.kmR, machineMacInput(options.machine, h2.keyId), h2.mac))) throw new ChannelError('bad-mac');
    if (!(await verifyInput(machineTranscript(h1, h2bare), h2.sig, machinePub))) throw new ChannelError('bad-signature');

    const h3bare: Fields = { t: 'h3', ...(head.version > h2.stateVersion ? pageFrom(org, h2.stateVersion, { t: 'h3', sig: SIG_PLACEHOLDER, mac: MAC_PLACEHOLDER }, pageBytes) : {}) };
    const sig = await signBody(SIGNING_DOMAINS.rl2, { role: 'device', h1, h2: h2bare, h3: h3bare }, me.channelKey.privateKey, me.channelKey.pub);
    const mac = await handshakeMac(secrets.kmI, deviceMacInput(me.member, me.device));
    io.send(encoded({ ...h3bare, sig, mac }));

    const clock = () => now().getTime();
    const peer: PeerInfo = { protocol: h2.protocol, build: h2.build, capabilities: h2.capabilities, stateVersion: h2.stateVersion };
    const channel = new SealedChannel(io, inbox, new FrameSealer(secrets.i2r, { now: clock }), new FrameOpener(secrets.r2i), secrets.channelId, peer);
    try {
      await channel.whenFirst(timeoutMs);
    } catch (error) {
      const stateVersion = error instanceof ChannelError ? error.stateVersion : undefined;
      const reason = error instanceof ChannelError ? error.reason : 'closed';
      throw new ChannelError(reason, { stateVersion, advanced: reason === 'behind' && stateVersion !== undefined && stateVersion > h2.stateVersion });
    }
    return channel;
  } catch (error) {
    throw refused(io, error);
  }
}

/**
 * The endpoint's end: reads `h1` (at most `H1_MAX_BYTES`) for its own ref and org, answers `h2` with the page the
 * device lacks, adopts `h3`'s page, then admits the device only as its head lists it: of the class it claims, not
 * revoked, under a member still in the state. Nothing else is read before `h3` verifies.
 */
export async function acceptChannel(io: ByteDuplex, me: MachineIdentity, org: OrgView, options: HandshakeOptions = {}): Promise<{ channel: Channel; peer: DevicePeer }> {
  const inbox = new Inbox(io);
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const pageBytes = options.pageBytes ?? HANDSHAKE_PAGE_BYTES;
  const clock = () => (options.now ?? (() => new Date()))().getTime();
  try {
    const h1 = readJson(await inbox.next(timeoutMs), H1_MAX_BYTES);
    if (!isH1(h1)) throw new ChannelError('malformed');
    if (h1.protocol.major !== RL2_PROTOCOL.major) throw new ChannelError('protocol');
    const start = org.head().state;
    if (h1.machine !== me.ref || h1.org !== start.org) throw new ChannelError('wrong-machine');
    const ephemeral = options.ephemeral ?? (await generateEphemeral());
    const base: Fields = {
      t: 'h2',
      protocol: { ...RL2_PROTOCOL },
      build: me.build,
      capabilities: me.capabilities,
      stateVersion: start.version,
      keyId: await keyId(me.key.pub),
      e: ephemeral.pub,
      n: options.nonce ?? random(NONCE_BYTES),
    };
    const h2bare: Fields = { ...base, ...(h1.stateVersion < start.version ? pageFrom(org, h1.stateVersion, { ...base, sig: SIG_PLACEHOLDER, mac: MAC_PLACEHOLDER }, pageBytes) : {}) };
    let z: Uint8Array<ArrayBuffer>;
    try {
      z = await sharedSecret(ephemeral, h1.e);
    } catch {
      throw new ChannelError('malformed');
    }
    const secrets = await handshakeSecrets(z, h1, h2bare);
    const sig = await signBody(SIGNING_DOMAINS.rl2, { role: 'machine', h1, h2: h2bare }, me.key.privateKey, me.key.pub);
    const mac = await handshakeMac(secrets.kmR, machineMacInput(me.ref, base.keyId as string));
    io.send(encoded({ ...h2bare, sig, mac }));

    const h3 = readJson(await inbox.next(timeoutMs), pageBytes);
    if (!isH3(h3)) throw new ChannelError('malformed');
    await org.advance(h3.states ?? [], h3.transitions ?? []);
    const head = org.head().state;
    const channel = () => new SealedChannel(io, inbox, new FrameSealer(secrets.r2i, { now: clock }), new FrameOpener(secrets.i2r), secrets.channelId, { protocol: h1.protocol, build: h1.build, capabilities: h1.capabilities, stateVersion: h1.stateVersion });
    if (head.revoked.some((r) => r.keyId === h3.sig.kid)) throw new ChannelError('revoked');
    const device = head.members.find((m) => m.id === h1.member)?.devices.find((d) => d.id === h1.device);
    // A head below the device's that doesn't hold the device as it signed (no entry, or an older one: another class or
    // key) is still catching up: the next page may carry the entry it signed with.
    const resolved = device !== undefined && device.class === h1.clientClass && (await keyId(device.channelPub)) === h3.sig.kid;
    if (!resolved && head.version < h1.stateVersion) {
      // The device has verified h2, so this close is the machine's: it reconnects with the next page.
      await channel().closeWith('behind', head.version);
      throw new ChannelError('behind', { stateVersion: head.version, advanced: head.version > start.version });
    }
    if (device === undefined) throw new ChannelError('unknown-device');
    if (device.class !== h1.clientClass) throw new ChannelError('class');
    if ((await keyId(device.channelPub)) !== h3.sig.kid) throw new ChannelError('bad-signature');
    if (!(await macVerifies(secrets.kmI, deviceMacInput(h1.member, h1.device), h3.mac))) throw new ChannelError('bad-mac');
    if (!(await verifyInput(deviceTranscript(h1, h2bare, bare(h3)), h3.sig, device.channelPub))) throw new ChannelError('bad-signature');
    const accepted = channel();
    return {
      channel: accepted,
      peer: { ...accepted.peer, member: h1.member, device: h1.device, clientClass: h1.clientClass, channelPub: device.channelPub },
    };
  } catch (error) {
    throw refused(io, error);
  }
}

/**
 * `openChannel` over a fresh carrier from `dial` for each connection a catch-up takes: it reconnects after a `behind`
 * that advanced either side's head, up to `maxConnections`, and answers any other refusal at once. A connection that
 * advanced neither means the next successor is over a page: that state comes only from the hub.
 */
export async function connectChannel(
  dial: () => ByteDuplex | Promise<ByteDuplex>,
  me: DeviceIdentity,
  org: OrgView,
  options: HandshakeOptions & { machine: string; maxConnections?: number },
): Promise<Channel> {
  const max = options.maxConnections ?? MAX_CATCH_UP_CONNECTIONS;
  for (let connection = 1; ; connection++) {
    try {
      return await openChannel(await dial(), me, org, options);
    } catch (error) {
      if (!(error instanceof ChannelError) || error.reason !== 'behind' || !error.advanced || connection >= max) throw error;
    }
  }
}
