// The viewers' and the library's reach to a byte kind's stored file (files.ts): the formats the exporter registry
// serves, the stored file resolved through the host, Open externally and Reveal (with the e2e seam's log), and Save as…
// of an export or of the stored file (with the e2e seam's folder).
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { artifactExportName, type ArtifactExportFormat } from '@shared/maws/tools';
import { createLibraryFiles, type LibraryFilesDeps } from './files';

const ID = '00000000-0000-4000-8000-000000000001';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-library-files-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Stored {
  kind: ArtifactKind;
  title: string;
  files: Record<number, { name: string; path: string }>; // by revision; the highest is the latest
}

function deps(stored: Stored, over: Partial<LibraryFilesDeps> = {}): LibraryFilesDeps {
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>> => {
    if (name === 'artifacts.get') return { ok: true, value: { artifact: { id: ID, kind: stored.kind, title: stored.title, revision: 3 } } } as never;
    if (name === 'artifacts.content') {
      const { revision } = input as CommandInput<'artifacts.content'>;
      const at = revision ?? Math.max(...Object.keys(stored.files).map(Number));
      const file = stored.files[at];
      if (!file) return { ok: false, error: ipcError('invalid_input', `no content at ${at}`, { reason: 'notFound', data: {} }) } as never;
      return { ok: true, value: { revision: at, kind: stored.kind, name: file.name, size: 1, sha256: 'x', path: file.path } } as never;
    }
    throw new Error(`unexpected ${name}`);
  };
  return {
    call,
    exporters: { get: (kind: ArtifactKind, format: ArtifactExportFormat) => (kind === 'html' && (format === 'pdf' || format === 'png') ? ({} as never) : undefined) },
    root: join(dir, 'artifacts'),
    downloads: () => join(dir, 'Downloads'),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    env: {},
    ...over,
  };
}

function put(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

describe('library files', () => {
  it('lists the formats the registry serves for a kind, in the formats’ order', () => {
    const files = createLibraryFiles(deps({ kind: 'html', title: 'Page', files: {} }));
    expect(files.exportFormats({ kind: 'html' })).toEqual({ formats: ['pdf', 'png'] });
    expect(files.exportFormats({ kind: 'file' })).toEqual({ formats: [] });
  });

  it('resolves the stored file at a revision, the latest when none is named, and passes a refusal on', async () => {
    const one = put('one.html', 'v1');
    const two = put('two.html', 'v2');
    const files = createLibraryFiles(deps({ kind: 'html', title: 'Page', files: { 4: { name: 'index.html', path: one }, 9: { name: 'index.html', path: two } } }));
    await expect(files.content({ artifactId: ID })).resolves.toEqual({ revision: 9, kind: 'html', name: 'index.html', path: two });
    await expect(files.content({ artifactId: ID, revision: 4 })).resolves.toEqual({ revision: 4, kind: 'html', name: 'index.html', path: one });
    await expect(files.content({ artifactId: ID, revision: 5 })).rejects.toMatchObject({ error: { code: 'invalid_input' } });
  });

  it('opens a document externally and reveals any file, through the e2e seam’s log when it is set', async () => {
    const pdf = put('report.pdf', '%PDF-1.4');
    const opened = deps({ kind: 'file', title: 'report.pdf', files: { 2: { name: 'report.pdf', path: pdf } } });
    const files = createLibraryFiles(opened);
    await expect(files.openExternally({ artifactId: ID })).resolves.toEqual({ opened: true, message: null });
    expect(opened.openPath).toHaveBeenCalledWith(pdf);
    await expect(files.reveal({ artifactId: ID })).resolves.toEqual({ revealed: true, message: null });
    expect(opened.showItemInFolder).toHaveBeenCalledWith(pdf);

    const log = join(dir, 'open.log');
    const seamed = deps({ kind: 'file', title: 'report.pdf', files: { 2: { name: 'report.pdf', path: pdf } } }, { env: { MAWS_E2E: '1', MAWS_E2E_OPEN_LOG: log } });
    const seam = createLibraryFiles(seamed);
    await seam.openExternally({ artifactId: ID });
    await seam.reveal({ artifactId: ID });
    expect(readFileSync(log, 'utf8')).toBe(`${pdf}\nreveal ${pdf}\n`);
    expect(seamed.openPath).not.toHaveBeenCalled();
  });

  it('never opens a program or a kind the OS would run: the refusal is an answer', async () => {
    const script = put('run.sh', 'echo hi');
    const tool = put('tool.html', '<p>x</p>');
    chmodSync(tool, 0o755);
    const sh = deps({ kind: 'file', title: 'run.sh', files: { 1: { name: 'run.sh', path: script } } });
    await expect(createLibraryFiles(sh).openExternally({ artifactId: ID })).resolves.toEqual({ opened: false, message: 'Not opened outside MAWS: run.sh' });
    const exec = deps({ kind: 'file', title: 'tool.html', files: { 1: { name: 'tool.html', path: tool } } });
    await expect(createLibraryFiles(exec).openExternally({ artifactId: ID })).resolves.toEqual({ opened: false, message: 'Not opened outside MAWS: tool.html' });
    expect(sh.openPath).not.toHaveBeenCalled();
    expect(exec.openPath).not.toHaveBeenCalled();
  });

  it('saves an export under the artifact’s title through the dialog at Downloads, and nothing when cancelled', async () => {
    const exported = join(dir, 'artifacts', ID, 'exports', artifactExportName(7, 'pdf'));
    mkdirSync(join(dir, 'artifacts', ID, 'exports'), { recursive: true });
    writeFileSync(exported, '%PDF-1.7 export');
    const chosen = join(dir, 'chosen.pdf');
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: chosen }));
    const files = createLibraryFiles(deps({ kind: 'html', title: 'Q3: plans / review', files: {} }, { showSaveDialog }));
    await expect(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pdf' } } })).resolves.toEqual({ saved: true, path: chosen });
    expect(showSaveDialog).toHaveBeenCalledWith({ defaultPath: join(dir, 'Downloads', 'Q3- plans - review.pdf') }, undefined);
    expect(readFileSync(chosen, 'utf8')).toBe('%PDF-1.7 export');

    const cancelled = createLibraryFiles(deps({ kind: 'html', title: 'Page', files: {} }));
    await expect(cancelled.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pdf' } } })).resolves.toEqual({ saved: false });
    await expect(cancelled.saveAs({ artifactId: ID, source: { export: { revision: 8, format: 'pdf' } } })).rejects.toThrow(/no export/);
  });

  it('saves a copy of a File artifact under its own name, into the e2e seam’s folder without a dialog', async () => {
    const csv = put('budget.csv', 'month,amount\n');
    const into = join(dir, 'saved');
    mkdirSync(into);
    const seamed = deps({ kind: 'file', title: 'Budget', files: { 3: { name: 'budget.csv', path: csv } } }, { env: { MAWS_E2E: '1', MAWS_E2E_SAVE_PATH: into } });
    const files = createLibraryFiles(seamed);
    await expect(files.saveAs({ artifactId: ID, source: { content: {} } })).resolves.toEqual({ saved: true, path: join(into, 'budget.csv') });
    expect(readFileSync(join(into, 'budget.csv'), 'utf8')).toBe('month,amount\n');
    expect(seamed.showSaveDialog).not.toHaveBeenCalled();
  });
});
