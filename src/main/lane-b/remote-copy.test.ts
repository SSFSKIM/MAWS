// A remote file's bytes brought here (P5 O7 M5a, "Open a copy, and Save As of a remote artifact"; M5a-b's fix wave 1):
// through the real files service's reads, a copy is the file's bytes or no copy at all. A text file the service sends as
// `utf8` is copied byte for byte when its text proves it (no replacement character), or when the service's hashed,
// strictly decoded read proves it, and refused otherwise (not UTF-8, or past the hashed read's cap); and a write the OS
// takes in part is written to its end, a write that makes no progress failing with no staging file left.
import { mkdtemp, open, readdir, readFile, rename, rm, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILES_READ_MAX_LENGTH } from '@shared/ipc/schema/files';
import { HostCommandError } from '@shared/host/runtime';
import { createFilesService, type FilesService } from '../../services/files/service';
import { createLibraryReads } from '../../services/library/files';
import type { RemoteLink } from '../machines/remote/link';
import { REMOTE_READ_PAGE_BYTES, REMOTE_READ_TRIES } from './remote-files-read';
import { fetchInto, fetchToFile, notByteForByte } from './remote-copy';

/** The OS's writes, as a test makes them: whole (`null`), at most `n` bytes each, or none. */
const io = vi.hoisted(() => ({ cap: null as number | null }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const write = handle.write.bind(handle) as (buffer: Uint8Array, offset: number, length: number, position: number) => Promise<{ bytesWritten: number }>;
      handle.write = (async (buffer: Uint8Array, offset: number, length: number, position: number) =>
        io.cap === null ? write(buffer, offset, length, position) : io.cap === 0 ? { bytesWritten: 0, buffer } : write(buffer, offset, Math.min(io.cap, length), position)) as typeof handle.write;
      return handle;
    },
  };
});

