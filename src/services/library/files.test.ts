// P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, acceptance 6; D19): the library's reads of a stored file,
// the machine's half (moved from src/main/library/files.test.ts with its cases): the stored file resolved through the
// engine host's `artifacts.content`, a File artifact's bytes read through the files service in process, a document
// opened and any file revealed on the asking client through the client port (or the e2e seam's log), a program never
// opened. Over the bus, as the spine registers them.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { NO_CLIENT } from '@shared/client/port';
import { endableClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { createFilesService } from '../files/service';
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
  registerLibraryReads(bus.register, { hosts: { dispatch: dispatch as never }, files: { readResolved }, port: { openExternal, reveal }, env: {}, artifactsRoot: join(dir, 'artifacts'), ...over });
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

// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "Open a copy, and Save As of a remote artifact",
// Interfaces §O): `library.read`'s export form reads a file `artifacts.export` wrote, its path resolved here as
// `library.saveAs` resolves it (the export grammar's name under `<root>/<artifactId>/exports/`), a regular file with no link
// on the way below the root, through the files service's own read (the real one here)
describe('library.read’s export form', () => {
  const EXPORT_ID = '00000000-0000-4000-8000-0000000000e1';
  const exportsOf = (root: string, id = ID) => join(root, id, 'exports');
  function exported(root = join(dir, 'artifacts')) {
    mkdirSync(exportsOf(root), { recursive: true });
    writeFileSync(join(exportsOf(root), '3-pdf.pdf'), '%PDF-1.7 cache');
    writeFileSync(join(exportsOf(root), `3-pdf-${EXPORT_ID}.pdf`), '%PDF-1.7 own');
    writeFileSync(join(exportsOf(root), '4-md.md'), '# Notes\n');
    return root;
  }
  const real = (artifactsRoot = join(dir, 'artifacts')) => {
    const files = createFilesService({ records: () => null, env: {} });
    return reads({ kind: 'html', files: {} }, { files, artifactsRoot });
  };

  it('reads an export under the artifact’s exports directory, the cache name or an own file’s, in chunks, with no host call', async () => {
    exported();
    const { bus, dispatch } = real();
    expect(await answer(bus, 'library.read', { artifactId: ID, export: { revision: 3, format: 'pdf' } })).toMatchObject({ ok: true, value: { encoding: 'base64', content: Buffer.from('%PDF-1.7 cache').toString('base64'), bytes: 14, truncated: false } });
    expect(await answer(bus, 'library.read', { artifactId: ID, export: { revision: 3, format: 'pdf', exportId: EXPORT_ID }, offset: 9, length: 3, hash: true })).toMatchObject({
      ok: true,
      value: { content: Buffer.from('own').toString('base64'), offset: 9, length: 3, bytes: 12, hash: expect.any(String) },
    });
    expect(await answer(bus, 'library.read', { artifactId: ID, export: { revision: 4, format: 'md' } })).toMatchObject({ ok: true, value: { encoding: 'utf8', content: '# Notes\n' } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reads through a link above the artifacts root, which is the profile’s own location', async () => {
    exported();
    symlinkSync(join(dir, 'artifacts'), join(dir, 'profile-link'));
    const { bus } = real(join(dir, 'profile-link'));
    expect(await answer(bus, 'library.read', { artifactId: ID, export: { revision: 4, format: 'md' } })).toMatchObject({ ok: true, value: { content: '# Notes\n' } });
  });

  it('refuses a name outside the export grammar at the schema, and a top-level revision beside the export', async () => {
    exported();
    const { bus, readResolved } = reads({ kind: 'html', files: {} });
    for (const export_ of [
      { revision: 3, format: 'exe' },
      { revision: -1, format: 'pdf' },
      { revision: 3, format: 'pdf', exportId: '../../../etc/passwd' },
      { revision: 3, format: 'pdf', path: '/etc/passwd' },
      { revision: '3-pdf.pdf/../../x', format: 'pdf' },
    ]) {
      expect(await answer(bus, 'library.read', { artifactId: ID, export: export_ }), JSON.stringify(export_)).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    expect(await answer(bus, 'library.read', { artifactId: '../x', export: { revision: 3, format: 'pdf' } })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(await answer(bus, 'library.read', { artifactId: ID, revision: 3, export: { revision: 3, format: 'pdf' } })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(readResolved).not.toHaveBeenCalled();
  });

  it('refuses a path elsewhere: an exports directory or an export that is a link, a directory in its place, one missing', async () => {
    const root = exported();
    const elsewhere = join(dir, 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, '3-pdf.pdf'), 'secret');
    writeFileSync(join(elsewhere, '5-md.md'), 'secret');
    symlinkSync(join(elsewhere, '5-md.md'), join(exportsOf(root), '5-md.md')); // the export itself a link
    mkdirSync(join(exportsOf(root), '6-md.md')); // a directory where the export would be
    const OTHER = '00000000-0000-4000-8000-000000000002';
    mkdirSync(join(root, OTHER));
    symlinkSync(elsewhere, exportsOf(root, OTHER)); // another artifact's exports directory a link
    const { bus } = real();
    const refused = { ok: false, error: { code: 'invalid_input' } };
    expect(await answer(bus, 'library.read', { artifactId: ID, export: { revision: 5, format: 'md' } })).toMatchObject(refused);
    expect(await answer(bus, 'library.read', { artifactId: ID, export: { revision: 6, format: 'md' } })).toMatchObject(refused);
    expect(await answer(bus, 'library.read', { artifactId: OTHER, export: { revision: 3, format: 'pdf' } })).toMatchObject(refused);
    expect(await answer(bus, 'library.read', { artifactId: ID, export: { revision: 7, format: 'pdf' } })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: `no export 7-pdf.pdf of ${ID}; export it again` } });
  });
});

