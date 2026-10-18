// What a transcript's rows may ask of the desk (MAWS's `TranscriptActions`, the survey's seam). The page holds the org
// key and a row's text is untrusted (the DC6 plan's constraints), so a link opens only as a new browsing context with
// no opener and no referrer, and only for the schemes MAWS's Markdown gates leave (`https:`, `http:`, `mailto:`);
// nothing from a row navigates this page. Everything that needs MAWS's host (a spilled result, a file, the composer, a
// subagent's tab) does nothing here until a later milestone gives it a desk meaning. A prompt the desk's mapping drops is
// an owner input whose turn was undone before the session read it (`source/off-chain.ts`: the desk's rows carry no
// engine cancel of their own), and says so.
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import { UNDONE } from '../source/off-chain';

const OPENABLE = new Set(['https:', 'http:', 'mailto:']);

/** Opens a link from a row in a new browsing context without opener access; any other URL is refused. */
export function openExternal(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!OPENABLE.has(parsed.protocol)) return;
  window.open(parsed.href, '_blank', 'noopener,noreferrer');
}

export const DESK_ACTIONS: Partial<TranscriptActions> = {
  openExternal,
  loadSpill: () => Promise.reject(new Error('A spilled result is not available on the desk yet.')),
  droppedRowMark: () => UNDONE,
};
