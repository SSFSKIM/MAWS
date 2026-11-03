// A session's agent capabilities on this machine (P5 O5 M5; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// Interfaces §I; acceptance 9): `session.capabilities` answered cold by the front (no spine, no render chunk loaded for
// it), and `session.capabilitiesChanged` posted for each session `mawsd` holds a cua socket for at each flip, once. The
// render entries come from the render seam's state, or from the facts it reads when it is not loaded (render-handle.ts);
// the browser entry from the cua sockets' (cua-socket.ts). The reasons are exact sentences the renderer and O7 show.
//
// P5 O17 M5 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §I): the browser entry says how a person on
// the machine sees the agent's tabs (`viewed`): in the attached app's pane (`local`), or only by screencast when the
// render host is the session's headless browser (`screencast`, before Chromium starts and whether or not the engine is
// live); else why not, in §I's order (`headlessReason`), the same reading that selects the route (browser-route.ts).
import { cuaSocketPath } from '@shared/browser/cua-socket';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionCapabilities, SessionCapability } from '@shared/ipc/schema/session-capabilities';
import { oldHostReason } from './browser-work'; // P5 O17 M5: the fence's own sentence

export interface RenderCapabilities {
  artifact_screenshot: SessionCapability;
  artifact_export: SessionCapability;
}

export interface RenderFacts {
  machine: string;
  runtime: { available: true } | { available: false; reason: string }; // the render runtime on this machine (M6 reads Linux's)
  failure: string | null; // the seam is unavailable after two failed starts, until its window passes: the last reason
  engineHostRenders: boolean; // no engine host connected (a cold one starts as this build), or its welcome lists host.render
  appAttached: boolean; // an app is attached (an older engine host's events still reach the seam then)
}

export function renderCapabilities({ machine, runtime, failure, engineHostRenders, appAttached }: RenderFacts): RenderCapabilities {
  const unavailable = (reason: string): SessionCapability => ({ available: false, reason });
  let entry: SessionCapability = { available: true };
  if (!runtime.available) entry = unavailable(`the render service is unavailable on ${machine}: ${runtime.reason}`);
  else if (failure !== null) entry = unavailable(`the render service is unavailable on ${machine}: ${failure}`);
  else if (!engineHostRenders && !appAttached) entry = unavailable(`the engine host on ${machine} predates the render service; it is replaced when idle`);
  return { artifact_screenshot: entry, artifact_export: entry };
}

// P5 O17 M5: what decides whether the render host can be a session's headless browser on this machine
export interface HeadlessFacts {
  machine: string;
  platform: NodeJS.Platform;
  addon: 'untried' | 'loaded' | 'failed'; // the peer identity addon (darwin): loaded at the first session's socket, never for a reading
  engineHost: 'none' | 'browserWork' | 'old'; // none connected (a cold one starts as this build), one that holds browser work, one that predates it
  runtime: { available: true } | { available: false; reason: string }; // the render runtime
  failure: string | null; // the render seam is unavailable after two failed starts: the last reason
  // P5 O17 M8 (Decisions, pass 3 on Linux): MAWS_E2E_LINUX_HEADLESS=1 under MAWS_E2E=1, read once by the daemon: Linux's
  // route reaches `cold` for the e2e's fixture connector (never real cua, which refuses its clients there, R6)
  e2eLinuxHeadless?: boolean;
}

// Why the headless browser is not usable, in §I's order (2 to 5), or null when it is
export function headlessReason({ machine, platform, addon, engineHost, runtime, failure, e2eLinuxHeadless = false }: HeadlessFacts): string | null {
  if (platform === 'linux' && !e2eLinuxHeadless) return `cua's host cannot check its peers on Linux yet, so the agent's browser is unavailable on ${machine}`; // D5, R6
  if (platform === 'darwin' && addon === 'failed') return `the peer identity check did not load on ${machine}, so the agent's browser is refused`;
  if (engineHost === 'old') return oldHostReason(machine);
  if (!runtime.available) return `the render service is unavailable on ${machine}: ${runtime.reason}`;
  if (failure !== null) return `the render service is unavailable on ${machine}: ${failure}`;
  return null;
}

// `path`: the daemon's socket for the session (none past sun_path); `tabEngine`: the attached tab engine's cua directory,
// null while none is attached. The relay connects to the tab engine's own socket for the session, so a path that does
// not fit on either side is no browser. P5 O17 M5: `headless`, `headlessReason`'s reading (§I).
export function browserCapability({ machine, appSessionId, path, tabEngine, headless }: { machine: string; appSessionId: AppSessionId; path: string | null; tabEngine: string | null; headless: string | null }): SessionCapability {
  const tooLong = path === null || (tabEngine !== null && cuaSocketPath(tabEngine, appSessionId) === null);
  if (tooLong) return { available: false, reason: `the browser socket of this session is longer than a Unix socket allows on ${machine}` };
  if (tabEngine !== null) return { available: true, viewed: 'local' };
  return headless === null ? { available: true, viewed: 'screencast' } : { available: false, reason: headless };
}

export interface SessionCapabilitiesOptions {
  render(): RenderCapabilities;
  browser(appSessionId: AppSessionId): SessionCapability;
  emit(appSessionId: AppSessionId, capabilities: SessionCapabilities): void; // session.capabilitiesChanged
  tracking?(any: boolean): void; // the first session tracked (true), the last forgotten (false): what watches for a flip runs only meanwhile
}

export interface SessionCapabilitiesTracker {
  of(appSessionId: AppSessionId): SessionCapabilities; // any session, tracked or not
  track(appSessionId: AppSessionId): void; // its reading kept from now, so a later flip is posted
  // A client's reading (`session.capabilities`): tracked from now, and a reading that differs from the one last told is
  // posted before it is answered, so what the next flip compares against is always what every client was last told
  ask(appSessionId: AppSessionId): SessionCapabilities;
  forget(appSessionId: AppSessionId): void;
  refresh(): void; // something they read may have changed: each tracked session whose reading changed is posted, once
}

export function createSessionCapabilities(options: SessionCapabilitiesOptions): SessionCapabilitiesTracker {
  const last = new Map<AppSessionId, string>();
  const of = (appSessionId: AppSessionId): SessionCapabilities => ({ ...options.render(), browser: options.browser(appSessionId) });
  const track = (appSessionId: AppSessionId) => {
    if (last.has(appSessionId)) return;
    last.set(appSessionId, JSON.stringify(of(appSessionId)));
    if (last.size === 1) options.tracking?.(true);
  };
  // Posts the session's reading when it is not what was last told; the reading, either way
  const reconcile = (appSessionId: AppSessionId, was: string): SessionCapabilities => {
    const capabilities = of(appSessionId);
    const now = JSON.stringify(capabilities);
    if (now !== was) {
      last.set(appSessionId, now);
      options.emit(appSessionId, capabilities);
    }
    return capabilities;
  };
  return {
    of,
    track,
    ask(appSessionId) {
      track(appSessionId);
      return reconcile(appSessionId, last.get(appSessionId)!);
    },
    forget(appSessionId) {
      if (last.delete(appSessionId) && last.size === 0) options.tracking?.(false);
    },
    refresh() {
      for (const [appSessionId, was] of last) reconcile(appSessionId, was);
    },
  };
}
