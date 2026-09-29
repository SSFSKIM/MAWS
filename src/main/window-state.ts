// Window bounds across launches (C5 execution document, Main modules "Window state"; residue *Window state and layout
// persistence*). The state lives under main's own layout key `window.main` in `<userData>/layout.json`; it is restored
// only when the saved bounds still show at least 64×64 px on a current display (a monitor may have been unplugged),
// else the default size is centred on the primary display. The layout store debounces the write (500 ms).
import { WindowStateSchema, type WindowState } from '@shared/ipc/schema/layout';

type Rect = WindowState['bounds'];

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 820 };
export const MIN_VISIBLE_PX = 64;

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

function centred(area: Rect): Rect {
  const width = Math.min(DEFAULT_WINDOW_SIZE.width, area.width);
  const height = Math.min(DEFAULT_WINDOW_SIZE.height, area.height);
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
}

// `workAreas` are the current displays' work areas, `primary` the primary display's. The maximized and full-screen
// flags are kept even when the bounds are replaced: they apply to whichever display the window opens on.
export function restoreWindowState(saved: unknown, workAreas: Rect[], primary: Rect): WindowState {
  const parsed = WindowStateSchema.safeParse(saved);
  if (!parsed.success) return { bounds: centred(primary), maximized: false, fullscreen: false };
  const { bounds, maximized, fullscreen } = parsed.data;
  const visible = workAreas.some((area) => {
    const o = overlap(bounds, area);
    return o.width >= MIN_VISIBLE_PX && o.height >= MIN_VISIBLE_PX;
  });
  return { bounds: visible ? bounds : centred(primary), maximized, fullscreen };
}

// What tracking reads of a BrowserWindow (a structural subset, so the tracker is tested without Electron).
export interface TrackedWindow {
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
  getNormalBounds(): Rect;
  isMaximized(): boolean;
  isFullScreen(): boolean;
}

const SAVE_ON = ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'close'] as const;

// Saves on every change and once more on close; `getNormalBounds` is the restore size of a maximized or full-screen
// window, so un-maximizing after a relaunch returns to where the user left it.
export function trackWindowState(win: TrackedWindow, save: (state: WindowState) => void): () => void {
  const capture = () => save({ bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() });
  for (const event of SAVE_ON) win.on(event, capture);
  const stop = () => {
    for (const event of SAVE_ON) win.removeListener(event, capture);
    win.removeListener('closed', stop);
  };
  win.on('closed', stop);
  return stop;
}
