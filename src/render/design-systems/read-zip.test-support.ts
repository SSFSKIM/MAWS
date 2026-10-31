// A zip archive's entries, read through its central directory and each entry's local header (stored or deflated), for
// the tests of the writer (zip.ts) and of the `claude` exporter.
import { inflateRawSync } from 'node:zlib';
import { expect } from 'vitest';

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  data: Uint8Array;
}

// The archive's entries through its central directory, each read from its local header; every name is flagged UTF-8.
export function readZip(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.byteLength - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(flags & 0x0800, `${name} is flagged UTF-8`).toBe(0x0800);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const stored = zip.subarray(start, start + size);
    entries.push({ name, method, crc, data: method === 8 ? new Uint8Array(inflateRawSync(stored)) : stored });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}
