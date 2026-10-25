// X2 `connectors.*` (P3-H H3b; docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log 24, 80, 83, 84
// and 85; the P3 interface ledger's X9 amendment and X23 grant rows): an artifact page's connector calls and watches,
// and route E's engine leg.
//
// Main's, renderer-callable: one page lease per owner window and artifact (`connectors.open`), its declaration, calls,
// watches, visibility and close, answered by main's broker (src/main/connectors). A page's own payload (the tools it
// declares, a call's or a watch's request) crosses as it came, `unknown`, so the broker answers a malformed one with its
// closed `invalid: request` rather than an IPC error. A watch's refreshes reach the owning window alone as
// `connectors.watchUpdate`, never every window.
//
// The engine host's, main's alone (never bridged): the grant store's reads and writes and route E's engine leg. A tool
// call outlives the supervisor's 10 s dispatch bound, so it is three commands and an event: `connectors.start` answers
// at once, `connectors.operation` says (to every window, so with nothing but the id) that an operation ended,
// `connectors.take` hands main its outcome, `connectors.cancel` withdraws it. No server configuration, header or result
// rides an event every window receives (Decision Log 82's boundary).
import * as z from 'zod';
import {
  CONNECTOR_GRANT_MODES,
  CONNECTOR_REFUSAL_REASONS,
  ConnectorCallRefSchema,
  ConnectorDatasetSinkSchema, // E3
  ConnectorGrantRequestSchema,
  ConnectorGrantSchema,
  ConnectorToolRefSchema,
  type ConnectorRefusalState,
} from '../../artifacts/connectors';
import { AppSessionIdSchema } from '../../graph/ids';
import { OperationReceiptSchema } from '../../engine/operations'; // P4-AGG M4
import { isMcpName, isMcpUrl, MCP_TRANSPORTS } from '../../plugins/cli'; // P4-AGG M4
import { PluginsBinarySchema, PluginsCwdSchema, PluginsScopeSchema } from './plugins'; // P4-AGG M4
import { JsonValueSchema, type CommandSpec } from './common';

const main = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'main' as const });
const host = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'engine-host' as const });

const ArtifactId = z.uuid();
const LeaseId = z.uuid();
const WatchId = z.uuid();
const OperationId = z.uuid();
const Time = z.number().int().nonnegative();

// ── what a page reads (P3 Decision Log 84: a state and a closed reason, never a message) ──

const refusalOf = <S extends ConnectorRefusalState>(state: S) => z.strictObject({ ok: z.literal(false), state: z.literal(state), reason: z.enum(CONNECTOR_REFUSAL_REASONS[state]) });
export const ConnectorRefusalSchema = z.union([refusalOf('paused'), refusalOf('revoked'), refusalOf('invalid'), refusalOf('failed')]);
const InvalidSchema = refusalOf('invalid');

export const ConnectorViaSchema = z.strictObject({ route: z.enum(['engine', 'direct']), sessionId: z.string().min(1).max(256).optional() });
export const ConnectorCallOutcomeSchema = z.union([z.strictObject({ ok: z.literal(true), result: JsonValueSchema, fetchedAt: Time, via: ConnectorViaSchema }), ConnectorRefusalSchema]);
export const ConnectorDeclareOutcomeSchema = z.union([z.strictObject({ ok: z.literal(true), declared: z.array(ConnectorToolRefSchema) }), InvalidSchema]);
export const ConnectorWatchStartSchema = z.union([z.strictObject({ ok: z.literal(true), watchId: WatchId, intervalMs: z.number().int().positive() }), InvalidSchema]);
export const ConnectorGrantOutcomeSchema = z.union([z.strictObject({ ok: z.literal(true), grant: ConnectorGrantSchema }), ConnectorRefusalSchema]);

// A watch's refresh, to the window that holds its lease.
export const ConnectorWatchUpdateSchema = z.strictObject({ leaseId: LeaseId, watchId: WatchId, update: ConnectorCallOutcomeSchema });
export type ConnectorWatchUpdate = z.infer<typeof ConnectorWatchUpdateSchema>;

// ── route E's engine leg, main ↔ engine host ──

