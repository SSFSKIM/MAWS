// The document frames both ends of a document port speak (X24; P3-0's S2 codec, `spikes/p3-store/s2/src/frames.ts`):
// y-protocols' own types, `0` sync (step 1, step 2, update) and `1` awareness, plus two MAWS types only the host sends:
// `ack` (100), which tells a replica how many content frames it sent on this connection are durable and what the doc's
// live revision is, and `restored` (101), sent after a restore's update, so an editor can drop its undo history across
// the restore and say "Restored from …" (this child's Decision Log 16), and, P4-A2 (X35; the P4 interface ledger §3, an
// X24 additive touch), `provisional` (102), the agent's streaming edit as JSON text. y-protocols leaves 2 (auth) and 3
// (query) to others. Every frame is an exact-size Uint8Array (structured clone ships a view's whole buffer).
//
// P4-A2: a `step2` carries the doc's revision at the diff and an `update` the seq of the row it is (0 from a replica,
// whose rows the host numbers), so a replica knows which rows it has integrated (`PortProvider.state.integrated`) and
// withdraws a provisional layer only once the write it stands for has landed (rule 2 of the spec §4.2).
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const MSG_ACK = 100; // [100, durableFrames, revision]
export const MSG_RESTORED = 101; // [101, revision, versionId]
export const MSG_PROVISIONAL = 102; // [102, json]: P4-A2, host-only, the `ArtifactProvisional` shape (src/shared/artifacts/provisional.ts)
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export type Frame =
  | { type: 'step1'; sv: Uint8Array }
  | { type: 'step2'; update: Uint8Array; revision?: number } // P4-A2: the doc's revision the diff reaches (absent or 0: unknown, a replica's or a test's)
  | { type: 'update'; update: Uint8Array; seq?: number } // P4-A2: the row's seq (absent or 0: unknown, a replica's own row, which the host numbers)
  | { type: 'awareness'; update: Uint8Array }
  | { type: 'ack'; frames: number; revision: number }
  | { type: 'restored'; revision: number; versionId: number }
  | { type: 'provisional'; json: string }; // P4-A2 (X35)

// Throws on anything that is not exactly one well-formed frame; callers treat a throw as a broken peer.
export function decodeFrame(data: unknown): Frame {
  if (!(data instanceof Uint8Array)) throw new Error(`a frame that is not bytes (${typeof data})`);
  const decoder = decoding.createDecoder(data);
  const type = decoding.readVarUint(decoder);
  let frame: Frame;
  if (type === MSG_SYNC) {
    const sub = decoding.readVarUint(decoder);
    const body = decoding.readVarUint8Array(decoder);
    if (sub === SYNC_STEP1) frame = { type: 'step1', sv: body };
    else if (sub === SYNC_STEP2) frame = { type: 'step2', update: body, revision: decoding.readVarUint(decoder) };
    else if (sub === SYNC_UPDATE) frame = { type: 'update', update: body, seq: decoding.readVarUint(decoder) };
    else throw new Error(`an unknown sync message ${sub}`);
  } else if (type === MSG_AWARENESS) {
    frame = { type: 'awareness', update: decoding.readVarUint8Array(decoder) };
  } else if (type === MSG_ACK) {
    frame = { type: 'ack', frames: decoding.readVarUint(decoder), revision: decoding.readVarUint(decoder) };
  } else if (type === MSG_RESTORED) {
    frame = { type: 'restored', revision: decoding.readVarUint(decoder), versionId: decoding.readVarUint(decoder) };
  } else if (type === MSG_PROVISIONAL) {
    frame = { type: 'provisional', json: decoding.readVarString(decoder) };
  } else {
    throw new Error(`an unknown frame type ${type}`);
  }
  // lib0 reads past the end without throwing in some paths: insist on an exact fit.
  if (decoder.pos !== data.length) throw new Error(`a frame with ${data.length - decoder.pos} trailing bytes or a short read`);
  return frame;
}

export function encodeFrame(frame: Frame): Uint8Array {
  const encoder = encoding.createEncoder();
  switch (frame.type) {
    case 'step1':
      encoding.writeVarUint(encoder, MSG_SYNC);
      encoding.writeVarUint(encoder, SYNC_STEP1);
      encoding.writeVarUint8Array(encoder, frame.sv);
      break;
    case 'step2':
      encoding.writeVarUint(encoder, MSG_SYNC);
      encoding.writeVarUint(encoder, SYNC_STEP2);
      encoding.writeVarUint8Array(encoder, frame.update);
      encoding.writeVarUint(encoder, frame.revision ?? 0);
      break;
    case 'update':
      encoding.writeVarUint(encoder, MSG_SYNC);
      encoding.writeVarUint(encoder, SYNC_UPDATE);
      encoding.writeVarUint8Array(encoder, frame.update);
      encoding.writeVarUint(encoder, frame.seq ?? 0);
      break;
    case 'awareness':
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(encoder, frame.update);
      break;
    case 'ack':
      encoding.writeVarUint(encoder, MSG_ACK);
      encoding.writeVarUint(encoder, frame.frames);
      encoding.writeVarUint(encoder, frame.revision);
      break;
    case 'restored':
      encoding.writeVarUint(encoder, MSG_RESTORED);
      encoding.writeVarUint(encoder, frame.revision);
      encoding.writeVarUint(encoder, frame.versionId);
      break;
    case 'provisional':
      encoding.writeVarUint(encoder, MSG_PROVISIONAL);
      encoding.writeVarString(encoder, frame.json);
      break;
  }
  return encoding.toUint8Array(encoder);
}

// A content frame is one the host acknowledges: it may carry document state.
export const isContent = (frame: Frame): boolean => frame.type === 'step2' || frame.type === 'update';
// Frames only the host may send; the host refuses one from a replica and closes that connection.
export const isHostOnly = (frame: Frame): boolean => frame.type === 'ack' || frame.type === 'restored' || frame.type === 'provisional';
