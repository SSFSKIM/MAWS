// Word's fallback pictures of a dashboard's charts (P3-E2 M5; E's Decision Log 32): a chart's SVG, the renderer's own
// bytes, drawn alone on a page of its own in the export service's protected capture window (offscreen, sandboxed, on
// the capture partition, its requests limited to its own file and `data:`, as C's deck window and A's printer are) with
// the governing system's faces, and taken at twice its size (sharper in Word, which shows it at its own size), never
// past the picture cap. One window per export, opened at the first chart and destroyed when the export ends or its
// signal aborts; pictures are taken one at a time. A table view is never pictured: it is a native table.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserWindow } from 'electron';
import { loadSettled, openCaptureWindow } from '../artifacts/capture';
import { printRequestAllowed } from '../artifacts/export';
import { restrictRequests, type SeamEnv } from '../artifacts/policies';

const SCALE = 2;
const SIDE_MAX = 8_192; // EXPORT_SIZE_MAX: what an offscreen window renders

export interface FigurePictures {
  /** A PNG of `svg` drawn at `size` CSS px (the picture itself up to twice that). */
  take(svg: string, size: { width: number; height: number }): Promise<Uint8Array>;
  /** Destroys the window, if one was opened; again does nothing. */
  close(): void;
}
/** One export's picture window: `signal` ends it, `facesCss` gives the governing system's `@font-face` rules once. */
export type OpenPictures = (job: { signal: AbortSignal; facesCss(): Promise<string> }) => FigurePictures;

/** The page a chart is pictured on: the system's faces, nothing else to load, the figure at the picture's size. */
export function picturePage(svg: string, facesCss: string, width: number, height: number): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:">`,
    `<style>${facesCss}\nhtml, body { margin: 0; background: transparent; overflow: hidden; }\nbody > svg { display: block; width: ${width}px; height: ${height}px; }</style>`,
    `</head><body>${svg}</body></html>`,
  ].join('');
}

export const openFigurePictures =
  (env: SeamEnv): OpenPictures =>
  ({ signal, facesCss }) => {
    const cancelled = () => new Error('the export was cancelled');
    let opened: Promise<{ win: BrowserWindow; file: string; url: string; faces: string; end(): Promise<void> }> | null = null;
    let queue: Promise<unknown> = Promise.resolve();
    let closed = false;
    const open = async () => {
      const faces = await facesCss();
      const dir = await mkdtemp(join(tmpdir(), 'maws-figure-'));
      const file = join(dir, 'figure.html');
      const url = pathToFileURL(file).href;
      if (signal.aborted || closed) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        throw cancelled();
      }
      const win = openCaptureWindow(1, 1, env);
      win.setBackgroundColor('#00000000'); // the figure's own ground; Word's page shows through the rest
      const unrestrict = restrictRequests(win.webContents.id, (requested) => !printRequestAllowed(requested, url));
      let ended = false;
      const end = async () => {
        if (ended) return;
        ended = true;
        signal.removeEventListener('abort', destroy);
        unrestrict();
        if (!win.isDestroyed()) win.destroy();
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      };
      const destroy = () => void end();
      signal.addEventListener('abort', destroy, { once: true });
      return { win, file, url, faces, end };
    };
    const take = async (svg: string, size: { width: number; height: number }): Promise<Uint8Array> => {
      if (signal.aborted || closed) throw cancelled();
      opened ??= open();
      const { win, file, url, faces } = await opened;
      const scale = Math.min(SCALE, SIDE_MAX / Math.max(size.width, size.height, 1));
      const [width, height] = [Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale))];
      await writeFile(file, picturePage(svg, faces, width, height), 'utf8');
      if (signal.aborted || closed || win.isDestroyed()) throw cancelled();
      win.setContentSize(width, height);
      await loadSettled(win, url);
      if (signal.aborted || closed || win.isDestroyed()) throw cancelled();
      const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
      return new Uint8Array(image.toPNG());
    };
    return {
      take: (svg, size) => {
        const next = queue.then(() => take(svg, size));
        queue = next.catch(() => {});
        return next;
      },
      close: () => {
        if (closed) return;
        closed = true;
        void opened?.then(({ end }) => end(), () => {});
      },
    };
  };
