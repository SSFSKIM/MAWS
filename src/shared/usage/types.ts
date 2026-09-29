// The account usage MAWS reads from ClaudeUsage's own files (C7 execution document, Interfaces "Status line popovers and
// usage"; charter D-17, D-19): one shared read in main for every session, `settings.usage` and `settings.usageChanged`.
// A window is one rate-limit window of one Claude account as ClaudeUsage last recorded it.
import * as z from 'zod';

export const UsageWindowSchema = z.strictObject({ percent: z.number(), resetsAt: z.string(), recordedAt: z.string() });
export type UsageWindow = z.infer<typeof UsageWindowSchema>;

export const AccountUsageSchema = z.strictObject({
  uuid: z.string(),
  email: z.string(),
  displayName: z.string(),
  planLabel: z.string().nullable(),
  rateLimitTier: z.string().nullable(),
  needsReauthentication: z.boolean(),
  lastSeenActive: z.string().nullable(),
  pinnedSessionCount: z.number().int().nonnegative(), // C11's ask: the pins entries whose accountUUID is this account's
  credentialOwnership: z.enum(['legacy', 'appManaged']).nullable(), // C11's ask: accounts.json's field; null when absent
  // fiveHour: limitKey `session`; sevenDay: `weekly_all`; scoped: each `weekly_scoped#<Model>`
  windows: z.strictObject({ fiveHour: UsageWindowSchema.nullable(), sevenDay: UsageWindowSchema.nullable(), scoped: z.array(z.strictObject({ model: z.string(), window: UsageWindowSchema })) }),
});
export type AccountUsage = z.infer<typeof AccountUsageSchema>;

export const UsageSnapshotSchema = z.strictObject({
  available: z.boolean(),
  dataDir: z.string(),
  readAt: z.string(),
  error: z.string().nullable(),
  drainTarget: z.string().nullable(),
  drainTargetIsManual: z.boolean(), // C11's ask: pins.json's flag; false when an older file omits it
  accounts: z.array(AccountUsageSchema),
  pinsFor: z.record(z.string(), z.string()), // engine session id → account uuid, for the ids the caller named
});
export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;
