// P3-H, the connector grant (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24 and 80; the P3
// interface ledger's X23 grant rows): the owner's permission for one artifact to run one MCP tool, the only gate on
// route E (the engine's mcp_call checks nothing) and on route D. Portable: no Node, Electron or `window.maws` here.
//
// A tool is named by the `server` and `tool` names the engine's mcp_status reports (a plugin server's
// `plugin:<plugin>:<server>`, a connector's `claude.ai <name>`), compared exactly. `fingerprint` is the caller's opaque
// identity of the server's configuration and the tool as granted (the spike's scope, transport, command and args or
// URL, never a header value); a call made under another fingerprint is refused until the owner grants again. `read`
// persists until revoked (a read-only tool, which a page may watch); `once` is the owner's Allow once for a tool that
// may write, consumed by the one call it authorizes and never watched.
import * as z from 'zod';

export const CONNECTOR_GRANT_MODES = ['read', 'once'] as const;
export type ConnectorGrantMode = (typeof CONNECTOR_GRANT_MODES)[number];

// Printable and bounded: a name the header shows and a key the store holds, never a control character.
const name = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}]+$/u, 'no control characters');

export const ConnectorToolRefSchema = z.strictObject({ server: name, tool: name });
export type ConnectorToolRef = z.infer<typeof ConnectorToolRefSchema>;

export const ConnectorGrantRequestSchema = z.strictObject({
  server: name,
  tool: name,
  fingerprint: z.string().min(1).max(512),
  mode: z.enum(CONNECTOR_GRANT_MODES),
});
export type ConnectorGrantRequest = z.infer<typeof ConnectorGrantRequestSchema>;

export const ConnectorGrantSchema = z.strictObject({ ...ConnectorGrantRequestSchema.shape, grantedAt: z.number().int().nonnegative() });
export type ConnectorGrant = z.infer<typeof ConnectorGrantSchema>;

// The tool a call would run and the fingerprint it would run under (what the store's authorization checks).
export const ConnectorCallRefSchema = z.strictObject({ server: name, tool: name, fingerprint: ConnectorGrantRequestSchema.shape.fingerprint });
export type ConnectorCallRef = z.infer<typeof ConnectorCallRefSchema>;

// The store's answer to a call (a `once` grant is consumed, durably, before `granted` is answered): `notGranted` when
// the artifact holds no grant for the tool (never granted, revoked, a used Allow once), `fingerprintChanged` when it
// holds one under another fingerprint (the owner re-grants to go on). H3b: `wrongMode` when the caller said which mode
// it expects and the grant is the other one (nothing consumed).
export type ConnectorAuthorization = { granted: true; mode: ConnectorGrantMode } | { granted: false; refusal: 'notGranted' | 'fingerprintChanged' | 'wrongMode' };

// A committed change of one artifact's grant for one tool: `revoked` covers the owner's revoke and the artifact's
// deletion, `consumed` an Allow once used. What a live watch or call under that grant stops on.
export interface ConnectorGrantChange {
  artifactId: string;
  server: string;
  tool: string;
  change: 'granted' | 'revoked' | 'consumed';
}

export const sameConnectorTool = (a: ConnectorToolRef, b: ConnectorToolRef): boolean => a.server === b.server && a.tool === b.tool;

// A map key for a tool, unambiguous for any two names (a separator inside a name cannot make two tools collide).
export const connectorToolKey = (ref: ConnectorToolRef): string => JSON.stringify([ref.server, ref.tool]);

// ── P3-H H3: a page's connector requests and their answers (P3 Decision Log 80; the P3 interface ledger's X9 amendment
// row; P3-E's XE8). Main's broker (src/main/connectors/broker.ts) answers them; a page reaches it only through the
// `ArtifactHost` adapter. A page names a tool and its arguments, never whether the tool is read-only (the route's
// annotations say), a fingerprint (the route reports it) or a grant (the owner's alone). ──

// A watch's refresh interval is clamped to these bounds, and one app runs at most this many watches at once (Claude's
// artifact runtime's values, spikes/p3-connectors/findings.txt §7).
export const CONNECTOR_WATCH_MIN_MS = 30_000;
export const CONNECTOR_WATCH_MAX_MS = 24 * 60 * 60 * 1000;
export const CONNECTOR_WATCH_LIMIT = 64;
export const clampWatchInterval = (ms: number): number => Math.min(CONNECTOR_WATCH_MAX_MS, Math.max(CONNECTOR_WATCH_MIN_MS, Math.round(ms)));

// The most tools one page lease declares, and the size of one call's arguments as JSON.
export const CONNECTOR_DECLARE_LIMIT = 128;
export const CONNECTOR_ARGS_MAX_BYTES = 64 * 1024;

export const ConnectorCallRequestSchema = z.strictObject({ server: name, tool: name, args: z.record(z.string(), z.unknown()).optional() });
export type ConnectorCallRequest = z.infer<typeof ConnectorCallRequestSchema>;

