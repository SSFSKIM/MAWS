// P3-G (§D4.3): Add to chat's picture. The still is drawn at its own pixel size and the marks over it through the same
// draw operations the overlay shows (drawing.ts `drawOps`), scaled by still.width / the surface's CSS width, on an
// OffscreenCanvas; PNG, or JPEG at 0.85 when the PNG is over the composer's 3.5 MiB. The inks and the font are read from
// the tokens at paint time (tokens-only rule); the canvas, the decoder and Path2D are injected so tests need no GPU.
import { CROP_MAX_BYTES } from '@shared/browser/comment';
import type { CapturedImage } from '@shared/markup/image';
import { drawOps, HALO_WIDTH, inkToken, STROKE_WIDTH, TEXT_SIZE, type DrawOp, type InkName, type Mark } from './drawing';

const JPEG_QUALITY = 0.85;

interface Canvas {
  getContext(kind: '2d'): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  convertToBlob(options: { type: string; quality?: number }): Promise<Blob>;
}

export interface CompositeDeps {
  canvas(width: number, height: number): Canvas;
  decode(still: CapturedImage): Promise<CanvasImageSource>;
  path(d: string): Path2D;
  ink(name: InkName): string;
  font(): string;
}

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const browserDeps: CompositeDeps = {
  canvas: (width, height) => new OffscreenCanvas(width, height),
  decode: async (still) => createImageBitmap(new Blob([Uint8Array.from(atob(still.data), (c) => c.charCodeAt(0))], { type: still.mediaType })),
  path: (d) => new Path2D(d),
  ink: (name) => token(inkToken(name)),
  font: () => token('--font-ui'),
};

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// The draw operations onto a context already scaled to surface px.
export function paintOps(ctx: Context, ops: readonly DrawOp[], deps: Pick<CompositeDeps, 'path' | 'ink' | 'font'>): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const op of ops) {
    if (op.kind === 'path') {
      ctx.strokeStyle = deps.ink(op.ink);
      ctx.lineWidth = STROKE_WIDTH;
      ctx.stroke(deps.path(op.d));
    } else {
      ctx.font = `600 ${TEXT_SIZE}px ${deps.font()}`;
      ctx.lineWidth = HALO_WIDTH * 2; // a stroke is centred on the outline: half of it lies outside the glyph
      ctx.strokeStyle = deps.ink(op.halo);
      ctx.strokeText(op.text, op.x, op.y);
      ctx.fillStyle = deps.ink(op.ink);
      ctx.fillText(op.text, op.x, op.y);
    }
  }
}

export async function compositeMarkup(still: CapturedImage, marks: readonly Mark[], surfaceWidth: number, deps: CompositeDeps = browserDeps): Promise<Blob> {
  const canvas = deps.canvas(still.width, still.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context for the mark-up composite');
  ctx.drawImage(await deps.decode(still), 0, 0, still.width, still.height);
  const scale = still.width / surfaceWidth;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  paintOps(ctx, drawOps(marks), deps);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  if (png.size <= CROP_MAX_BYTES) return png;
  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}
