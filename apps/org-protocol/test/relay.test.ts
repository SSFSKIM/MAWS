// RL1's own shapes (Interfaces §C): the channel multiplex's binary frames, and the endpoint's text frames that are not
// DX2's log plane. Both ends and the hub read them through these, so a frame one writes the others parse alike.
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_CLOSE,
  CHANNEL_HEADER_BYTES,
  closeReasonName,
  decodeChannelFrame,
  encodeChannelFrame,
  isEndpointHello,
  isNotify,
  isRl1Heartbeat,
  openTag,
  RL1_MESSAGE_LIMIT,
  RL1_PROTOCOL,
} from '../src/relay.ts';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('the channel multiplex', () => {
  it('is [u8 type][u32 channel, big-endian][payload]', () => {
    const frame = encodeChannelFrame('data', 0x01020304, bytes(9, 8, 7));
    expect([...frame]).toEqual([2, 1, 2, 3, 4, 9, 8, 7]);
    expect(CHANNEL_HEADER_BYTES).toBe(5);
  });

  it('round-trips each type, the empty payload and the largest channel id', () => {
    for (const type of ['open', 'data', 'close'] as const) {
      const decoded = decodeChannelFrame(encodeChannelFrame(type, 0xffffffff, bytes()));
      expect(decoded).toEqual({ type, channel: 0xffffffff, payload: bytes() });
    }
  });

  it('decodes from an ArrayBuffer as a WebSocket delivers it, and views the payload without copying', () => {
    const encoded = encodeChannelFrame('data', 7, bytes(1, 2, 3));
    const decoded = decodeChannelFrame(encoded.buffer)!;
    expect(decoded.channel).toBe(7);
    expect([...decoded.payload]).toEqual([1, 2, 3]);
    expect(decoded.payload.buffer).toBe(encoded.buffer);
  });

  it('refuses a frame shorter than its header, an unknown type, and a channel id out of range', () => {
    expect(decodeChannelFrame(bytes(2, 0, 0, 0))).toBeNull();
    expect(decodeChannelFrame(bytes(4, 0, 0, 0, 1))).toBeNull();
    expect(decodeChannelFrame(bytes(0, 0, 0, 0, 1))).toBeNull();
    expect(() => encodeChannelFrame('data', -1, bytes())).toThrow(TypeError);
    expect(() => encodeChannelFrame('data', 2 ** 32, bytes())).toThrow(TypeError);
  });

  it("carries close's reason as a u16, and the open answer's tag as a u32", () => {
    const close = decodeChannelFrame(encodeChannelFrame('close', 3, CHANNEL_CLOSE['endpoint-gone']))!;
    expect(close.payload).toHaveLength(2);
    expect(closeReasonName(close.payload)).toBe('endpoint-gone');
    expect(closeReasonName(bytes(0xff, 0xff))).toBeNull();
    expect(closeReasonName(bytes(1))).toBeNull();
    expect(openTag(encodeChannelFrame('open', 9, bytes(0, 0, 1, 0)).subarray(CHANNEL_HEADER_BYTES))).toBe(256);
    expect(openTag(bytes(1, 2))).toBeNull();
  });

  it('bounds a message at 1 MiB, room for a 256 KiB payload and its seal', () => {
    expect(RL1_MESSAGE_LIMIT).toBe(1024 * 1024);
  });
});

describe("the endpoint's text frames", () => {
  const ref = 'Qm9vdHN0cmFwUmVmMDAx';
  it('tells the endpoint hello from a project hello', () => {
    expect(isEndpointHello({ t: 'hello', protocol: RL1_PROTOCOL, build: 'mawsd@1', machine: ref })).toBe(true);
    expect(isEndpointHello({ t: 'hello', protocol: RL1_PROTOCOL, build: 'mawsd@1', machine: ref, leaseGeneration: 4 })).toBe(true);
    expect(isEndpointHello({ t: 'hello', project: '5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', name: 'demo', have: {} })).toBe(false);
    expect(isEndpointHello({ t: 'hello', protocol: { major: 1 }, build: 'x', machine: ref })).toBe(false);
    expect(isEndpointHello({ t: 'hello', protocol: RL1_PROTOCOL, build: 'x', machine: 'not a ref' })).toBe(false);
    expect(isEndpointHello({ t: 'hello', protocol: RL1_PROTOCOL, build: 'x', machine: ref, leaseGeneration: -1 })).toBe(false);
  });

  it('reads a heartbeat by its generation', () => {
    expect(isRl1Heartbeat({ t: 'hb', generation: 3 })).toBe(true);
    expect(isRl1Heartbeat({ t: 'hb', generation: 0 })).toBe(false);
    expect(isRl1Heartbeat({ t: 'hb', at: '2026-10-27T00:00:00.000Z' })).toBe(false);
  });

  it('reads a notify of a session waiting, writing or settled, with its pending count', () => {
    const notify = { t: 'notify', session: 's1', project: '5b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d', kind: 'waiting', pending: 2 };
    expect(isNotify(notify)).toBe(true);
    expect(isNotify({ ...notify, kind: 'settled', pending: 0 })).toBe(true);
    expect(isNotify({ ...notify, kind: 'asked' })).toBe(false);
    expect(isNotify({ ...notify, pending: -1 })).toBe(false);
    expect(isNotify({ ...notify, pending: 1.5 })).toBe(false);
    expect(isNotify({ ...notify, session: '' })).toBe(false);
  });
});
