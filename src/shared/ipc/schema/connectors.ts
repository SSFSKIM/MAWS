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
  ConnectorGrantRequestSchema,
  ConnectorGrantSchema,
  ConnectorToolRefSchema,
  type ConnectorRefusalState,
} from '../../artifacts/connectors';
import { AppSessionIdSchema } from '../../graph/ids';
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
export const ConnectorStartSchema = ConnectorSessionToolSchema.extend({
  operationId: OperationId,
  artifactId: ArtifactId,
  arguments: z.record(z.string(), z.unknown()),
  fingerprint: ConnectorGrantRequestSchema.shape.fingerprint,
  mode: z.enum(CONNECTOR_GRANT_MODES),
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
// grant's tool that may write now): the page reads paused/unavailable, the durable grant is left for the owner.
export const DIRECT_REASONS = ['source', 'credential', 'unauthorized', 'connection', 'capacity', 'toolMissing', 'grant', 'store', 'cancelled', 'timeout', 'transport', 'notJson', 'tooLarge', 'changed'] as const;
const Reason = z.enum(DIRECT_REASONS);
export const DirectCredentialSchema = z.strictObject({ connectionId: z.uuid(), credentialEpoch: CredentialEpoch, accessToken: z.string().min(1).max(16_384), expiresAt: Time.optional() });
export const DirectSourceSchema = z.strictObject({
  directory: Directory, // the candidate directory it was observed in (the engine's attested spawn cwd)
  sourceId: SourceId,
  generation: Generation,
  server: ConnectorToolRefSchema.shape.server,
  scope: z.enum(['user', 'local']),
  transport: z.enum(['stdio', 'http']),
  path: z.string().min(1).max(4096), // the config file
  entryPath: z.array(z.string().max(4096)).max(8), // the JSON location in it
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
// first grant-backed one, else the first known one. `toolMissing` where a source is verified but none of these stands.
const DirectToolMetadataSchema = z.union([
  z.strictObject({ fingerprint: ConnectorGrantRequestSchema.shape.fingerprint, readOnly: z.boolean() }),
  z.strictObject({ fingerprint: ConnectorGrantRequestSchema.shape.fingerprint, grantBacked: z.literal(true) }), // P3-HD M3b
]);
export const DirectResolveAnswerSchema = z.discriminatedUnion('ready', [
  z.strictObject({ ready: z.literal(true), source: DirectSourceSchema, tool: DirectToolMetadataSchema.optional() }),
  z.strictObject({ ready: z.literal(false), why: z.enum([...DIRECT_SOURCE_REFUSALS, 'toolMissing']) }),
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
export const DirectOperationOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('resolve'), answer: DirectResolveAnswerSchema }),
  z.strictObject({ kind: z.literal('call'), outcome: DirectCallOutcomeSchema }),
  z.strictObject({ kind: z.literal('discover'), answer: DirectDiscoverAnswerSchema }),
]);
export type DirectSource = z.infer<typeof DirectSourceSchema>;
export type DirectResolveAnswer = z.infer<typeof DirectResolveAnswerSchema>;
export type DirectCallOutcome = z.infer<typeof DirectCallOutcomeSchema>;
export type DirectDiscoverAnswer = z.infer<typeof DirectDiscoverAnswerSchema>;
export type DirectOperationOutcome = z.infer<typeof DirectOperationOutcomeSchema>;
export type DirectReason = (typeof DIRECT_REASONS)[number];
export type DirectToolMetadata = z.infer<typeof DirectToolMetadataSchema>; // P3-HD M3b
export type DirectCredential = z.infer<typeof DirectCredentialSchema>; // P3-HD M3b
const Started = z.strictObject({ operationId: OperationId });
// P3-HD end

const ToolOf = z.strictObject({ artifactId: ArtifactId, ...ConnectorToolRefSchema.shape });
export const ConnectorGrantChangedSchema = z.strictObject({ ...ToolOf.shape, change: z.enum(['granted', 'revoked', 'consumed']) });

const Lease = z.strictObject({ leaseId: LeaseId });
const LeaseWatch = z.strictObject({ leaseId: LeaseId, watchId: WatchId });

export const commands = {
  // ── main's, a page's lease (relayed by its owner window's ArtifactHost adapter) ──
  // A hidden lease on the artifact for the asking window.
  'connectors.open': main(z.strictObject({ artifactId: ArtifactId }), z.strictObject({ leaseId: LeaseId })),
  // `tools`: the page's `{server, tool}` pairs, as it sent them.
  'connectors.declare': main(z.strictObject({ leaseId: LeaseId, tools: z.unknown() }), ConnectorDeclareOutcomeSchema),
  // `request`: the page's `{server, tool, args?}`. Answers once the tool has (no fixed bound: a tool may take minutes).
  'connectors.call': main(z.strictObject({ leaseId: LeaseId, request: z.unknown() }), ConnectorCallOutcomeSchema),
  // `request`: the page's `{server, tool, args?, intervalMs}`; its refreshes arrive as `connectors.watchUpdate`.
  'connectors.watch': main(z.strictObject({ leaseId: LeaseId, request: z.unknown() }), ConnectorWatchStartSchema),
  'connectors.unwatch': main(LeaseWatch, z.strictObject({ stopped: z.boolean() })),
  // The owner's Refresh (after its Start, say): one now, when the watch is visible, granted and idle.
  'connectors.refresh': main(LeaseWatch, z.strictObject({ refreshing: z.boolean() })),
  // The surface shown or hidden: hidden, the lease calls nothing.
  'connectors.visibility': main(z.strictObject({ leaseId: LeaseId, visible: z.boolean() }), z.strictObject({ ok: z.boolean() })),
  'connectors.close': main(Lease, z.strictObject({ closed: z.boolean() })),
  // ── the engine host's, main's alone ──
  'connectors.grants': host(z.strictObject({ artifactId: ArtifactId }), z.strictObject({ grants: z.array(ConnectorGrantSchema) })),
  'connectors.grant': host(z.strictObject({ artifactId: ArtifactId, grant: ConnectorGrantRequestSchema }), z.strictObject({ grant: ConnectorGrantSchema })),
  'connectors.revoke': host(ToolOf, z.strictObject({ revoked: z.boolean() })),
  'connectors.check': host(z.strictObject({ artifactId: ArtifactId, call: ConnectorCallRefSchema }), ConnectorAuthorizationSchema),
  'connectors.resolve': host(ConnectorSessionToolSchema, ConnectorResolveAnswerSchema),
  'connectors.start': host(ConnectorStartSchema, z.strictObject({ operationId: OperationId })),
  // null: no such operation (taken, cancelled, expired, or still running)
  'connectors.take': host(z.strictObject({ operationId: OperationId }), z.strictObject({ outcome: ConnectorOperationOutcomeSchema.nullable() })),
  'connectors.cancel': host(z.strictObject({ operationId: OperationId }), z.strictObject({ cancelled: z.boolean() })),
  // P3-HD start: route D's host half (above); each answers at once, its operation's end is `connectors.directOperation`
  'connectors.directResolve': host(DirectResolveInputSchema, Started),
  'connectors.directStart': host(DirectStartSchema, Started),
  'connectors.directDiscover': host(DirectDiscoverSchema, Started),
  // null: no such operation (taken, cancelled, expired, or still running)
  'connectors.directTake': host(z.strictObject({ operationId: OperationId }), z.strictObject({ outcome: DirectOperationOutcomeSchema.nullable() })),
  'connectors.directCancel': host(z.strictObject({ operationId: OperationId }), z.strictObject({ cancelled: z.boolean() })),
  // A credential withdrawn (its `credentialEpoch`, absent every epoch seen, and every earlier one of `connectionId`, for
  // main's attachment), or with no `connectionId` all direct work: its operations end unannounced and its connections
  // admit no further write before this answers, and a later start at a withdrawn epoch is refused. `cancelled`: ended.
  'connectors.directClose': host(z.strictObject({ connectionId: z.uuid().optional(), credentialEpoch: CredentialEpoch.optional() }), z.strictObject({ cancelled: z.number().int().nonnegative() })),
  // P3-HD end
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
} as const satisfies Record<`connectors.${string}`, z.ZodType>;
