// What a session's inference was observed reaching (P5 O7 M9, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "What the machine reports" and "The relay check and the features"). On the `machine` route MAWS injects nothing, so
// the route chosen says nothing of where requests go: ClaudeUsage's features (usage windows, accounts, gateway models)
// key on `observed.kind`, which the engine host names from `get_status`, falling back to the legacy fields (`mode`, the
// record's `routed`) where no observation was made (an older host, or a launch not verified yet). A live status is the
// current launch and wins over the record's observation of an earlier one.
import { readRecordedRoute, readRoute, type LegacyRoute, type ObservedRoute, type Route } from '@shared/engine/route';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import { MACHINE_ROUTE } from './copy';

type LiveGateway = { gateway: Pick<EngineSessionStatus['gateway'], 'mode' | 'route' | 'observed'> };
type KeptGateway = { gateway: Pick<SessionRecord['gateway'], 'routed' | 'route' | 'observed'> };

/** Whether the session's requests go through ClaudeUsage's relay; null when nothing says (a session never verified). */
export function throughClaudeUsage(status: LiveGateway | null, record: KeptGateway | null): boolean | null {
  if (status) return status.gateway.observed ? status.gateway.observed.kind === 'claudeusage' : status.gateway.mode === 'gateway';
  if (!record) return null;
  return record.gateway.observed ? record.gateway.observed.kind === 'claudeusage' : record.gateway.routed;
}

/** The legacy route whose catalogue names the session's models: the relay's through ClaudeUsage, else the engine's own. */
export function catalogueRoute(status: LiveGateway | null, record: KeptGateway | null): LegacyRoute | null {
  const via = throughClaudeUsage(status, record);
  return via === null ? null : via ? 'gateway' : 'direct';
}

/** The route the session was launched on (`route` first, then the legacy field); null when never recorded. */
export function routeChosen(status: LiveGateway | null, record: KeptGateway | null): Route | null {
  if (status) return readRoute({ route: status.gateway.route, gateway: status.gateway.mode });
  return record ? readRecordedRoute(record.gateway) : null;
}

/** What the live launch was observed reaching, else (no process) what the record kept of the last one. */
export function observedOf(status: LiveGateway | null, record: KeptGateway | null): ObservedRoute | null {
  if (status) return status.gateway.observed ?? null;
  return record?.gateway.observed ?? null;
}

const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
};

/** What the machine's own route reached, in words: ClaudeUsage, the Anthropic login, or the host its base URL names. */
export function machineReached(observed: ObservedRoute | null): string {
  if (observed === null) return MACHINE_ROUTE.pending;
  switch (observed.kind) {
    case 'claudeusage':
      return MACHINE_ROUTE.claudeUsage(observed.baseUrl ?? '');
    case 'login':
      return MACHINE_ROUTE.login(observed.login ?? null);
    case 'host':
      return hostOf(observed.baseUrl ?? '');
  }
}

/** What the machine reached, in a few words (the switch's toast): ClaudeUsage, the login, or the host. */
export function machineReachedBriefly(observed: ObservedRoute | null): string {
  return observed?.kind === 'claudeusage' ? MACHINE_ROUTE.reachedClaudeUsage : machineReached(observed);
}

/** Session info's words for a session on the machine's own route: what the machine reached, never a mismatch. */
export const machineRouteLine = (observed: ObservedRoute | null): string => MACHINE_ROUTE.line(machineReached(observed));
