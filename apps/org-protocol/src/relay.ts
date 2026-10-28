// RL1, endpoint ↔ hub (the remote layer's Interfaces; O11's Interfaces §C): one WebSocket per endpoint, carrying
//   - text messages (JSON): the endpoint's `hello` and the hub's `welcome`, DX2's log plane as it is today (its frames
//     are desk-hub's `protocol/machine.ts`), `hb`/`hb-ack` with the lease, the machine's signed `listing` and `endpoint`
//     records, `notify` of a session's state, and the hub's `state` notice;
//   - binary messages, the channel multiplex: `[u8 type][u32 channel, big-endian][payload]`, `type` 1 open, 2 data,
//     3 close. The hub relays them without reading the payload, which is RL2's sealed channel.
// An app's socket to the machine's object carries the same binary messages. The app opens a channel with `open`, its
// channel field a tag of its own choosing; the hub assigns the channel id, unique per endpoint connection, tells the
// endpoint `open [id][the app's payload]`, and answers the app `open [id][the tag, u32]`. A refused open is answered
// the same, then `close [id][reason]` at once. `close`'s payload is a u16 reason (`CHANNEL_CLOSE`).
import { isMachineRef } from './names.ts';
import type { EndpointRecord, Listing, Signed } from './types.ts';

/** RL1's version, carried in the endpoint's `hello`; a hub refuses a major it does not speak. */
export const RL1_PROTOCOL = { major: 1, minor: 0 } as const;

/** Every RL1 message, text or binary, is at most 1 MiB (RL §4.2); the hub closes a socket that sends a larger one with
 * 1009. A channel's payload is at most 256 KiB of plaintext and RL2's seal around it. */
export const RL1_MESSAGE_LIMIT = 1024 * 1024;

/** An app's socket holds at most this many channels at once (its channel list rides in a 2 KiB attachment). */
export const MAX_CHANNELS_PER_SOCKET = 64;

export const CHANNEL_HEADER_BYTES = 5;

const TYPES = { open: 1, data: 2, close: 3 } as const;
export type ChannelFrameType = keyof typeof TYPES;
const TYPE_NAMES: Record<number, ChannelFrameType> = { 1: 'open', 2: 'data', 3: 'close' };

/** A channel's close reasons, as `close`'s u16 payload. */
export const CHANNEL_CLOSE_REASONS = {
  /** Either end closed it. */
  closed: 0,
  /** The endpoint's connection ended (a reconnect, a replacement, a revocation): the app opens it again. */
  'endpoint-gone': 1,
  /** The app's socket ended. */
  'app-gone': 2,
  /** The channel id names no channel of this socket. */
  'unknown-channel': 3,
  /** The app's socket already holds `MAX_CHANNELS_PER_SOCKET` channels. */
  'too-many-channels': 4,
} as const;
export type ChannelCloseReason = keyof typeof CHANNEL_CLOSE_REASONS;

/** Each close reason's u16 payload, ready to send. */
export const CHANNEL_CLOSE = Object.fromEntries(
  Object.entries(CHANNEL_CLOSE_REASONS).map(([name, code]) => [name, new Uint8Array([code >> 8, code & 0xff])]),
) as Record<ChannelCloseReason, Uint8Array<ArrayBuffer>>;

export type ChannelFrame = { type: ChannelFrameType; channel: number; payload: Uint8Array };

/** One binary message of the multiplex. */
export function encodeChannelFrame(type: ChannelFrameType, channel: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xffffffff) throw new TypeError('a channel id is a u32');
  const frame = new Uint8Array(CHANNEL_HEADER_BYTES + payload.length);
  frame[0] = TYPES[type];
  new DataView(frame.buffer).setUint32(1, channel);
  frame.set(payload, CHANNEL_HEADER_BYTES);
  return frame;
}

/** A binary message read as a channel frame, its payload a view of the message; null for one that is not one. */
export function decodeChannelFrame(message: ArrayBuffer | Uint8Array): ChannelFrame | null {
  const bytes = message instanceof Uint8Array ? message : new Uint8Array(message);
  if (bytes.length < CHANNEL_HEADER_BYTES) return null;
  const type = TYPE_NAMES[bytes[0]];
  if (type === undefined) return null;
  const channel = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
  return { type, channel, payload: bytes.subarray(CHANNEL_HEADER_BYTES) };
}

