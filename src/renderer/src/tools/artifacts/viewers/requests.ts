// The version an open of an artifact asks its viewer for (P3-L M6b; E2's `openDeliverable(…, version)` before the
// cutover; fix wave 2: every open says which, `ArtifactOpenAt`). The viewer of that artifact on the asked surface shows
// it, whether it is mounting now (the panel's record view opening) or already shows the artifact, taking the request
// once its versions are read, however long that read takes. There is one open request: the next open supersedes it
// (a version-less open asks for the latest), and an open the owner's guard refused cancels its own, so a request is
// never left for a later, unrelated mount to take. No wall-clock lapse.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ArtifactOpenAt } from '../../../artifacts/open-at';
import type { EditorHostScope } from '../../../panel/editor-host';

export interface VersionRequest {
  serial: number;
  artifactId: string;
  at: ArtifactOpenAt;
  surface: EditorHostScope['surface'];
}

const store = createStore<{ request: VersionRequest | null }>()(() => ({ request: null }));
let serials = 0;

// Answers the request's serial, for `cancelVersionRequest`.
export function requestArtifactVersion(artifactId: string, at: ArtifactOpenAt, surface: EditorHostScope['surface']): number {
  const serial = ++serials;
  store.setState({ request: { serial, artifactId, at, surface } });
  return serial;
}

// The open that asked was refused: its request goes, unless a later open already superseded it.
export function cancelVersionRequest(serial: number): void {
  if (store.getState().request?.serial === serial) store.setState({ request: null });
}

// The request a viewer of `artifactId` on `surface` should take, or null.
export function useVersionRequest(artifactId: string, surface: EditorHostScope['surface']): VersionRequest | null {
  return useStore(store, (s) => (s.request?.artifactId === artifactId && s.request.surface === surface ? s.request : null));
}

// Takes the request (once): true when it was still the open request.
export function takeVersionRequest(serial: number): boolean {
  if (store.getState().request?.serial !== serial) return false;
  store.setState({ request: null });
  return true;
}

export const resetVersionRequests = (): void => store.setState({ request: null });
