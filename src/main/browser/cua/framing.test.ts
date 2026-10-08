import { describe, expect, it } from 'vitest';
import { createPeer, encodeFrame, frameDecoder, NO_HANDLER, type RpcMessage } from './framing';

// The extension protocol's wire (cua's src/chrome/protocol.mjs, version 1): a u32 byte length in the host's native order
// (little-endian on every Mac MAWS ships for), then that many bytes of UTF-8 JSON-RPC 2.0.

describe('framing', () => {
  it('round-trips messages across arbitrary chunk boundaries, several to a chunk', () => {
    const bytes = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 'ü' }), encodeFrame({ c: [1, 2] })]);
    expect(bytes.readUInt32LE(0)).toBe(Buffer.byteLength('{"a":1}'));
    const push = frameDecoder(1024);
    const out: unknown[] = [];
    for (let i = 0; i < bytes.length; i += 3) out.push(...push(bytes.subarray(i, i + 3)));
    expect(out).toEqual([{ a: 1 }, { b: 'ü' }, { c: [1, 2] }]);
  });

  it('throws on a declared length over the limit, before buffering the body', () => {
    const push = frameDecoder(8);
    expect(() => push(encodeFrame({ long: 'x'.repeat(20) }).subarray(0, 4))).toThrow(/exceeds/);
  });
});

describe('the JSON-RPC peer', () => {
  function pair() {
    const wire: RpcMessage[] = [];
    const left = createPeer({
      send: (frame) => wire.push(...frameDecoder()(frame)),
      handlers: {
        echo: (params) => params,
        fail: () => {
          throw new Error('nope');
        },
        note: (params) => void notes.push(params),
      },
    });
    const notes: unknown[] = [];
    return { left, wire, notes };
  }

  it('answers requests with their result, a throw as code 1 with its message, an unknown method as code -1', async () => {
    const { left, wire } = pair();
    left.receive({ jsonrpc: '2.0', id: 1, method: 'echo', params: { x: 1 } });
    left.receive({ jsonrpc: '2.0', id: 2, method: 'fail', params: {} });
    left.receive({ jsonrpc: '2.0', id: 3, method: 'nothing', params: {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(wire.sort((a, b) => Number(a.id) - Number(b.id))).toEqual([
      { jsonrpc: '2.0', id: 1, result: { x: 1 } },
      { jsonrpc: '2.0', id: 2, error: { code: 1, message: 'nope' } },
      { jsonrpc: '2.0', id: 3, error: { code: -1, message: NO_HANDLER('nothing') } },
    ]);
  });

  it('runs notifications without answering, and notifies the other side', async () => {
    const { left, wire, notes } = pair();
    left.receive({ jsonrpc: '2.0', method: 'note', params: { y: 2 } });
    left.notify('hello', { z: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(notes).toEqual([{ y: 2 }]);
    expect(wire).toEqual([{ jsonrpc: '2.0', method: 'hello', params: { z: 3 } }]);
  });

  it('a reply over the frame limit becomes the error message_too_large; after close nothing is sent', async () => {
    const wire: RpcMessage[] = [];
    const peer = createPeer({ send: (frame) => wire.push(...frameDecoder()(frame)), handlers: { big: () => 'x'.repeat(100) }, maxFrameBytes: 90 });
    peer.receive({ jsonrpc: '2.0', id: 7, method: 'big', params: {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(wire).toEqual([{ jsonrpc: '2.0', id: 7, error: { code: 1, message: 'message_too_large' } }]);
    peer.close();
    peer.notify('late', {});
    peer.receive({ jsonrpc: '2.0', id: 8, method: 'big', params: {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(wire).toHaveLength(1);
  });
});
