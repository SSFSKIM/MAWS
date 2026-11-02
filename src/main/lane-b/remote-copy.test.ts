// A remote file's bytes brought here (P5 O7 M5a, "Open a copy, and Save As of a remote artifact"; M5a-b's fix wave 1):
// through the real files service's reads, a copy is the file's bytes or no copy at all. A text file the service sends as
// `utf8` is copied byte for byte when its text proves it (no replacement character), or when the service's hashed,
// strictly decoded read proves it, and refused otherwise (not UTF-8, or past the hashed read's cap); and a write the OS
// takes in part is written to its end, a write that makes no progress failing with no staging file left.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FILES_READ_MAX_LENGTH } from '@shared/ipc/schema/files';
import { createFilesService, type FilesService } from '../../services/files/service';
import type { RemoteLink } from '../machines/remote/link';
import { fetchToFile, notByteForByte } from './remote-copy';

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
