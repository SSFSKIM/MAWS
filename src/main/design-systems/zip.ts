// A zip archive of in-memory files, for the `claude` export of a design system (one file to hand over, as A's export
// service writes one per export). PKZIP 2.0 entries, no ZIP64 (an export is far below 4 GB), names flagged UTF-8, in the
// order given: text deflated when that is smaller, bytes stored (an asset is a font or an image, compressed already, and
// deflating megabytes of it would hold main's thread for nothing).
import { crc32, deflateRawSync } from 'node:zlib';

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const VERSION = 20; // 2.0: deflate and folders
const UTF8 = 0x0800;

// The DOS date and time of `at`, local time, at two-second resolution (1980 at the earliest).
function dosTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** The files as one zip archive, each under its path. */
export function zipFiles(files: Readonly<Record<string, string | Uint8Array>>, at: Date = new Date()): Uint8Array {
  const { time, date } = dosTime(at);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path, 'utf8');
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const deflated = typeof content === 'string' ? deflateRawSync(data) : null;
    const method = deflated && deflated.byteLength < data.byteLength ? 8 : 0;
    const stored = method === 8 ? deflated! : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(offset, 42); // extra, comment, disk and attributes stay 0

    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += local.byteLength + name.byteLength + stored.byteLength;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
