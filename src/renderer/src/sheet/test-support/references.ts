// Invented references for the sheet's suites (no fixture of the pin has a question with both a text and an image).
import type { SheetReference } from '@shared/sheet/model';

export const TEXT_REFERENCE: SheetReference = {
  kind: 'text', path: 'src/auth.ts', abs: '/work/harbour/src/auth.ts', sha256: 'a'.repeat(64), bytes: 64, size: 640, mtimeMs: 1,
  lines: [40, 42], startLine: 40, numLines: 3, totalLines: 120, changed: true,
};
export const IMAGE_REFERENCE: SheetReference = {
  kind: 'image', path: 'docs/berth.png', abs: '/work/harbour/docs/berth.png', sha256: 'b'.repeat(64), bytes: 68, size: 68, mtimeMs: 1,
  mediaType: 'image/png', changed: null,
};
// A one-pixel PNG.
export const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
