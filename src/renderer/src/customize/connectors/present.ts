// What Customize › Connectors says and asks (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Adding", "Signing in", "Which session", "My items"). Pure: the sheet, My items and the tests read these.
// - + asks `claude mcp add --transport <http|sse> <name> <url> --scope <scope>`: the directory's name, URL (or the first of
//   its url_options, or an instance URL the person types, held to the server's url_regex as the directory writes it, a
//   pattern JavaScript cannot read refusing every URL) and transport, at user scope by default. A name configured in any
//   scope that applies here is refused with the existing entry; until every scope's configuration is read, nothing is
//   added.
// - Remove asks `claude mcp remove <name> --scope <scope>` at the server's own scope; MAWS's own (`app`) servers are not
//   the engine's to remove.
// - Sign in runs in the attached session, else any ready session whose scope includes the server (Decision Log 14): any
//   session for a user-scope server, a session in the page's directory for a project or local one.
// - A server's sign-in state: a sign-in under way or its end first, then the attached session's mcp_status, then the
//   directory's auth posture for the record the server's endpoint matches (main's `catalog.postures`); no words when MAWS
//   observed nothing, though a remote server still offers Sign in. A success yields to a read taken after it that says
//   the server needs a sign-in or failed, save a success for new sessions against its own session's read; a sign-in that
//   did not finish stays said.
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { isMcpName, isMcpUrl, PLUGINS_SCOPES, type PluginsScope } from '@shared/plugins/cli';
import { patternCheck } from '@shared/plugins/connector-url';
import { CONNECTOR_ALREADY_CONNECTED } from '@shared/ipc/schema/connectors';
import { usedEntry } from '@shared/plugins/connector-precedence';
import { requestFor, type PluginsRequest } from '../../widgets/plugins/present';
import { trustOf } from '../discover/present';
import { CONNECTORS as C } from './copy';
import type { SignInRecord } from './sign-in';

export type AuthPosture = 'auth_required' | 'no_auth';

export function connectorAddOf(item: CatalogItem): PluginsRequest | null {
  const route = item.install;
  if (route.kind !== 'connector' || item.scanBlocked !== null) return null;
  const url = route.url ?? route.urlOptions[0]?.url ?? '';
  return requestFor(
    'mcp-add',
    { name: route.name, url, transport: route.transport, scope: 'user' },
    null,
    { connector: { name: item.name, publisher: item.publisher, trust: trustOf(item).label, urlPattern: route.urlPattern, urlOptions: route.urlOptions, authPosture: route.authPosture } },
  );
}

/** Why the URL cannot be added, or null. A pattern JavaScript cannot read refuses every URL, before one is typed. */
export function urlProblem(url: string, pattern: string | null): string | null {
  const check = pattern === null ? null : patternCheck(url, pattern);
  if (check === 'unreadable') return C.urlUnchecked;
  if (url === '') return C.urlRequired;
  if (!isMcpUrl(url)) return C.urlScheme;
  return check === 'no_match' ? C.urlPattern(pattern!) : null;
}

export const nameProblem = (name: string): string | null => (name === '' ? C.nameRequired : isMcpName(name) ? null : C.nameRule);

/** The entry already configured under this name in a scope that applies in the page's directory (the inventory lists
 * every such scope), or null. */
export const existingOf = (name: string, servers: readonly CustomizationServer[]): CustomizationServer | null => servers.find((server) => server.name === name) ?? null;

/** What is configured in every scope that applies here, as Add needs it: read whole, or why not. A name is free only
 * against a whole read, so nothing is added while it is reading, failed, or read in part (`serversRead` false). */
export type ConfiguredServers =
  | { state: 'reading' }
  | { state: 'failed'; message: string }
  | { state: 'partial' }
  | { state: 'read'; servers: readonly CustomizationServer[] };

export function configuredOf(read: { data: { servers: readonly CustomizationServer[]; serversRead: boolean } | undefined; error: Error | null }): ConfiguredServers {
  if (read.error) return { state: 'failed', message: read.error.message }; // the latest read failed: an older answer vouches for nothing now
  if (read.data) return read.data.serversRead ? { state: 'read', servers: read.data.servers } : { state: 'partial' };
  return { state: 'reading' };
}

/** The scopes the sheet offers: a project's two need a project, so the user configuration offers user alone. */
export const scopesFor = (cwd: string | null): PluginsScope[] => (cwd === null ? ['user'] : [...PLUGINS_SCOPES]);

/** The file `mcp add` and `mcp remove` change at a scope: the engine's global config file (user, and local, which it
 * keeps under the project's entry there), or the project's `.mcp.json`. */
export const writesFor = (scope: PluginsScope, where: { globalConfig: string; cwd: string }): string => (scope === 'project' ? `${where.cwd.replace(/\/$/, '')}/.mcp.json` : where.globalConfig);

const ENGINE_SCOPES: ReadonlySet<string> = new Set(PLUGINS_SCOPES);

/** Where `mcp remove` must run for this entry, or null for the page's directory: a project entry lives in the `.mcp.json`
 * it was read from, which may be a parent directory's (the inventory reads every ancestor's), and the CLI removes from
 * the `.mcp.json` of the directory it runs in. A local entry is the page's project's; a user one is anywhere's. */
export function removalDirectoryOf(server: CustomizationServer): string | null {
  if (server.scope !== 'project') return null;
  const parent = server.path.slice(0, server.path.lastIndexOf('/'));
  return parent === '' ? '/' : parent;
}
export function removeRequestOf(server: CustomizationServer): PluginsRequest | null {
  if (!ENGINE_SCOPES.has(server.scope)) return null;
  return requestFor('mcp-remove', { name: server.name, scope: server.scope as PluginsScope }, null);
}

