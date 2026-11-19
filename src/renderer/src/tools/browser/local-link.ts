// UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, R3; Interfaces §D; the child's
// l9-browser-delivery-03): the one decision for a web link out of a session's transcript (a Markdown link, a web call's
// receipt) or its terminal. A link of a session on another machine goes to `openForwardedLink` and is never looked at
// again: forwarded, or refused with its line, ⌘ or not (the system browser would reach this Mac's loopback). Else, unless
// ⌘ was held in a transcript, an http(s) link to a loopback host opens in the session's in-app browser (a side thread's
// parent's) with no forward, so the dev server an agent starts here opens beside the chat as one elsewhere does. Anything
// else is left to its surface (`layout.openExternal`, `pty.openLink`). A terminal opens a link only on ⌘-click and passes
// no option, so a loopback link there opens in the app, whose browser can take it further.
import type { AppSessionId } from '@shared/graph/ids';
import { isAddress, machineOf } from '@shared/machine/address';
import { isLoopbackLink } from '@shared/machine/loopback-link';
import { ipc } from '../../ipc/client';
import { DEFAULT_ACTIONS } from '../../transcript/view/default-actions';
import { openBrowserUrl, openForwardedLink } from './comment/actions';

/** `http:` or `https:`, on a loopback host (`isLoopbackLink`). */
export function isLocalWebLink(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  return (protocol === 'http:' || protocol === 'https:') && isLoopbackLink(url);
}

/** The one decision for a web link out of a session's transcript or terminal. True: it was taken (forwarded, refused with its line, or opened in the in-app browser). False: the surface opens it as before. */
export function openLinkInApp(appSessionId: AppSessionId, url: string, options?: { external?: boolean }): boolean {
  // Each branch names its own machine: the in-app open requires an address of this Mac, the forward one of another
  // machine, so neither depends on the other's place. An id that is no address names no machine (every mounted route
  // passes an address: a transcript's store key, a terminal's session), and its link is left to the surface.
  const machine = isAddress(appSessionId) ? machineOf(appSessionId) : null;
  if (machine === ipc.localMachine && options?.external !== true && isLocalWebLink(url)) {
    openBrowserUrl(appSessionId, url);
    return true;
  }
  if (machine !== null && machine !== ipc.localMachine) return openForwardedLink(appSessionId, url);
  return false;
}

/** A mounted transcript's web-link opener (App.tsx registers it as `openExternal`): the decision above, else the host's default, which asks main told the session's machine. */
export function openWebLink(url: string, appSessionId?: AppSessionId | null, options?: { external?: boolean }): void {
  if (appSessionId == null || !openLinkInApp(appSessionId, url, options)) DEFAULT_ACTIONS.openExternal(url, appSessionId);
}