// A live session's server and tool as the host reads them from that session's mcp_status now: ready with the tool's
// fingerprint (scope, transport, command and args or URL, never a header value) and its `readOnly` annotation, or why
// not. `launchId` and `cwd` are the process and directory main found eligible: another launch, or a session that moved,
// is `notLive`.
export const CONNECTOR_UNREADY = ['notLive', 'unsupported', 'unknown', 'absent', 'notConnected', 'sdk', 'toolMissing', 'collision'] as const;
export const ConnectorSessionToolSchema = z.strictObject({ appSessionId: AppSessionIdSchema, launchId: z.string().min(1).max(256), cwd: z.string().min(1).max(4096), server: ConnectorToolRefSchema.shape.server, tool: ConnectorToolRefSchema.shape.tool });
export const ConnectorResolveAnswerSchema = z.discriminatedUnion('ready', [
  z.strictObject({ ready: z.literal(true), fingerprint: ConnectorGrantRequestSchema.shape.fingerprint, readOnly: z.boolean() }),
  z.strictObject({ ready: z.literal(false), why: z.enum(CONNECTOR_UNREADY) }),
]);
export type ConnectorResolveAnswer = z.infer<typeof ConnectorResolveAnswerSchema>;

// One tool run as main's check admitted it: the grant's `fingerprint` and `mode`, which the host compares with the
// grant again (before an Allow once is consumed) and with the session's mcp_status at the write.
// E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): `dataset`, the trusted sink main forwards from the
// owner's surface (or an agent's refresh request, `requestId`, which the host issued): the host keeps the result, checks
// it against the dataset's query and publishes it as the dataset's snapshot instead of answering it.
export const ConnectorStartSchema = ConnectorSessionToolSchema.extend({
  operationId: OperationId,
  artifactId: ArtifactId,
  arguments: z.record(z.string(), z.unknown()),
  fingerprint: ConnectorGrantRequestSchema.shape.fingerprint,
  mode: z.enum(CONNECTOR_GRANT_MODES),
  dataset: ConnectorDatasetSinkSchema.extend({ requestId: z.uuid().optional() }).optional(), // E3
});

// How an operation ended, for main alone. `refused`: the host's own last check found no grant to admit it (named as the
// page's `revoked` reasons); `unavailable`: the session or its server went; `failed`: the tool or the route said so;
// `tooLarge`: a result over the artifact bound. `message` is for main's log, never a page.
const Message = z.string().max(1_000);
export const ConnectorOperationOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), result: JsonValueSchema }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(['unavailable', 'failed', 'tooLarge']), message: Message }),
  z.strictObject({ ok: z.literal(false), failure: z.literal('refused'), refusal: z.enum(CONNECTOR_REFUSAL_REASONS.revoked), message: Message }),
]);
export type ConnectorOperationOutcome = z.infer<typeof ConnectorOperationOutcomeSchema>;

// E3 start (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3; the architect's M2 correction): a dataset
// operation's take, beside H's nullable outcome, for main alone. Main's first take after the call's end (made only once
// main rechecked that the work may still publish) starts the host's publication: `publishing` while it runs (any later
// take joins it); then its end once: `dataset`, the committed snapshot's compact metadata (never a row), or `failed`
// with nothing new to draw: `stale` the dataset changed or went meanwhile (a descriptor-level conflict, nothing
// written), `revoked` its grant's fence broke before the commit, and `validation`, `toolError` or `timeout` the error
// state recorded in its place, the previous snapshot kept.
export const ConnectorDatasetTakeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('publishing'), operationId: OperationId }),
  z.strictObject({
    status: z.literal('dataset'),
    artifactId: ArtifactId,
    id: ConnectorDatasetSinkSchema.shape.id,
    revision: Time,
    columns: z.array(z.strictObject({ name: z.string(), type: z.string(), mismatches: z.number().int().nonnegative().optional() })),
    rows: z.number().int().nonnegative(),
    warnings: z.array(z.string()).optional(),
  }),
  z.strictObject({ status: z.literal('failed'), reason: z.enum(['stale', 'validation', 'toolError', 'timeout', 'revoked']) }),
]);
export type ConnectorDatasetTake = z.infer<typeof ConnectorDatasetTakeSchema>;
// E3 end

export const ConnectorAuthorizationSchema = z.discriminatedUnion('granted', [
  z.strictObject({ granted: z.literal(true), mode: z.enum(CONNECTOR_GRANT_MODES) }),
  z.strictObject({ granted: z.literal(false), refusal: z.enum(['notGranted', 'fingerprintChanged', 'wrongMode']) }),
]);

