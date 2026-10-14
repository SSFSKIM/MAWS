// A version asked for from outside the viewer (P3-L M6b; E2's `openDeliverable(…, version)` before the cutover): a
// transcript row's Open names the n-th of the artifact's versions, and the viewer of that artifact on the asked surface
// shows it, whether it is mounting now (the panel's record view opening) or already shows the artifact. The request is
// taken once, by the first such viewer, and lapses after REQUEST_LAPSE_MS (an open the owner's guard refused never
// re-targets a later one).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { EditorHostScope } from '../../../panel/editor-host';

export const REQUEST_LAPSE_MS = 5_000;

export interface VersionRequest {
  serial: number;
  artifactId: string;
  version: number; // the place, from 1
  surface: EditorHostScope['surface'];
  at: number;
}

const store = createStore<{ request: VersionRequest | null }>()(() => ({ request: null }));
let serials = 0;

export function requestArtifactVersion(artifactId: string, version: number, surface: EditorHostScope['surface'], now = Date.now()): void {
  store.setState({ request: { serial: ++serials, artifactId, version, surface, at: now } });
}

// The request a viewer of `artifactId` on `surface` should take, or null.
export function useVersionRequest(artifactId: string, surface: EditorHostScope['surface']): VersionRequest | null {
  return useStore(store, (s) => (s.request?.artifactId === artifactId && s.request.surface === surface ? s.request : null));
}

// Takes the request (once): true when it was still the open request and had not lapsed.
export function takeVersionRequest(serial: number, now = Date.now()): boolean {
  const { request } = store.getState();
  if (request?.serial !== serial) return false;
  store.setState({ request: null });
  return now - request.at <= REQUEST_LAPSE_MS;
}

export const resetVersionRequests = (): void => store.setState({ request: null });
