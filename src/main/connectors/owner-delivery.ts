// P4-B5: the owner's delivery through MAWS's own connection, main's half (docs/doperpowers/plans/2026-10-19-p4-smoothing.md
// §4.7 and P4-B5; route D's design binding: docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md). Connector-generic:
// the delivery service (../delivery/) names the tool, builds its arguments and reads its answer. No session is started,
// no model turn is taken, no artifact grant is made or used: the owner's gesture in a trusted sheet is the authority,
// and the host's last check at the actual write is route D's (`connectors.directSend`).
//
// - Finding. WR 76/78 adds cold user-scope literal HTTP entries and validated app MCP settings to the host's delivery
//   source authority (configured-delivery.ts), independently of engine reports. Existing observed sources remain:
//   `find` reads live sessions' mcp_status (the artifact's own first, at most OBSERVE_LIMIT; nothing launched, acquired
//   or marked used), then asks the host which attested sources can take the tool. HTTP sources of one saved identity
//   (including the same user entry read cold and observed in a session) are one.
// - A source's connection is MAWS's own: a stdio server needs no sign-in of MAWS's (`local`); an HTTP server's state is
//   the provider's sealed record. With none saved, the server may be open: as the owner's Connect does (./owner.ts), a
//   listing without a credential is tried first (`open`), and only the server's refusal makes it `signIn`; a server is
//   never pushed into OAuth unless it refuses.
// - Connecting is the provider's Connect (or, for a record that needs it, Reconnect): a browser consent the owner
//   completes, sealed where route D keeps every grant, then a listing with it to prove it. Never the engine's credential.
// - Sending is route D's `send`: one tools/call, never retried, its credential prepared inside the operation.
// - The record store's read (a safeStorage decrypt that can stall, taking no signal) is raced against the caller's
//   signal: `find` ends within its deadline (that source `unavailable`), and a cancelled `connect` answers `cancelled`.
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import type { DirectSource } from '@shared/ipc/schema/connectors';
import type { DirectRoute, DirectSendAnswer } from './direct-route';
import type { ConnectorOAuthConnectFailure, ConnectorOAuthProvider, ConnectorOAuthState } from './oauth-provider';
import { oauthIdentityOf } from './oauth-types';
import { within } from './owner';

type HostCommand = 'engine.sessions' | 'library.entry' | 'connectors.observe';

// the live sessions whose reports one `find` reads at most, and at once
export const OBSERVE_LIMIT = 8;
const OBSERVE_CONCURRENCY = 4;

// `local`: stdio, no sign-in of MAWS's; `connected`: MAWS's saved sign-in; `open`: HTTP that answered a listing with no
// credential; `signIn`: HTTP that refused one (or a record forgotten), the owner's Connect needed; `reconnect`: the saved
// sign-in can no longer be used; `busy`: a sign-in under way; `unavailable`: the record store cannot be read.
export type DeliveryConnection = 'local' | 'connected' | 'open' | 'signIn' | 'reconnect' | 'busy' | 'unavailable';
export interface DeliverySource {
  source: DirectSource;
  connection: DeliveryConnection;
}
export type DeliveryConnectResult = { ok: true } | { ok: false; why: ConnectorOAuthConnectFailure | 'refused' | 'listing' };

export interface OwnerDelivery {
  // The verified sources that can take `tool` (a report lists it, or an HTTP server on one of `urlHosts`), each with its
  // connection, the usable first, and how many live sessions there were to read; null when the host could not be asked.
  find(request: { tool: string; urlHosts: readonly string[]; artifactId?: string }, signal: AbortSignal): Promise<{ sources: DeliverySource[]; live: number } | null>;
  connect(source: DirectSource, signal: AbortSignal): Promise<DeliveryConnectResult>;
  send(source: DirectSource, request: { artifactId: string; tool: string; arguments: Record<string, unknown> }, signal: AbortSignal): Promise<DirectSendAnswer>;
}

export interface OwnerDeliveryDeps {
  call<N extends HostCommand>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  direct: Pick<DirectRoute, 'locate' | 'send' | 'discover'>;
  oauth: Pick<ConnectorOAuthProvider, 'state' | 'connect' | 'reconnect'> | null; // null: no OAuth of MAWS's own
  log?: (line: string) => void;
}

const identityKey = (source: DirectSource): string | null => {
  const identity = oauthIdentityOf(source);
  return identity && JSON.stringify([identity.requestUrl, identity.server, identity.scope, identity.configPath, identity.entryPath]);
};
const RANK: Record<DeliveryConnection, number> = { connected: 0, local: 1, open: 2, signIn: 3, reconnect: 4, busy: 5, unavailable: 6 };
const UNREAD: ConnectorOAuthState = { state: 'unavailable', why: 'store' }; // the store unread: failed, or the signal first