// P3-HD start: route D's host half, main ↔ engine host (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// M2; P3 co-work Decision Log 98 and its follow-up). MAWS's own MCP connection runs in the host, beside the grant
// store, so the last check of a call is synchronous with its actual transport write. Every command answers at once:
// a resolution reads a config file, a discovery and a call connect a server, so each is an operation whose end is
// `connectors.directOperation` (its id alone) and whose typed answer main takes with `connectors.directTake`. Answers
// carry closed reasons, never an SDK's, a server's or a file's text, and never a header, env value or token. A
// `credential` is main's transient access token for one verified HTTP resource (M3), never a refresh token or secret.
const Directory = z.string().min(1).max(4096);
const SourceId = z.uuid();
const Generation = z.number().int().positive();
const CredentialEpoch = z.number().int().nonnegative();
// why a server is no verified direct source (./connectors/provenance.ts's refusals)
export const DIRECT_SOURCE_REFUSALS = ['unobserved', 'ambiguous', 'engineOnly', 'unidentified', 'changed', 'unattested', 'unresolved', 'unavailable'] as const;
// why a direct operation did not answer: `source` the verified source no longer stands (`sourceRefusal` says why
// when a lookup said), `credential` its credential was withdrawn (`connectors.directClose`), `unauthorized` the server
// refused it (main marks that credential unusable), `connection` the server could not be started, initialized or
// reached, `capacity` a bound of the host's, `toolMissing` the live tools/list lacks it, `grant` the store's check,
// `store` the store unavailable, `cancelled`/`timeout`, `transport` the exchange failed once started (never resent),
// `notJson`/`tooLarge` the result. P3-HD M3b: `changed`, the live tools/list no longer admits the grant's use (a read
// grant's tool that may write now): the page reads paused/unavailable, the durable grant is left for the owner. P3-HD
// panel correction: `taskRequired`, the live tools/list says the tool requires task execution, which MAWS's own
// connection cannot run (a session's alone); refused before any Allow once is spent.
export const DIRECT_REASONS = ['source', 'credential', 'unauthorized', 'connection', 'capacity', 'toolMissing', 'grant', 'store', 'cancelled', 'timeout', 'transport', 'notJson', 'tooLarge', 'changed', 'taskRequired'] as const;
const Reason = z.enum(DIRECT_REASONS);
export const DirectCredentialSchema = z.strictObject({ connectionId: z.uuid(), credentialEpoch: CredentialEpoch, accessToken: z.string().min(1).max(16_384), expiresAt: Time.optional() });
export const DirectSourceSchema = z.strictObject({
  directory: Directory, // observed source: engine cwd; configured delivery: host-private scope selector
  sourceId: SourceId,
  generation: Generation,
  server: ConnectorToolRefSchema.shape.server,
  scope: z.enum(['user', 'local', 'app']),
  transport: z.enum(['stdio', 'http']),
  path: z.string().min(1).max(4096), // the config file
  entryPath: z.array(z.string().max(4096)).max(8), // JSON location; app settings' unique-name array uses a name= selector
  observedAt: z.iso.datetime(),
  resourceUrl: z.string().min(1).max(8192).optional(), // http: the resource a credential is bound to
});
export const DirectResolveInputSchema = z.strictObject({
  operationId: OperationId,
  artifactId: ArtifactId,
  directories: z.array(Directory).min(1).max(16), // main's canonical candidates, in its order: the first that observed the server decides
  server: ConnectorToolRefSchema.shape.server,
  tool: ConnectorToolRefSchema.shape.tool.optional(), // absent: the source alone (an owner's discovery of a needs-auth server)
});
// With a tool named, ready where tool metadata is known (an agreeing engine report's readOnly annotation, combined
// with the host's own live listing hints; the live tools/list still decides at the call), or, P3-HD M3b (Decision Log
// 18), `grantBacked` where none is known but the artifact's existing grant matches the identified entry's fingerprint:
// no readOnly is invented for it. Main's directories are ranked: the first known candidate the grant matches, else the
// first grant-backed one, else the first known one. `toolMissing` where a source is verified but none of these stands;
// P3-HD panel correction: `taskRequired` where the source's live listing said the tool requires task execution.
const DirectToolMetadataSchema = z.union([
  z.strictObject({ fingerprint: ConnectorGrantRequestSchema.shape.fingerprint, readOnly: z.boolean() }),
  z.strictObject({ fingerprint: ConnectorGrantRequestSchema.shape.fingerprint, grantBacked: z.literal(true) }), // P3-HD M3b
]);
export const DirectResolveAnswerSchema = z.discriminatedUnion('ready', [
  z.strictObject({ ready: z.literal(true), source: DirectSourceSchema, tool: DirectToolMetadataSchema.optional() }),
  z.strictObject({ ready: z.literal(false), why: z.enum([...DIRECT_SOURCE_REFUSALS, 'toolMissing', 'taskRequired']) }),
]);
const DirectSourceRef = { directory: Directory, sourceId: SourceId, generation: Generation, server: ConnectorToolRefSchema.shape.server };
// One tool run under the source a resolution answered and the grant main's check admitted.
export const DirectStartSchema = z.strictObject({
  operationId: OperationId,
  artifactId: ArtifactId,
  ...DirectSourceRef,
  tool: ConnectorToolRefSchema.shape.tool,
  arguments: z.record(z.string(), z.unknown()),
  fingerprint: ConnectorGrantRequestSchema.shape.fingerprint,
  mode: z.enum(CONNECTOR_GRANT_MODES),
  credential: DirectCredentialSchema.optional(),
  dataset: ConnectorStartSchema.shape.dataset, // E3c: the same host-only publication contract
  appSessionId: ConnectorSessionToolSchema.shape.appSessionId.optional(), // E3c: the asking agent, never an engine invented for route D
});
// The owner's discovery (Connect's bootstrap): initialize and tools/list on the source, never tools/call.
export const DirectDiscoverSchema = z.strictObject({ operationId: OperationId, ...DirectSourceRef, credential: DirectCredentialSchema.optional() });
const DirectRefusal = z.strictObject({ ok: z.literal(false), failure: z.literal('refused'), refusal: z.enum(CONNECTOR_REFUSAL_REASONS.revoked), reason: Reason });
export const DirectCallOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), result: JsonValueSchema }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(['unavailable', 'failed', 'tooLarge']), reason: Reason, sourceRefusal: z.enum(DIRECT_SOURCE_REFUSALS).optional() }),
  DirectRefusal,
]);
export const DirectDiscoverAnswerSchema = z.union([
  z.strictObject({ ok: z.literal(true), tools: z.array(z.strictObject({ name: ConnectorToolRefSchema.shape.tool, readOnly: z.boolean() })).max(1_024) }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(['unavailable', 'failed']), reason: Reason, sourceRefusal: z.enum(DIRECT_SOURCE_REFUSALS).optional() }),
]);
// P4-B5 start (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.7, the direct send): the owner's delivery through
// MAWS's own connection, with no session, no model turn and no artifact grant. `directLocate` finds the verified sources
// that can take one tool: every observed server whose agreeing reports list `tool`, or (a server needing sign-in reports
// no tools) whose verified HTTP resource is on one of `urlHosts`; nothing is connected. `directSend` runs that tool once
// on a located source for the owner's gesture in a trusted sheet: no grant is checked or consumed; what admits its
// actual write (synchronously, as a call's) is the operation still registered (not cancelled, not past its deadline),
// the source still verified, the credential's epoch not withdrawn, main's attachment, and the artifact it delivers not
// deleted. Never retried. The live tools/list must show the tool and not require task execution.
const Hostname = z.string().min(1).max(253).regex(/^[a-z0-9.-]+$/);
export const DirectLocateSchema = z.strictObject({ operationId: OperationId, tool: ConnectorToolRefSchema.shape.tool, urlHosts: z.array(Hostname).max(8) });
export const DIRECT_LOCATE_MAX = 16;
export const DirectLocateAnswerSchema = z.strictObject({ sources: z.array(DirectSourceSchema).max(DIRECT_LOCATE_MAX) });
export const DirectSendSchema = z.strictObject({
  operationId: OperationId,
  artifactId: ArtifactId, // the artifact delivered: its deletion stops the send at the write
  ...DirectSourceRef,
  tool: ConnectorToolRefSchema.shape.tool,
  arguments: z.record(z.string(), z.unknown()),
  credential: DirectCredentialSchema.optional(),
});
// P4-B5 end
export const DirectOperationOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resolve'), answer: DirectResolveAnswerSchema }),
  z.strictObject({ kind: z.literal('call'), outcome: DirectCallOutcomeSchema }),
  z.strictObject({ kind: z.literal('discover'), answer: DirectDiscoverAnswerSchema }),
  z.strictObject({ kind: z.literal('locate'), answer: DirectLocateAnswerSchema }), // P4-B5
]);
export type DirectSource = z.infer<typeof DirectSourceSchema>;
export type DirectResolveAnswer = z.infer<typeof DirectResolveAnswerSchema>;
export type DirectCallOutcome = z.infer<typeof DirectCallOutcomeSchema>;
export type DirectDiscoverAnswer = z.infer<typeof DirectDiscoverAnswerSchema>;
export type DirectOperationOutcome = z.infer<typeof DirectOperationOutcomeSchema>;
export type DirectReason = (typeof DIRECT_REASONS)[number];
export type DirectToolMetadata = z.infer<typeof DirectToolMetadataSchema>; // P3-HD M3b
export type DirectCredential = z.infer<typeof DirectCredentialSchema>; // P3-HD M3b
export type DirectLocateAnswer = z.infer<typeof DirectLocateAnswerSchema>; // P4-B5
const Started = z.strictObject({ operationId: OperationId });
// P3-HD end

