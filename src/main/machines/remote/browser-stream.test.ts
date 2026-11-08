// The device's half of a `browser.screencast` stream (P5 O17 M9a; O17's Interfaces §K): its open over the link's stream
// table, frames read whole from chunks at their offsets, the endpoint's byte credit refunded per chunk (a maximum frame is
// past the opening credit), frame credit only by the consumer's `ack`, its input on `streamControl`, and its end.
import { encodeScreencastFrame, STREAM_CHUNK_BYTES, SCREENCAST_JPEG_MAX, type DeviceMessage, type EndpointMessage, type ScreencastFrame } from 'org-protocol';
import { describe, expect, it } from 'vitest';
import type { BrowserFrame } from '@shared/browser/screencast';
import { openBrowserStream, type BrowserStreamSink } from './browser-stream';
import { StreamTable, STREAM_OPEN_CREDIT } from './streams';

const OPEN = { appSessionId: 'app-1', epoch: 'e1', tabId: 'b_000000000001' };

function harness(peer = ['rl2.streams', 'rl2.read-open', 'rl2.browser-screencast']) {
  const sent: DeviceMessage[] = [];
  const logs: string[] = [];
  const table = new StreamTable({ send: (m) => (sent.push(m), true), current: () => true, peerCapabilities: () => peer, log: (line) => void logs.push(line) });
  const heard: Array<[string, ...unknown[]]> = [];
  const sink: BrowserStreamSink = {
    opened: (view) => void heard.push(['opened', view]),
    frame: (frame) => void heard.push(['frame', frame]),
    closed: (reason) => void heard.push(['closed', reason]),
  };
  const link = { openStream: (request: Parameters<StreamTable['open']>[0], streamSink: Parameters<StreamTable['open']>[1]) => table.open(request, streamSink, null) };
  const of = (t: string) => sent.filter((m) => m.t === t) as Array<DeviceMessage & Record<string, unknown>>;
  const id = () => (of('streamOpen')[0] as { id: string }).id;
  const endpoint = (m: Record<string, unknown>) => table.receive({ id: id(), ...m } as EndpointMessage);
  return { table, sent, heard, sink, link, of, id, endpoint, logs };
}