const dirs: string[] = [];
const services: FilesService[] = [];
afterEach(async () => {
  io.cap = null;
  for (const service of services.splice(0)) service.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const scratch = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maws-remote-copy-'));
  dirs.push(dir);
  return dir;
};

/** A machine whose `files.read` is the real files service over `path`; each read it answered, with its input. */
function machineOver(path: string) {
  const files = createFilesService({ records: () => null });
  services.push(files);
  const reads: Array<Record<string, unknown>> = [];
  const link = {
    machine: 'FarMachineRef000000000',
    name: 'mini',
    call: async (_name: string, input: { offset?: number; length?: number; hash?: boolean }) => {
      reads.push(input);
      return { ok: true, output: await files.readResolved({ path, ...(input.offset !== undefined && { offset: input.offset }), ...(input.length !== undefined && { length: input.length }), ...(input.hash !== undefined && { hash: input.hash }) }) };
    },
  } as unknown as RemoteLink;
  return { link, reads };
}

const fetch = (link: RemoteLink, to: string) => fetchToFile(link, { appSessionId: 'app-1', path: '/remote/file' } as never, to, 64 * 1024 * 1024, () => {});

describe('a copy is the file’s bytes', () => {
  it('refuses a text-named file that isn’t UTF-8 (the service sends it only as lossy text), the hashed read telling it, rather than write a changed file', async () => {
    const dir = await scratch();
    const legacy = join(dir, 'legacy.txt');
    await writeFile(legacy, Buffer.from([0x61, 0xff, 0x62]));
    const { link, reads } = machineOver(legacy);
    const to = join(dir, 'copy.txt');
    expect(await fetch(link, to)).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_input', message: notByteForByte('mini') }) });
    expect(reads.some((read) => read.hash === true)).toBe(true);
    expect(await readdir(dir)).toEqual(['legacy.txt']); // nothing written, no staging file left
  });

  it('copies valid UTF-8 holding a replacement character byte for byte, the hashed read proving it', async () => {
    const dir = await scratch();
    const notes = join(dir, 'notes.txt');
    const bytes = Buffer.from('before � after, ünïcödé', 'utf8');
    await writeFile(notes, bytes);
    const { link, reads } = machineOver(notes);
    const to = join(dir, 'copy.txt');
    expect(await fetch(link, to)).toEqual({ ok: true, value: 'written' });
    expect(await readFile(to)).toEqual(bytes);
    expect(reads.some((read) => read.hash === true)).toBe(true);
  });

  it('copies plain UTF-8 text without the hashed read', async () => {
    const dir = await scratch();
    const notes = join(dir, 'notes.txt');
    const bytes = Buffer.from('plain ünïcödé text\r\n'.repeat(1000), 'utf8');
    await writeFile(notes, bytes);
    const { link, reads } = machineOver(notes);
    const to = join(dir, 'copy.txt');
    expect(await fetch(link, to)).toEqual({ ok: true, value: 'written' });
    expect(await readFile(to)).toEqual(bytes);
    expect(reads.every((read) => read.hash === undefined)).toBe(true);
  });

  it('refuses text past the hashed read’s cap that isn’t UTF-8, rather than write a changed file', async () => {
    const dir = await scratch();
    const big = join(dir, 'big.log');
    await writeFile(big, Buffer.concat([Buffer.alloc(FILES_READ_MAX_LENGTH, 0x61), Buffer.from([0xff, 0x0a])]));
    const { link } = machineOver(big);
    expect(await fetch(link, join(dir, 'copy.log'))).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_input', message: notByteForByte('mini') }) });
    expect(await readdir(dir)).toEqual(['big.log']);
  });
});

// P5 O7 M5a review: a remote HTML artifact's Open externally copies its stored entry file through the real library
// service's `library.read` (it once refused every kind but `file`)
describe('a library artifact’s copy', () => {
  it('copies an HTML artifact’s stored entry file byte for byte through library.read', async () => {
    const dir = await scratch();
    const entry = join(dir, 'index.html');
    const bytes = Buffer.from('<!doctype html><h1>Q3 ünïcödé</h1>\n', 'utf8');
    await writeFile(entry, bytes);
    const files = createFilesService({ records: () => null });
    services.push(files);
    const dispatch = async () => ({ ok: true, value: { revision: 3, kind: 'html', name: 'index.html', size: bytes.length, sha256: 'x', path: entry } });
    const library = createLibraryReads({ hosts: { dispatch } as never, files, port: {} as never, env: {}, artifactsRoot: join(dir, 'artifacts') });
    const link = {
      machine: 'FarMachineRef000000000',
      name: 'mini',
      call: async (name: string, input: never) => {
        if (name !== 'library.read') throw new Error(`unexpected ${name}`);
        try {
          return { ok: true, output: await library.read(input) };
        } catch (error) {
          if (error instanceof HostCommandError) return { ok: false, error: error.ipcError };
          throw error;
        }
      },
    } as unknown as RemoteLink;
    const to = join(dir, 'copy.html');
    expect(await fetchToFile(link, { artifactId: '00000000-0000-4000-8000-000000000001', revision: 3 } as never, to, 64 * 1024 * 1024, () => {})).toEqual({ ok: true, value: 'written' });
    expect(await readFile(to)).toEqual(bytes);
  });
});

describe('a copy is written to its end', () => {
  const pdf = Buffer.from('%PDF-1.7 a complete file');
  const link = {
    machine: 'FarMachineRef000000000',
    name: 'mini',
    call: async () => ({ ok: true, output: { encoding: 'base64', content: pdf.toString('base64'), bytes: pdf.length, offset: 0, length: pdf.length, truncated: false, mime: 'application/pdf', hash: null, utf8: null } }),
  } as unknown as RemoteLink;

  it('writes on past a write the OS took in part', async () => {
    const dir = await scratch();
    io.cap = 1;
    expect(await fetch(link, join(dir, 'copy.pdf'))).toEqual({ ok: true, value: 'written' });
    io.cap = null;
    expect(await readFile(join(dir, 'copy.pdf'))).toEqual(pdf);
  });

  it('fails a write that makes no progress, leaving no file and no staging file', async () => {
    const dir = await scratch();
    io.cap = 0;
    await expect(fetch(link, join(dir, 'copy.pdf'))).rejects.toThrow(/no progress/);
    io.cap = null;
    expect(await readdir(dir)).toEqual([]);
  });
});

// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M3, decision 8; "What one version
// means"; sequences 13 and 14): a file frame's copy of another machine's file, into a descriptor whose name is gone. It
// asks the hash from its first page, so within the hashed read's cap a copy is one version; above it only the size is
// compared, the recorded limit. Every path and byte here is invented.
describe('fetchInto', () => {
  const MiB = 1024 * 1024;
  const SOURCE = { appSessionId: 'app-session-lark-91', path: '/remote/quillon-orchard-5c1/ledger draft.pdf' } as never;
  const SENT = ['appSessionId', 'path', 'offset', 'length', 'hash'];

  /** A sink as a frame's copy has it: created, opened read-write, and its name removed before a byte is written. */
  async function nameless(dir: string): Promise<FileHandle> {
    const handle = await open(join(dir, 'sink'), 'wx+', 0o600);
    await unlink(join(dir, 'sink'));
    return handle;
  }
  async function contentsOf(handle: FileHandle): Promise<Buffer> {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    return buffer;
  }
  const sinks: FileHandle[] = [];
  afterEach(async () => {
    for (const sink of sinks.splice(0)) await sink.close().catch(() => {});
  });

  /**
   * A machine whose `files.read` is the real files service over `path`, as `machineOver` above; `before(n)` runs before
   * the `n`th call is answered (a page held while the file is replaced); `pages` refuses `too-large` any call asking
   * more than one channel page, so the paged read pages.
   */
  function heldMachine(path: string, before: Record<number, () => Promise<void>> = {}, pages = false) {
    const files = createFilesService({ records: () => null });
    services.push(files);
    const reads: Array<Record<string, unknown>> = [];
    const link = {
      machine: 'FarMachineRef000000000',
      name: 'mini',
      call: async (_name: string, input: { offset?: number; length?: number; hash?: boolean }) => {
        reads.push(input);
        await before[reads.length]?.();
        if (pages && (input.length ?? 0) > REMOTE_READ_PAGE_BYTES) return { ok: false, error: { code: 'too-large' } };
        return { ok: true, output: await files.readResolved({ path, ...(input.offset !== undefined && { offset: input.offset }), ...(input.length !== undefined && { length: input.length }), ...(input.hash !== undefined && { hash: input.hash }) }) };
      },
    } as unknown as RemoteLink;
    return { link, reads };
  }
  /** `path` replaced by another file holding `bytes`, put in its place. */
  const replace = (path: string, bytes: Buffer) => async () => {
    await writeFile(`${path}.next`, bytes);
    await rename(`${path}.next`, path);
  };
  async function copy(link: RemoteLink, dir: string, log: (line: string) => void = () => {}) {
    const sink = await nameless(dir);
    sinks.push(sink);
    const seen: Array<{ mime: string; bytes: number }> = [];
    const result = await fetchInto(link, SOURCE, sink, 64 * MiB, log, { label: 'file frame (pdf)', seen: (first) => void seen.push(first) });
    return { sink, seen, result };
  }

  it('asks the hash from its first page, and no key the copy of Open externally does not send', async () => {
    const dir = await scratch();
    const path = join(dir, 'report.pdf');
    const bytes = Buffer.alloc(4 * MiB, 0x61);
    await writeFile(path, bytes);
    const { link, reads } = heldMachine(path);
    const { sink, seen, result } = await copy(link, dir);
    expect(result).toEqual({ ok: true, value: { written: bytes.length } });
    expect((await contentsOf(sink)).equals(bytes)).toBe(true);
    expect(reads.length).toBeGreaterThan(1);
    for (const read of reads) {
      expect(read.hash).toBe(true);
      expect(Object.keys(read).filter((key) => !SENT.includes(key))).toEqual([]);
    }
    expect(seen).toEqual([{ mime: 'application/pdf', bytes: bytes.length }]);
    expect(await readdir(dir)).toEqual(['report.pdf']); // the sink has no name
  });

  it('an equal-size replacement between two held pages of a file within the cap is copied again, and what the descriptor holds at the end is one version', async () => {
    const dir = await scratch();
    const path = join(dir, 'report.pdf');
    const first = Buffer.alloc(4 * MiB, 0x61);
    const second = Buffer.alloc(4 * MiB, 0x62);
    await writeFile(path, first);
    const { link, reads } = heldMachine(path, { 2: replace(path, second) });
    const log: string[] = [];
    const { sink, seen, result } = await copy(link, dir, (line) => log.push(line));
    expect(result).toEqual({ ok: true, value: { written: second.length } });
    expect((await contentsOf(sink)).equals(second)).toBe(true);
    expect(reads).toHaveLength(4); // two pages, then the two pages of the pass made again
    expect(seen).toHaveLength(2); // each pass's first page is told
    expect(log.filter((line) => line.includes('copied again'))).toHaveLength(1);
  });

  it('the same replacement that keeps happening is refused, with nothing served', async () => {
    const dir = await scratch();
    const path = join(dir, 'report.pdf');
    const a = Buffer.alloc(4 * MiB, 0x61);
    const b = Buffer.alloc(4 * MiB, 0x62);
    await writeFile(path, a);
    const { link, reads } = heldMachine(path, { 2: replace(path, b), 4: replace(path, a), 6: replace(path, b) });
    const { result } = await copy(link, dir);
    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'internal', message: 'files.read: the file kept changing on machine mini while it was copied' }) });
    expect(reads).toHaveLength(2 * REMOTE_READ_TRIES);
  });

  it('above the cap an equal-size replacement between two held pages is not seen: pinned as the recorded limit', async () => {
    // Past FILES_READ_MAX_LENGTH the other machine answers no hash, so only the size is compared between pages: the copy
    // holds the first page of one version and the rest of the other, and is drawn until the entry's next read copies it
    // again (the tracker's row; "What one version means").
    const dir = await scratch();
    const path = join(dir, 'report.pdf');
    const size = FILES_READ_MAX_LENGTH + MiB;
    const first = Buffer.alloc(size, 0x61);
    const second = Buffer.alloc(size, 0x62);
    await writeFile(path, first);
    const { link, reads } = heldMachine(path, { 2: replace(path, second) });
    const { sink, result } = await copy(link, dir);
    expect(result).toEqual({ ok: true, value: { written: size } });
    const held = await contentsOf(sink);
    expect(held.equals(Buffer.concat([first.subarray(0, REMOTE_READ_PAGE_BYTES), second.subarray(REMOTE_READ_PAGE_BYTES)]))).toBe(true);
    expect(reads.every((read) => read.hash === true)).toBe(true);
  });

  it('a text file larger than the cap with no replacement character is copied', async () => {
    const dir = await scratch();
    const path = join(dir, 'big.log');
    const bytes = Buffer.from(`${'plain log line\n'.repeat(Math.ceil((FILES_READ_MAX_LENGTH + MiB) / 15))}`, 'utf8');
    await writeFile(path, bytes);
    const { link } = heldMachine(path);
    const { sink, seen, result } = await copy(link, dir);
    expect(result).toEqual({ ok: true, value: { written: bytes.length } });
    expect((await contentsOf(sink)).equals(bytes)).toBe(true);
    expect(seen).toEqual([{ mime: 'text/plain', bytes: bytes.length }]);
  });

  it('a text file is copied when its hash proves it, and refused as not byte for byte when its bytes are not UTF-8, within the cap and above it', async () => {
    const dir = await scratch();
    const proven = join(dir, 'notes.txt');
    const valid = Buffer.from('before � after, ünïcödé', 'utf8'); // a replacement character that is the file's own
    await writeFile(proven, valid);
    const copied = await copy(heldMachine(proven).link, dir);
    expect(copied.result).toEqual({ ok: true, value: { written: valid.length } });
    expect((await contentsOf(copied.sink)).equals(valid)).toBe(true);

    const legacy = join(dir, 'legacy.txt');
    await writeFile(legacy, Buffer.from([0x61, 0xff, 0x62]));
    expect((await copy(heldMachine(legacy).link, dir)).result).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_input', message: notByteForByte('mini') }) });

    const big = join(dir, 'big.log');
    await writeFile(big, Buffer.concat([Buffer.alloc(FILES_READ_MAX_LENGTH, 0x61), Buffer.from([0xff, 0x0a])]));
    expect((await copy(heldMachine(big).link, dir)).result).toEqual({ ok: false, error: expect.objectContaining({ code: 'invalid_input', message: notByteForByte('mini') }) });
  });

  it('answers too-large past the bound, having written nothing', async () => {
    const dir = await scratch();
    const path = join(dir, 'report.pdf');
    await writeFile(path, Buffer.alloc(2 * MiB, 0x61));
    const { link, reads } = heldMachine(path);
    const sink = await nameless(dir);
    sinks.push(sink);
    expect(await fetchInto(link, SOURCE, sink, MiB, () => {}, { label: 'file frame (pdf)', seen: () => {} })).toEqual({ ok: true, value: 'too-large' });
    expect(reads).toHaveLength(1);
    expect((await sink.stat()).size).toBe(0);
  });

  it('a pass that starts again leaves the descriptor holding only the last pass', async () => {
    const dir = await scratch();
    const path = join(dir, 'report.pdf');
    const longer = Buffer.alloc(5 * MiB, 0x61);
    const shorter = Buffer.alloc(MiB, 0x62); // shorter than the first pass's first page
    await writeFile(path, longer);
    const { link } = heldMachine(path, { 2: replace(path, shorter) });
    const { sink, result } = await copy(link, dir);
    expect(result).toEqual({ ok: true, value: { written: shorter.length } });
    expect((await contentsOf(sink)).equals(shorter)).toBe(true);
  });

  it('a copy that pages, and one copied again after a change, log neither the path nor anything of the caller’s', async () => {
    const dir = await scratch();
    const path = join(dir, 'report.pdf');
    const first = Buffer.alloc(7 * MiB, 0x61);
    const second = Buffer.alloc(7 * MiB, 0x62);
    await writeFile(path, first);
    // the second chunk is refused too large for the channel and paged; the file is replaced between its two pages
    const { link } = heldMachine(path, { 4: replace(path, second) }, true);
    const log: string[] = [];
    const { sink, result } = await copy(link, dir, (line) => log.push(line));
    expect(result).toEqual({ ok: true, value: { written: second.length } });
    expect((await contentsOf(sink)).equals(second)).toBe(true);
    expect(log.some((line) => line.includes('read in pages'))).toBe(true);
    expect(log.some((line) => line.includes('changed between its pages'))).toBe(true);
    expect(log.some((line) => line.includes('copied again'))).toBe(true);
    for (const line of log) {
      expect(line).toContain('file frame (pdf)');
      for (const told of ['quillon-orchard-5c1', 'ledger draft', 'ledger%20draft', 'app-session-lark-91', path]) expect(line).not.toContain(told);
    }
  });
});

