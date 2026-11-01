// P3-H H3a: what main's connector broker (./broker.ts) is given to work with (docs/doperpowers/plans/2026-10-12-p3-co-work.md,
// P3-H and Decision Log 24, 80 and 83). A route is a way to run an MCP tool that is already there: route E an
// eligible live session's engine (`mcp_call`), route D MAWS's own client of a direct-capable server. The broker asks a
// route only to find what is already live and to call it, so no route API can start a session, keep an engine alive or
// connect a server for a timer (X16). The grant authority is the host's artifact store (H2): the owner's grants and a
// check that consumes nothing. Both are trusted main-side code, but what a route answers crosses into the broker
// unchecked by any type, so the broker reads it through `readTarget` and `readAnswer` here.
import * as z from 'zod';
import type { ConnectorAuthorization, ConnectorCallRef, ConnectorGrant, ConnectorGrantMode, ConnectorGrantRequest, ConnectorResult, ConnectorRouteName, ConnectorToolRef } from '@shared/artifacts/connectors';
import { ConnectorGrantRequestSchema } from '@shared/artifacts/connectors';
import { JsonValueSchema } from '@shared/ipc/schema';
import { ARTIFACT_MAX_BYTES } from '@shared/maws/tools';

export interface ConnectorGrantAuthority {
  list(artifactId: string): Promise<ConnectorGrant[]>;
  grant(artifactId: string, request: ConnectorGrantRequest): Promise<ConnectorGrant>;
  revoke(artifactId: string, tool: ConnectorToolRef): Promise<boolean>;
  // Whether the artifact's grant admits `call` now, consuming nothing (H2's `checkConnectorCall`).
  check(artifactId: string, call: ConnectorCallRef): Promise<ConnectorAuthorization>;
}

export interface ConnectorRoute {
  readonly route: ConnectorRouteName;
  // The already-available target that runs `tool` for `artifactId` (route E: the artifact's eligible live session whose
  // mcp_status has the server connected, Decision Log 83), or null when there is none. Never acquires anything.
  resolve(artifactId: string, tool: ConnectorToolRef, signal: AbortSignal): Promise<ConnectorRouteTarget | null>;
}

export interface ConnectorRouteTarget {
  // The route's identity of the server's configuration and the tool, compared with the grant's on every call.
  fingerprint: string;
  // The route's annotations (route E's `readOnly`, route D's `readOnlyHint`): only a read-only tool is watched or held
  // under a persistent grant.
  readOnly: boolean;
  // P3-HD M3b (route D, Decision Log 18): no tool metadata is known, but the artifact's existing grant matches the
  // identified entry's fingerprint. `readOnly` is then false (never a fabricated read-only fact); the broker's own fresh
  // check's mode decides what the existing grant admits, a new grant is never made from it, and the route's live
  // listing proves the tool again before anything is consumed or written.
  grantBacked?: true;
  sessionId?: string; // route E: the session whose engine would run the call
  // Runs the tool. `fingerprint` and `mode` are what main's check admitted, for the route's own last check just before
  // it writes the call (the host's `authorizeConnectorCall`, which takes an Allow once's use); `signal` aborts it.
  call(args: Record<string, unknown>, context: ConnectorRouteCallContext): Promise<ConnectorRouteAnswer>;
}

export interface ConnectorRouteCallContext {
  appSessionId?: string; // E3c: the asking session for a direct dataset refresh
  signal: AbortSignal;
  fingerprint: string;
  mode: ConnectorGrantMode;
  // E3 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the trusted dataset sink. The route's backend
  // keeps the result and publishes it as the dataset's snapshot, answering the publication's metadata as `result`;
  // `requestId` names an agent's refresh request (the host issued it), never a page's. `publishable` is main's
  // synchronous recheck that the work may still publish (the native window read now for a page, the request not ended
  // for an agent): the route asks it in the same turn as each step that would let the backend publish, and withdraws the
  // work when it answers false. E3 M2 residual: once dispatched, a dataset call is not raced against `signal` by the
  // broker: the route settles it when the signal aborts, as nothing published when its backend's cancel won, else with
  // the publication's durable end (the host owns that end once its commit is admitted).
  dataset?: { id: string; baseRevision?: number; requestId?: string };
  publishable?: () => boolean;
  // P3-F F-connectors 6: main's synchronous admission recheck (the page's native window re-read now, the work not
  // aborted). A route that awaits anything of its own after main's door (route D's credential preparation) asks it in
  // the same turn as the write that dispatches the call, and sends nothing when it answers false.
  admit?: () => boolean;
}

