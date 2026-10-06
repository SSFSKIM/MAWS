// `artifact_screenshot`'s capture (E2 execution document, Design §7, Decision Log 8 and 20). The engine host cannot
// render, so it asks main through the IPC event `maws.artifact.capture`; main renders the version in its own offscreen
// window and answers through the host command `maws.artifact.captured`. At most two captures run at once (the engine
// may batch two screenshots: the tool is read-only); a third waits for a slot. Each capture has a 20 s guard, so a
// queued request is answered within 40 s, inside the host's 45 s.
//
// The window is not an app window (never registered in `windows.ts`): offscreen (deterministic `paint` events, nothing
// on the desktop), no preload, on the in-memory `maws-capture` partition, which carries the same scheme handler and the
// same request and download filters as the app's session (`index.ts`); new windows denied, top-level navigation
// prevented, subframe navigation guarded and non-proxied UDP off. The page loads top-level, where no `<iframe sandbox>`
// reaches it; the handler's `sandbox allow-scripts` policy sandboxes it as the viewer's frame is. `disableDialogs` keeps
// a modal from blocking the load until the guard. The page's console errors go into the result (at most 20, each cut
// at 500 characters), never into `deliverables.console`: the transcript row counts what the owner's viewer logged.
// The device scale factor is 1 (offscreen's default): the picture is for the model, not a Retina display.
//
// The named fallback, should offscreen rendering misbehave, is a hidden window captured with
// `capturePage(undefined, { stayHidden: true })` after `incrementCapturerCount()` (electron.d.ts, `capturePage`).
import { BrowserWindow, type NativeImage } from 'electron';
import type { CommandInput } from '@shared/ipc/schema';
import type { MawsArtifactCapture, MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { deliverableUrl } from '@shared/maws/deliverable';
import { ARTIFACT_SCREENSHOT_MAX_BYTES } from '@shared/maws/tools';
import { guardFrames, type SeamEnv } from './policies';
import type { DeliverableReader } from './reader';

export const CAPTURE_PARTITION = 'maws-capture';
export const CAPTURE_GUARD_MS = 20_000;
const CAPTURE_SETTLE_MS = 500; // after the load: the first paint, or this long (fonts, first animations)
const CAPTURE_CONCURRENCY = 2;
const CONSOLE_ERRORS_MAX = 20;
const CONSOLE_ERROR_CHARS = 500;

export interface CaptureDeps {
  reader: Pick<DeliverableReader, 'get'>;
  env: SeamEnv;
}

class CaptureFailure extends Error {}

// One capture, start to finish: the version checked on disk, the window opened, loaded, settled, captured, encoded and
// destroyed. Never rejects: every failure is an answer with its reason.
export async function captureArtifact(request: MawsArtifactCapture, { reader, env }: CaptureDeps): Promise<MawsArtifactCapturedResult> {
  const { record, present } = await reader.get(request.appSessionId, request.deliverableId).catch(() => ({ record: null, present: [] as boolean[] }));
  if (!record) return { ok: false, error: `no deliverable ${request.deliverableId} in this session` };
  if (request.version > record.versions.length) return { ok: false, error: `version ${request.version} does not exist` };
  if (!present[request.version - 1]) return { ok: false, error: `version ${request.version} is not on disk any more` };

  const win = openCaptureWindow(request.width, request.height, env);
  let guard: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      guard = setTimeout(() => reject(new CaptureFailure(`the page did not finish loading within ${CAPTURE_GUARD_MS / 1000} s`)), CAPTURE_GUARD_MS);
    });
    const consoleErrors: string[] = [];
    const image = await Promise.race([render(win, deliverableUrl(request.appSessionId, request.deliverableId, request.version), consoleErrors), timedOut]);
    const encoded = encodeCapture(image);
    return 'error' in encoded ? { ok: false, error: encoded.error } : { ok: true, png: encoded.png.toString('base64'), width: encoded.width, height: encoded.height, consoleErrors };
  } catch (error) {
    return { ok: false, error: error instanceof CaptureFailure ? error.message : `the capture failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(guard);
    if (!win.isDestroyed()) win.destroy();
  }
}

function openCaptureWindow(width: number, height: number, env: SeamEnv): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      partition: CAPTURE_PARTITION,
      backgroundThrottling: false,
      disableDialogs: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  guardFrames(win.webContents, env);
  return win;
}

async function render(win: BrowserWindow, url: string, consoleErrors: string[]): Promise<NativeImage> {
  const contents = win.webContents;
  contents.on('console-message', (event) => {
    if (event.level === 'error' && consoleErrors.length < CONSOLE_ERRORS_MAX) consoleErrors.push(event.message.slice(0, CONSOLE_ERROR_CHARS));
  });
  const loaded = new Promise<void>((resolve, reject) => {
    contents.once('did-finish-load', () => resolve());
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) reject(new CaptureFailure(`the page did not load (${code} ${description})`));
    });
  });
  contents.loadURL(url).catch(() => {}); // the load events above decide
  await loaded;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, CAPTURE_SETTLE_MS);
    contents.once('paint', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return contents.capturePage();
}

// The PNG under ARTIFACT_SCREENSHOT_MAX_BYTES: as captured, else resized to half its width once, else refused.
export function encodeCapture(image: Pick<NativeImage, 'toPNG' | 'getSize' | 'resize'>): { png: Buffer; width: number; height: number } | { error: string } {
  let current = image;
  let png = current.toPNG();
  if (png.length > ARTIFACT_SCREENSHOT_MAX_BYTES) {
    current = current.resize({ width: Math.max(1, Math.floor(current.getSize().width / 2)) });
    png = current.toPNG();
  }
  if (png.length > ARTIFACT_SCREENSHOT_MAX_BYTES) return { error: `screenshot too large (${png.length} bytes); ask for a smaller size` };
  const { width, height } = current.getSize();
  return { png, width, height };
}

export interface CaptureServiceDeps extends CaptureDeps {
  onEvent(name: 'maws.artifact.capture', listener: (payload: MawsArtifactCapture) => void): () => void;
  dispatch(input: CommandInput<'maws.artifact.captured'>): Promise<unknown>;
}

// Main's side of the capture bridge: every `maws.artifact.capture` the engine host emits is captured (two at a time)
// and answered. Answers the unsubscribe.
export function startCaptureService({ onEvent, dispatch, ...deps }: CaptureServiceDeps): () => void {
  const slot = slots(CAPTURE_CONCURRENCY);
  return onEvent('maws.artifact.capture', (request) => {
    void slot(() => captureArtifact(request, deps))
      .then((result) => dispatch({ appSessionId: request.appSessionId, requestId: request.requestId, result }))
      .catch((error: unknown) => console.error('[deliverables] could not answer a capture', error));
  });
}

// Runs at most `max` tasks at once; a finished task hands its slot to the oldest waiting one.
function slots(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const acquire = () => (running < max ? (running++, Promise.resolve()) : new Promise<void>((resolve) => waiting.push(resolve)));
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
  return async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