// UX wave U6b-2 (Decision Log 30): for every caller of the inner read, a pass is written only when what it wrote reaches
// the size its first page gave. A machine that keeps the size and stops sending (a later page of no bytes, or a page
// not marked truncated that ends before the size) is read again within the tries and then refused as a file that kept
// changing; an empty file is still copied. Every byte here is invented.
describe('a copy ends at the size its first page gave', () => {
  const SOURCE = { appSessionId: 'app-session-lark-91', path: '/remote/quillon-orchard-5c1/ledger.pdf' } as never;
  const SIZE = REMOTE_READ_PAGE_BYTES + 4096;

  /** A machine that answers SIZE bytes and no hash, then ends short: a later page of no bytes, or one not marked truncated. */
  function shortMachine(end: 'empty' | 'unmarked') {
    const reads: Array<Record<string, unknown>> = [];
    const link = {
      machine: 'FarMachineRef000000000',
      name: 'mini',
      call: async (_name: string, input: { offset?: number; length?: number }) => {
        reads.push(input);
        const offset = input.offset ?? 0;
        const length = offset === 0 ? Math.min(input.length ?? SIZE, SIZE) : end === 'empty' ? 0 : 1024;
        const truncated = offset === 0 ? offset + length < SIZE : end === 'empty';
        return { ok: true, output: { encoding: 'base64', content: Buffer.alloc(length, 0x61).toString('base64'), bytes: SIZE, offset, length, truncated, mime: 'application/pdf', hash: null, utf8: null } };
      },
    } as unknown as RemoteLink;
    return { link, reads };
  }
  const keptChanging = { ok: false, error: expect.objectContaining({ code: 'internal', message: 'files.read: the file kept changing on machine mini while it was copied' }) };

  it.each(['empty', 'unmarked'] as const)('a frame’s copy whose later page ends short of the size (%s) is copied again and refused as kept changing', async (end) => {
    const dir = await scratch();
    const sink = await open(join(dir, 'sink'), 'wx+', 0o600);
    try {
      const { link, reads } = shortMachine(end);
      expect(await fetchInto(link, SOURCE, sink, 64 * 1024 * 1024, () => {}, { label: 'file frame (pdf)', seen: () => {} })).toEqual(keptChanging);
      expect(reads).toHaveLength(2 * REMOTE_READ_TRIES);
    } finally {
      await sink.close();
    }
  });

  it.each(['empty', 'unmarked'] as const)('Open externally’s copy whose later page ends short of the size (%s) is refused, leaving no file', async (end) => {
    const dir = await scratch();
    const { link, reads } = shortMachine(end);
    expect(await fetch(link, join(dir, 'copy.pdf'))).toEqual(keptChanging);
    expect(reads).toHaveLength(2 * REMOTE_READ_TRIES);
    expect(await readdir(dir)).toEqual([]);
  });

  it('an empty file is still copied, by either copy', async () => {
    const dir = await scratch();
    const empty = join(dir, 'empty.pdf');
    await writeFile(empty, Buffer.alloc(0));
    const sink = await open(join(dir, 'sink'), 'wx+', 0o600);
    try {
      expect(await fetchInto(machineOver(empty).link, SOURCE, sink, 64 * 1024 * 1024, () => {}, { label: 'file frame (pdf)', seen: () => {} })).toEqual({ ok: true, value: { written: 0 } });
      expect((await sink.stat()).size).toBe(0);
    } finally {
      await sink.close();
    }
    expect(await fetch(machineOver(empty).link, join(dir, 'copy.pdf'))).toEqual({ ok: true, value: 'written' });
    expect(await readFile(join(dir, 'copy.pdf'))).toEqual(Buffer.alloc(0));
  });
});

// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, decision 15, §D): a session's
// file is read for a copy through the reader its caller hands in (the adapter's outside-aware read for the page that
// asked), on both routes, "Open externally"'s and a frame's; a library source is read as it was, by `library.read`.
describe('a session’s file read through the copy’s reader', () => {
  /** A reader over the real files service's reads of `path`, recording what it was asked; the link is never called. */
  function readerOver(path: string) {
    const files = createFilesService({ records: () => null });
    services.push(files);
    const asked: Array<Record<string, unknown>> = [];
    const reader = async (input: Record<string, unknown>) => {
      asked.push(input);
      const { offset, length, hash } = input as { offset?: number; length?: number; hash?: boolean };
      return { ok: true as const, value: await files.readResolved({ path, ...(offset !== undefined && { offset }), ...(length !== undefined && { length }), ...(hash !== undefined && { hash }) }) };
    };
    const link = { machine: 'FarMachineRef000000000', name: 'mini', call: async () => { throw new Error('the link is not asked when a reader is given'); } } as unknown as RemoteLink;
    return { reader, asked, link };
  }

  it('fetchToFile reads a session source through the reader, byte for byte, and never the link', async () => {
    const dir = await scratch();
    const path = join(dir, 'outside.txt');
    const bytes = Buffer.from('a file outside the session’s folders, ünïcödé\n', 'utf8');
    await writeFile(path, bytes);
    const { reader, asked, link } = readerOver(path);
    const to = join(dir, 'copy.txt');
    expect(await fetchToFile(link, { appSessionId: 'app-1', path: '/remote/outside.txt' } as never, to, 64 * 1024 * 1024, () => {}, reader)).toEqual({ ok: true, value: 'written' });
    expect(await readFile(to)).toEqual(bytes);
    expect(asked.length).toBeGreaterThan(0);
    for (const input of asked) expect(input).toMatchObject({ appSessionId: 'app-1', path: '/remote/outside.txt' });
  });

  it('fetchInto reads a session source through the reader, the hash asked on every page', async () => {
    const dir = await scratch();
    const path = join(dir, 'outside.pdf');
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 7, 0x62);
    await writeFile(path, bytes);
    const { reader, asked, link } = readerOver(path);
    const handle = await open(join(dir, 'sink'), 'wx+', 0o600);
    await unlink(join(dir, 'sink'));
    try {
      const seen: Array<{ mime: string; bytes: number }> = [];
      expect(await fetchInto(link, { appSessionId: 'app-1', path: '/remote/outside.pdf' } as never, handle, 64 * 1024 * 1024, () => {}, { label: 'a file frame of app-1', seen: (first) => void seen.push(first), readSessionFile: reader })).toEqual({ ok: true, value: { written: bytes.length } });
      const copied = Buffer.alloc(bytes.length);
      await handle.read(copied, 0, bytes.length, 0);
      expect(copied.equals(bytes)).toBe(true);
      expect(seen).toEqual([{ mime: 'application/pdf', bytes: bytes.length }]);
      expect(asked.length).toBeGreaterThan(1);
      for (const input of asked) expect(Object.keys(input).sort()).toEqual(['appSessionId', 'hash', 'length', 'offset', 'path']);
    } finally {
      await handle.close();
    }
  });

  it('an artifact source is read by library.read as before, the reader never called', async () => {
    const dir = await scratch();
    const calls: string[] = [];
    const bytes = Buffer.from('a stored file\n', 'utf8');
    const link = {
      machine: 'FarMachineRef000000000',
      name: 'mini',
      call: async (name: string, input: { offset?: number; length?: number }) => {
        calls.push(name);
        const offset = input.offset ?? 0;
        const content = bytes.subarray(offset, offset + (input.length ?? bytes.length));
        return { ok: true, output: { encoding: 'base64', content: content.toString('base64'), bytes: bytes.length, offset, length: content.length, truncated: offset + content.length < bytes.length, mime: 'text/plain', hash: null, utf8: null } };
      },
    } as unknown as RemoteLink;
    const reader = vi.fn();
    const to = join(dir, 'copy.txt');
    expect(await fetchToFile(link, { artifactId: '00000000-0000-4000-8000-000000000001', revision: 3 } as never, to, 64 * 1024 * 1024, () => {}, reader)).toEqual({ ok: true, value: 'written' });
    expect(await readFile(to)).toEqual(bytes);
    expect(calls).toEqual(['library.read']);
    expect(reader).not.toHaveBeenCalled();
  });
});
