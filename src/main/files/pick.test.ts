import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PickedFileSchema } from '@shared/ipc/schema/layout';
import { IMAGE_MAX_BYTES, PDF_MAX_BYTES, pickFiles, type OpenDialog } from './pick';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-pick-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const dialogAnswering = (filePaths: string[], canceled = false) => vi.fn<OpenDialog>(async () => ({ canceled, filePaths }));

describe('layout.pickFiles', () => {
  it('opens files with multiSelections at the directory and reads bytes only for images and PDFs under their caps', async () => {
    const png = join(dir, 'shot.png');
    const pdf = join(dir, 'spec.pdf');
    const ts = join(dir, 'main.ts');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(pdf, '%PDF-1.7');
    writeFileSync(ts, 'export {};\n');
    const showOpenDialog = dialogAnswering([png, pdf, ts]);
    const { files } = await pickFiles({ kind: 'files', directory: dir, multiple: true }, { showOpenDialog });
    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile', 'multiSelections'], defaultPath: dir });
    for (const file of files) PickedFileSchema.parse(file);
    expect(files).toEqual([
      { path: png, name: 'shot.png', bytes: 4, mediaType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') },
      { path: pdf, name: 'spec.pdf', bytes: 8, mediaType: 'application/pdf', data: Buffer.from('%PDF-1.7').toString('base64') },
      { path: ts, name: 'main.ts', bytes: 11, mediaType: null, data: null },
    ]);
  });

  it('filters photos to images, and answers a chosen directory by path without reading it', async () => {
    const photos = dialogAnswering([]);
    await pickFiles({ kind: 'photos', directory: null, multiple: false }, { showOpenDialog: photos });
    expect(photos.mock.calls[0]![0]).toMatchObject({ properties: ['openFile'], filters: [{ name: 'Images', extensions: expect.arrayContaining(['png', 'jpg', 'jpeg', 'gif', 'webp']) }] });
    expect(photos.mock.calls[0]![0].defaultPath).toBeUndefined();

    const folder = join(dir, 'extra');
    mkdirSync(folder);
    writeFileSync(join(folder, 'secret.png'), 'x');
    const directory = dialogAnswering([folder]);
    const { files } = await pickFiles({ kind: 'directory', directory: dir, multiple: false }, { showOpenDialog: directory });
    expect(directory.mock.calls[0]![0].properties).toEqual(['openDirectory', 'createDirectory']); // New chat: Codex's folder dialog lets a new project's folder be made there (main-BvBtZhys.js:121436-121458)
    expect(files).toEqual([{ path: folder, name: 'extra', bytes: 0, mediaType: 'inode/directory', data: null }]);
  });

  it('lets a multiple directory pick choose several folders in one dialog (E1: a `multiple` folder question)', async () => {
    const one = join(dir, 'one');
    const two = join(dir, 'two');
    const dialog = dialogAnswering([one, two]);
    const { files } = await pickFiles({ kind: 'directory', directory: dir, multiple: true }, { showOpenDialog: dialog });
    expect(dialog.mock.calls[0]![0].properties).toEqual(['openDirectory', 'createDirectory', 'multiSelections']);
    expect(files.map((file) => file.path)).toEqual([one, two]);
  });

  it('answers HEIC, BMP and TIFF by path: the Messages API and the canvas downscale take only PNG, JPEG, GIF and WebP', async () => {
    const picked = ['a.heic', 'b.bmp', 'c.tiff', 'd.webp'].map((name) => {
      writeFileSync(join(dir, name), 'x');
      return join(dir, name);
    });
    const { files } = await pickFiles({ kind: 'files', directory: null, multiple: true }, { showOpenDialog: dialogAnswering(picked) });
    expect(files.map((f) => [f.name, f.mediaType, f.data])).toEqual([
      ['a.heic', 'image/heic', null],
      ['b.bmp', 'image/bmp', null],
      ['c.tiff', 'image/tiff', null],
      ['d.webp', 'image/webp', Buffer.from('x').toString('base64')],
    ]);
  });

  it('answers nothing for a cancelled dialog and data: null over the caps', async () => {
    expect(await pickFiles({ kind: 'files', directory: null, multiple: true }, { showOpenDialog: dialogAnswering([join(dir, 'x')], true) })).toEqual({ files: [] });
    expect(IMAGE_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(PDF_MAX_BYTES).toBe(32 * 1024 * 1024);
    const big = join(dir, 'huge.jpg');
    writeFileSync(big, Buffer.alloc(64));
    const { files } = await pickFiles({ kind: 'files', directory: null, multiple: false }, { showOpenDialog: dialogAnswering([big]), imageMaxBytes: 63 });
    expect(files).toEqual([{ path: big, name: 'huge.jpg', bytes: 64, mediaType: 'image/jpeg', data: null }]);
  });
});
