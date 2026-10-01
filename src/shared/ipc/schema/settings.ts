// X2 `settings.*`: the persisted app settings and the theme resolved from them (charter §12 C1 *Theme switching*).
// Version 2 (C5): the keymap overrides and the notification policy. Version 3 (C11): the engine binary, the gateway
// policy, the near-limit threshold, the monospace font and the per-kind notification switches. Version 4 (C12): the
// memory budget. Version 5 (W2): the transcript's width. Migrations live in `src/shared/settings/defaults.ts`, run by
// main's store; the schema never defaults.
import * as z from 'zod';
import { ACTION_IDS } from '../../keymap/actions';
import { CHORD_PATTERN } from '../../keymap/chord';
import type { CommandSpec } from './common';
// W3 start
import { EffortSchema } from '../../engine/launch-spec';
import { PermissionModeSchema } from '../../graph/enums';
// W3 end
// C7 start
import { UsageSnapshotSchema } from '../../usage/types';
// C7 end

export const ThemeSettingSchema = z.enum(['light', 'dark', 'system']);
export type ThemeSetting = z.infer<typeof ThemeSettingSchema>;

export const ChordSchema = z.string().regex(CHORD_PATTERN); // Electron accelerator syntax, readable by parseChord

// C11 start: the sections version 3 adds (C11 execution document, Interfaces "Settings, version 3").
// The groups C5's notifier maps X1's attention kinds to (src/main/attention/notifier.ts GROUP): approvals = permission,
// dialog, elicitation; questions = question; planReviews = plan; errors = error, interrupted, auto_mode_unavailable;
// heldPeerMessages = held_peer_message (not actionable, so it never notifies in P0).
export const NotificationKindsSchema = z.strictObject({ approvals: z.boolean(), questions: z.boolean(), planReviews: z.boolean(), errors: z.boolean(), heldPeerMessages: z.boolean() });
export type NotificationKinds = z.infer<typeof NotificationKindsSchema>;
// An engine binary is named by absolute path, never resolved through PATH (§4.1); macOS paths only.
export const AbsolutePathSchema = z.string().refine((path) => path.startsWith('/'), { message: 'must be an absolute path' });
const EngineSettingsSchema = z.strictObject({
  binaryPath: AbsolutePathSchema.nullable(), // null = C3's ENGINE_BIN
  pinnedVersion: z.string(), // what engine.binaryInfo must report; a mismatch refuses launches (binary_version) until re-pinned
  subagentModel: z.string().nullable(), // the default CLAUDE_CODE_SUBAGENT_MODEL for new sessions; null = the captured shell's value
  // C12 start: version 4, the memory budget (C12 execution document, Interfaces "Settings, version 4"; charter §4.4).
  // memoryBudgetMiB: the limit on the sum of the engine process trees; null = 25% of physical memory.
  // statefulMcpServers: MCP server names, exactly as system/init reports them, whose state dies with their process; a
  // connected or connecting one keeps its session live under the budget.
  memoryBudgetMiB: z.number().int().min(512).nullable(),
  statefulMcpServers: z.array(z.string().min(1).max(200)).max(64),
  // C12 end
});
const GatewaySettingsSchema = z.strictObject({
  defaultRoute: z.enum(['gateway', 'direct']), // D-19: 'gateway'; seeds C10's intent.gateway
  relayUnreachable: z.enum(['ask', 'wait', 'direct']), // the launch policy C10's session.start consults
  offerDirect: z.boolean(), // the per-session Direct option; D-19's fallback stays when the relay is unreachable
});
const UsageSettingsSchema = z.strictObject({ nearLimitPercent: z.number().int().min(50).max(100) }); // C7's banner threshold
// W2: Claude Desktop's three transcript widths (charter §6 as amended 2026-10-01): the column the transcript and the
// composer share, set on the root as --measure.
export const TRANSCRIPT_WIDTHS = [768, 960, 1280] as const;
export const TranscriptWidthSchema = z.union([z.literal(768), z.literal(960), z.literal(1280)]);
export type TranscriptWidth = z.infer<typeof TranscriptWidthSchema>;
const AppearanceSettingsSchema = z.strictObject({
  monoFont: z.string().min(1).max(200).nullable(), // prepended to --font-mono; null = the token stack
  transcriptWidth: TranscriptWidthSchema, // W2, version 5
});
const NotificationSettingsSchema = z.strictObject({ enabled: z.boolean(), sound: z.boolean(), kinds: NotificationKindsSchema });
// C11 end