/** The scope of the entry the engine uses instead of this one (`app`: MAWS's own server of the name), or null when this
 * is the one it uses; MAWS's own rows are never shadowed (@shared/plugins/connector-precedence). */
export function shadowedBy(server: CustomizationServer, servers: readonly CustomizationServer[]): CustomizationServer['scope'] | null {
  if (server.scope === 'app') return null;
  const used = usedEntry(server.name, servers);
  return used === null || (used.scope === server.scope && used.path === server.path) ? null : used.scope;
}

export const shadowWords = (scope: CustomizationServer['scope'], name: string): string => (scope === 'app' ? C.shadowedByMaws(name) : C.shadowed(scope));

/** The key a configured server's operations run under (Remove): its scope, name and file, since two project files may
 * configure one name. */
export const serverKey = (server: Pick<CustomizationServer, 'name' | 'scope' | 'path'>): string => `connector:${server.scope}:${server.name}:${server.path}`;

// ---- signing in ------------------------------------------------------------------------------------------------------

export interface ReadySession {
  appSessionId: string;
  cwd: string;
}

/** The session a server signs in from: the attached one, else the first ready session whose scope includes the server,
 * one in the page's directory first (the entries the page shows are the ones it reads); null when none does (Sign in then
 * says to open one). MAWS's own servers are not signed in through the engine. Main refuses a session whose engine uses
 * another entry of the name (scalpel-2#1). */
export function signInSessionOf(scope: CustomizationServer['scope'], ready: readonly ReadySession[], attached: string | null, cwd: string | null): string | null {
  if (scope === 'app') return null;
  if (attached !== null) return attached;
  const here = (session: ReadySession) => (cwd !== null && session.cwd === cwd ? 0 : 1);
  const inScope = ready.filter((session) => scope === 'user' || here(session) === 0).sort((a, b) => here(a) - here(b) || a.appSessionId.localeCompare(b.appSessionId));
  return inScope[0]?.appSessionId ?? null;
}

export interface SignInFacts {
  live: { status: string; error: string | null } | null | undefined; // the attached session's mcp_status entry; null: not listed; undefined: no read
  liveRead: { appSessionId: string; at: number } | null; // the read `live` came from: its session and when (ms)
  posture: AuthPosture | null; // the directory's, for the record the server's endpoint matches
  last: SignInRecord | null; // this server's latest sign-in
  transport: string | null; // the configured transport: a local (stdio) server signs in nowhere
}

export interface SignInView {
  text: string | null; // null: MAWS has observed nothing about it
  tone: 'muted' | 'success' | 'danger';
  signIn: boolean; // Sign in is offered (a second press while one runs cancels it and starts again)
  cancel: boolean;
}

const view = (text: string | null, tone: SignInView['tone'], signIn: boolean, cancel = false): SignInView => ({ text, tone, signIn, cancel });
const REMOTE: ReadonlySet<string | null> = new Set(['http', 'sse', null]);

/** The result a row shows: a sign-in under way always (it is the connector's one operation, and Cancel must reach it);
 * one that ended only for the configuration it was started for, by fingerprint, known on both sides. */
export function resultFor(record: SignInRecord | null, fingerprint: string | null): SignInRecord | null {
  if (record === null) return null;
  const ended = record.event.state === 'done' || record.event.state === 'failed' || record.event.state === 'cancelled';
  return !ended || (fingerprint !== null && record.fingerprint === fingerprint) ? record : null;
}

// A success the session has since contradicted: a read after it lists the server needing a sign-in or failed. A success
// for new sessions never claimed the signing session, so that session's read does not contradict it.
function overtaken({ event, appSessionId, at }: SignInRecord, live: SignInFacts['live'], read: SignInFacts['liveRead']): boolean {
  if (event.state !== 'done' || !live || read === null || read.at <= at) return false;
  if (live.status !== 'needs-auth' && live.status !== 'failed') return false;
  return !(event.where === 'new_sessions' && read.appSessionId === appSessionId);
}

export function signInViewOf({ live, liveRead, posture, last: record, transport }: SignInFacts): SignInView | null {
  if (record !== null && !overtaken(record, live, liveRead)) {
    const last = record.event;
    switch (last.state) {
      case 'done':
        return view(last.message === CONNECTOR_ALREADY_CONNECTED ? C.alreadyConnected : C.signedIn[last.where ?? 'here'], 'success', false);
      case 'cancelled':
        return view(C.didntFinish(C.cancelled), 'danger', true);
      case 'failed': {
        const reason = last.reason ?? 'engine';
        const why = reason === 'engine' || reason === 'other_entry' ? (last.message ?? C.reason[reason]) : reason === 'denied' && last.message ? `${C.reason.denied} (${last.message})` : C.reason[reason];
        return view(C.didntFinish(why), 'danger', true);
      }
      default:
        return view(C.step[last.state], 'muted', true, true);
    }
  }
  if (!REMOTE.has(transport)) return null;
  const authless = posture === 'no_auth';
  if (live) {
    switch (live.status) {
      case 'connected':
        return view(authless ? `${C.connected} · ${C.noneNeeded}` : C.connected, 'success', false);
      case 'needs-auth':
        return view(C.needed, 'muted', true);
      case 'failed':
        return view(C.failed(live.error), 'danger', !authless);
      case 'pending':
        return view(C.connecting, 'muted', false);
      default:
        return view(C.status(live.status), 'muted', false);
    }
  }
  if (authless) return view(C.noneNeeded, 'muted', false);
  if (posture === 'auth_required') return view(C.needed, 'muted', true);
  // a remote server nobody describes and no session lists (one added after the session started, Decision Log 14): no
  // state to claim, but Sign in is offered; an authless server answers it at once
  return view(null, 'muted', true);
}
