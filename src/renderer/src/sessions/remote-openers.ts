// How another machine's listed session opens (P5 O8 M2, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "What a
// click does"; Interfaces §G). A lane's owner registers its opener (O7 M2 lane B's, O9 M9 lane A's); a click on a listed
// row calls its lane's. With none registered the row is selected and its hover card shows, and nothing opens.
import type { ListedSession } from '../stores/sessions';

export type RemoteLane = ListedSession['lane'];
export type RemoteOpener = (listed: ListedSession) => void;

const openers = new Map<RemoteLane, RemoteOpener>();

// The latest registration wins; its unregister removes only itself.
export function registerRemoteOpener(lane: RemoteLane, open: RemoteOpener): () => void {
  openers.set(lane, open);
  return () => {
    if (openers.get(lane) === open) openers.delete(lane);
  };
}

export function remoteOpenerFor(lane: RemoteLane): RemoteOpener | null {
  return openers.get(lane) ?? null;
}
