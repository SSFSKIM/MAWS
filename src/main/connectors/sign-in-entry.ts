// scalpel-2#1: whether a session's engine uses the configured entry a sign-in was asked for. The engine is asked for a
// server by name alone (mcp_authenticate carries no scope), so it signs in whichever entry of the name its directory
// uses (@shared/plugins/connector-precedence); a sign-in for another entry would authenticate that one and be shown on
// the wrong row. The session's entries are read for its own directory, as the inventory reads them.
import { usedEntry, type ConfiguredEntry } from '@shared/plugins/connector-precedence';

export interface RequestedEntry {
  name: string;
  scope: 'user' | 'project' | 'local';
  path: string; // the file the entry is in
  cwd: string | null; // the page's directory: a local entry is that project's
}

/** Why the session cannot sign this entry in, in words, or null when its engine uses exactly this entry. */
export function entryRefusal(requested: RequestedEntry, sessionCwd: string, entries: readonly ConfiguredEntry[]): string | null {
  // a local entry lives under its project's key in the global file: the same path for every project
  if (requested.scope === 'local' && requested.cwd !== sessionCwd) return `that session runs in ${sessionCwd}, not ${requested.cwd ?? 'the user configuration'}`;
  const used = usedEntry(requested.name, entries);
  if (used === null) return `that session has no ${requested.name} entry`;
  if (used.scope === requested.scope && used.path === requested.path) return null;
  return used.scope === 'app' ? `that session uses MAWS’s ${requested.name} server` : `that session uses the ${used.scope} entry in ${used.path}`;
}
