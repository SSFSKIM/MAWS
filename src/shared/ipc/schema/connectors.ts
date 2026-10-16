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
import type { CommandSpec } from './common';

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
export const ConnectorCallOutcomeSchema = z.union([z.strictObject({ ok: z.literal(true), result: z.unknown(), fetchedAt: Time, via: ConnectorViaSchema }), ConnectorRefusalSchema]);
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
  z.strictObject({ ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(['unavailable', 'failed', 'tooLarge']), message: Message }),
  z.strictObject({ ok: z.literal(false), failure: z.literal('refused'), refusal: z.enum(CONNECTOR_REFUSAL_REASONS.revoked), message: Message }),
]);
export type ConnectorOperationOutcome = z.infer<typeof ConnectorOperationOutcomeSchema>;

export const ConnectorAuthorizationSchema = z.discriminatedUnion('granted', [
  z.strictObject({ granted: z.literal(true), mode: z.enum(CONNECTOR_GRANT_MODES) }),
  z.strictObject({ granted: z.literal(false), refusal: z.enum(['notGranted', 'fingerprintChanged', 'wrongMode']) }),
]);

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
} as const satisfies Record<`connectors.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  // main's, to the window holding the lease only
  'connectors.watchUpdate': ConnectorWatchUpdateSchema,
  // the engine host's: an operation ended (its outcome waits for `connectors.take`)
  'connectors.operation': z.strictObject({ operationId: OperationId }),
  // the engine host's: a committed grant change (the store's onConnectorGrantChange), the tool and the change alone
  'connectors.grantChanged': ConnectorGrantChangedSchema,
} as const satisfies Record<`connectors.${string}`, z.ZodType>;
