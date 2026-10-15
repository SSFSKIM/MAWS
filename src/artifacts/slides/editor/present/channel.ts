// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D13; M6): how a show's two windows (the audience's and
// the presenter's) keep one position, over a `BroadcastChannel` named by the deck (both windows are the app's origin; no
// IPC). Each move is told to the other window, which follows without telling it back; a window that opens asks where the
// show is (`hello`), and the other answers. Ending the show in either window ends it in both.
import type { Position } from './sequence';

export type PresentMessage = { t: 'at'; pos: Position; black: boolean } | { t: 'hello' } | { t: 'end' };

export const channelName = (artifactId: string): string => `maws-present:${artifactId}`;

export interface PresentChannel {
  post(message: PresentMessage): void;
  close(): void;
}

/** The show's channel; `onMessage` hears the other window only (a channel never hears its own posts). */
export function openPresentChannel(artifactId: string, onMessage: (message: PresentMessage) => void): PresentChannel {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} };
  const channel = new BroadcastChannel(channelName(artifactId));
  channel.onmessage = (event: MessageEvent<PresentMessage>) => onMessage(event.data);
  return { post: (message) => channel.postMessage(message), close: () => channel.close() };
}
