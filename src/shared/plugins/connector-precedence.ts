// The configured entry of a server name the engine uses (Claude Code 2.1.309, cli.pretty.js): local over user over
// project (720870 drops a project server a user or local one names; 720898 lays local over user), and among project
// `.mcp.json` files the one nearest the directory (720717 reads them from the root down, each over the last; the
// inventory lists them in that order, nearest last). MAWS's own server of the name over them all, conservatively: MAWS
// passes its servers with --mcp-config, which the engine loads as `dynamic` (457558), and its authentication resolver
// prefers a loaded client's own configuration over the files' (853424). Customize marks the other entries shadowed;
// main's sign-in refuses a session whose used entry is not the one asked for.

export interface ConfiguredEntry {
  name: string;
  scope: 'app' | 'user' | 'project' | 'local';
  path: string;
}

const RANK: Record<ConfiguredEntry['scope'], number> = { app: 4, local: 3, user: 2, project: 1 };

/** The entry the engine uses for `name` among one directory's entries (as the inventory lists them), or null. */
export function usedEntry<E extends ConfiguredEntry>(name: string, entries: readonly E[]): E | null {
  let used: E | null = null;
  for (const entry of entries) if (entry.name === name && (used === null || RANK[entry.scope] >= RANK[used.scope])) used = entry;
  return used;
}
