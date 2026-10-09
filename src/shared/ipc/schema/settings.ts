// X2 `settings.*`: the persisted app settings and the theme resolved from them (charter §12 C1 *Theme switching*).
// Version 2 (C5): the keymap overrides and the notification policy. Version 3 (C11): the engine binary, the gateway
// policy, the near-limit threshold, the monospace font and the per-kind notification switches. Version 4 (C12): the
// memory budget. Version 5 (W2): the transcript's width. Version 6 (W3): the mode a session takes when the engine refuses
// auto. Version 7 (W7): the memory budget's switch. Version 8 (W13): the engine's pin retired (MAWS runs the installed
// Claude Code). Version 9 (E9): the dictation recognizer's locale. Version 10 (E10): the background supervisor. Version 11 (E4a): the in-app browser. Migrations live in `src/shared/settings/defaults.ts`,
// run by main's store; the schema never defaults.
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
// E4a start
import { isSearchUrlTemplate } from '../../browser/url';
// E4a end

export const ThemeSettingSchema = z.enum(['light', 'dark', 'system']);
export type ThemeSetting = z.infer<typeof ThemeSettingSchema>;

export const ChordSchema = z.string().regex(CHORD_PATTERN); // Electron accelerator syntax, readable by parseChord

// C11 start: the sections version 3 adds (C11 execution document, Interfaces "Settings, version 3").
// The groups C5's notifier maps X1's attention kinds to (src/main/attention/notifier.ts GROUP): approvals = permission,
// dialog, elicitation; questions = question; planReviews = plan; errors = error, interrupted, auto_mode_unavailable;
// heldPeerMessages = held_peer_message (not actionable, so it never notifies in P0).
export const NotificationKindsSchema = z.strictObject({ approvals: z.boolean(), questions: z.boolean(), planReviews: z.boolean(), errors: z.boolean(), heldPeerMessages: z.boolean() });
export type NotificationKinds = z.infer<typeof NotificationKindsSchema>;
// A chosen engine binary is named by absolute path (§4.1); macOS paths only.
export const AbsolutePathSchema = z.string().refine((path) => path.startsWith('/'), { message: 'must be an absolute path' });
const EngineSettingsSchema = z.strictObject({
  binaryPath: AbsolutePathSchema.nullable(), // null = the installed Claude Code, resolved per launch (W13; engine-host/binary-info.ts)
  subagentModel: z.string().nullable(), // the default CLAUDE_CODE_SUBAGENT_MODEL for new sessions; null = the captured shell's value
  // C12 start: version 4, the memory budget (C12 execution document, Interfaces "Settings, version 4"; charter §4.4).
  // memoryBudgetMiB: the limit on the sum of the engine process trees; null = 25% of physical memory.
  // statefulMcpServers: MCP server names, exactly as system/init reports them, whose state dies with their process; a
  // connected or connecting one keeps its session live under the budget.
  memoryBudgetMiB: z.number().int().min(512).nullable(),
  statefulMcpServers: z.array(z.string().min(1).max(200)).max(64),
  // C12 end
  // W7: version 7, the budget's switch (charter §4.4 as amended 2026-10-01): off, no process is released for the budget
  // and engine processes never exit on their own; the two fields above are kept for when it is on again. An object, so
  // a patch replaces it whole.
  memoryBudget: z.strictObject({ enabled: z.boolean() }),
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
// W3: charter D-18 and §5.1 as amended 2026-10-01: when the engine refuses auto for a session (a model without auto mode,
// fast mode, the circuit breaker, settings), MAWS sets this mode explicitly and says so; any engine mode but auto.
export const AutoFallbackSchema = PermissionModeSchema.exclude(['auto']);
export type AutoFallback = z.infer<typeof AutoFallbackSchema>;
const PermissionsSettingsSchema = z.strictObject({ autoFallback: AutoFallbackSchema });
// E9 start: version 9, push-to-talk dictation (E9 execution document, Interfaces "Settings version 9"). The recognizer's
// locale as a BCP-47 identifier (`en-US`); null = the system's current locale, which the helper resolves at each capture.
export const VoiceSettingsSchema = z.strictObject({ locale: z.string().min(2).max(32).nullable() });
// E9 end
// E10 start: version 10, the background supervisor (E10 execution document, Interfaces "Settings version 10"; A-29 (4)).
// idleExitMinutes: how long the supervisor waits, with no app connected and no live session, before it exits (and how
// long a kept session with no hard reason runs while no app is connected); null = never. keepRunningDefault: whether
// "Quit and keep sessions running" is the quit question's default button when work is in flight.
export const MAX_IDLE_MINUTES = 1440; // a day; host.configure's millisecond cap is derived from it (schema/host.ts)
export const SupervisorSettingsSchema = z.strictObject({ idleExitMinutes: z.number().int().min(1).max(MAX_IDLE_MINUTES).nullable(), keepRunningDefault: z.boolean() });
// E10 end
// E4a start: version 11, the in-app browser (E4a execution document, Interfaces "X15: settings 11"). profile: the imported
// Chrome profile's directory whose partition new tabs open in (E4b lists them in profiles.json); null = the default
// partition. searchUrl: the address bar's search, an http(s) template where %s stands for the query (refused rather than
// trimmed: zod's url check trims, and validators never transform). linkTarget: where a page's new-window links open
// (Decision Log 11): a new tab of the same session, or the system browser.
export const BrowserSettingsSchema = z.strictObject({
  profile: z.string().min(1).max(200).nullable(),
  searchUrl: z.string().max(2048).refine(isSearchUrlTemplate, { message: 'not an http or https URL with %s' }),
  linkTarget: z.enum(['in-app', 'external']),
  // cua #90: version 12, whether an imported profile's tabs show its bookmarks bar (⌘⇧B in the browser, Settings › Browser)
  bookmarksBar: z.enum(['shown', 'hidden']),
});
export type BrowserSettings = z.infer<typeof BrowserSettingsSchema>;
// E4a end

export const SettingsSchema = z.strictObject({
  version: z.literal(12), // C11: version 3; C12: version 4 (engine.memoryBudgetMiB, engine.statefulMcpServers); W2: version 5 (appearance.transcriptWidth); W3: version 6 (permissions.autoFallback); W7: version 7 (engine.memoryBudget); W13: version 8 (engine.pinnedVersion removed); E9: version 9 (voice); E10: version 10 (supervisor); E4a: version 11 (browser); cua #90: version 12 (browser.bookmarksBar)
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
  permissions: PermissionsSettingsSchema, // W3
  voice: VoiceSettingsSchema, // E9
  supervisor: SupervisorSettingsSchema, // E10
  browser: BrowserSettingsSchema, // E4a
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
  permissions: PermissionsSettingsSchema.partial().optional(), // W3
  voice: VoiceSettingsSchema.partial().optional(), // E9
  supervisor: SupervisorSettingsSchema.partial().optional(), // E10
  browser: BrowserSettingsSchema.partial().optional(), // E4a
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

// C12 start: `settings.engineApplied` answers once main's `engine.configure` push for `settings.engine` as it now stands
// has been answered by the host; its error carries the push's message. Main is the only sender of `engine.configure`.
// W13: custody of a pinned copy is retired with the pin, and `settings.engineCustody` with it.
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
  'settings.engineApplied': { input: z.void(), output: z.void(), owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// C12 end

// W6 route executor start: ClaudeUsage's loopback control API, which the usage popover's actions run through (charter
// §19, W6 route executor; the C11 execution document's popover). Main is its only caller: on every use it reads the
// token from `<ClaudeUsage data dir>/control-token` and the port from `gateway.json`; an absent token file means the
// route does not exist yet. `settings.usageControls` answers whether the API answers (`GET /claudeusage/state`) and the
// state it answered, read leniently; `settings.usageAction` runs one action and answers ClaudeUsage's result, a refusal
// (409) with ClaudeUsage's own reason and message. While the API cannot be reached, `reason` says why, and the actions
// stay as they were before it existed: disabled, with ClaudeUsage's own panel as the way.
export const UsageControlReasonSchema = z.enum([
  'no_route', // no token file, no port, a 404 or a refused connection: this ClaudeUsage has no control route
  'bad_token', // a 401, or a token file that cannot be read
  'timeout', // no answer within the client's limit
  'starting', // a 503: the relay answers but ClaudeUsage's app is not wired to it yet
  'failed', // any other status, or an answer that is not the state
]);
export type UsageControlReason = z.infer<typeof UsageControlReasonSchema>;
export const UsageControlStateSchema = z.strictObject({
  updatedAt: z.string().nullable(),
  routing: z.strictObject({ enabled: z.boolean(), ready: z.boolean(), port: z.number().int().nullable(), drainTarget: z.string().nullable(), drainTargetIsManual: z.boolean() }),
  // `status` is ClaudeUsage's own case name in snake_case; `canRoute`, `canReconnect` and `canRemove` are ClaudeUsage's
  // own word on each account's actions, null when the state does not carry them
  accounts: z.array(
    z.strictObject({ uuid: z.string(), email: z.string(), status: z.string(), isRoutingHere: z.boolean(), canRoute: z.boolean().nullable(), canReconnect: z.boolean().nullable(), canRemove: z.boolean().nullable() }),
  ),
  codex: z.array(z.strictObject({ id: z.string(), label: z.string(), isDrainTarget: z.boolean() })),
});
export type UsageControlState = z.infer<typeof UsageControlStateSchema>;
export const UsageControlsAnswerSchema = z.strictObject({ available: z.boolean(), reason: UsageControlReasonSchema.nullable(), state: UsageControlStateSchema.nullable() });
export type UsageControlsAnswer = z.infer<typeof UsageControlsAnswerSchema>;
export const UsageActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('route'), uuid: z.string().min(1) }), // POST /claudeusage/route
  z.strictObject({ action: z.literal('add'), email: z.string().min(1).nullable().optional() }), // POST /claudeusage/accounts/add: ClaudeUsage's sign-in sheet
  z.strictObject({ action: z.literal('reconnect'), uuid: z.string().min(1) }), // POST /claudeusage/accounts/reconnect: the same sheet
  z.strictObject({ action: z.literal('remove'), uuid: z.string().min(1), confirm: z.boolean().optional() }), // POST /claudeusage/accounts/remove: refused without confirm
  z.strictObject({ action: z.literal('panel') }), // POST /claudeusage/panel: toggles ClaudeUsage's own panel
]);
export type UsageAction = z.infer<typeof UsageActionSchema>;
// ok: `drainTarget` and `drainTargetIsManual` are the route's result (null and false for the other actions), `shown`
// whether the panel toggle left ClaudeUsage's panel on screen (null for the other actions). Not ok: a 409's `reason` and
// `message` as ClaudeUsage wrote them (its panel's own wording), or a UsageControlReason with main's own message when
// ClaudeUsage was not reached.
export const UsageActionResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), drainTarget: z.string().nullable(), drainTargetIsManual: z.boolean(), shown: z.boolean().nullable() }),
  z.strictObject({ ok: z.literal(false), reason: z.string(), message: z.string() }),
]);
export type UsageActionResult = z.infer<typeof UsageActionResultSchema>;
const w6RouteCommands = {
  'settings.usageControls': { input: z.void(), output: UsageControlsAnswerSchema, owner: 'main' },
  'settings.usageAction': { input: UsageActionSchema, output: UsageActionResultSchema, owner: 'main' },
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;
// W6 route executor end

export const commands = {
  'settings.get': { input: z.void(), output: SettingsStateSchema, owner: 'main' },
  'settings.set': { input: SettingsPatchSchema, output: SettingsStateSchema, owner: 'main' },
  ...c7Commands, // C7
  ...c11Commands, // C11
  ...c12Commands, // C12
  ...w3Commands, // W3
  ...w6RouteCommands, // W6 route executor
} as const satisfies Record<`settings.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'settings.changed': SettingsStateSchema,
  ...c7Events, // C7
} as const satisfies Record<`settings.${string}`, z.ZodType>;
