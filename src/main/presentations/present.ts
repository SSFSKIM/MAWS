// Main's presenter (P3-C M6; docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D13; H1's `presentations.present`):
// the deck's audience window, frameless and full screen on an external display when there is one (else on the display
// of the window that asked), and with a second display a presenter window full screen on the primary one. Each loads
// the renderer's `present` route (`?present=1&artifact=<id>&role=audience|presenter&slide=<id>&paired=1`), which opens
// the deck as a replica and keeps the two windows at one position over a BroadcastChannel (no IPC). The windows close
// together; a new show ends the one before it. They are not app windows (`windows.ts`): the app's events, focus and
// dock behaviour stay with the app's own. Under MAWS_E2E they open quietly, as app windows do, and never full screen
// (a native full-screen Space cannot be shown quietly).
import { join } from 'node:path';
import { BrowserWindow, screen, type Rectangle, type WebContents } from 'electron';
import type { PresentInput, PresentOutput } from '@shared/ipc/schema/presentations';
import { guardFrames, type SeamEnv } from '../artifacts/policies';
import type { registerMainHandler } from '../ipc/router';
import { showAppWindow } from '../window-show';

export type PresentRole = 'audience' | 'presenter';

export interface PresentDisplay {
  id: number;
  bounds: Rectangle;
}

export interface PresentWindowSpec {
  artifactId: string;
  role: PresentRole;
  slideId: string | null;
  /** A presenter window shows beside the audience's. */
  paired: boolean;
  bounds: Rectangle;
}

export interface PresentWindow {
  close(): void;
  isDestroyed(): boolean;
  onClosed(listener: () => void): void;
}

export interface PresenterDeps {
  displays(): PresentDisplay[];
  primary(): PresentDisplay;
  /** The display the asking window is on (the primary when unknown). */
  nearest(sender: WebContents | null): PresentDisplay;
  open(spec: PresentWindowSpec): PresentWindow;
}

export interface Presenter {
  present(input: PresentInput, sender: WebContents | null): PresentOutput;
  /** Ends the show that is on, if any (its windows closed). */
  end(): void;
}

export function createPresenter(deps: PresenterDeps): Presenter {
  let showing: PresentWindow[] = [];
  const end = () => {
    const windows = showing;
    showing = [];
    for (const win of windows) if (!win.isDestroyed()) win.close();
  };
  return {
    present({ artifactId, slideId }, sender) {
      end();
      const primary = deps.primary();
      const external = deps.displays().find((d) => d.id !== primary.id);
      const paired = external !== undefined;
      const spec = { artifactId, slideId: slideId ?? null, paired };
      const windows = [deps.open({ ...spec, role: 'audience', bounds: (external ?? deps.nearest(sender)).bounds })];
      if (paired) windows.push(deps.open({ ...spec, role: 'presenter', bounds: primary.bounds }));
      showing = windows;
      // one window closing (Escape, End show, the window closed) ends the show in the other
      for (const win of windows) win.onClosed(() => showing === windows && end());
      return { opened: paired ? 'audience+presenter' : 'audience' };
    },
    end,
  };
}

/** The `present` route's query for a window. */
export function presentQuery(spec: Omit<PresentWindowSpec, 'bounds'>, env: SeamEnv): Record<string, string> {
  return {
    present: '1',
    artifact: spec.artifactId,
    role: spec.role,
    ...(spec.slideId !== null && { slide: spec.slideId }),
    ...(spec.paired && { paired: '1' }),
    ...(env.MAWS_E2E === '1' && { e2e: '1' }),
  };
}

const BLACK = '#000000';

function openPresentWindow(spec: PresentWindowSpec, appUrl: string, env: SeamEnv): PresentWindow {
  const quiet = env.MAWS_E2E === '1';
  const win = new BrowserWindow({
    title: spec.role === 'audience' ? 'Presentation' : 'Presenter',
    ...spec.bounds,
    frame: false,
    fullscreen: !quiet,
    show: false,
    backgroundColor: BLACK,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  });
  guardFrames(win.webContents, env); // the embeds' frames are store frames: the policies the app window has
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => showAppWindow(win, env));
  void win.loadURL(`${appUrl}${appUrl.includes('?') ? '&' : '?'}${new URLSearchParams(presentQuery(spec, env)).toString()}`);
  return { close: () => win.close(), isDestroyed: () => win.isDestroyed(), onClosed: (listener) => win.once('closed', listener) };
}

/** `presentations.present` on main's router; answers the presenter (its `end` for the app's quit). */
export function registerPresenter({ register, appUrl, env }: { register: typeof registerMainHandler; appUrl: string; env: SeamEnv }): Presenter {
  const presenter = createPresenter({
    displays: () => screen.getAllDisplays().map(({ id, bounds }) => ({ id, bounds })),
    primary: () => {
      const { id, bounds } = screen.getPrimaryDisplay();
      return { id, bounds };
    },
    nearest: (sender) => {
      const win = sender ? BrowserWindow.fromWebContents(sender) : null;
      const { id, bounds } = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
      return { id, bounds };
    },
    open: (spec) => openPresentWindow(spec, appUrl, env),
  });
  register('presentations.present', (input, { sender }) => presenter.present(input, sender));
  return presenter;
}
