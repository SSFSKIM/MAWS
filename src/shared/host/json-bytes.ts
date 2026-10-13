// The bytes codec of the detached JSON line (P3-A M5; docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 25l
// and 34a). JSON has no bytes, and a MessagePort's structured clone keeps a Uint8Array, so the socket port writes each
// Uint8Array of a message as `{"$bytes": "<base64>"}` and reads that shape back as a Uint8Array of its own: the X2
// schemas stay `Uint8Array` in both modes (artifacts.create's bytes, uploadAsset, versionState, attributions, and any
// later field). A field whose base64 is malformed is left as the object it was, so the schema refuses it as any invalid
// input is refused.
//
// Plain data may look like the codec's shapes (an agent's tool input can be any JSON), so an object whose only key is
// `$bytes` or `$plain` is written escaped, `{"$plain": {<that key>: <its value>}}`, and read back as it was. A message
// with neither bytes nor a look-alike is written by JSON.stringify alone (its fast path; one walk decides), and a line
// that names neither key is read by JSON.parse alone.
export const BYTES_KEY = '$bytes';
export const ESCAPE_KEY = '$plain';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function encodeJsonLine(message: unknown): string {
  return JSON.stringify(needsCodec(message) ? toWire(message) : message);
}

// Throws on a line that is not JSON, as JSON.parse does.
export function decodeJsonLine(line: string): unknown {
  const data: unknown = JSON.parse(line);
  return line.includes(`"${BYTES_KEY}"`) || line.includes(`"${ESCAPE_KEY}"`) ? fromWire(data) : data;
}

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

// The one key of an object that has exactly one and it is the codec's, else null.
function codecKey(value: Record<string, unknown>): string | null {
  const keys = Object.keys(value);
  return keys.length === 1 && (keys[0] === BYTES_KEY || keys[0] === ESCAPE_KEY) ? keys[0] : null;
}

function needsCodec(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (value instanceof Uint8Array) return true;
  if (Array.isArray(value)) return value.some(needsCodec);
  if (!isPlainObject(value)) return false;
  if (codecKey(value) !== null) return true;
  for (const key in value) if (needsCodec(value[key])) return true;
  return false;
}

function toWire(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (value instanceof Uint8Array) return { [BYTES_KEY]: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
  if (Array.isArray(value)) return value.map(toWire);
  if (!isPlainObject(value)) return value; // a Date and the like keep their own toJSON
  const key = codecKey(value);
  if (key !== null) return { [ESCAPE_KEY]: { [key]: toWire(value[key]) } };
  return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toWire(child)])); // own keys, `__proto__` too
}

function fromWire(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(fromWire);
  const record = value as Record<string, unknown>;
  const key = codecKey(record);
  if (key === BYTES_KEY) {
    const text = record[BYTES_KEY];
    if (typeof text === 'string' && text.length % 4 === 0 && BASE64.test(text)) return new Uint8Array(Buffer.from(text, 'base64'));
    return record; // malformed: the schema refuses it
  }
  if (key === ESCAPE_KEY) {
    const inner = record[ESCAPE_KEY];
    if (typeof inner === 'object' && inner !== null && !Array.isArray(inner)) {
      const escaped = Object.keys(inner);
      if (escaped.length === 1) return { [escaped[0]]: fromWire((inner as Record<string, unknown>)[escaped[0]]) };
    }
  }
  return Object.fromEntries(Object.entries(record).map(([name, child]) => [name, fromWire(child)]));
}
