// The screencast channel between the render host and a viewer (the stand-in for an RL2 kind): a u32 little-endian
// length, then one byte of kind, then the body. Kind 1 is a JSON control message (either direction: start, ack, click,
// stop; started, clicked, metrics). Kind 2 is a frame, host to viewer: a u32 length of JSON metadata, the metadata, then
// the JPEG bytes as CDP's `Page.screencastFrame` gave them (base64-decoded), so the bytes counted are the image's own.
const CONTROL = 1;
const FRAME = 2;

const framed = (kind, body) => {
  const out = Buffer.alloc(5 + body.length);
  out.writeUInt32LE(1 + body.length, 0);
  out[4] = kind;
  body.copy(out, 5);
  return out;
};

export const encodeControl = (message) => framed(CONTROL, Buffer.from(JSON.stringify(message), 'utf8'));

export function encodeFrame(meta, data) {
  const json = Buffer.from(JSON.stringify(meta), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(json.length, 0);
  return framed(FRAME, Buffer.concat([head, json, data]));
}

// push(chunk) → the messages completed so far, in order; throws on a kind it does not know.
export function channelDecoder() {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
    const out = [];
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0);
      if (pending.length < 4 + length) break;
      const kind = pending[4];
      const body = pending.subarray(5, 4 + length);
      pending = pending.subarray(4 + length);
      if (kind === CONTROL) out.push({ kind: 'control', body: JSON.parse(body.toString('utf8')) });
      else if (kind === FRAME) {
        const metaLength = body.readUInt32LE(0);
        out.push({ kind: 'frame', meta: JSON.parse(body.subarray(4, 4 + metaLength).toString('utf8')), data: Buffer.from(body.subarray(4 + metaLength)) });
      } else throw new Error(`unknown message kind ${kind}`);
    }
    return out;
  };
}
