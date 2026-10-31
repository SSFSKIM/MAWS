// The screencast channel's framing (lib/wire.mjs): what the render host and the viewer exchange over the unix socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeControl, encodeFrame, channelDecoder } from './wire.mjs';

test('a control message survives the round trip', () => {
  const decode = channelDecoder();
  assert.deepEqual(decode(encodeControl({ op: 'click', id: 3, x: 10, y: 20 })), [{ kind: 'control', body: { op: 'click', id: 3, x: 10, y: 20 } }]);
});

test('a frame carries its metadata and its JPEG bytes unchanged', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]);
  const [message] = channelDecoder()(encodeFrame({ seq: 7, cdpTimestamp: 1.5 }, jpeg));
  assert.equal(message.kind, 'frame');
  assert.deepEqual(message.meta, { seq: 7, cdpTimestamp: 1.5 });
  assert.deepEqual(message.data, jpeg);
});

test('messages split across chunks and packed into one chunk both decode in order', () => {
  const wire = Buffer.concat([encodeControl({ op: 'a' }), encodeFrame({ seq: 1 }, Buffer.alloc(1000, 9)), encodeControl({ op: 'b' })]);
  const decode = channelDecoder();
  const out = [];
  for (let at = 0; at < wire.length; at += 7) out.push(...decode(wire.subarray(at, at + 7)));
  assert.deepEqual(out.map((m) => (m.kind === 'control' ? m.body.op : `frame ${m.data.length}`)), ['a', 'frame 1000', 'b']);
  assert.deepEqual(channelDecoder()(wire).length, 3);
});

test('an unknown message kind is refused', () => {
  const bad = Buffer.alloc(5);
  bad.writeUInt32LE(1, 0);
  bad[4] = 9;
  assert.throws(() => channelDecoder()(bad), /unknown message kind 9/);
});