/** A `close` payload's reason by name; null for a payload that is not a u16 or a code this version does not name. */
export function closeReasonName(payload: Uint8Array): ChannelCloseReason | null {
  if (payload.length !== 2) return null;
  const code = (payload[0] << 8) | payload[1];
  const found = Object.entries(CHANNEL_CLOSE_REASONS).find(([, value]) => value === code);
  return found ? (found[0] as ChannelCloseReason) : null;
}

/** The app's tag in the hub's answer to its `open` (a u32); null for a payload that is not one. */
export function openTag(payload: Uint8Array): number | null {
  if (payload.length !== 4) return null;
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0);
}

/** A tag as the `open` answer's payload. */
export function tagBytes(tag: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, tag);
  return out;
}

// ---- Text frames (the log plane's are DX2's, desk-hub's protocol/machine.ts) -------------------------------------------

/**
 * The endpoint's first message on its socket. `machine` is its ref (RL DL 19), which the hub matches against the
 * credential's own. `leaseGeneration` is the generation it held before, when it held one.
 */
export type EndpointHello = { t: 'hello'; protocol: { major: number; minor: number }; build: string; machine: string; leaseGeneration?: number };
/** The hub's answer to `hello`: this connection's generation (one counter with DX2's streams), and how often the
 * endpoint sends `hb`. */
export type Rl1Welcome = { t: 'welcome'; generation: number; heartbeat_ms: number };
/** The endpoint's heartbeat, every `heartbeat_ms`: the hub renews the machine's lease in every project this connection
 * opened and answers `hb-ack`. */
export type Rl1Heartbeat = { t: 'hb'; generation: number };
export type Rl1HeartbeatAck = { t: 'hb-ack'; generation: number };
/** A machine-signed listing (RL6's projection) for the hub to keep and serve to the org's apps; one in `LISTING_GONE` withdraws its session. */
export type ListingFrame = { t: 'listing'; record: Signed<Listing> };
/** The machine's endpoint record (RL §4.1's direct carriers). */
export type EndpointRecordFrame = { t: 'endpoint'; record: Signed<EndpointRecord> };
export type NotifyKind = 'waiting' | 'wrote' | 'settled';
/** A session's state: `waiting` and `wrote` push to its listed owners' devices; `pending` is its count for badges. */
export type NotifyFrame = { t: 'notify'; session: string; project: string; kind: NotifyKind; pending: number };
/** The org state advanced to `version`: the endpoint reads `GET /machine/org/state?since=<held>`. */
export type StateNotice = { t: 'state'; version: number };
/** The hub refused a text frame (`frame` its `t`), and keeps the socket: `422 not-on-rl1` for a DX4/DX6 session-plane
 * frame, a record's refusal as the Registry answered it (`session` and `revision` name a listing, `issued` an endpoint
 * record). */
export type Rl1Refusal = { t: 'refusal'; frame: string; status: number; error: string; message?: string; session?: string; revision?: number; issued?: string };

/** What the hub tells each app socket of a machine: whether its endpoint is connected, and each session's pending
 * count the endpoint last notified (sessions with none are left out). */
export type RelayPresence = { t: 'presence'; online: boolean; pending: Record<string, { project: string; kind: NotifyKind; pending: number }> };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

export function isEndpointHello(frame: unknown): frame is EndpointHello {
  if (!isObject(frame) || frame.t !== 'hello' || 'project' in frame) return false;
  const { protocol } = frame;
  return (
    isObject(protocol) &&
    isCount(protocol.major, 0) &&
    isCount(protocol.minor, 0) &&
    isText(frame.build, 256) &&
    isMachineRef(frame.machine) &&
    (frame.leaseGeneration === undefined || isCount(frame.leaseGeneration, 1))
  );
}

export function isRl1Heartbeat(frame: unknown): frame is Rl1Heartbeat {
  return isObject(frame) && frame.t === 'hb' && isCount(frame.generation, 1);
}

export function isNotify(frame: unknown): frame is NotifyFrame {
  return (
    isObject(frame) &&
    frame.t === 'notify' &&
    isText(frame.session, 256) &&
    isText(frame.project, 256) &&
    (frame.kind === 'waiting' || frame.kind === 'wrote' || frame.kind === 'settled') &&
    isCount(frame.pending, 0)
  );
}
