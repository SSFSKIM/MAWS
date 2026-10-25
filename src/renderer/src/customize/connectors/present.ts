// What Customize › Connectors says and asks (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Adding", "Signing in", "Which session", "My items"). Pure: the sheet, My items and the tests read these.
// - + asks `claude mcp add --transport <http|sse> <name> <url> --scope <scope>`: the directory's name, URL (or the first of
//   its url_options, or an instance URL the person types, held to the server's url_regex as a whole) and transport, at
//   user scope by default. A name configured in any scope that applies here is refused with the existing entry.
// - Remove asks `claude mcp remove <name> --scope <scope>` at the server's own scope; MAWS's own (`app`) servers are not
//   the engine's to remove.
// - Sign in runs in the attached session, else any ready session whose scope includes the server (Decision Log 14): any
//   session for a user-scope server, a session in the page's directory for a project or local one.
// - A server's sign-in state: a sign-in under way or its end first, then the attached session's mcp_status, then the
//   directory's auth posture for a server it lists under that name; nothing when MAWS observed nothing.
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import { isMcpName, isMcpUrl, PLUGINS_SCOPES, type PluginsScope } from '@shared/plugins/cli';
import { requestFor, type PluginsRequest } from '../../widgets/plugins/present';
import { trustOf } from '../discover/present';
import { CONNECTORS as C } from './copy';

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

/** Why the URL cannot be added, or null. The directory's pattern is held to the whole URL; one JavaScript cannot read
 * leaves the scheme check alone (the engine takes any http or https URL). */
export function urlProblem(url: string, pattern: string | null): string | null {
  if (url === '') return C.urlRequired;
  if (!isMcpUrl(url)) return C.urlScheme;
  if (pattern === null) return null;
  let whole: RegExp;
  try {
    whole = new RegExp(`^(?:${pattern})$`);
  } catch {
    return null;
  }
  return whole.test(url) ? null : C.urlPattern(pattern);
}

export const nameProblem = (name: string): string | null => (name === '' ? C.nameRequired : isMcpName(name) ? null : C.nameRule);

/** The entry already configured under this name in a scope that applies in the page's directory (the inventory lists
 * every such scope), or null. */
export const existingOf = (name: string, servers: readonly CustomizationServer[]): CustomizationServer | null => servers.find((server) => server.name === name) ?? null;

/** The scopes the sheet offers: a project's two need a project, so the user configuration offers user alone. */
export const scopesFor = (cwd: string | null): PluginsScope[] => (cwd === null ? ['user'] : [...PLUGINS_SCOPES]);

/** The file `mcp add` and `mcp remove` change at a scope: the engine's global config file (user, and local, which it
 * keeps under the project's entry there), or the project's `.mcp.json`. */
export const writesFor = (scope: PluginsScope, where: { globalConfig: string; cwd: string }): string => (scope === 'project' ? `${where.cwd.replace(/\/$/, '')}/.mcp.json` : where.globalConfig);

const ENGINE_SCOPES: ReadonlySet<string> = new Set(PLUGINS_SCOPES);
export function removeRequestOf(server: CustomizationServer): PluginsRequest | null {
  if (!ENGINE_SCOPES.has(server.scope)) return null;
  return requestFor('mcp-remove', { name: server.name, scope: server.scope as PluginsScope }, null);
}

/** The key a configured server's operations run under (Remove), by scope and name. */
export const serverKey = (server: Pick<CustomizationServer, 'name' | 'scope'>): string => `connector:${server.scope}:${server.name}`;

// ---- signing in ------------------------------------------------------------------------------------------------------

export interface ReadySession {
  appSessionId: string;
  cwd: string;
}

/** The session a server signs in from: the attached one, else the first ready session whose scope includes the server;
 * null when none does (Sign in then says to open one). MAWS's own servers are not signed in through the engine. */
export function signInSessionOf(scope: CustomizationServer['scope'], ready: readonly ReadySession[], attached: string | null, cwd: string | null): string | null {
  if (scope === 'app') return null;
  if (attached !== null) return attached;
  const inScope = ready.filter((session) => scope === 'user' || (cwd !== null && session.cwd === cwd)).sort((a, b) => a.appSessionId.localeCompare(b.appSessionId));
  return inScope[0]?.appSessionId ?? null;
}

export interface SignInFacts {
  live: { status: string; error: string | null } | null | undefined; // the attached session's mcp_status entry; null: not listed; undefined: no read
  posture: AuthPosture | null; // the directory's, for a server it lists under this name
  last: ConnectorSignInChanged | null; // this server's latest sign-in
  transport: string | null; // the configured transport: a local (stdio) server signs in nowhere
}

export interface SignInView {
  text: string;
  tone: 'muted' | 'success' | 'danger';
  signIn: boolean; // Sign in is offered (a second press while one runs cancels it and starts again)
  cancel: boolean;
}

const view = (text: string, tone: SignInView['tone'], signIn: boolean, cancel = false): SignInView => ({ text, tone, signIn, cancel });
const REMOTE: ReadonlySet<string | null> = new Set(['http', 'sse', null]);

export function signInViewOf({ live, posture, last, transport }: SignInFacts): SignInView | null {
  if (last !== null) {
    switch (last.state) {
      case 'done':
        return view(C.signedIn[last.where ?? 'here'], 'success', false);
      case 'cancelled':
        return view(C.didntFinish(C.cancelled), 'danger', true);
      case 'failed': {
        const reason = last.reason ?? 'engine';
        const why = reason === 'engine' ? (last.message ?? C.reason.engine) : reason === 'denied' && last.message ? `${C.reason.denied} (${last.message})` : C.reason[reason];
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
  return null;
}