// P3-HD M3c2 start: the owner's per-server rows in H's Connectors sheet (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md,
// M3 and Decision Log 22, 29, 30 and 33). Trusted owner commands, main's and bridged like H's grant commands, never
// part of the portable page API. A row is an explicit selection of safe fields: the server, its configuration's scope,
// transport and file, the tools selecting it, MAWS's connection state by closed words and a saved connection's opaque
// id. Never a request URL (its query may be a secret), a resource, an issuer, a client, a token or a source id; the
// owner's actions name a row by an opaque `sourceHandle` main revalidates against the artifact's current eligibility.
const SourceHandle = z.uuid();
const ConnectionId = z.uuid();
const ToolName = ConnectorToolRefSchema.shape.tool;
// Why an owner's Connect, Reconnect or discovery did not finish: the flow's, the provider's and the host's closed words,
// and `stale` (the row's tools no longer select that source).
export const CONNECTOR_OWNER_FAILURES = [
  'cancelled', 'timeout', 'network', 'insecure', 'discovery', 'resource', 'issuer', 'unsupported', 'listener', 'registration', 'browser', 'denied', 'state',
  'exchange', 'token', 'rejected', 'transient',
  'busy', 'needsReconnect', 'unavailable', 'notHttp', 'stopped', 'capacity', 'failed',
  'source', 'credential', 'unauthorized', 'connection', 'toolMissing', 'grant', 'store', 'transport', 'notJson', 'tooLarge', 'changed',
  'taskRequired', // P3-HD panel correction
  'stale',
] as const;
export type ConnectorOwnerFailure = (typeof CONNECTOR_OWNER_FAILURES)[number];
const Disconnecting = z.enum(['pending', 'unconfirmed']); // a withdrawn connection's host close unanswered, or answered unconfirmed
// What an owner's last action on the row came to, kept for main's attachment.
const LastAction = z.union([
  // `tools`: how many tools the server listed; `credential`: reached with none (open HTTP, stdio) or MAWS's own sign-in
  z.strictObject({ action: z.enum(['connect', 'reconnect']), ok: z.literal(true), tools: z.number().int().nonnegative().max(1_024), credential: z.enum(['none', 'maws']) }),
  z.strictObject({ action: z.enum(['connect', 'reconnect']), ok: z.literal(false), why: z.enum(CONNECTOR_OWNER_FAILURES) }),
  z.strictObject({ action: z.literal('disconnect'), local: z.enum(['forgotten', 'absent', 'failed']), host: z.enum(['confirmed', 'unconfirmed']), revocation: z.enum(['revoked', 'unsupported', 'failed', 'none']) }),
]);
// An HTTP source's MAWS connection: `none` no MAWS sign-in saved (the entry's own configuration applies); `withdrawn`
// Disconnected or a failed Reconnect, blocked until Connect; `needsConnect` the server refused a request without one;
// `unavailable` the saved connections cannot be read (`store`), one unreadable may be this one's (`unknown`), or two match.
const Connection = z.strictObject({
  state: z.enum(['none', 'connecting', 'connected', 'needsReconnect', 'withdrawn', 'needsConnect', 'unavailable']),
  connectionId: ConnectionId.optional(),
  why: z.enum(['store', 'unknown', 'duplicate']).optional(),
  disconnecting: Disconnecting.optional(),
});
const Origin = { server: ConnectorToolRefSchema.shape.server, scope: z.enum(['user', 'local', 'app']), path: z.string().min(1).max(4096) };
export const ConnectorServerRowSchema = z.discriminatedUnion('kind', [
  // a verified source the declared or granted tools select: HTTP coalesced by its saved identity, stdio by its source
  z.strictObject({
    kind: z.literal('source'),
    handle: SourceHandle,
    ...Origin,
    transport: z.enum(['stdio', 'http']),
    tools: z.array(ToolName).max(256),
    needsDiscovery: z.boolean(), // some tool's metadata is not known yet: Connect lists the server's tools
    connection: Connection.optional(), // HTTP, where MAWS has its own OAuth
    action: z.enum(['connecting', 'reconnecting']).optional(), // an owner's action in flight
    last: LastAction.optional(),
  }),
  // a server these tools name that MAWS cannot reach itself: a session's alone
  z.strictObject({ kind: z.literal('engineOnly'), server: ConnectorToolRefSchema.shape.server, why: z.enum([...DIRECT_SOURCE_REFUSALS, 'toolMissing', 'taskRequired']), tools: z.array(ToolName).max(256) }),
  // a saved MAWS connection of a named server that no current source uses: not usable, Disconnect only
  z.strictObject({ kind: z.literal('saved'), connectionId: ConnectionId, ...Origin, disconnecting: Disconnecting.optional(), last: LastAction.optional() }),
  // a saved MAWS connection that cannot be read: no server or file is invented; Forget only
  z.strictObject({ kind: z.literal('unreadable'), connectionId: ConnectionId, disconnecting: Disconnecting.optional(), last: LastAction.optional() }),
  // a connection already forgotten whose withdrawal the connector process has not confirmed: still visible, retryable
  z.strictObject({ kind: z.literal('retiring'), connectionId: ConnectionId, server: ConnectorToolRefSchema.shape.server.optional(), scope: Origin.scope.optional(), path: Origin.path.optional(), disconnecting: Disconnecting, last: LastAction.optional() }),
]);
export type ConnectorServerRow = z.infer<typeof ConnectorServerRowSchema>;
export const ConnectorServersSchema = z.strictObject({
  servers: z.array(ConnectorServerRowSchema).max(1_024),
  saved: z.enum(['ok', 'unavailable']), // whether MAWS could read its saved connections at all
  // Decision Log 33: an unreadable saved connection was forgotten, so until MAWS relaunches no HTTP server without its
  // own MAWS sign-in is used automatically (an explicit Connect still can)
  withdrawnUnattributed: z.boolean(),
});
export type ConnectorServers = z.infer<typeof ConnectorServersSchema>;
// An owner action acknowledged at once; its end is `connectors.serversChanged`, and the rows are read again.
export const ConnectorOwnerAckSchema = z.union([z.strictObject({ accepted: z.literal(true) }), z.strictObject({ accepted: z.literal(false), why: z.enum(['stale', 'busy', 'capacity', 'stopped']) })]);
export type ConnectorOwnerAck = z.infer<typeof ConnectorOwnerAckSchema>;
const OwnerSource = z.strictObject({ artifactId: ArtifactId, sourceHandle: SourceHandle });
// P3-HD M3c2 end

