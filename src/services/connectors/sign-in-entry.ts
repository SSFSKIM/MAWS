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
import { addressFormOf, addressMatches, pluginInSession, type PluginInSession, type SessionPlugin } from '@shared/plugins/plugin-connector';

export interface RequestedEntry {
  name: string;
  scope: 'user' | 'project' | 'local';
  path?: string; // the file the entry is in; P5 O7 M8: absent (`connectors.signInServer`), whichever the session uses
  cwd: string | null; // the page's directory: a local entry is that project's
}

/** A configured entry with its endpoint, as `customization.serverEndpoints` reads it (`url` null where it has none). */
export interface EndpointEntry extends ConfiguredEntry {
  transport: string;
  url: string | null;
  revision?: string | null; // UX wave U11a M8: the engine host's revision of the configuration; absent from an earlier build's
}

/** A server as the session's mcp_status reports it (loose: only `name` is certain). */
export interface LiveServer {
  name: string;
  scope?: unknown;
  source?: unknown; // UX wave U11h: `plugin` for a plugin's server (2.1.322; spikes/protocol-probe/findings-uxwave-u11-plugin-connectors.txt, 2)
  transport?: unknown;
  config?: unknown;
}

/** Why the session cannot sign this entry in, in words, or null when its engine uses exactly this entry. */
export function entryRefusal(requested: RequestedEntry, sessionCwd: string, entries: readonly EndpointEntry[], live: readonly LiveServer[]): string | null {
  // a local entry lives under its project's key in the global file: the same path for every project
  if (requested.scope === 'local' && requested.cwd !== sessionCwd) return `that session runs in ${sessionCwd}, not ${requested.cwd ?? 'the user configuration'}`;
  const used = usedEntry(requested.name, entries);
  if (used === null) return `that session has no ${requested.name} entry`;
  if (used.scope !== requested.scope || (requested.path !== undefined && used.path !== requested.path)) return used.scope === 'app' ? `that session uses MAWS’s ${requested.name} server` : `that session uses the ${used.scope} entry in ${used.path}`;
  const held = live.find((server) => server.name === requested.name);
  if (held !== undefined && !holds(held, used)) return `this session uses a different ${requested.name}; start a new session to sign in`;
  return null;
}

// The running engine's server is the entry: its scope, its transport, and its URL where the entry has one. A URL the
// file writes with `${…}` the engine expands from its own environment, which MAWS cannot read; scope and transport decide.
// `streamable-http` is the engine's alias of `http` (2.1.309 cli.pretty.js 719781), and its status may report either.
const transportOf = (type: unknown) => (type === 'streamable-http' ? 'http' : type);
// `scope`: the scope the engine reports for the entry (a server of MAWS's own list, given with --mcp-config, is `dynamic`)
function holds(server: LiveServer, entry: EndpointEntry, scope: string = entry.scope): boolean {
  if (server.scope !== scope || transportOf(server.transport) !== transportOf(entry.transport)) return false;
  if (entry.url === null || entry.url.includes('${')) return true;
  const config = server.config;
  return typeof config === 'object' && config !== null && (config as { url?: unknown }).url === entry.url;
}

// UX wave U11a M8 (docs/doperpowers/plans/2026-11-12-ux-wave-U11a-settings-connectors-org.md, §A, "The check"): a dynamic
// connector, one a plugin brings or one of MAWS's own list, is named by no configuration file the session reads; what
// the engine signs in is the session's own server of the name, which its mcp_status lists with scope `dynamic`. A press
// from a row of MAWS's own list also names the configuration that row was drawn from, by its revision: the entry of the
// name must still be of that revision, and the session's server must be that entry. So what is authenticated is the
// session's server, the session's server is the entry, and the entry is the configuration the row showed.
/** Why the session cannot sign this dynamic server in, in words, or null. `own`: MAWS's own entries as the engine host answers them now, read only for a press that names an entry. */
export function dynamicRefusal(requested: { name: string; entry?: { revision: string } }, live: readonly LiveServer[], own: readonly EndpointEntry[]): string | null {
  const held = live.find((server) => server.name === requested.name);
  if (held === undefined) return `that session has no ${requested.name} server`;
  const different = `this session uses a different ${requested.name}; start a new session to sign in`;
  if (held.scope !== 'dynamic') return different;
  if (requested.entry === undefined) return null;
  const entry = own.find((candidate) => candidate.scope === 'app' && candidate.name === requested.name);
  if (entry === undefined || typeof entry.revision !== 'string' || entry.revision !== requested.entry.revision) return `MAWS’s ${requested.name} server changed since this page read it; refresh the page, then sign in`;
  return holds(held, entry, 'dynamic') ? null : different;
}