export function createOwnerDelivery(deps: OwnerDeliveryDeps): OwnerDelivery {
  const log = deps.log ?? ((line: string) => console.warn(`[connectors] ${line}`));

  async function host<N extends HostCommand>(name: N, input: CommandInput<N>) {
    const result = await deps.call(name, input);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.code}`);
    return result.value;
  }

  // Every live session's report read now (the artifact's own first), so the cache holds what each engine reports; the
  // number of live sessions there were (null: the host did not list them).
  async function observe(artifactId: string | undefined, signal: AbortSignal): Promise<number | null> {
    let live: readonly { appSessionId: string; launchId: string; cwd: string; process: string }[];
    try {
      live = (await host('engine.sessions', undefined)).filter((session) => session.process === 'ready');
    } catch {
      return null; // nothing read: the cache answers what it already holds
    }
    let own = new Set<string>();
    if (artifactId !== undefined) {
      try {
        own = new Set((await host('library.entry', { artifactId })).links.map((link) => link.appSessionId));
      } catch {
        // no row (deleted meanwhile): the order alone changes
      }
    }
    const order = [...live.filter((session) => own.has(session.appSessionId)), ...live.filter((session) => !own.has(session.appSessionId))].slice(0, OBSERVE_LIMIT);
    let next = 0;
    const worker = async () => {
      while (next < order.length && !signal.aborted) {
        const { appSessionId, launchId, cwd } = order[next++]!;
        await deps.call('connectors.observe', { appSessionId, launchId, cwd }).catch(() => null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(OBSERVE_CONCURRENCY, order.length) }, worker));
    return live.length;
  }

  async function connectionOf(source: DirectSource, signal: AbortSignal): Promise<DeliveryConnection> {
    if (source.transport === 'stdio') return 'local';
    const identity = oauthIdentityOf(source);
    if (!identity || !deps.oauth) return 'unavailable';
    const state = await within(deps.oauth.state(identity), signal, UNREAD);
    switch (state.state) {
      case 'connected':
        return 'connected';
      case 'needsReconnect':
        return 'reconnect';
      case 'connecting':
        return 'busy';
      case 'unavailable':
        return 'unavailable';
      case 'disconnected': {
        // no MAWS sign-in saved: a listing with no credential says whether the server is open
        const listed = await deps.direct.discover(source, signal);
        return listed.ok ? 'open' : listed.reason === 'unauthorized' ? 'signIn' : 'unavailable';
      }
      default: // needsConnect, withdrawn
        return 'signIn';
    }
  }

  return {
    async find({ tool, urlHosts, artifactId }, signal) {
      const live = await observe(artifactId, signal);
      if (signal.aborted) return null;
      const sources = await deps.direct.locate(tool, urlHosts, signal);
      if (sources === null) return null;
      const seen = new Set<string>();
      const unique = sources.filter((source) => {
        const key = identityKey(source) ?? `stdio\0${source.sourceId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const found = await Promise.all(unique.map(async (source) => ({ source, connection: await connectionOf(source, signal) })));
      return { sources: found.sort((a, b) => RANK[a.connection] - RANK[b.connection]), live: live ?? 0 };
    },
    async connect(source, signal) {
      if (source.transport !== 'http') return { ok: true };
      const identity = oauthIdentityOf(source);
      if (!identity || !deps.oauth) return { ok: false, why: 'notHttp' };
      const state = await within(deps.oauth.state(identity), signal, UNREAD);
      if (signal.aborted) return { ok: false, why: 'cancelled' };
      if (state.state === 'connecting') return { ok: false, why: 'busy' };
      if (state.state === 'unavailable') return { ok: false, why: 'unavailable' };
      if (state.state === 'disconnected') {
        const open = await deps.direct.discover(source, signal);
        if (open.ok) return { ok: true }; // the server is open: no sign-in of MAWS's is needed
        if (open.reason !== 'unauthorized') return { ok: false, why: 'listing' };
      }
      if (signal.aborted) return { ok: false, why: 'cancelled' };
      const made = state.state === 'needsReconnect' ? await deps.oauth.reconnect(source, signal) : await deps.oauth.connect(source, signal);
      if (!made.ok) return { ok: false, why: made.why };
      const listed = await deps.direct.discover(source, signal);
      if (listed.ok) return { ok: true };
      log(`connectors: ${source.server} refused a listing with MAWS's new sign-in (${listed.reason})`);
      return { ok: false, why: listed.reason === 'unauthorized' ? 'refused' : 'listing' };
    },
    send: (source, request, signal) => deps.direct.send(source, request, signal),
  };
}
