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

// W6 start: what the top bar's usage popover shows beside the accounts, each from one more of ClaudeUsage's files (E1;
// the copy of ClaudeUsage's panel, `PanelView.swift`). Each is null when its file is absent or unreadable.
// gateway.json: the "Route Claude Code through this app" toggle's state, and the relay's port.
export const UsageGatewaySchema = z.strictObject({ routingEnabled: z.boolean(), port: z.number().int().nullable() });
export type UsageGateway = z.infer<typeof UsageGatewaySchema>;
// codex-accounts.json and the per-model codex-pins.<model>.json: the Codex accounts the GPT aliases use. ClaudeUsage
// keeps their limits in memory only, so none are here.
export const CodexAccountUsageSchema = z.strictObject({ accountId: z.string(), email: z.string(), planLabel: z.string().nullable(), needsReauthentication: z.boolean(), pinnedSessionCount: z.number().int().nonnegative() });
export type CodexAccountUsage = z.infer<typeof CodexAccountUsageSchema>;
export const UsageCodexSchema = z.strictObject({
  accounts: z.array(CodexAccountUsageSchema),
  drainTarget: z.string().nullable(), // the account every model's route drains, null when they disagree or none is set
  drainTargetIsManual: z.boolean(),
});
export type UsageCodex = z.infer<typeof UsageCodexSchema>;
// gateway-requests.jsonl, the relay's one line per request: the last ten minutes as ClaudeUsage's panel shows them
// (`TelemetryLedger.activity` and `.health`): per account the requests it served, the share of prompt tokens read from
// the cache and when it last served; and the relay's health line.
export const ACTIVITY_WINDOW_MS = 10 * 60_000;
export const AccountActivitySchema = z.strictObject({ account: z.string(), requests: z.number().int().nonnegative(), cacheHitRatio: z.number().nullable(), lastServed: z.string() });
export type AccountActivity = z.infer<typeof AccountActivitySchema>;
export const GatewayHealthSchema = z.strictObject({
  requests: z.number().int().nonnegative(),
  served: z.number().int().nonnegative(),
  firstByteP50: z.number().nullable(), // seconds
  firstByteP95: z.number().nullable(),
  stalls: z.number().int().nonnegative(), // a silence longer than 10 s
  transportFailures: z.number().int().nonnegative(),
  refused: z.number().int().nonnegative(),
  unreachable: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
});
export type GatewayHealth = z.infer<typeof GatewayHealthSchema>;
export const UsageActivitySchema = z.strictObject({ accounts: z.array(AccountActivitySchema), health: GatewayHealthSchema });
export type UsageActivity = z.infer<typeof UsageActivitySchema>;
// W6 end

export const UsageSnapshotSchema = z.strictObject({
  available: z.boolean(),
  dataDir: z.string(),
  readAt: z.string(),
  error: z.string().nullable(),
  drainTarget: z.string().nullable(),
  drainTargetIsManual: z.boolean(), // C11's ask: pins.json's flag; false when an older file omits it
  accounts: z.array(AccountUsageSchema),
  pinsFor: z.record(z.string(), z.string()), // engine session id → account uuid, for the ids the caller named
  // W6 start
  gateway: UsageGatewaySchema.nullable(),
  codex: UsageCodexSchema.nullable(),
  activity: UsageActivitySchema.nullable(), // as of `readAt`
  // W6 end
});
export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;