// UX wave U11h (docs/doperpowers/plans/2026-11-14-ux-wave-U11h-plugin-connectors.md, §B, "The rule"): a press from a
// plugin's row in Customize. Nothing on a server's status entry names its plugin (the findings, 2): the engine names it
// `plugin:<manifest name>:<server>`, more than one plugin can build one name (two of one manifest name, or a colon in a
// manifest name), and the engine keeps one of them and says nothing. So the row's entry is found by its revision (d), the
// plugins the session reported must hold exactly one possible owner of the name, the row's (a), and the session's server
// of the name must be a plugin's of the entry's transport (b) at the entry's address (c). These are the words of the
// press (point 1); the operation's later points say one sentence of their own (./sign-in.ts).

/** A plugin's connector as `customization.serverEndpoints` answers it (`pluginServers`), what the rule reads of it. */
export interface PluginEntry { plugin: string; name: string | null; version: string | null; transport: string; url: string | null; revision: string | null }

/** (d): the entry of the press's engine name whose revision is the press's, or null (gone, replaced, updated, or no revision answered). The revision covers the plugin's key, so two entries of one name are told apart. */
export function pluginEntryOf<E extends PluginEntry>(press: { name: string; revision: string }, entries: readonly E[]): (E & { name: string }) | null {
  return (entries.find((entry) => entry.name === press.name && entry.revision !== null && entry.revision === press.revision) as (E & { name: string }) | undefined) ?? null;
}

/** The one sentence of the operation's later points, whatever part failed there (§G). */
export const PLUGINS_CHANGED = 'Plugins changed while this sign-in started. Try again.';

/** (d) refused, in the press's words. */
export const pluginEntryChanged = (name: string): string => `${name} changed since this page read it; refresh the page, then sign in`;

const OWNER_WORDS: Record<Exclude<PluginInSession, 'ok'>, (name: string) => string> = {
  'not-reported': () => 'that session has not reported its plugins yet; send it a message, then sign in',
  absent: (name) => `that session loaded no plugin that supplies ${name}`,
  collision: (name) => `more than one plugin in that session supplies ${name}; turn the others off, start a new session, then sign in`,
  'other-plugin': (name) => `that session loaded ${name} from another plugin`,
  'other-version': () => 'that session loaded another version of this plugin; start a new session to sign in',
};

/** (a): why the plugins the session last reported do not admit the entry, in the press's words, or null. */
export function pluginOwnerRefusal(entry: PluginEntry & { name: string }, plugins: readonly SessionPlugin[], observedAt: string | null): string | null {
  const verdict = pluginInSession(entry, plugins, observedAt);
  return verdict === 'ok' ? null : OWNER_WORDS[verdict](entry.name);
}

/** (b) and (c): why the session's server of the name is not the entry's, in the press's words, or null. Also the judge of the operation's baseline read, so "already connected" is never said of a server outside the entry's address. */
export function pluginServerRefusal(entry: PluginEntry & { name: string }, live: readonly LiveServer[]): string | null {
  const held = live.find((server) => server.name === entry.name);
  if (held === undefined) return `that session has no ${entry.name} server`;
  const different = `this session uses a different ${entry.name}; start a new session to sign in`;
  if (held.scope !== 'dynamic' || held.source !== 'plugin' || transportOf(held.transport) !== transportOf(entry.transport)) return different;
  // a remote entry with no address: its declared address is past the endpoints' bound, and a cut text would be another
  // address (a session at that prefix would match it), so nothing is compared and the press is refused
  if (entry.url === null) return different;
  if (addressFormOf(entry.url) === 'templated-origin') return `${entry.name}’s address is set when a chat starts; sign in from that chat’s Connectors dialog`;
  const url = typeof held.config === 'object' && held.config !== null ? (held.config as { url?: unknown }).url : undefined;
  return typeof url === 'string' && addressMatches(entry.url, url) ? null : different;
}
