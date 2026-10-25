// scalpel-2#1: whether a session's engine uses the configured entry a sign-in was asked for. The engine is asked for a
// server by name alone (mcp_authenticate carries no scope), so it signs in whichever entry of the name it holds; a
// sign-in for another entry would authenticate that one and be shown on the wrong row. Two readings, in turn:
// - the files, read for the session's own directory as the inventory reads them: the entry they say the name resolves to
//   (@shared/plugins/connector-precedence) must be the row's, or a new session would not use it either;
// - the running engine (fix-D#4): what it holds is what it read at launch, which the files no longer say once an entry
//   was removed, added or changed since (an app server given with --mcp-config and since removed, a user one on disk).
//   Its mcp_status reports each server's scope, transport and configuration (2.1.309 cli.pretty.js 1128186: `scope`
//   is the entry's, `dynamic` for --mcp-config; `config.url` for http and sse, redacted only for managed servers); they
//   must be the row's. A server it does not list yet is read from its files when it is asked (the first reading stands).
import { usedEntry, type ConfiguredEntry } from '@shared/plugins/connector-precedence';

export interface RequestedEntry {
  name: string;
  scope: 'user' | 'project' | 'local';
  path: string; // the file the entry is in
  cwd: string | null; // the page's directory: a local entry is that project's
}

/** A configured entry with its endpoint, as `customization.serverEndpoints` reads it (`url` null where it has none). */
export interface EndpointEntry extends ConfiguredEntry {
  transport: string;
  url: string | null;
}

/** A server as the session's mcp_status reports it (loose: only `name` is certain). */
export interface LiveServer {
  name: string;
  scope?: unknown;
  transport?: unknown;
  config?: unknown;
}

/** Why the session cannot sign this entry in, in words, or null when its engine uses exactly this entry. */
export function entryRefusal(requested: RequestedEntry, sessionCwd: string, entries: readonly EndpointEntry[], live: readonly LiveServer[]): string | null {
  // a local entry lives under its project's key in the global file: the same path for every project
  if (requested.scope === 'local' && requested.cwd !== sessionCwd) return `that session runs in ${sessionCwd}, not ${requested.cwd ?? 'the user configuration'}`;
  const used = usedEntry(requested.name, entries);
  if (used === null) return `that session has no ${requested.name} entry`;
  if (used.scope !== requested.scope || used.path !== requested.path) return used.scope === 'app' ? `that session uses MAWS’s ${requested.name} server` : `that session uses the ${used.scope} entry in ${used.path}`;
  const held = live.find((server) => server.name === requested.name);
  if (held !== undefined && !holds(held, used)) return `this session uses a different ${requested.name}; start a new session to sign in`;
  return null;
}

// The running engine's server is the entry: its scope, its transport, and its URL where the entry has one. A URL the
// file writes with `${…}` the engine expands from its own environment, which MAWS cannot read; scope and transport decide.
// `streamable-http` is the engine's alias of `http` (2.1.309 cli.pretty.js 719781), and its status may report either.
const transportOf = (type: unknown) => (type === 'streamable-http' ? 'http' : type);
function holds(server: LiveServer, entry: EndpointEntry): boolean {
  if (server.scope !== entry.scope || transportOf(server.transport) !== transportOf(entry.transport)) return false;
  if (entry.url === null || entry.url.includes('${')) return true;
  const config = server.config;
  return typeof config === 'object' && config !== null && (config as { url?: unknown }).url === entry.url;
}
