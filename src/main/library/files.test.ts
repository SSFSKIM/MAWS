// The viewers' and the library's reach to a byte kind's stored file (files.ts): the formats the exporter registry
// serves, the stored file resolved through the host, Open externally and Reveal (with the e2e seam's log), and Save as…
// of an export or of the stored file (with the e2e seam's folder).
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult } from '@shared/ipc/schema';
import { artifactExportName, type ArtifactExportFormat } from '@shared/maws/tools';
import { zipFiles } from '../design-systems/zip';
import { createLibraryFiles, type LibraryFilesDeps } from './files';

// Run real filesystem operations, interleaving another writer at the asynchronous boundaries.
const diskRace = vi.hoisted(() => ({
  afterLstat: null as ((path: string) => void) | null,
  beforeRename: null as ((from: string, to: string) => void) | null,
  afterRename: null as ((from: string, to: string) => void) | null,
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const lstat = (async (...args: Parameters<typeof actual.lstat>) => {
    try { return await actual.lstat(...args); } finally { diskRace.afterLstat?.(String(args[0])); }
  }) as typeof actual.lstat;
  const rename: typeof actual.rename = async (from, to) => {
    diskRace.beforeRename?.(String(from), String(to));
    await actual.rename(from, to);
    diskRace.afterRename?.(String(from), String(to));
  };
  return { ...actual, lstat, rename };
});

const ID = '00000000-0000-4000-8000-000000000001';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-library-files-'));
});
afterEach(() => {
  diskRace.afterLstat = diskRace.beforeRename = diskRace.afterRename = null;
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

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
    confirmReplaceFolder: vi.fn(async () => false),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
    readFile: vi.fn(async ({ path, offset = 0 }) => ({ encoding: 'utf8' as const, content: readFileSync(path, 'utf8').slice(offset), bytes: 0, offset, length: 0, truncated: false, mime: 'text/plain', hash: null, utf8: null })),
    env: {},
    ...over,
  };
}