const ToolOf = z.strictObject({ artifactId: ArtifactId, ...ConnectorToolRefSchema.shape });
export const ConnectorGrantChangedSchema = z.strictObject({ ...ToolOf.shape, change: z.enum(['granted', 'revoked', 'consumed']) });

// P4-AGG M4 start (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Interfaces "Connector commands"):
// Customize › Connectors. `connectors.add` and `connectors.remove` are the engine host's plugin runner running the
// engine's own `claude mcp add|remove` in the page's directory, operations completing on `plugins.operation` like a
// plugin verb; like a plugin mutation, each names the binary its sheet showed (`plugins.env`'s), so a binary changed in
// Settings › Engine meanwhile runs nothing. Renderer-callable, the two engine-host commands of this namespace a window
// reaches. `connectors.signIn` is main's operation over the engine's own MCP sign-in in one ready session: a receipt at
// once, its progress as `connectors.signInChanged`, which carries the server's name and the state alone (never the
// authorization URL, a code or a token).
export const McpServerNameSchema = z.string().max(128).refine(isMcpName, 'letters, digits, hyphens and underscores (the engine\'s rule for a server name)');
export const McpServerUrlSchema = z.string().max(4096).refine(isMcpUrl, 'an http or https URL');
const McpAt = { cwd: PluginsCwdSchema, binary: PluginsBinarySchema, name: McpServerNameSchema, scope: PluginsScopeSchema };
export const CONNECTOR_SIGN_IN_STATES = ['starting', 'waiting_browser', 'waiting_callback', 'watching_status', 'submitting', 'done', 'failed', 'cancelled'] as const;
// A `done` whose message is this: the session had the server connected before anything started, so no flow ran (fixB
// scalpel-2#3); the row says so rather than that a sign-in happened.
export const CONNECTOR_ALREADY_CONNECTED = 'already connected';
export const CONNECTOR_SIGN_IN_REASONS = ['no_session', 'timeout', 'denied', 'engine', 'session_exited', 'other_entry'] as const; // other_entry: the session uses another entry of the name (its words in `message`)
export const ConnectorSignInChangedSchema = z.strictObject({
  opId: z.string(),
  name: McpServerNameSchema,
  state: z.enum(CONNECTOR_SIGN_IN_STATES),
  reason: z.enum(CONNECTOR_SIGN_IN_REASONS).nullable(), // failed only
  message: z.string().max(2000).nullable(), // the engine's words, when it gave some
  // done only (Decision Log 14): the signing session's mcp_status lists the server connected ('here'), else the credential
  // serves the sessions started from now ('new_sessions')
  where: z.enum(['here', 'new_sessions']).nullable(),
});
export type ConnectorSignInChanged = z.infer<typeof ConnectorSignInChangedSchema>;
// P4-AGG M4 end

