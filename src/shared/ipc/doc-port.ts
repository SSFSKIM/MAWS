// A document's port on its way to the page (P3-A M4; docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 13):
// main posts it to the window on the Electron IPC channel `DOC_PORT_CHANNEL` (outside the X2 registry: it carries a
// MessagePort, not a command or an event), and the sandboxed preload re-posts it to the page's main world with
// `window.postMessage`'s transfer list as a `DocPortMessage`, where the renderer's ArtifactHost awaits it by `channel`.
// Zod-free, so the preload bundles nothing more.
export const DOC_PORT_CHANNEL = 'maws:doc-port';

export interface DocPortMessage {
  maws: 'doc-port';
  channel: number;
  artifactId: string;
}

export function isDocPortMessage(data: unknown): data is DocPortMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message.maws === 'doc-port' && typeof message.channel === 'number' && Number.isInteger(message.channel) && typeof message.artifactId === 'string';
}