function put(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

function ownedPngExport() {
  const exports = join(dir, 'artifacts', ID, 'exports');
  mkdirSync(exports, { recursive: true });
  const exportId = '00000000-0000-4000-8000-0000000000e1';
  writeFileSync(join(exports, artifactExportName(7, 'pngs', exportId)), zipFiles({ 'slide-01.png': Uint8Array.from([1, 2]), 'slide-02.png': Uint8Array.from([3, 4]) }));
  const parent = join(dir, 'chosen');
  mkdirSync(parent);
  return { exports, parent, chosen: join(parent, 'Quarterly slides'), input: { artifactId: ID, source: { export: { revision: 7, format: 'pngs', exportId } } } satisfies CommandInput<'library.saveAs'> };
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

  // M6b fix wave 2 (Decision Log 36i): a File artifact's file read by the artifact alone, its path resolved here
  it('reads a File artifact’s stored file at a revision by its id, the path resolved here; refuses another kind', async () => {
    const csv = put('ledger.csv', 'item,cost\n');
    const reading = deps({ kind: 'file', title: 'ledger.csv', files: { 2: { name: 'ledger.csv', path: csv } } });
    const files = createLibraryFiles(reading);
    await expect(files.read({ artifactId: ID, offset: 0, hash: true })).resolves.toMatchObject({ content: 'item,cost\n' });
    expect(reading.readFile).toHaveBeenCalledWith({ path: csv, offset: 0, hash: true });
    const page = createLibraryFiles(deps({ kind: 'html', title: 'Page', files: { 4: { name: 'index.html', path: put('index.html', '<p>x</p>') } } }));
    await expect(page.read({ artifactId: ID })).rejects.toMatchObject({ error: { code: 'invalid_input' } });
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

  it('saves all-slide PNGs as one named folder only after explicit replacement approval, remembering its parent', async () => {
    const exported = join(dir, 'artifacts', ID, 'exports', artifactExportName(7, 'pngs'));
    mkdirSync(join(dir, 'artifacts', ID, 'exports'), { recursive: true });
    writeFileSync(exported, zipFiles({ 'slide-01.png': Uint8Array.from([1, 2]), 'slide-02.png': Uint8Array.from([3, 4]) }));
    const parent = join(dir, 'chosen');
    const chosen = join(parent, 'Quarterly slides');
    mkdirSync(chosen, { recursive: true });
    writeFileSync(join(chosen, 'old.png'), 'old');
    const showSaveDialog = vi.fn<LibraryFilesDeps['showSaveDialog']>(async () => ({ canceled: false, filePath: chosen }));
    const confirmReplaceFolder = vi.fn(async () => {
      expect(readdirSync(chosen)).toEqual(['old.png']);
      expect(readFileSync(join(chosen, 'old.png'), 'utf8')).toBe('old');
      return true;
    });
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, { showSaveDialog, confirmReplaceFolder }));
    await expect(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pngs' } } })).resolves.toEqual({ saved: true, path: chosen });
    expect(confirmReplaceFolder).toHaveBeenCalledExactlyOnceWith(chosen, undefined);
    expect(readdirSync(chosen)).toEqual(['slide-01.png', 'slide-02.png']);
    expect([...readFileSync(join(chosen, 'slide-01.png'))]).toEqual([1, 2]);
    expect([...readFileSync(join(chosen, 'slide-02.png'))]).toEqual([3, 4]);
    expect(showSaveDialog.mock.calls[0]![0]).toMatchObject({ defaultPath: join(dir, 'Downloads', 'Quarterly slides') });
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: chosen });
    await expect(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pngs' } } })).resolves.toEqual({ saved: false });
    expect(showSaveDialog.mock.calls[1]![0]).toMatchObject({ defaultPath: chosen });
    expect(readdirSync(parent)).toEqual(['Quarterly slides']);
  });

  it.each(['save dialog', 'replacement prompt'] as const)('cancelling the PNG %s preserves every existing file and removes the owned export and staging files', async (cancelAt) => {
    const exports = join(dir, 'artifacts', ID, 'exports');
    mkdirSync(exports, { recursive: true });
    const exportId = '00000000-0000-4000-8000-0000000000e1';
    const own = join(exports, artifactExportName(7, 'pngs', exportId));
    const cached = join(exports, artifactExportName(7, 'pngs'));
    const pngs = zipFiles({ 'slide-01.png': Uint8Array.from([1, 2]), 'slide-02.png': Uint8Array.from([3, 4]) });
    writeFileSync(own, pngs);
    writeFileSync(cached, pngs);
    const parent = join(dir, 'chosen');
    const chosen = join(parent, 'Quarterly slides');
    mkdirSync(join(chosen, 'nested'), { recursive: true });
    writeFileSync(join(chosen, 'old.png'), 'old');
    writeFileSync(join(chosen, 'nested', 'keep.txt'), 'Keep this');
    const confirmReplaceFolder = vi.fn(async () => false);
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: cancelAt === 'save dialog', filePath: chosen }),
      confirmReplaceFolder,
    }));
    await expect(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pngs', exportId } } })).resolves.toEqual({ saved: false });
    expect(confirmReplaceFolder).toHaveBeenCalledTimes(cancelAt === 'save dialog' ? 0 : 1);
    expect(readdirSync(parent)).toEqual(['Quarterly slides']);
    expect(readdirSync(chosen)).toEqual(['nested', 'old.png']);
    expect(readFileSync(join(chosen, 'old.png'), 'utf8')).toBe('old');
    expect(readdirSync(join(chosen, 'nested'))).toEqual(['keep.txt']);
    expect(readFileSync(join(chosen, 'nested', 'keep.txt'), 'utf8')).toBe('Keep this');
    expect(readdirSync(exports)).toEqual([artifactExportName(7, 'pngs')]);
    expect([...readFileSync(cached)]).toEqual([...pngs]);
  });

  it('publishes a complete PNG folder at a new destination without a replacement prompt', async () => {
    const { exports, parent, chosen, input } = ownedPngExport();
    const confirmReplaceFolder = vi.fn(async () => false);
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder,
    }));
    await expect(files.saveAs(input)).resolves.toEqual({ saved: true, path: chosen });
    expect(confirmReplaceFolder).not.toHaveBeenCalled();
    expect(readdirSync(chosen)).toEqual(['slide-01.png', 'slide-02.png']);
    expect([...readFileSync(join(chosen, 'slide-01.png'))]).toEqual([1, 2]);
    expect([...readFileSync(join(chosen, 'slide-02.png'))]).toEqual([3, 4]);
    expect(readdirSync(parent)).toEqual(['Quarterly slides']);
    expect(readdirSync(exports)).toEqual([]);
  });

  it.each(['file', 'symbolic link'] as const)('refuses an existing %s as a PNG folder destination without replacing it', async (kind) => {
    const { exports, parent, chosen, input } = ownedPngExport();
    const target = join(parent, 'important.txt');
    writeFileSync(target, 'Keep this');
    if (kind === 'file') writeFileSync(chosen, 'Original file');
    else symlinkSync(target, chosen);
    const confirmReplaceFolder = vi.fn(async () => true);
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder,
    }));
    await expect(files.saveAs(input)).rejects.toThrow(/folder/i);
    expect(confirmReplaceFolder).not.toHaveBeenCalled();
    expect(readFileSync(target, 'utf8')).toBe('Keep this');
    expect(readFileSync(chosen, 'utf8')).toBe(kind === 'file' ? 'Original file' : 'Keep this');
    expect(lstatSync(chosen).isSymbolicLink()).toBe(kind === 'symbolic link');
    expect(readdirSync(parent)).toEqual(['Quarterly slides', 'important.txt']);
    expect(readdirSync(exports)).toEqual([]);
  });

  it.each([false, true])('asks about a folder created while loading the PNG bundle, honoring Replace=%s', async (replace) => {
    const { exports, parent, chosen, input } = ownedPngExport();
    const loadAsync = JSZip.loadAsync;
    vi.spyOn(JSZip, 'loadAsync').mockImplementationOnce(async (data, options) => {
      const zip = await loadAsync(data, options);
      mkdirSync(chosen);
      writeFileSync(join(chosen, 'important.txt'), 'Created while staging');
      return zip;
    });
    const sender = {} as Parameters<LibraryFilesDeps['showSaveDialog']>[1];
    const confirmReplaceFolder = vi.fn(async () => {
      expect(readFileSync(join(chosen, 'important.txt'), 'utf8')).toBe('Created while staging');
      return replace;
    });
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder,
    }));
    await expect(files.saveAs(input, sender)).resolves.toEqual(replace ? { saved: true, path: chosen } : { saved: false });
    expect(confirmReplaceFolder).toHaveBeenCalledExactlyOnceWith(chosen, sender);
    if (replace) {
      expect(readdirSync(chosen)).toEqual(['slide-01.png', 'slide-02.png']);
      expect([...readFileSync(join(chosen, 'slide-01.png'))]).toEqual([1, 2]);
      expect([...readFileSync(join(chosen, 'slide-02.png'))]).toEqual([3, 4]);
    } else {
      expect(readdirSync(chosen)).toEqual(['important.txt']);
      expect(readFileSync(join(chosen, 'important.txt'), 'utf8')).toBe('Created while staging');
    }
    expect(readdirSync(parent)).toEqual(['Quarterly slides']);
    expect(readdirSync(exports)).toEqual([]);
  });

  it.each(['directory', 'symbolic link'] as const)('refuses a destination swapped for another %s during replacement approval', async (replacement) => {
    const { exports, parent, chosen, input } = ownedPngExport();
    mkdirSync(chosen);
    writeFileSync(join(chosen, 'old.png'), 'Original');
    const original = join(parent, 'original');
    const incoming = join(parent, 'incoming');
    mkdirSync(incoming);
    writeFileSync(join(incoming, 'important.txt'), 'Not approved');
    const confirmReplaceFolder = vi.fn(async () => {
      renameSync(chosen, original);
      if (replacement === 'directory') renameSync(incoming, chosen);
      else symlinkSync(incoming, chosen);
      return true;
    });
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder,
    }));
    await expect(files.saveAs(input)).rejects.toThrow(/changed/i);
    expect(readFileSync(join(chosen, 'important.txt'), 'utf8')).toBe('Not approved');
    expect(lstatSync(chosen).isSymbolicLink()).toBe(replacement === 'symbolic link');
    expect(readFileSync(join(original, 'old.png'), 'utf8')).toBe('Original');
    expect(readdirSync(parent)).toEqual(replacement === 'directory' ? ['Quarterly slides', 'original'] : ['Quarterly slides', 'incoming', 'original']);
    expect(readdirSync(exports)).toEqual([]);
  });

  it('refuses a folder created just after the destination was observed absent', async () => {
    const { exports, parent, chosen, input } = ownedPngExport();
    diskRace.afterLstat = (path) => {
      if (path !== chosen) return;
      diskRace.afterLstat = null;
      mkdirSync(chosen);
      writeFileSync(join(chosen, 'important.txt'), 'Not approved');
    };
    const confirmReplaceFolder = vi.fn(async () => true);
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder,
    }));
    await expect(files.saveAs(input)).rejects.toThrow(/changed/i);
    expect(confirmReplaceFolder).not.toHaveBeenCalled();
    expect(readdirSync(chosen)).toEqual(['important.txt']);
    expect(readFileSync(join(chosen, 'important.txt'), 'utf8')).toBe('Not approved');
    expect(readdirSync(parent)).toEqual(['Quarterly slides']);
    expect(readdirSync(exports)).toEqual([]);
  });

  it('checks the moved folder identity, preserving a swap between the last check and the move', async () => {
    const { exports, parent, chosen, input } = ownedPngExport();
    mkdirSync(chosen);
    writeFileSync(join(chosen, 'old.png'), 'Original');
    const original = join(parent, 'original');
    diskRace.beforeRename = (from) => {
      if (from !== chosen) return;
      diskRace.beforeRename = null;
      renameSync(chosen, original);
      mkdirSync(chosen);
      writeFileSync(join(chosen, 'important.txt'), 'Not approved');
    };
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder: async () => true,
    }));
    await expect(files.saveAs(input)).rejects.toThrow(/changed/i);
    expect(readFileSync(join(chosen, 'important.txt'), 'utf8')).toBe('Not approved');
    expect(readFileSync(join(original, 'old.png'), 'utf8')).toBe('Original');
    expect(readdirSync(parent)).toEqual(['Quarterly slides', 'original']);
    expect(readdirSync(exports)).toEqual([]);
  });

  it.each([false, true])('preserves a folder created after moving the approved destination, with contents=%s', async (withContents) => {
    const { exports, parent, chosen, input } = ownedPngExport();
    mkdirSync(chosen);
    writeFileSync(join(chosen, 'old.png'), 'Original');
    let backup = '';
    let incomingInode = 0;
    diskRace.afterRename = (from, to) => {
      if (from !== chosen) return;
      diskRace.afterRename = null;
      backup = to;
      mkdirSync(chosen);
      if (withContents) writeFileSync(join(chosen, 'important.txt'), 'Not approved');
      incomingInode = lstatSync(chosen).ino;
    };
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder: async () => true,
    }));
    const saving = files.saveAs(input);
    await expect(saving).rejects.toThrow(/changed/i);
    await expect(saving).rejects.toThrow(backup);
    expect(lstatSync(chosen).ino).toBe(incomingInode);
    expect(readdirSync(chosen)).toEqual(withContents ? ['important.txt'] : []);
    if (withContents) expect(readFileSync(join(chosen, 'important.txt'), 'utf8')).toBe('Not approved');
    expect(readFileSync(join(backup, 'old.png'), 'utf8')).toBe('Original');
    expect(readdirSync(parent).filter((name) => name !== 'Quarterly slides')).toHaveLength(1);
    expect(readdirSync(exports)).toEqual([]);
  });

  it('never recursively removes a backup swapped after publication', async () => {
    const { exports, parent, chosen, input } = ownedPngExport();
    mkdirSync(chosen);
    writeFileSync(join(chosen, 'old.png'), 'Original');
    const original = join(parent, 'original');
    let backup = '';
    diskRace.afterRename = (from, to) => {
      if (from === chosen) backup = to;
      else if (to === chosen) {
        diskRace.afterRename = null;
        renameSync(backup, original);
        mkdirSync(backup);
        writeFileSync(join(backup, 'important.txt'), 'Not approved');
      }
    };
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder: async () => true,
    }));
    await expect(files.saveAs(input)).rejects.toThrow(/changed/i);
    expect(readFileSync(join(backup, 'important.txt'), 'utf8')).toBe('Not approved');
    expect(readFileSync(join(original, 'old.png'), 'utf8')).toBe('Original');
    expect(readdirSync(chosen)).toEqual(['slide-01.png', 'slide-02.png']);
    expect(readdirSync(exports)).toEqual([]);
  });

  it.each([false, true])('a failed publication restores only a vacant destination, with a concurrent creator=%s', async (concurrentCreator) => {
    const { exports, parent, chosen, input } = ownedPngExport();
    mkdirSync(chosen);
    writeFileSync(join(chosen, 'old.png'), 'Original');
    let backup = '';
    let incomingInode = 0;
    diskRace.afterRename = (from, to) => { if (from === chosen) backup = to; };
    diskRace.beforeRename = (from, to) => {
      if (to !== chosen || from === backup) return;
      diskRace.beforeRename = null;
      if (concurrentCreator) {
        mkdirSync(chosen);
        incomingInode = lstatSync(chosen).ino;
      }
      throw new Error('Publication failed');
    };
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, {
      showSaveDialog: async () => ({ canceled: false, filePath: chosen }), confirmReplaceFolder: async () => true,
    }));
    await expect(files.saveAs(input)).rejects.toThrow(/Publication failed/);
    if (concurrentCreator) {
      expect(lstatSync(chosen).ino).toBe(incomingInode);
      expect(readdirSync(chosen)).toEqual([]);
      expect(readFileSync(join(backup, 'old.png'), 'utf8')).toBe('Original');
    } else {
      expect(readdirSync(chosen)).toEqual(['old.png']);
      expect(readFileSync(join(chosen, 'old.png'), 'utf8')).toBe('Original');
      expect(readdirSync(parent)).toEqual(['Quarterly slides']);
    }
    expect(readdirSync(exports)).toEqual([]);
  });

  it('refuses malformed PNG bundles before replacing an existing folder', async () => {
    const exported = join(dir, 'artifacts', ID, 'exports', artifactExportName(7, 'pngs'));
    mkdirSync(join(dir, 'artifacts', ID, 'exports'), { recursive: true });
    writeFileSync(exported, zipFiles({ '../escape.png': Uint8Array.from([1]) }));
    const chosen = join(dir, 'keep');
    mkdirSync(chosen);
    writeFileSync(join(chosen, 'keep.txt'), 'Keep this');
    const files = createLibraryFiles(deps({ kind: 'presentation', title: 'Quarterly', files: {} }, { showSaveDialog: async () => ({ canceled: false, filePath: chosen }) }));
    await expect(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pngs' } } })).rejects.toThrow();
    expect(readFileSync(join(chosen, 'keep.txt'), 'utf8')).toBe('Keep this');
  });

  it('saves an export under the artifact’s title through the dialog at Downloads, and nothing when cancelled', async () => {
    const exported = join(dir, 'artifacts', ID, 'exports', artifactExportName(7, 'pdf'));
    mkdirSync(join(dir, 'artifacts', ID, 'exports'), { recursive: true });
    writeFileSync(exported, '%PDF-1.7 export');
    const chosen = join(dir, 'chosen.pdf');
    const showSaveDialog = vi.fn<LibraryFilesDeps['showSaveDialog']>(async () => ({ canceled: false, filePath: chosen }));
    const files = createLibraryFiles(deps({ kind: 'html', title: 'Q3: plans / review', files: {} }, { showSaveDialog }));
    await expect(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pdf' } } })).resolves.toEqual({ saved: true, path: chosen });
    expect(showSaveDialog).toHaveBeenCalledWith({ defaultPath: join(dir, 'Downloads', 'Q3- plans - review.pdf') }, undefined);
    expect(readFileSync(chosen, 'utf8')).toBe('%PDF-1.7 export');

    const cancelled = createLibraryFiles(deps({ kind: 'html', title: 'Page', files: {} }));
    await expect(cancelled.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pdf' } } })).resolves.toEqual({ saved: false });
    await expect(cancelled.saveAs({ artifactId: ID, source: { export: { revision: 8, format: 'pdf' } } })).rejects.toThrow(/no export/);
  });

  // P4 (W1, tracker 2026-10-19 L302): an export of its own file is found by its id, whatever another export of the same
  // revision and format wrote at the cache name meanwhile, and the save removes it once copied or declined, since
  // nothing else collects the exports directory; the cache name's file is never the save's to remove
  it('saves an export of its own by its id, past another export at the cache name, and removes it once saved or cancelled', async () => {
    const exports = join(dir, 'artifacts', ID, 'exports');
    mkdirSync(exports, { recursive: true });
    const OWN = '00000000-0000-4000-8000-0000000000e1';
    const own = join(exports, artifactExportName(7, 'pdf', OWN));
    const cached = join(exports, artifactExportName(7, 'pdf'));
    writeFileSync(own, '%PDF letter');
    writeFileSync(cached, '%PDF a4, the agent’s'); // the interleaved export of the same revision and format
    const chosen = join(dir, 'chosen.pdf');
    const files = createLibraryFiles(deps({ kind: 'document', title: 'Plan', files: {} }, { showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: chosen })) }));
    await expect(files.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pdf', exportId: OWN } } })).resolves.toEqual({ saved: true, path: chosen });
    expect(readFileSync(chosen, 'utf8')).toBe('%PDF letter');
    expect(readdirSync(exports)).toEqual([artifactExportName(7, 'pdf')]);

    writeFileSync(own, '%PDF letter again');
    const cancelled = createLibraryFiles(deps({ kind: 'document', title: 'Plan', files: {} }));
    await expect(cancelled.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pdf', exportId: OWN } } })).resolves.toEqual({ saved: false });
    await expect(cancelled.saveAs({ artifactId: ID, source: { export: { revision: 7, format: 'pdf' } } })).resolves.toEqual({ saved: false });
    expect(readdirSync(exports)).toEqual([artifactExportName(7, 'pdf')]);
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
