// What an open of an artifact asks its editor for (P3-L M6b; E2's `openDeliverable(…, version)` before the cutover; fix
// wave 2: every open says which version, `ArtifactOpenAt`; P4-B4: and the place a link's fragment or `show_pane`'s `at`
// names, `ArtifactLocation`). The editor of that artifact on the asked surface takes it, whether it is mounting now (the
// panel's record view opening, a main tab made) or already shows the artifact, once it can act on it (its versions read,
// its document bound), however long that takes. There is one open request: the next open supersedes it (a version-less
// open asks for the latest), and an open the owner's guard refused cancels its own, so a request is never left for a
// later, unrelated mount to take. No wall-clock lapse.
//
// A location's `version` is a retained version's id (what `artifact_read` lists), unlike `ArtifactOpenAt`'s `version`, a
// place number; when present it names the version shown.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { ArtifactLocation } from '@shared/artifacts/link';
import type { ArtifactOpenAt } from '../../../artifacts/open-at';
import type { EditorHostScope } from '../../../panel/editor-host';

export interface OpenRequest {
  serial: number;
  artifactId: string;
  at: ArtifactOpenAt;
  location?: ArtifactLocation; // P4-B4: absent when the open names no place
  surface: EditorHostScope['surface'];
}

const store = createStore<{ request: OpenRequest | null }>()(() => ({ request: null }));
let serials = 0;

// Answers the request's serial, for `cancelOpenRequest`.
export function requestArtifactOpen(artifactId: string, at: ArtifactOpenAt, surface: EditorHostScope['surface'], location?: ArtifactLocation): number {
  const serial = ++serials;
  store.setState({ request: { serial, artifactId, at, ...(location !== undefined && { location }), surface } });
  return serial;
}

// The open that asked was refused: its request goes, unless a later open already superseded it.
export function cancelOpenRequest(serial: number): void {
  if (store.getState().request?.serial === serial) store.setState({ request: null });
}

// P4-B3: an open that carries its viewer's state (a move between surfaces) asks for no version, and an ask still left for
// that artifact on that surface goes, so the moved viewer keeps the version it shows. P4-B4 (at the B3 merge): the open
// request carries a link's place too, which goes with it: a moved viewer keeps its place as well.
export function withdrawVersionRequest(artifactId: string, surface: EditorHostScope['surface']): void {
  const request = store.getState().request;
  if (request?.artifactId === artifactId && request.surface === surface) store.setState({ request: null });
}

// The request an editor of `artifactId` on `surface` should take, or null.
export function useOpenRequest(artifactId: string, surface: EditorHostScope['surface']): OpenRequest | null {
  return useStore(store, (s) => (s.request?.artifactId === artifactId && s.request.surface === surface ? s.request : null));
}

// Takes the request (once): true when it was still the open request.
export function takeOpenRequest(serial: number): boolean {
  if (store.getState().request?.serial !== serial) return false;
  store.setState({ request: null });
  return true;
}

export const resetOpenRequests = (): void => store.setState({ request: null });
