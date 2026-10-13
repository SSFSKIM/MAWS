// What the document editor needs from its environment (D1, D13 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md):
// an open document handle and the slice of `ArtifactHost` the editor reaches (assets and the identity it writes as).
// The handle is opened and owned outside the editor (the tab's store handle, M8), so a remount never reopens it.
import type { ArtifactHost, DocumentHandle } from '../../host';

/**
 * The handle as the editor drives it: X24's `DocumentHandle` plus the provider's composition hold, which the ledger's
 * X24 row puts on the handle (H1 request k, landing in A's M4). Until A's handle carries it, the renderer's wrapper
 * (M8) supplies it from the provider, and every fake in the tests implements exactly this interface.
 */
export type DocumentHandleWithHold = DocumentHandle & { holdRemote(on: boolean): void };

/** The part of `ArtifactHost` the editor calls: an image's URL, an upload, and who is typing. */
export type EditorHost = Pick<ArtifactHost, 'assetUrl' | 'uploadAsset' | 'identity'>;

/**
 * A colour as CSS reads it. `actorDisplay` and `identity()` name the author colours by their custom property
 * (`--author-3`); a colour given any other way passes through.
 */
export const cssColor = (color: string): string => (color.startsWith('--') ? `var(${color})` : color);
