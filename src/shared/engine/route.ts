// The inference route (P5 O7 M9; docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The route", Interfaces
// §U): `gateway` (MAWS points the engine at ClaudeUsage's relay), `direct` (MAWS blanks the gateway variables), and
// `machine` (nothing injected: the machine's own settings, environment and login decide, as `claude` in its terminal
// would). Inside a wire major an added enum member is breaking (src/shared/ipc/wire.ts), so this enum is used only by
// the new optional `route` properties; every legacy field keeps its two-member enum and is always written too, with the
// legacy route, the value an older reader should act on. Imports nothing but zod: the graph's record, the launch spec,
// the intent, the IPC schemas and the settings all read it.
import * as z from 'zod';

export const RouteSchema = z.enum(['gateway', 'direct', 'machine']);
export type Route = z.infer<typeof RouteSchema>;
export type LegacyRoute = Exclude<Route, 'machine'>; // the two-member enum every pre-M9 field carries

// What `get_status` reported of a session's inference, named (M9 "What the machine reports"): ClaudeUsage when the base
// URL is the machine's relay, the Anthropic login (its `Login` and `Organization` rows) when there is none, else the host
// the base URL names. Never a mismatch: the machine route has no expectation to miss.
export const ObservedRouteSchema = z.strictObject({
  kind: z.enum(['claudeusage', 'login', 'host']),
  baseUrl: z.string().nullable(),
  login: z.string().optional(),
  organization: z.string().optional(),
});
export type ObservedRoute = z.infer<typeof ObservedRouteSchema>;

// The legacy route of a machine route, given its effective base URL (the engine host's resolution before a launch, or
// what `get_status` reported after it) and this machine's relay URL (src/engine-host/launch.ts's RELAY_URL, compared as
// `verifyGateway` compares it, by string): an older peer acting on it reaches the same inference in the two cases that
// allow it (the relay, or no base URL at all) and the nearest otherwise.
export function legacyRouteOf(baseUrl: string | null, relayUrl: string): LegacyRoute {
  return baseUrl === relayUrl ? 'gateway' : 'direct';
}

// The route a reader acts on: `route` when present, else the legacy field. One rule for every carrier (the launch spec,
// the setup intent, StartOptions, `engine.models`' input, the status's `{route, mode}` read as `{route, gateway: mode}`).
export function readRoute(carrier: { route?: Route; gateway: LegacyRoute }): Route;
export function readRoute(carrier: { route?: Route; gateway?: LegacyRoute }): Route | undefined;
export function readRoute(carrier: { route?: Route; gateway?: LegacyRoute }): Route | undefined {
  return carrier.route ?? carrier.gateway;
}

// The same rule over the session record's gateway, whose legacy field is `routed` (true when the session was observed
// through ClaudeUsage); null when neither says, a session MAWS discovered on disk and never verified.
export function readRecordedRoute(gateway: { route?: Route; routed: boolean | null }): Route | null {
  return gateway.route ?? (gateway.routed === true ? 'gateway' : gateway.routed === false ? 'direct' : null);
}

// The keys the gateway route sets and the direct route deletes (engine-host/launch.ts buildEnvironment). P5 O7 M9:
// effectiveBaseUrl (engine-host/models-cache.ts) reports which of them a machine sets, so a legacy direct launch is
// equivalent to the machine route only where it sets none.
export const GATEWAY_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ENABLE_TOOL_SEARCH'] as const;
