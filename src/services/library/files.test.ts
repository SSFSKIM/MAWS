// P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, acceptance 6; D19): the library's reads of a stored file,
// the machine's half (moved from src/main/library/files.test.ts with its cases): the stored file resolved through the
// engine host's `artifacts.content`, a File artifact's bytes read through the files service in process, a document
// opened and any file revealed on the asking client through the client port (or the e2e seam's log), a program never
// opened. Over the bus, as the spine registers them.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { NO_CLIENT } from '@shared/client/port';
import { endableClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { registerLibraryReads, type LibraryReadsDeps } from './files';

const ID = '00000000-0000-4000-8000-000000000001';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-library-reads-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

interface Stored {
  kind: ArtifactKind;
  files: Record<number, { name: string; path: string }>; // by revision; the highest is the latest
}

// The engine host's store, the files service and the OS as the client port reaches it, as fakes a test reads.
function reads(stored: Stored, over: Partial<LibraryReadsDeps> = {}) {
  const dispatch = vi.fn(async (_owner: string, name: string, input: unknown) => {
    if (name !== 'artifacts.content') throw new Error(`unexpected ${name}`);
    const { revision } = input as CommandInput<'artifacts.content'>;
    const at = revision ?? Math.max(...Object.keys(stored.files).map(Number));
    const file = stored.files[at];
    if (!file) return { ok: false, error: ipcError('invalid_input', `no content at ${at}`, { reason: 'notFound', data: {} }) } as CommandResult<'artifacts.content'>;
    return { ok: true, value: { revision: at, kind: stored.kind, name: file.name, size: 1, sha256: 'x', path: file.path } } as CommandResult<'artifacts.content'>;
  });
  const readResolved = vi.fn(async ({ path, offset = 0 }: { path: string; offset?: number }) => ({ encoding: 'utf8' as const, content: readFileSync(path, 'utf8').slice(offset), bytes: 0, offset, length: 0, truncated: false, mime: 'text/plain', hash: null, utf8: null }));
  const openExternal = vi.fn(async (): Promise<Awaited<ReturnType<LibraryReadsDeps['port']['openExternal']>>> => ({ opened: true }));
  const reveal = vi.fn(async (): Promise<Awaited<ReturnType<LibraryReadsDeps['port']['reveal']>>> => ({ revealed: true }));
  const bus = fakeBus();
  registerLibraryReads(bus.register, { hosts: { dispatch: dispatch as never }, files: { readResolved }, port: { openExternal, reveal }, env: {}, ...over });
  return { bus, dispatch, readResolved, openExternal, reveal };
}

function put(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

const answer = async (bus: FakeBus, name: 'library.content' | 'library.read' | 'library.openExternally' | 'library.reveal', input: unknown) => bus.invoke(name, input);

describe('the library’s reads of a stored file', () => {
  it('registers exactly the four reads', () => {
    expect(reads({ kind: 'html', files: {} }).bus.registered().sort()).toEqual(['library.content', 'library.openExternally', 'library.read', 'library.reveal']);
  });

  it('resolves the stored file at a revision, the latest when none is named, and passes a refusal on', async () => {
    const one = put('one.html', 'v1');
    const two = put('two.html', 'v2');
    const { bus } = reads({ kind: 'html', files: { 4: { name: 'index.html', path: one }, 9: { name: 'index.html', path: two } } });
    expect(await answer(bus, 'library.content', { artifactId: ID })).toEqual({ ok: true, value: { revision: 9, kind: 'html', name: 'index.html', path: two } });
    expect(await answer(bus, 'library.content', { artifactId: ID, revision: 4 })).toEqual({ ok: true, value: { revision: 4, kind: 'html', name: 'index.html', path: one } });
    expect(await answer(bus, 'library.content', { artifactId: ID, revision: 5 })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'no content at 5' } });
  });

  // M6b fix wave 2 (Decision Log 36i): a File artifact's file read by the artifact alone, its path resolved here, read by
  // the files service in process (no files.readResolved on the bus)
  it('reads a File artifact’s stored file at a revision by its id through the files service; refuses another kind', async () => {
    const csv = put('ledger.csv', 'item,cost\n');
    const file = reads({ kind: 'file', files: { 2: { name: 'ledger.csv', path: csv } } });
    expect(await answer(file.bus, 'library.read', { artifactId: ID, offset: 0, hash: true })).toMatchObject({ ok: true, value: { content: 'item,cost\n' } });
    expect(file.readResolved).toHaveBeenCalledWith({ path: csv, offset: 0, hash: true });
    const page = reads({ kind: 'html', files: { 4: { name: 'index.html', path: put('index.html', '<p>x</p>') } } });
    expect(await answer(page.bus, 'library.read', { artifactId: ID })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: `artifact ${ID} is not a file artifact` } });
    expect(page.readResolved).not.toHaveBeenCalled();
  });

  it('fails library.read with the files service’s own refusal', async () => {
    const csv = join(dir, 'gone.csv');
    const file = reads({ kind: 'file', files: { 2: { name: 'gone.csv', path: csv } } }, { files: { readResolved: async () => Promise.reject(new Error(`not found: ${csv}`)) } });
    expect(await answer(file.bus, 'library.read', { artifactId: ID })).toEqual({ ok: false, error: { code: 'internal', message: `not found: ${csv}` } });
  });

  it('opens a document externally and reveals any file on the asking client, through the e2e seam’s log when it is set', async () => {
    const pdf = put('report.pdf', '%PDF-1.4');
    const opened = reads({ kind: 'file', files: { 2: { name: 'report.pdf', path: pdf } } });
    const client = endableClientRef('page:7.1');
    expect(await opened.bus.invoke('library.openExternally', { artifactId: ID }, client)).toEqual({ ok: true, value: { opened: true, message: null } });
    expect(opened.openExternal).toHaveBeenCalledWith(client, { path: pdf });
    expect(await opened.bus.invoke('library.reveal', { artifactId: ID }, client)).toEqual({ ok: true, value: { revealed: true, message: null } });
    expect(opened.reveal).toHaveBeenCalledWith(client, pdf);

    const log = join(dir, 'open.log');
    const seamed = reads({ kind: 'file', files: { 2: { name: 'report.pdf', path: pdf } } }, { env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    await answer(seamed.bus, 'library.openExternally', { artifactId: ID });
    await answer(seamed.bus, 'library.reveal', { artifactId: ID });
    expect(readFileSync(log, 'utf8')).toBe(`${pdf}\nreveal ${pdf}\n`);
    expect(seamed.openExternal).not.toHaveBeenCalled();
    expect(seamed.reveal).not.toHaveBeenCalled();
  });

  it('answers that no client could open or reveal it when the port has none', async () => {
    const pdf = put('report.pdf', '%PDF-1.4');
    const gone = reads({ kind: 'file', files: { 2: { name: 'report.pdf', path: pdf } } }, { port: { openExternal: async () => NO_CLIENT, reveal: async () => NO_CLIENT } });
    expect(await answer(gone.bus, 'library.openExternally', { artifactId: ID })).toMatchObject({ ok: true, value: { opened: false, message: expect.any(String) } });
    expect(await answer(gone.bus, 'library.reveal', { artifactId: ID })).toMatchObject({ ok: true, value: { revealed: false, message: expect.any(String) } });
  });

  it('never opens a program or a kind the OS would run, and reveals only a file still on disk: each refusal is an answer', async () => {
    const script = put('run.sh', 'echo hi');
    const tool = put('tool.html', '<p>x</p>');
    chmodSync(tool, 0o755);
    const sh = reads({ kind: 'file', files: { 1: { name: 'run.sh', path: script } } });
    expect(await answer(sh.bus, 'library.openExternally', { artifactId: ID })).toEqual({ ok: true, value: { opened: false, message: 'Not opened outside MAWS: run.sh' } });
    const exec = reads({ kind: 'file', files: { 1: { name: 'tool.html', path: tool } } });
    expect(await answer(exec.bus, 'library.openExternally', { artifactId: ID })).toEqual({ ok: true, value: { opened: false, message: 'Not opened outside MAWS: tool.html' } });
    expect(sh.openExternal).not.toHaveBeenCalled();
    expect(exec.openExternal).not.toHaveBeenCalled();
    const gone = reads({ kind: 'file', files: { 1: { name: 'gone.pdf', path: join(dir, 'gone.pdf') } } });
    expect(await answer(gone.bus, 'library.reveal', { artifactId: ID })).toEqual({ ok: true, value: { revealed: false, message: 'Not on disk any more: gone.pdf' } });
    expect(gone.reveal).not.toHaveBeenCalled();
  });
});
