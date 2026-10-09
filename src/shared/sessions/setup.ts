// A setup's phases, outcomes and per-resource results (C10 execution document, Interfaces "Shared shapes", setup.ts):
// what `session.start` answers synchronously (`StartOutcome`) and what streams as `session.setup` afterwards
// (`SetupEvent`). Strict: app shapes. Shared by main (the setup runner) and the renderer (the cards and the status line).
import * as z from 'zod';
import { AppSessionIdSchema, SessionIdSchema } from '../graph/ids';
import { SessionHolderSchema } from '../graph/session';
import { RelayHealthSchema } from '../engine/relay-health';
import { TrustStateSchema } from './trust';

export const SETUP_PHASES = ['worktree', 'trusting', 'launching', 'ready', 'failed'] as const;
export type SetupPhase = (typeof SETUP_PHASES)[number];

// Per-resource outcome of a rollback or a failure, never a single boolean.
export const SetupResourcesSchema = z.strictObject({
  worktree: z
    .strictObject({
      path: z.string(),
      branch: z.string().nullable(),
      createdHere: z.boolean(),
      state: z.enum(['kept', 'removed', 'remove_refused', 'remove_failed']),
      detail: z.string().nullable(),
      branchState: z.enum(['none', 'kept', 'deleted', 'delete_refused', 'delete_failed']), // the branch this attempt created (`none` for an existing branch or worktree); deleted only after a clean removal
    })
    .nullable(),
  record: z.enum(['none', 'kept', 'removed']), // kept: only when the launch wrote a transcript; a provisional record is removed by rollback and by the start-time reconciliation alike
  transcript: z.enum(['none', 'kept']), // rollback never trashes a transcript: only the human's Delete moves one
});
export type SetupResources = z.infer<typeof SetupResourcesSchema>;

const AttachSchema = z.strictObject({ jobId: z.string(), command: z.string() }).nullable();

export const StartOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('starting'), appSessionId: AppSessionIdSchema }), // the guards passed; phases follow as `session.setup`
  z.strictObject({ status: z.literal('needs_trust'), appSessionId: AppSessionIdSchema, trust: TrustStateSchema }), // decision `unanswered` on an untrusted key; nothing created
  z.strictObject({ status: z.literal('relay_unreachable'), appSessionId: AppSessionIdSchema, health: RelayHealthSchema }), // C10's pre-check before any resource; C3's own check may answer the same later as a setup outcome
  z.strictObject({ status: z.literal('held'), appSessionId: AppSessionIdSchema, holder: SessionHolderSchema, attach: AttachSchema }),
  z.strictObject({ status: z.literal('already_live'), appSessionId: AppSessionIdSchema }),
  z.strictObject({ status: z.literal('archived'), appSessionId: AppSessionIdSchema }),
  z.strictObject({ status: z.literal('missing_directory'), appSessionId: AppSessionIdSchema, directory: z.string() }),
  z.strictObject({ status: z.literal('invalid'), appSessionId: AppSessionIdSchema, field: z.string(), message: z.string() }),
  z.strictObject({ status: z.literal('refused'), appSessionId: AppSessionIdSchema, reason: z.enum(['no_engine_session', 'busy', 'unknown_session']), message: z.string() }),
]);
export type StartOutcome = z.infer<typeof StartOutcomeSchema>;

export const SetupEventSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  phase: z.enum(SETUP_PHASES),
  detail: z.string().nullable(),
  outcome: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('ready'), engineSessionId: SessionIdSchema, firstTurn: z.enum(['sent', 'queued', 'none']) }),
      z.strictObject({ kind: z.literal('relay_unreachable'), health: RelayHealthSchema }),
      z.strictObject({ kind: z.literal('held'), holder: SessionHolderSchema, attach: AttachSchema }),
      z.strictObject({ kind: z.literal('error'), message: z.string(), resources: SetupResourcesSchema }),
    ])
    .nullable(),
  // P2-A (2026-10-09): present on the phases of an acquisition's own run, whose end reaches every caller in its
  // `session.acquire` reply (delivered on another transport, in no fixed order with these events): nothing docks a card
  // or tells a failure from a tagged event; phase readers read it as any other
  acquisition: z.literal(true).optional(),
});
export type SetupEvent = z.infer<typeof SetupEventSchema>;

// P2-A start (2026-10-09; X16, the P2 interface ledger §1): what `session.acquire` answers, after the launch it awaited.
// `ready` when the session's engine is ready (`launched`: this acquisition launched it; `joined`: it joined a launch
// already in flight); the guards' card and refusal answers verbatim from `StartOutcome` (its `starting` and
// `already_live` never: the first is not an end, the second is `ready`); `failed`, the setup's error outcome.
const [, needsTrust, relayUnreachable, held, , archived, missingDirectory, invalid, refused] = StartOutcomeSchema.options;
export const AcquireOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ready'), appSessionId: AppSessionIdSchema, launched: z.boolean(), joined: z.boolean() }),
  needsTrust,
  relayUnreachable,
  held,
  archived,
  missingDirectory,
  invalid,
  refused,
  z.strictObject({ status: z.literal('failed'), appSessionId: AppSessionIdSchema, message: z.string(), resources: SetupResourcesSchema }),
]);
export type AcquireOutcome = z.infer<typeof AcquireOutcomeSchema>;
// P2-A end