const Lease = z.strictObject({ leaseId: LeaseId });
const LeaseWatch = z.strictObject({ leaseId: LeaseId, watchId: WatchId });

export const commands = {
  // ── main's, a page's lease (relayed by its owner window's ArtifactHost adapter) ──
  // A hidden lease on the artifact for the asking window.
  'connectors.open': main(z.strictObject({ artifactId: ArtifactId }), z.strictObject({ leaseId: LeaseId })),
  // `tools`: the page's `{server, tool}` pairs, as it sent them.
  'connectors.declare': main(z.strictObject({ leaseId: LeaseId, tools: z.unknown() }), ConnectorDeclareOutcomeSchema),
  // `request`: the page's `{server, tool, args?}`. Answers once the tool has (no fixed bound: a tool may take minutes).
  // E3: `dataset`, the trusted owner's sink beside the request (never the page's): the result becomes the dataset's
  // snapshot in the host, and the outcome's `result` is the publication's metadata.
  'connectors.call': main(z.strictObject({ leaseId: LeaseId, request: z.unknown(), dataset: ConnectorDatasetSinkSchema.optional() /* E3 */ }), ConnectorCallOutcomeSchema),
  // `request`: the page's `{server, tool, args?, intervalMs}`; its refreshes arrive as `connectors.watchUpdate`.
  'connectors.watch': main(z.strictObject({ leaseId: LeaseId, request: z.unknown(), dataset: ConnectorDatasetSinkSchema.optional() /* E3 */ }), ConnectorWatchStartSchema),
  'connectors.unwatch': main(LeaseWatch, z.strictObject({ stopped: z.boolean() })),
  // The owner's Refresh (after its Start, say): one now, when the watch is visible, granted and idle.
  // E3 panel (Decision Log 17): `probe`, the trusted owner's liveness check of its dataset watch: `refreshing` then says
  // whether that watch lives, and nothing is woken, checked, called or rescheduled.
  'connectors.refresh': main(z.strictObject({ ...LeaseWatch.shape, probe: z.boolean().optional() /* E3 panel */ }), z.strictObject({ refreshing: z.boolean() })),
  // The surface shown or hidden: hidden, the lease calls nothing.
  'connectors.visibility': main(z.strictObject({ leaseId: LeaseId, visible: z.boolean() }), z.strictObject({ ok: z.boolean() })),
  'connectors.close': main(Lease, z.strictObject({ closed: z.boolean() })),
  // P3-HD M3c2 start: the owner's, from the Connectors sheet (main's, bridged; no page reaches them)
  // The rows for the artifact's declared `tools` and its durable grants; bounded by main.
  'connectors.servers': main(z.strictObject({ artifactId: ArtifactId, tools: z.array(ConnectorToolRefSchema).max(256) }), ConnectorServersSchema),
  'connectors.connect': main(OwnerSource, ConnectorOwnerAckSchema),
  'connectors.reconnect': main(OwnerSource, ConnectorOwnerAckSchema), // an explicit replacement: the old sign-in is withdrawn first
  'connectors.disconnect': main(z.strictObject({ connectionId: ConnectionId }), ConnectorOwnerAckSchema), // MAWS's own only; no current source needed
  // P3-HD M3c2 end
  // P4-AGG M4 start: Customize › Connectors (above)
  'connectors.add': host(z.strictObject({ ...McpAt, url: McpServerUrlSchema, transport: z.enum(MCP_TRANSPORTS) }), OperationReceiptSchema),
  'connectors.remove': host(z.strictObject(McpAt), OperationReceiptSchema),
  // the connector is its configuration (name, scope, and the directory for a project or local one): one sign-in at a time
  'connectors.signIn': main(z.strictObject({ name: McpServerNameSchema, scope: PluginsScopeSchema, cwd: PluginsCwdSchema.nullable(), path: PluginsCwdSchema, appSessionId: AppSessionIdSchema }), OperationReceiptSchema), // path: the file the entry is in
  'connectors.signInCancel': main(z.strictObject({ opId: z.string() }), z.strictObject({ cancelled: z.boolean() })),
  // P4-AGG M4 end
  // ── the engine host's, main's alone ──
  'connectors.grants': host(z.strictObject({ artifactId: ArtifactId }), z.strictObject({ grants: z.array(ConnectorGrantSchema) })),
  'connectors.grant': host(z.strictObject({ artifactId: ArtifactId, grant: ConnectorGrantRequestSchema }), z.strictObject({ grant: ConnectorGrantSchema })),
  'connectors.revoke': host(ToolOf, z.strictObject({ revoked: z.boolean() })),
  'connectors.check': host(z.strictObject({ artifactId: ArtifactId, call: ConnectorCallRefSchema }), ConnectorAuthorizationSchema),
  'connectors.resolve': host(ConnectorSessionToolSchema, ConnectorResolveAnswerSchema),
  'connectors.start': host(ConnectorStartSchema, z.strictObject({ operationId: OperationId })),
  // null: no such operation (taken, cancelled, expired, or still running). E3: `dataset`, a dataset operation's phase
  // or end (its `outcome` then null); a dataset operation that ended before its call (refused, unavailable) answers
  // its `outcome` as H's do.
  'connectors.take': host(
    z.strictObject({ operationId: OperationId }),
    z
      .strictObject({ outcome: ConnectorOperationOutcomeSchema.nullable(), dataset: ConnectorDatasetTakeSchema.optional() /* E3 */ })
      .refine((taken) => taken.dataset === undefined || taken.outcome === null, 'a dataset phase comes with a null outcome'), // E3 M2 residual
  ),
  'connectors.cancel': host(z.strictObject({ operationId: OperationId }), z.strictObject({ cancelled: z.boolean() })),
  // P3-HD start: route D's host half (above); each answers at once, its operation's end is `connectors.directOperation`
  'connectors.directResolve': host(DirectResolveInputSchema, Started),
  'connectors.directStart': host(DirectStartSchema, Started),
  'connectors.directDiscover': host(DirectDiscoverSchema, Started),
  // null: no such operation (taken, cancelled, expired, or still running)
  'connectors.directTake': host(z.strictObject({ operationId: OperationId }), z.strictObject({ outcome: DirectOperationOutcomeSchema.nullable(), dataset: ConnectorDatasetTakeSchema.optional() }).refine((taken) => taken.dataset === undefined || taken.outcome === null, 'a dataset phase comes with a null outcome')),
  'connectors.directCancel': host(z.strictObject({ operationId: OperationId }), z.strictObject({ cancelled: z.boolean() })),
  // A credential withdrawn (its `credentialEpoch`, absent every epoch seen, and every earlier one of `connectionId`, for
  // main's attachment), or with no `connectionId` all direct work: its operations end unannounced and its connections
  // admit no further write before this answers, and a later start at a withdrawn epoch is refused. `cancelled`: ended.
  'connectors.directClose': host(z.strictObject({ connectionId: z.uuid().optional(), credentialEpoch: CredentialEpoch.optional() }), z.strictObject({ cancelled: z.number().int().nonnegative() })),
  // P3-HD end
  // P4-B5 start: the owner's delivery (above), each an operation answered at once like route D's; and route E's
  // observation alone: one live session's mcp_status read now, so route D's cache knows what that engine reports (no
  // tool, no probe, nothing acquired). `observed`: the report landed in the cache.
  'connectors.directLocate': host(DirectLocateSchema, Started),
  'connectors.directSend': host(DirectSendSchema, Started),
  'connectors.observe': host(ConnectorSessionToolSchema.pick({ appSessionId: true, launchId: true, cwd: true }), z.strictObject({ observed: z.boolean() })),
  // P4-B5 end
} as const satisfies Record<`connectors.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  // main's, to the window holding the lease only
  'connectors.watchUpdate': ConnectorWatchUpdateSchema,
  // the engine host's: an operation ended (its outcome waits for `connectors.take`)
  'connectors.operation': z.strictObject({ operationId: OperationId }),
  // the engine host's: a committed grant change (the store's onConnectorGrantChange), the tool and the change alone
  'connectors.grantChanged': ConnectorGrantChangedSchema,
  // P3-HD: the engine host's: a direct operation ended (its answer waits for `connectors.directTake`)
  'connectors.directOperation': z.strictObject({ operationId: OperationId }),
  // P3-HD M3c2: main's, to the windows that read the artifact's server rows: they changed (read them again); nothing else
  'connectors.serversChanged': z.strictObject({ artifactId: ArtifactId }),
  // P4-AGG M4: main's, to every window: a sign-in operation moved
  'connectors.signInChanged': ConnectorSignInChangedSchema,
} as const satisfies Record<`connectors.${string}`, z.ZodType>;