// `intervalMs` is the page's wish; the watch's start answers the clamped interval it runs at.
export const ConnectorWatchRequestSchema = z.strictObject({ ...ConnectorCallRequestSchema.shape, intervalMs: z.number().finite().positive() });
export type ConnectorWatchRequest = z.infer<typeof ConnectorWatchRequestSchema>;

// The owner's grant gesture from the header: the tool and the mode. The fingerprint is the route's, which main takes.
export const ConnectorGrantGestureSchema = z.strictObject({ server: name, tool: name, mode: z.enum(CONNECTOR_GRANT_MODES) });
export type ConnectorGrantGesture = z.infer<typeof ConnectorGrantGestureSchema>;

export type ConnectorRouteName = 'engine' | 'direct';
export interface ConnectorVia {
  route: ConnectorRouteName;
  sessionId?: string; // the live session whose engine ran the call (route E)
}

// A tool's answer as a JSON value (`null` included, never `undefined`): both routes refuse an answer that is not JSON,
// and the wire schemas (src/shared/ipc/schema/connectors.ts) say the same of a success.
export type ConnectorResult = string | number | boolean | null | unknown[] | Record<string, unknown>;

// A call's result: the tool's answer as the route returned it, when main received it, and how it went.
export interface ConnectorCallResult {
  result: ConnectorResult;
  fetchedAt: number;
  via: ConnectorVia;
}

// How a call, or a watch's refresh, ends when it yields no result (P3 Decision Log 84): a state and a reason from a
// closed list, never free text, so no server's or route's error words reach an untrusted page (Decision Log 82's
// boundary; main logs them). Refusals, where nothing was called: `paused` for want of a visible page or a route
// (`hidden`, `closed`, `noRoute` no already-live engine or direct route has the server, `unavailable` the route lost it
// at the call); `revoked` no grant admits it (`notGranted`, `fingerprintChanged` the server or tool changed since the
// owner granted, `wrongMode` a read grant for a tool that may write or an Allow once for a watch, `revoked` the owner
// revoked it or its artifact went while it ran); `invalid` the request cannot be served (`request` malformed, `lease` no
// such page lease of this owner, `undeclared`, `notReadOnly` a watch of, or a read grant for, a tool the route does not
// mark read-only, `watchLimit`). `failed`: it ran, or tried, and failed (`toolError` the tool or the route said so,
// `malformed` the route's answer, `tooLarge` its result, `routeFailed` a route or the grant could not be read).
export const CONNECTOR_REFUSAL_REASONS = {
  paused: ['hidden', 'closed', 'noRoute', 'unavailable'],
  revoked: ['notGranted', 'fingerprintChanged', 'wrongMode', 'revoked'],
  invalid: ['request', 'lease', 'undeclared', 'notReadOnly', 'watchLimit'],
  failed: ['toolError', 'malformed', 'tooLarge', 'routeFailed'],
} as const;
export type ConnectorRefusalState = keyof typeof CONNECTOR_REFUSAL_REASONS;
export type ConnectorRefusal = {
  [S in ConnectorRefusalState]: { ok: false; state: S; reason: (typeof CONNECTOR_REFUSAL_REASONS)[S][number] };
}[ConnectorRefusalState];
export type ConnectorInvalid = Extract<ConnectorRefusal, { state: 'invalid' }>;

export type ConnectorCallOutcome = ({ ok: true } & ConnectorCallResult) | ConnectorRefusal;
export type ConnectorDeclareOutcome = { ok: true; declared: ConnectorToolRef[] } | ConnectorInvalid;
// A watch's start: its id and the interval it runs at. Its refreshes reach its listener as call outcomes.
export type ConnectorWatchStart = { ok: true; watchId: string; intervalMs: number } | ConnectorInvalid;
export type ConnectorGrantOutcome = { ok: true; grant: ConnectorGrant } | ConnectorRefusal;
// ── P3-H H3 end ──

// E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3; E's Decision Log 48): the trusted owner's
// dataset sink beside a page's call or watch (never inside the page's own request): the host validates the result as a
// dashboard dataset's snapshot and publishes it under `id`, answering the publication's metadata in the result's slot
// instead of the tool's answer. `baseRevision` is the revision the caller read the descriptor at; a watch omits it, so
// each refresh takes the host's base at its start.
export const ConnectorDatasetSinkSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .refine((id) => id !== '__proto__', '"__proto__" is reserved'),
  baseRevision: z.number().int().nonnegative().optional(),
});
export type ConnectorDatasetSink = z.infer<typeof ConnectorDatasetSinkSchema>;
export const ConnectorCallOptionsSchema = z.strictObject({ dataset: ConnectorDatasetSinkSchema });
export type ConnectorCallOptions = z.infer<typeof ConnectorCallOptionsSchema>;

// The one budget of a connector operation (moved here from main's route E by the E3 M2 fix, which re-exports it):
// past the host's own bound on an operation (two mcp_status reads of 8 s, the store, mcp_call's 120 s long deadline).
// A dataset refresh's runs from its admission through its route, grant, call and the host's publication, never a new
// budget per phase.
export const CONNECTOR_OPERATION_DEADLINE_MS = 180_000;
// E3 end
