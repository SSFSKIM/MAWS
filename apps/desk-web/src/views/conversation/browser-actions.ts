// What a link in a message does on the desk's page, wherever the desk draws MAWS's Markdown: a session's message and a
// human's bubble in the group chat, the session view's rows and its tail. The page holds the org key and a message's
// text is untrusted (the DC6 plan's constraints), so a link opens only as a new browsing context with no opener and no
// referrer, and only for the schemes MAWS's Markdown gates leave (`https:`, `http:`, `mailto:`); nothing from a message
// navigates this page.
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';

const OPENABLE = new Set(['https:', 'http:', 'mailto:']);

/** Opens a link from a message in a new browsing context without opener access; any other URL is refused. */
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

/**
 * The actions MAWS's Markdown reads where the desk draws it outside a mounted transcript, and inside one the same for
 * links: without them a link calls MAWS's default, a no-op until the session view's chunk loads and then Electron's IPC,
 * which the page does not have. A path chip names a file on the session's machine, which the browser cannot open.
 */
export const BROWSER_ACTIONS: Partial<TranscriptActions> = { openExternal };
