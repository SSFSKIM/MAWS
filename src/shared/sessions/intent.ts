// The setup intent (C10 execution document, Terms "Setup intent", Interfaces "Shared shapes", intent.ts): the persisted
// description of a session that has not been launched yet, kept under its allocated `appSessionId` until the session
// is identity-bound, with the per-attempt `progress` a retry reuses and a restart reconciles. Strict: app shapes.
//
// The draft shape is C4's `Draft` (src/shared/ipc/schema/session.ts), restated here rather than imported: the X2
// module imports this one for the C10 block's `session.intent.*` shapes, and a back-import would make the two
// modules a cycle whose evaluation order decides whether a schema is still in its temporal dead zone. `intent.test-d.ts`
// pins the two types equal, so a change to C4's draft fails the typecheck here.
import * as z from 'zod';
import { PermissionModeSchema } from '../graph/enums';
import { ContentBlockSchema } from '../graph/events';
import { AppSessionIdSchema, MessageUuidSchema, ProjectIdSchema, SessionIdSchema } from '../graph/ids';
import { EffortSchema } from '../engine/launch-spec';
import { SETUP_PHASES, SetupResourcesSchema } from './setup';

export const SetupDraftSchema = z.strictObject({
  doc: z.unknown(),
  attachments: z.array(z.strictObject({ path: z.string(), kind: z.string() })),
  updatedAt: z.string(),
});

export const BranchChoiceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('new'), name: z.string(), base: z.string() }), // base: 'HEAD', a local branch, or a typed ref; resolved by `git.worktree.add`
  z.strictObject({ kind: z.literal('existing'), name: z.string() }),
]);
export type BranchChoice = z.infer<typeof BranchChoiceSchema>;

export const LocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('directory'), path: z.string() }), // realpathed by the service
  z.strictObject({ kind: z.literal('newWorktree'), repoRoot: z.string(), name: z.string(), branch: BranchChoiceSchema }),
  z.strictObject({ kind: z.literal('existingWorktree'), repoRoot: z.string(), path: z.string() }),
]);
export type Location = z.infer<typeof LocationSchema>;

export const TrustDecisionSchema = z.enum(['unanswered', 'accepted', 'declined']); // the tri-state; only `accepted` attests
export type TrustDecision = z.infer<typeof TrustDecisionSchema>;

export const FirstMessageSchema = z.strictObject({ content: z.union([z.string(), z.array(ContentBlockSchema)]), display: z.string() }); // C7's `start` argument, verbatim
export type FirstMessage = z.infer<typeof FirstMessageSchema>;

export const SetupIntentSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  projectId: ProjectIdSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  kind: z.enum(['create', 'fork']),
  source: z.strictObject({ appSessionId: AppSessionIdSchema, engineSessionId: SessionIdSchema, rewindTo: MessageUuidSchema.nullable() }).nullable(), // fork only; rewindTo from C7's resubmit seam
  location: LocationSchema,
  additionalDirectories: z.array(z.string()),
  model: z.string().nullable(), // null = engine default / settings
  effort: EffortSchema.nullable(),
  permissionMode: PermissionModeSchema.nullable(),
  gateway: z.enum(['gateway', 'direct']), // D-19 default 'gateway'
  trust: TrustDecisionSchema,
  trustKey: z.string().nullable(), // the trust key the decision answered (null while `unanswered`)
  message: FirstMessageSchema.nullable(), // retained from `start` until the handoff or a hand-back
  draft: SetupDraftSchema.nullable(), // C4's `Draft`, held here while unstarted; never touched by a start, a rejection or a hand-back
  progress: z.strictObject({
    engineSessionId: SessionIdSchema.nullable(), // the id pinned for the real launch, minted at the first attempt and kept across retries
    worktree: z.strictObject({ path: z.string(), branch: z.string().nullable(), head: z.string(), createdHere: z.boolean() }).nullable(),
    trustRecorded: z.boolean(), // the bootstrap confirmed `workspace_trust_recorded: true` for `trustKey`
    bootstrap: z.strictObject({ appSessionId: AppSessionIdSchema, at: z.string() }).nullable(), // the bootstrap id in flight or not yet forgotten
    launch: z.strictObject({ launchId: z.string(), at: z.string() }).nullable(), // C3 accepted the real launch: the pin may be in use from here on
    send: z
      .strictObject({ queueId: z.string(), messageUuid: MessageUuidSchema.nullable(), disposition: z.enum(['sent', 'queued']), at: z.string() })
      .nullable(), // the handoff: from here the message is C3's and is never sent again
    lastFailure: z.strictObject({ at: z.string(), phase: z.enum(SETUP_PHASES), message: z.string(), resources: SetupResourcesSchema }).nullable(),
  }),
});
export type SetupIntent = z.infer<typeof SetupIntentSchema>;

// `message` and `progress` are never patched from the renderer: `session.start` sets the message,
// `session.intent.release` clears it, the setup owns `progress`.
export const SetupIntentPatchSchema = SetupIntentSchema.pick({
  location: true,
  additionalDirectories: true,
  model: true,
  effort: true,
  permissionMode: true,
  gateway: true,
  trust: true,
  draft: true,
}).partial();
export type SetupIntentPatch = z.infer<typeof SetupIntentPatchSchema>;

export const ForkTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('inPlace') }),
  z.strictObject({ kind: z.literal('newWorktree'), name: z.string(), branch: BranchChoiceSchema }),
]);
export type ForkTarget = z.infer<typeof ForkTargetSchema>;