export const SettingsSchema = z.strictObject({
  version: z.literal(5), // C11: version 3; C12: version 4 (engine.memoryBudgetMiB, engine.statefulMcpServers); W2: version 5 (appearance.transcriptWidth)
  theme: ThemeSettingSchema,
  // Overrides only; null unbinds; absent means the default. `partialRecord`, because zod 4's enum-keyed `record` is
  // exhaustive and would reject `{}` and every single override; unknown keys are still rejected.
  keymap: z.partialRecord(z.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: NotificationSettingsSchema, // C11: C5's two fields plus kinds
  // C11 start
  engine: EngineSettingsSchema,
  gateway: GatewaySettingsSchema,
  usage: UsageSettingsSchema,
  appearance: AppearanceSettingsSchema,
  // C11 end
});
export type Settings = z.infer<typeof SettingsSchema>;

// C11: a section is patched by field (each section `.partial()`), and `notifications.kinds` one level further, so one
// kind is patched alone; `applySettingsPatch` (src/shared/settings/defaults.ts) is the one merge. The keymap is a
// record of overrides and is replaced whole, so an override is removed by leaving it out.
export const SettingsPatchSchema = z.strictObject({
  theme: ThemeSettingSchema.optional(),
  keymap: SettingsSchema.shape.keymap.optional(),
  notifications: z.strictObject({ enabled: z.boolean().optional(), sound: z.boolean().optional(), kinds: NotificationKindsSchema.partial().optional() }).optional(),
  engine: EngineSettingsSchema.partial().optional(),
  gateway: GatewaySettingsSchema.partial().optional(),
  usage: UsageSettingsSchema.partial().optional(),
  appearance: AppearanceSettingsSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const SettingsStateSchema = z.strictObject({ settings: SettingsSchema, resolvedTheme: z.enum(['light', 'dark']) });
export type SettingsState = z.infer<typeof SettingsStateSchema>;

// C7 start: the account usage main reads from ClaudeUsage's files (C7 execution document, Interfaces "Status line
// popovers and usage"). `settings.usage` answers the snapshot with `pinsFor` filled for the engine session ids it names;
// `settings.usageChanged` carries the next snapshot when the files change, `pinsFor` for the ids the last call named.
const c7Commands = {
  'settings.usage': { input: z.strictObject({ engineSessionIds: z.array(z.string()).max(64) }), output: UsageSnapshotSchema, owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
const c7Events = {
  'settings.usageChanged': UsageSnapshotSchema,
} as const satisfies Record<`settings.${string}`, z.ZodType>;
// C7 end

// C11 start: the ClaudeUsage hand-off and the reveal (C11 execution document, Interfaces "X2 additions"). ClaudeUsage
// registers no URL scheme, CLI or notification interface, so a hand-off activates it by bundle id and hands the user an
// instruction naming the control in its panel. The two account-free intents carry no email field at all.
export const CLAUDE_USAGE_BUNDLE_ID = 'com.haegi.ClaudeUsage';
export const ClaudeUsageStatusSchema = z.strictObject({ installed: z.boolean(), running: z.boolean(), bundleId: z.literal(CLAUDE_USAGE_BUNDLE_ID), dataDirPresent: z.boolean(), checkedAt: z.string() });
export type ClaudeUsageStatus = z.infer<typeof ClaudeUsageStatusSchema>;
export const ClaudeUsageOpenIntentSchema = z.discriminatedUnion('intent', [
  z.strictObject({ intent: z.literal('panel') }),
  z.strictObject({ intent: z.literal('addAccount') }),
  z.strictObject({ intent: z.literal('reconnect'), accountEmail: z.string().min(1) }),
  z.strictObject({ intent: z.literal('remove'), accountEmail: z.string().min(1) }),
]);
export type ClaudeUsageOpenIntent = z.infer<typeof ClaudeUsageOpenIntentSchema>;
export const ClaudeUsageOpenResultSchema = z.strictObject({ opened: z.boolean(), reason: z.enum(['not_installed', 'launch_failed']).nullable(), instruction: z.string() });
export type ClaudeUsageOpenResult = z.infer<typeof ClaudeUsageOpenResultSchema>;
const c11Commands = {
  // installed: Spotlight knows the bundle id (cached 60 s); running: the relay's hello answered (the listener runs whenever
  // ClaudeUsage does); dataDirPresent: C7's reader found its files
  'settings.claudeUsage.status': { input: z.void(), output: ClaudeUsageStatusSchema, owner: 'main' },
  'settings.claudeUsage.open': { input: ClaudeUsageOpenIntentSchema, output: ClaudeUsageOpenResultSchema, owner: 'main' },
  // shell.showItemInFolder for a path under the engine's config home or a session's directories; never opens or edits it
  'settings.reveal': { input: z.strictObject({ path: z.string() }), output: z.strictObject({ revealed: z.boolean() }), owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C11 end

// C12 start: MAWS's custody of the pinned engine (C12 execution document, Interfaces "Engine custody" and "X2
// additions"). `settings.engineCustody` answers the copy the next launch uses, null when custody does not run (MAWS_E2E
// and replay, where the host keeps C3's ENGINE_BIN). `settings.engineApplied` answers once main's `engine.configure` push
// for `settings.engine` as it now stands has been answered by the host, custody for a changed pin included; its error
// carries custody's or the push's message. Main is the only sender of `engine.configure`.
export const CustodyManifestSchema = z.strictObject({ version: z.string(), sha256: z.string(), size: z.number().int(), source: z.string(), copiedAt: z.string() });
export type CustodyManifest = z.infer<typeof CustodyManifestSchema>;
export const CustodySchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('ok'), path: z.string(), manifest: CustodyManifestSchema }),
  z.strictObject({ state: z.enum(['missing', 'mismatch', 'version']), path: z.string(), message: z.string() }),
]);
export type Custody = z.infer<typeof CustodySchema>;
// W3 start: what the engine will use when MAWS passes nothing (charter §5.4 and D-18 as amended 2026-10-01): the user's
// own `model`, `effortLevel` and `permissions.defaultMode` from `<CLAUDE_CONFIG_DIR or ~/.claude>/settings.json`, read
// and never written. A key the file does not set, or sets to a value the engine would not take, is null.
export const UserEngineDefaultsSchema = z.strictObject({ model: z.string().nullable(), effortLevel: EffortSchema.nullable(), defaultMode: PermissionModeSchema.nullable() });
export type UserEngineDefaults = z.infer<typeof UserEngineDefaultsSchema>;
const w3Commands = {
  'settings.userEngineDefaults': { input: z.void(), output: UserEngineDefaultsSchema, owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// W3 end

const c12Commands = {
  'settings.engineCustody': { input: z.void(), output: CustodySchema.nullable(), owner: 'main' },
  'settings.engineApplied': { input: z.void(), output: z.void(), owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C12 end

export const commands = {
  'settings.get': { input: z.void(), output: SettingsStateSchema, owner: 'main' },
  'settings.set': { input: SettingsPatchSchema, output: SettingsStateSchema, owner: 'main' },
  ...c7Commands, // C7
  ...c11Commands, // C11
  ...c12Commands, // C12
  ...w3Commands, // W3
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'settings.changed': SettingsStateSchema,
  ...c7Events, // C7
} as const satisfies Record<`settings.${string}`, z.ZodType>;
