// RFC 8785, the JSON Canonicalization Scheme (DX1): object keys sorted by their UTF-16 code units, no whitespace,
// strings and numbers as ECMAScript's JSON.stringify writes them. The caller encodes the result as UTF-8.

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function canonicalize(value: unknown): string {
  if (value === undefined) throw new TypeError('canonicalize: undefined is not JSON');
  return write(value);
}

function write(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalize: ${value} is not a JSON number`);
      return JSON.stringify(value);
    case 'string':
      return writeString(value);
    case 'object':
      return Array.isArray(value) ? writeArray(value) : writeObject(value);
    default:
      throw new TypeError(`canonicalize: a ${typeof value} is not JSON`);
  }
}

function writeString(text: string): string {
  // I-JSON (RFC 7493), which RFC 8785 requires, has no lone surrogates; UTF-8 cannot carry one.
  if (LONE_SURROGATE.test(text)) throw new TypeError('canonicalize: a string holds a lone surrogate');
  return JSON.stringify(text);
}

function writeArray(items: unknown[]): string {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i] === undefined) throw new TypeError('canonicalize: an array holds undefined');
    out.push(write(items[i]));
  }
  return `[${out.join(',')}]`;
}

function writeObject(object: object): string {
  const proto = Object.getPrototypeOf(object);
  if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalize: only plain objects are JSON objects');
  const record = object as Record<string, unknown>;
  // A key whose value is undefined is absent on the wire (JSON.stringify drops it), so it is absent here too. The
  // default sort compares UTF-16 code units, which is the order RFC 8785 §3.2.3 prescribes.
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${writeString(key)}:${write(record[key])}`).join(',')}}`;
}
