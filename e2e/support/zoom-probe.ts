// UX wave U6b-5b M1's probe scenes, their shared part (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, M1,
// "The probe scenes"). Each probe runs only under MAWS_ZOOM_PROBE=1, on a Mac, by the architect; it sets the app window's
// zoom through main (`webContents.setZoomFactor`, as nothing of the product does yet), waits on what the document names
// for each placement (main's acknowledgment, the seam's answer, the card drawn), and ends in `record` lines. It asserts
// nothing about where a placement lands: what is "off" is read from the lines against the document's table. Under
// MAWS_ZOOM_PROBE_HOLD=1 (with MAWS_E2E_QUIET=0, so the window is shown) it stops at each factor until resumed, for
// the architect's look. M3's asserting scenes replace these.
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { EXTENSION_POPUP_MAX, EXTENSION_POPUP_MIN } from '@shared/browser/extensions';
import { REPO_ROOT } from './launch';

export const ZOOM_PROBE = process.env.MAWS_ZOOM_PROBE === '1';
export const ZOOM_PROBE_HOLD = process.env.MAWS_ZOOM_PROBE_HOLD === '1';
export const PROBE_FACTORS = [0.5, 0.8, 1.25, 2] as const;

// The probe's skip and its time: a probe launches the app once and walks four factors (no time is asserted); held for
// the look, it has no limit.
export function zoomProbe(): void {
  test.skip(!ZOOM_PROBE, 'a probe of U6b-5b M1: runs only under MAWS_ZOOM_PROBE=1, on a Mac');
  test.setTimeout(ZOOM_PROBE_HOLD ? 0 : 600_000);
}

// Whether a text holds a path of this machine (the checkout, the home folder), as a path or a file URL.
export const holdsMachinePath = (text: string): boolean => [REPO_ROOT, homedir()].some((path) => text.includes(path) || text.includes(pathToFileURL(path).href));
// Every placeholder for its folder, in both forms a record can hold it in, longest first (a folder inside another keeps
// its own name).
export function scrubPaths(text: string, names: Record<string, string>): string {
  const pairs = Object.entries(names)
    .flatMap(([name, path]) => [pathToFileURL(path).href, path].map((form) => [form, name] as const))
    .sort((a, b) => b[0].length - a[0].length);
  return pairs.reduce((out, [form, name]) => out.split(form).join(name), text);
}

// One probe line: `[zoom-probe] RECORD {json}` on the runner's output, and the same as the test's annotation. A line
// that names a path of this machine is refused (the repository is public; a record is copied into FINDINGS.md).
export function record(lines: object[]): void {
  for (const line of lines) {
    const text = JSON.stringify(line);
    expect(holdsMachinePath(text), 'a probe record names no path of the checkout or the home folder').toBe(false);
    test.info().annotations.push({ type: 'zoom-probe', description: text });
    console.log(`[zoom-probe] RECORD ${text}`);
  }
}

// The app window's zoom set in main, and the page laid out at it: its devicePixelRatio is the display's scale times the
// factor (polled; a zoom call returns before the renderer has laid the page out again). `page` is the app's own page.
export async function setAppZoom(app: ElectronApplication, page: Page, factor: number): Promise<void> {
  // the app's one window, found as the scenes' other helpers find it (support/browser-scene.ts `resizeWindow`)
  const scale = await app.evaluate(({ BrowserWindow, screen }, f) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())!;
    win.webContents.setZoomFactor(f);
    return screen.getDisplayMatching(win.getBounds()).scaleFactor;
  }, factor);
  await expect.poll(() => page.evaluate(() => window.devicePixelRatio), { message: `the app's page laid out at ${factor}` }).toBeCloseTo(scale * factor, 2);
}

// The app window's own factor, its traffic lights' position and its content area, read in main.
export function appWindowState(app: ElectronApplication): Promise<{ factor: number; lights: { x: number; y: number } | null; content: { width: number; height: number } }> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible())!;
    const [width, height] = win.getContentSize();
    return { factor: win.webContents.getZoomFactor(), lights: typeof win.getWindowButtonPosition === 'function' ? win.getWindowButtonPosition() : null, content: { width: width!, height: height! } };
  });
}

// Under MAWS_ZOOM_PROBE_HOLD=1: stops here with the window shown until the run is resumed (Playwright's inspector).
export async function holdForLook(page: Page, where: string): Promise<void> {
  if (!ZOOM_PROBE_HOLD) return;
  console.log(`[zoom-probe] HOLD ${where}: resume in the inspector to go on`);
  await page.pause();
}

type Rect = { x: number; y: number; width: number; height: number };
// Decision 27's rule, the prediction for a placement under the factor: each edge multiplied and rounded, the size the
// difference.
export function timesFactor(r: Rect, f: number): Rect {
  const x = Math.round(r.x * f);
  const y = Math.round(r.y * f);
  return { x, y, width: Math.round((r.x + r.width) * f) - x, height: Math.round((r.y + r.height) * f) - y };
}
// The extension popup's place as `popupBounds` (src/main/browser/extensions/popup.ts, at the pin) computes it, mirrored
// here since the e2e does not load main's code: the popup's size clamped to Chrome's bounds and the content, its right
// edge on the anchor's, under the anchor or above it, held inside the content. With the probe's own size for
// `preferred` (the popup's bounds as read), so a clamp at the content's edge is predicted, not read as "off".
export function popupPlace(anchor: Rect, preferred: { width: number; height: number }, content: { width: number; height: number }): Rect {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const width = Math.min(clamp(Math.round(preferred.width), EXTENSION_POPUP_MIN.width, EXTENSION_POPUP_MAX.width), content.width);
  const height = Math.min(clamp(Math.round(preferred.height), EXTENSION_POPUP_MIN.height, EXTENSION_POPUP_MAX.height), content.height);
  const x = clamp(anchor.x + anchor.width - width, 0, content.width - width);
  const below = anchor.y + anchor.height;
  const y = below + height <= content.height ? below : anchor.y - height >= 0 ? anchor.y - height : Math.max(0, content.height - height);
  return { x, y, width, height };
}

export const sameRect = (a: Rect | null, b: Rect | null) => a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
// Where two rectangles in one unit disagree, edge by edge (b's edge less a's).
export const edgeDeltas = (a: Rect, b: Rect) => ({ left: b.x - a.x, top: b.y - a.y, right: b.x + b.width - (a.x + a.width), bottom: b.y + b.height - (a.y + a.height) });
// The area of `a` that `b` does not cover, in square units.
export function uncovered(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return a.width * a.height - w * h;
}
