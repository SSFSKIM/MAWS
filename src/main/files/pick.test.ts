import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PickedFileSchema } from '@shared/ipc/schema/layout';
import type { ClientId, ClientRef } from '@shared/ipc/client';
import type { ClientPort } from '@shared/client/port';
import { IMAGE_MAX_BYTES, PDF_MAX_BYTES, pickFiles } from './pick';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-pick-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const CLIENT: ClientRef = { id: 'page:1.1' as ClientId, onGone: () => () => {} };
// The client port's pick, answering the chosen paths (or cancelled); the request it was asked is in its calls.
const dialogAnswering = (paths: string[], cancelled = false) => vi.fn<ClientPort['pick']>(async () => (cancelled ? { cancelled: true } : { paths }));
const pick = (input: Parameters<typeof pickFiles>[0], port: ReturnType<typeof dialogAnswering>, imageMaxBytes?: number) => pickFiles(input, CLIENT, { port: { pick: port }, ...(imageMaxBytes !== undefined && { imageMaxBytes }) });

describe('layout.pickFiles', () => {
  it('opens files with multiSelections at the directory and reads bytes only for images and PDFs under their caps', async () => {
    const png = join(dir, 'shot.png');
    const pdf = join(dir, 'spec.pdf');
    const ts = join(dir, 'main.ts');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(pdf, '%PDF-1.7');
    writeFileSync(ts, 'export {};\n');
    const showOpenDialog = dialogAnswering([png, pdf, ts]);
    const { files } = await pick({ kind: 'files', directory: dir, multiple: true }, showOpenDialog);
    expect(showOpenDialog).toHaveBeenCalledWith(CLIENT, { kind: 'file', multiple: true, defaultPath: dir });
    for (const file of files) PickedFileSchema.parse(file);
    expect(files).toEqual([
      { path: png, name: 'shot.png', bytes: 4, mediaType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') },
      { path: pdf, name: 'spec.pdf', bytes: 8, mediaType: 'application/pdf', data: Buffer.from('%PDF-1.7').toString('base64') },
      { path: ts, name: 'main.ts', bytes: 11, mediaType: null, data: null },
    ]);
  });

  // E11 (tracker row E1 "layout.pickFiles reads bytes the Question sheet drops")
  it('answers paths only, reading no bytes, when the caller asks (the Question sheet)', async () => {
    const png = join(dir, 'shot.png');
    const pdf = join(dir, 'spec.pdf');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(pdf, '%PDF-1.7');
    const { files } = await pick({ kind: 'files', directory: dir, multiple: true, pathsOnly: true }, dialogAnswering([png, pdf]));
    expect(files).toEqual([
      { path: png, name: 'shot.png', bytes: 4, mediaType: 'image/png', data: null },
      { path: pdf, name: 'spec.pdf', bytes: 8, mediaType: 'application/pdf', data: null },
    ]);
  });

  it('filters photos to images, and answers a chosen directory by path without reading it', async () => {
    const photos = dialogAnswering([]);
    await pick({ kind: 'photos', directory: null, multiple: false }, photos);
    expect(photos.mock.calls[0]![1]).toMatchObject({ kind: 'file', multiple: false, filters: [{ name: 'Images', extensions: expect.arrayContaining(['png', 'jpg', 'jpeg', 'gif', 'webp']) }] });
    expect(photos.mock.calls[0]![1].defaultPath).toBeUndefined();

    const folder = join(dir, 'extra');
    mkdirSync(folder);
    writeFileSync(join(folder, 'secret.png'), 'x');
    const directory = dialogAnswering([folder]);
    const { files } = await pick({ kind: 'directory', directory: dir, multiple: false }, directory);
    expect(directory.mock.calls[0]![1]).toEqual({ kind: 'directory', multiple: false, defaultPath: dir }); // the port's panel lets a new folder be made there (electron-port.ts)
    expect(files).toEqual([{ path: folder, name: 'extra', bytes: 0, mediaType: 'inode/directory', data: null }]);
  });

  it('lets a multiple directory pick choose several folders in one dialog (E1: a `multiple` folder question)', async () => {
    const one = join(dir, 'one');
    const two = join(dir, 'two');
    const dialog = dialogAnswering([one, two]);
    const { files } = await pick({ kind: 'directory', directory: dir, multiple: true }, dialog);
    expect(dialog.mock.calls[0]![1]).toMatchObject({ kind: 'directory', multiple: true });
    expect(files.map((file) => file.path)).toEqual([one, two]);
  });

  it('answers HEIC, BMP and TIFF by path: the Messages API and the canvas downscale take only PNG, JPEG, GIF and WebP', async () => {
    const picked = ['a.heic', 'b.bmp', 'c.tiff', 'd.webp'].map((name) => {
      writeFileSync(join(dir, name), 'x');
      return join(dir, name);
    });
    const { files } = await pick({ kind: 'files', directory: null, multiple: true }, dialogAnswering(picked));
    expect(files.map((f) => [f.name, f.mediaType, f.data])).toEqual([
      ['a.heic', 'image/heic', null],
      ['b.bmp', 'image/bmp', null],
      ['c.tiff', 'image/tiff', null],
      ['d.webp', 'image/webp', Buffer.from('x').toString('base64')],
    ]);
  });

  it('answers nothing for a cancelled dialog and data: null over the caps', async () => {
    expect(await pick({ kind: 'files', directory: null, multiple: true }, dialogAnswering([join(dir, 'x')], true))).toEqual({ files: [] });
    expect(IMAGE_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(PDF_MAX_BYTES).toBe(32 * 1024 * 1024);
    const big = join(dir, 'huge.jpg');
    writeFileSync(big, Buffer.alloc(64));
    const { files } = await pick({ kind: 'files', directory: null, multiple: false }, dialogAnswering([big]), 63);
    expect(files).toEqual([{ path: big, name: 'huge.jpg', bytes: 64, mediaType: 'image/jpeg', data: null }]);
  });
});