const frame = (seq: number, jpegBytes: number): ScreencastFrame => ({
  epoch: 'e1',
  tabId: 'b_000000000001',
  seq,
  capturedAt: seq * 10,
  width: 1280,
  height: 800,
  viewport: { width: 1280, height: 800 },
  jpeg: Uint8Array.from({ length: jpegBytes }, (_, i) => (i * 13 + seq) & 0xff),
});
/** `bytes` as the endpoint sends them: chunks of at most 64 KiB at continuous offsets from `from`. */
function data(h: ReturnType<typeof harness>, bytes: Uint8Array, from = 0, size = STREAM_CHUNK_BYTES): void {
  for (let at = 0; at < bytes.byteLength; at += size) h.endpoint({ t: 'streamData', offset: from + at, data: Buffer.from(bytes.subarray(at, Math.min(at + size, bytes.byteLength))).toString('base64url') });
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('a screencast on the link', () => {
  it('opens the kind with its fields under the default credit, and hands the consumer what the answer views', () => {
    const h = harness();
    openBrowserStream(h.link, { ...OPEN, control: { op: 'op-0000000000000001' } }, h.sink);
    expect(h.of('streamOpen')).toEqual([{ t: 'streamOpen', id: h.id(), kind: 'browser.screencast', credit: STREAM_OPEN_CREDIT, browser: { ...OPEN, control: { op: 'op-0000000000000001' } } }]);
    h.endpoint({ t: 'streamOpened', credit: 1024, browser: { epoch: 'e1', tabId: OPEN.tabId, control: true } });
    expect(h.heard).toEqual([['opened', { epoch: 'e1', tabId: OPEN.tabId, control: true }]]);
  });

  // Its own timeout: a maximum frame read across chunks and compared whole is CPU-bound, 4.0 s of the default 5 s on a
  // 4-vCPU hosted Linux runner as the one unit job, and 5.06 s twice in a 4-way shard there (42457114696).
  it('reads a maximum frame and the one after it whole across chunks, refunding each chunk’s bytes as it comes, so the 1 MiB opening credit never stalls it', { timeout: 20_000 }, () => {
    const h = harness();
    openBrowserStream(h.link, OPEN, h.sink);
    h.endpoint({ t: 'streamOpened', credit: 1024, browser: { epoch: 'e1', tabId: OPEN.tabId, control: false } });
    const big = encodeScreencastFrame(frame(1, SCREENCAST_JPEG_MAX));
    expect(big.byteLength).toBeGreaterThan(STREAM_OPEN_CREDIT);
    data(h, big);
    const small = encodeScreencastFrame(frame(2, 100));
    data(h, small, big.byteLength, 7);
    const frames = h.heard.filter(([kind]) => kind === 'frame').map(([, f]) => f as BrowserFrame);
    expect(frames).toEqual([frame(1, SCREENCAST_JPEG_MAX), frame(2, 100)]);
    expect(h.of('streamCredit').reduce((n, m) => n + (m.bytes as number), 0)).toBe(big.byteLength + small.byteLength);
    expect(h.of('streamClose')).toEqual([]);
    expect(h.logs).toEqual([]);
  });

  it('acknowledges a frame and sends input only when the consumer says so, each on `streamControl`', () => {
    const h = harness();
    const s = openBrowserStream(h.link, OPEN, h.sink);
    s.ack(3); // before the answer: held until it comes
    h.endpoint({ t: 'streamOpened', credit: 1024, browser: { epoch: 'e1', tabId: OPEN.tabId, control: true } });
    s.input(1, { kind: 'text', text: 'hi' });
    s.ack(4);
    expect(h.of('streamControl').map((m) => m.control)).toEqual([{ ack: { seq: 3 } }, { input: { seq: 1, event: { kind: 'text', text: 'hi' } } }, { ack: { seq: 4 } }]);
  });

  it('closes `malformed` an envelope out of shape or a chunk off its offset, delivering nothing of it, and tells the consumer', () => {
    for (const bad of [
      (h: ReturnType<typeof harness>) => data(h, new Uint8Array([0, 0, 0x20, 0])), // metadata past 4 KiB
      (h: ReturnType<typeof harness>) => data(h, encodeScreencastFrame(frame(1, 10)), 5),
    ]) {
      const h = harness();
      const s = openBrowserStream(h.link, OPEN, h.sink);
      h.endpoint({ t: 'streamOpened', credit: 1024, browser: { epoch: 'e1', tabId: OPEN.tabId, control: false } });
      bad(h);
      expect(h.of('streamClose')).toEqual([{ t: 'streamClose', id: h.id(), reason: 'malformed' }]);
      expect(h.heard.slice(1)).toEqual([['closed', 'malformed']]);
      s.ack(1);
      expect(h.of('streamControl')).toEqual([]);
    }
  });

  it('ends with the endpoint’s word, `not-offered` from an endpoint without the capability, and says nothing after its own close', async () => {
    const h = harness();
    openBrowserStream(h.link, OPEN, h.sink);
    h.endpoint({ t: 'streamOpened', credit: 1024, browser: { epoch: 'e1', tabId: OPEN.tabId, control: false } });
    h.endpoint({ t: 'streamClose', reason: 'control-revoked' });
    expect(h.heard.at(-1)).toEqual(['closed', 'control-revoked']);
    const old = harness(['rl2.streams', 'rl2.read-open']);
    openBrowserStream(old.link, OPEN, old.sink);
    await tick();
    expect(old.heard).toEqual([['closed', 'not-offered']]);
    expect(old.sent).toEqual([]);
    const mine = harness();
    const t = openBrowserStream(mine.link, OPEN, mine.sink);
    t.close();
    expect(mine.of('streamClose')).toEqual([{ t: 'streamClose', id: mine.id(), reason: 'closed' }]);
    expect(mine.heard).toEqual([]);
  });
});
