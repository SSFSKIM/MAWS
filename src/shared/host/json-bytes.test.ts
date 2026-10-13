// P3-A M5 (Decision Log 25l, 34a): the detached JSON line carries a Uint8Array as base64, so the registry's byte fields
// (artifacts.create's bytes, uploadAsset, versionState, attributions) are a Uint8Array on both ends in both modes.
import { describe, expect, it } from 'vitest';
import { BYTES_KEY, decodeJsonLine, encodeJsonLine, ESCAPE_KEY } from './json-bytes';

const roundTrip = (value: unknown) => decodeJsonLine(encodeJsonLine(value));

describe('the bytes codec of the JSON line', () => {
  it('writes a message with no bytes exactly as JSON.stringify does', () => {
    const message = { t: 'evt', name: 'session.eventBatch', payload: { events: [{ id: 'a', text: 'héllo', n: 1, ok: true, none: null, gone: undefined }] } };
    expect(encodeJsonLine(message)).toBe(JSON.stringify(message));
    expect(roundTrip(message)).toEqual(JSON.parse(JSON.stringify(message)));
  });

  it('carries a Uint8Array anywhere in a message as base64 and reads it back as a plain Uint8Array of its own', () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255, 10]);
    const pooled = Buffer.from('a Buffer from the pool'); // a Buffer is a Uint8Array too
    const message = { t: 'res', id: '1', ok: true, value: { bytes, nested: [{ more: pooled }], empty: new Uint8Array(0) } };
    const line = encodeJsonLine(message);
    expect(JSON.parse(line).value.bytes).toEqual({ [BYTES_KEY]: Buffer.from(bytes).toString('base64') });
    const back = roundTrip(message) as { value: { bytes: Uint8Array; nested: [{ more: Uint8Array }]; empty: Uint8Array } };
    expect(back.value.bytes).toEqual(bytes);
    expect(back.value.bytes.constructor).toBe(Uint8Array);
    expect(back.value.bytes.buffer.byteLength).toBe(bytes.length);
    expect(Buffer.from(back.value.nested[0].more).toString()).toBe('a Buffer from the pool');
    expect(back.value.empty).toEqual(new Uint8Array(0));
  });

  it('carries a view into a larger buffer as only its own bytes', () => {
    const backing = Uint8Array.from([9, 9, 1, 2, 3, 9]);
    expect(roundTrip({ bytes: backing.subarray(2, 5) })).toEqual({ bytes: Uint8Array.from([1, 2, 3]) });
  });

  it('keeps plain data that looks like the codec’s own shapes as it was', () => {
    const lookalikes = [
      { [BYTES_KEY]: 'AAEC' },
      { [ESCAPE_KEY]: { [BYTES_KEY]: 'AAEC' } },
      { [ESCAPE_KEY]: 'x' },
      { [BYTES_KEY]: 'AAEC', other: 1 }, // not the codec's shape (two keys), kept as is either way
      [{ [BYTES_KEY]: { [BYTES_KEY]: 'AA==' } }],
    ];
    for (const value of lookalikes) expect(roundTrip({ payload: value }), JSON.stringify(value)).toEqual({ payload: value });
    expect(roundTrip({ [BYTES_KEY]: Uint8Array.from([7]) })).toEqual({ [BYTES_KEY]: Uint8Array.from([7]) });
  });

  it('leaves a malformed base64 field as the object it was, so the schema refuses it as invalid input', () => {
    for (const bad of ['not base64!', 'AAE', 'A===', 12, null]) {
      const line = `{"t":"req","id":"1","name":"artifacts.uploadAsset","input":{"bytes":{"${BYTES_KEY}":${JSON.stringify(bad)}}}}`;
      expect((decodeJsonLine(line) as { input: { bytes: unknown } }).input.bytes, String(bad)).toEqual({ [BYTES_KEY]: bad });
    }
  });

  it('throws on a line that is not JSON, as JSON.parse does', () => {
    expect(() => decodeJsonLine('not json')).toThrow();
  });
});
