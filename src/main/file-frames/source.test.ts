// A file frame's sources of bytes (UX wave U6b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md,
// Interfaces §C; M3, decision 6): a file of this Mac read by the files service's raw read as the page that owns the
// token, at every request; a copy of another machine's file read from the descriptor that holds it. Every path here is
// invented.
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef, type ClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { FilesReadInput, FilesReadOutput } from '@shared/ipc/schema/files';
import { copySource, FrameReadError, localSource, type RawRead } from './source';

const SESSION = 'app-session-1' as AppSessionId;
const PATH = '/work/invented/report.pdf';
const owner = endableClientRef('page:3.1');

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A raw read that answers `answer` and records what it was asked, and as whom. */
function reader(answer: (input: FilesReadInput) => Awaited<ReturnType<RawRead>>) {
  const asked: Array<{ input: FilesReadInput; as: ClientRef }> = [];
  const read: RawRead = async (input, as) => {
    asked.push({ input, as });
    return answer(input);
  };
  return { read, asked };
}
const answer = (bytes: Buffer, extra: Partial<FilesReadOutput> = {}): Awaited<ReturnType<RawRead>> => ({
  ok: true,
  value: { encoding: 'base64', content: bytes.toString('base64'), bytes: 1000, offset: 10, length: bytes.length, truncated: true, mime: 'application/pdf', hash: null, utf8: null, identity: '1:2:1000:3:4', ...extra },
});
const why = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (thrown: unknown) => thrown);
  expect(error).toBeInstanceOf(FrameReadError);
  return error as FrameReadError;
};

describe('localSource', () => {
  it('a local read asks files.read with raw, named and the page that owns the token, and nothing else', async () => {
    const { read, asked } = reader(() => answer(Buffer.from('%PDF-1.7')));
    const source = localSource(read, owner, { appSessionId: SESSION, path: PATH }, { named: true });
    const page = await source.read(10, 8);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.input).toStrictEqual({ appSessionId: SESSION, path: PATH, offset: 10, length: 8, raw: true, named: true });
    expect(asked[0]!.as).toBe(owner);
    expect(Buffer.from(page.bytes).toString()).toBe('%PDF-1.7');
    expect(page).toMatchObject({ size: 1000, identity: '1:2:1000:3:4' });
  });

  it('an answer with no identity is unserved', async () => {
    const { identity: _, ...older } = (answer(Buffer.from('%PDF')) as { value: FilesReadOutput }).value;
    const source = localSource(async () => ({ ok: true, value: older }), owner, { appSessionId: SESSION, path: PATH }, { named: true });
    expect((await why(source.read(0, 4))).why).toBe('unserved');
  });

  it('an answer in a text encoding is unserved', async () => {
    const { read } = reader(() => answer(Buffer.from('x'), { encoding: 'utf8', content: '<p>page</p>', mime: 'text/html' }));
    const source = localSource(read, owner, { appSessionId: SESSION, path: PATH }, { named: true });
    expect((await why(source.read(0, 11))).why).toBe('unserved');
  });

  it('a refused read is refused, with the service’s words', async () => {
    const source = localSource(async () => ({ ok: false, error: ipcError('invalid_input', `not found: ${PATH}`) }), owner, { appSessionId: SESSION, path: PATH }, { named: true });
    const error = await why(source.read(0, 4));
    expect(error.why).toBe('refused');
    expect(error.message).toBe(`not found: ${PATH}`);
    const thrown = localSource(async () => Promise.reject(new Error('the daemon did not answer')), owner, { appSessionId: SESSION, path: PATH }, { named: true });
    const lost = await why(thrown.read(0, 4));
    expect(lost.why).toBe('refused');
    expect(lost.message).toBe('the daemon did not answer');
  });
});

describe('copySource', () => {
  it('a copy’s source reads the descriptor and closes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'maws-frame-source-'));
    dirs.push(dir);
    await writeFile(join(dir, 'copy'), 'abcdefghij');
    const handle = await open(join(dir, 'copy'), 'r');
    const source = copySource(handle, 10);
    const middle = await source.read(2, 5);
    expect(Buffer.from(middle.bytes).toString()).toBe('cdefg');
    expect(middle.size).toBe(10);
    const tail = await source.read(8, 5);
    expect(Buffer.from(tail.bytes).toString()).toBe('ij');
    const past = await source.read(12, 5);
    expect(past.bytes.length).toBe(0);
    expect(new Set([middle.identity, tail.identity, past.identity]).size).toBe(1); // a copy cannot change: it has no name
    await source.close();
    expect(handle.fd).toBe(-1);
    await source.close(); // a second close does nothing
  });
});
