// A session's agent capabilities on this machine (P5 O5 M5; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md,
// Interfaces §I; acceptance 9): `session.capabilities` answered cold by the front (no spine, no render chunk loaded for
// it), and `session.capabilitiesChanged` posted for each session `mawsd` holds a cua socket for at each flip, once. The
// render entries come from the render seam's state, or from the facts it reads when it is not loaded (render-handle.ts);
// the browser entry from the cua sockets' (cua-socket.ts). The reasons are exact sentences the renderer and O7 show.
import { cuaSocketPath } from '@shared/browser/cua-socket';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionCapabilities, SessionCapability } from '@shared/ipc/schema/session-capabilities';

export interface RenderCapabilities {
  artifact_screenshot: SessionCapability;
  artifact_export: SessionCapability;
}

export interface RenderFacts {
  machine: string;
  runtime: { available: true } | { available: false; reason: string }; // the render runtime on this machine (M6 reads Linux's)
  failure: string | null; // the seam is unavailable after two failed starts, until its window passes: the last reason
  engineHostRenders: boolean; // the engine host's welcome lists host.render
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

// `path`: the daemon's socket for the session (none past sun_path); `tabEngine`: the attached tab engine's cua directory,
// null while none is attached. The relay connects to the tab engine's own socket for the session, so a path that does
// not fit on either side is no browser.
export function browserCapability({ machine, appSessionId, path, tabEngine }: { machine: string; appSessionId: AppSessionId; path: string | null; tabEngine: string | null }): SessionCapability {
  const tooLong = path === null || (tabEngine !== null && cuaSocketPath(tabEngine, appSessionId) === null);
  if (tooLong) return { available: false, reason: `the browser socket of this session is longer than a Unix socket allows on ${machine}` };
  return tabEngine !== null ? { available: true } : { available: false, reason: `no browser is attached on ${machine}` };
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
  forget(appSessionId: AppSessionId): void;
  refresh(): void; // something they read may have changed: each tracked session whose reading changed is posted, once
}

export function createSessionCapabilities(options: SessionCapabilitiesOptions): SessionCapabilitiesTracker {
  const last = new Map<AppSessionId, string>();
  const of = (appSessionId: AppSessionId): SessionCapabilities => ({ ...options.render(), browser: options.browser(appSessionId) });
  return {
    of,
    track(appSessionId) {
      if (last.has(appSessionId)) return;
      last.set(appSessionId, JSON.stringify(of(appSessionId)));
      if (last.size === 1) options.tracking?.(true);
    },
    forget(appSessionId) {
      if (last.delete(appSessionId) && last.size === 0) options.tracking?.(false);
    },
    refresh() {
      for (const [appSessionId, was] of last) {
        const capabilities = of(appSessionId);
        const now = JSON.stringify(capabilities);
        if (now === was) continue;
        last.set(appSessionId, now);
        options.emit(appSessionId, capabilities);
      }
    },
  };
}