// `unavailable`: the route no longer has the server (not connected, the engine gone, needs authentication); `failed`:
// the tool or the route failed otherwise. `message` is for main's log (and the owner's header), never the page.
// P3-H H3b: `refused`, the route's own last check before the write found no grant to admit the call as main's check did
// (route E's host: the grant revoked, re-granted under another mode or fingerprint, or the server's identity changed),
// named by the page's `revoked` reasons; `tooLarge`, a result the route would not carry over the artifact bound.
export type ConnectorRouteRefusal = 'notGranted' | 'fingerprintChanged' | 'wrongMode' | 'revoked';
export type ConnectorRouteAnswer =
  | { ok: true; result: ConnectorResult }
  | { ok: false; failure: 'unavailable' | 'failed' | 'tooLarge'; message: string }
  | { ok: false; failure: 'refused'; refusal: ConnectorRouteRefusal; message: string };

// A result larger than an artifact cannot become one (P3-E's dataset snapshot), so it is refused here rather than later.
export const CONNECTOR_RESULT_MAX_BYTES = ARTIFACT_MAX_BYTES;
const MESSAGE_MAX_LENGTH = 1_000;

const TargetSchema = z
  .object({
    fingerprint: ConnectorGrantRequestSchema.shape.fingerprint,
    readOnly: z.boolean(),
    grantBacked: z.literal(true).optional(), // P3-HD M3b
    sessionId: z.string().min(1).max(256).optional(),
    call: z.custom<ConnectorRouteTarget['call']>((value) => typeof value === 'function'),
  })
  .refine((target) => !(target.grantBacked && target.readOnly)); // P3-HD M3b: a grant-backed target claims no read-only

const AnswerSchema = z.union([
  z.object({ ok: z.literal(true), result: JsonValueSchema }),
  z.object({ ok: z.literal(false), failure: z.enum(['unavailable', 'failed', 'tooLarge']), message: z.string() }),
  z.object({ ok: z.literal(false), failure: z.literal('refused'), refusal: z.enum(['notGranted', 'fingerprintChanged', 'wrongMode', 'revoked']), message: z.string() }), // P3-H H3b
]);

// The route's target itself when it is well formed (not the schema's copy: its `call` may be a method of it), else null.
export function readTarget(value: unknown): ConnectorRouteTarget | null {
  return TargetSchema.safeParse(value).success ? (value as ConnectorRouteTarget) : null;
}

// The route's answer, or why it cannot be taken: `malformed` (the wrong shape, or a result that is not JSON at any depth) or
// `tooLarge` (a result over CONNECTOR_RESULT_MAX_BYTES as JSON).
export function readAnswer(value: unknown): ConnectorRouteAnswer | 'malformed' | 'tooLarge' {
  const parsed = AnswerSchema.safeParse(value);
  if (!parsed.success) return 'malformed';
  const answer = parsed.data;
  if (!answer.ok) return { ...answer, message: answer.message.slice(0, MESSAGE_MAX_LENGTH) };
  const bytes = jsonBytes(answer.result);
  if (bytes === null) return 'malformed';
  return bytes <= CONNECTOR_RESULT_MAX_BYTES ? { ok: true, result: answer.result } : 'tooLarge';
}

// The size of `value` as JSON, or null when it is not JSON (undefined, a bigint, a cycle).
export function jsonBytes(value: unknown): number | null {
  try {
    const text = JSON.stringify(value) as string | undefined;
    return text === undefined ? null : Buffer.byteLength(text);
  } catch {
    return null;
  }
}

export const boundedMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, MESSAGE_MAX_LENGTH);
