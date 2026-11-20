// Media a viewer draws or plays, made without checked-in assets: a one-page PDF, a WAV of silence and a WebM recorded in
// the app's page. E2's Deliverables spec made them first; P3-L (M5b) moved them here so the library's viewer cases use
// the same files (`e2e/deliverables.spec.ts`, `e2e/library.spec.ts`).
import type { ElectronApplication, Locator, Page } from '@playwright/test';

// A colour as main's capture reads it, 0 to 255 per channel.
export type Rgb = readonly [number, number, number];
export const BLACK: Rgb = [0, 0, 0];
export const INVENTED_RED: Rgb = [204, 26, 26]; // UX wave U6b-2: a second version's mark, told from the first's black

// A one-page PDF whose page is mostly a filled square of `mark` (black by default), so a drawn page is told from a blank,
// blocked or error frame by that colour's pixels (`markPixels`); the cross-reference offsets are computed, so the file is
// valid as written. With `link`, the square is also a /URI link annotation to that URL.
export function minimalPdf(link?: string, mark: Rgb = BLACK): Buffer {
  const content = `${mark === BLACK ? '0 0 0' : mark.map((channel) => (channel / 255).toFixed(3)).join(' ')} rg 20 20 160 160 re f`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >>${link ? ' /Annots [5 0 R]' : ''} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...(link ? [`<< /Type /Annot /Subtype /Link /Rect [20 20 180 180] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${link}) >> >>`] : []),
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, k) => {
    offsets.push(body.length);
    body += `${k + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

// UX wave U6b-2 (docs/doperpowers/plans/2026-11-15-ux-wave-U6b-2-file-frames.md, M6): how many pixels of `element`'s
// rect, in what main paints for the window showing `page`, are within MARK_TOLERANCE of `mark` on every channel: a PDF
// drawn by Chromium's viewer is its page's square of that colour, which neither the viewer's error page nor a blank frame
// paints.
// 0 when the element has no box yet (not attached, or replaced while it is read), so a poll on it asks again rather than
// ending on a throw; a capture that fails still throws.
// How far a captured channel may be from a mark's and still be the mark. Chromium's PDF viewer paints everything around
// the page in its own background, 0xff282828 (rgb(40, 40, 40), BACKGROUND_COLOR in the viewer's bundle of Electron 44): a
// tolerance of 40 counted that background as the black square, so a viewer that had drawn no page yet passed as drawn.
export const MARK_TOLERANCE = 16;

export async function markPixels(app: ElectronApplication, page: Page, element: Locator, mark: Rgb = BLACK): Promise<number> {
  const rect = await element.boundingBox({ timeout: 2_000 }).catch(() => null);
  if (!rect || rect.width < 1 || rect.height < 1) return 0;
  const clip = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  return app.evaluate(
    async ({ BrowserWindow }, { clip, url, mark, tolerance }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url);
      if (!win) throw new Error(`no window shows ${url}`);
      const bitmap = (await win.webContents.capturePage(clip)).toBitmap(); // BGRA
      let count = 0;
      for (let i = 0; i < bitmap.length; i += 4) if (Math.abs(bitmap[i + 2] - mark[0]) <= tolerance && Math.abs(bitmap[i + 1] - mark[1]) <= tolerance && Math.abs(bitmap[i] - mark[2]) <= tolerance) count++;
      return count;
    },
    { clip, url: page.url(), mark: [...mark], tolerance: MARK_TOLERANCE },
  );
}

// A second of 8 kHz mono 16-bit silence: a valid WAV the audio element loads.
export function silentWav(seconds = 1, rate = 8_000): Buffer {
  const data = seconds * rate * 2;
  const wav = Buffer.alloc(44 + data);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + data, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(data, 40);
  return wav;
}

// Two seconds of a canvas whose colour cycles, recorded in the app's page with MediaRecorder: a real `.webm` without a
// checked-in asset.
export async function recordedWebm(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    const start = performance.now();
    recorder.start(100);
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsed = performance.now() - start;
        context.fillStyle = `hsl(${Math.round(elapsed / 8) % 360} 70% 45%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (elapsed > 2_000) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}
