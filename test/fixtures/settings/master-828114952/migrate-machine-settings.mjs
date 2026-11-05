/* eslint-disable */
// Vendored, generated: master's own `migrateMachineSettings` at 828114952 (src/shared/settings/defaults.ts, the base P5
// O7 M9 branched from), its executable source with every module its reader imports (the settings schema, the app MCP
// servers, the launch profile, the keymap, the enums, …), types stripped and nothing else changed, so a test can read a
// file as an older build reads it (P5 O7 M9, M9 "The default, without a v2"). Regenerate only to move the base, from a
// detached worktree of that commit with this tree's node_modules:
//   printf "export { migrateMachineSettings } from './src/shared/settings/defaults';\n" > vendor-entry.ts
//   esbuild vendor-entry.ts --bundle --format=esm --platform=node --external:zod --tsconfig=tsconfig.node.json \
//     --legal-comments=none --outfile=migrate-machine-settings.mjs
// src/shared/settings/defaults.ts
import * as z8 from "zod";

// src/shared/keymap/actions.ts
var ACTIONS = {
  "session.new": { title: "New chat", chord: "Cmd+N", sink: "menu", menu: "file", scope: "app" },
  // New chat (2026-10-01): registered with the session creator; disabled until one exists
  "tab.close": { title: "Close tab", chord: "Cmd+W", sink: "menu", menu: "file", scope: "app" },
  "tab.reopen": { title: "Reopen closed tab", chord: "Cmd+Shift+T", sink: "menu", menu: "file", scope: "app" },
  "tab.overview": { title: "Overview", chord: "Cmd+0", sink: "menu", menu: "view", scope: "app" },
  "artifacts.open": { title: "Artifacts", chord: null, sink: "menu", menu: "view", scope: "app" },
  // P3-G (§D5): opens or activates the Artifacts tab, as the sidebar's row does
  "tab.select": { title: "Select tab 1\u20139", chord: "Cmd+1", sink: "menu", menu: "view", scope: "app" },
  // the menu expands this to nine items Cmd+1 … Cmd+9 with arg 1..9
  "tab.next": { title: "Next tab", chord: "Ctrl+Tab", sink: "renderer", menu: "view", scope: "pane" },
  "tab.previous": { title: "Previous tab", chord: "Ctrl+Shift+Tab", sink: "renderer", menu: "view", scope: "pane" },
  "tab.stripNext": { title: "Next tab in strip", chord: "Cmd+Alt+]", sink: "menu", menu: "go", scope: "app" },
  "tab.stripPrevious": { title: "Previous tab in strip", chord: "Cmd+Alt+[", sink: "menu", menu: "go", scope: "app" },
  "region.focusNext": { title: "Focus next region", chord: "F6", sink: "menu", menu: "go", scope: "app" },
  "region.focusPrevious": { title: "Focus previous region", chord: "Shift+F6", sink: "menu", menu: "go", scope: "app" },
  "sidebar.focus": { title: "Focus sidebar", chord: null, sink: "menu", menu: "go", scope: "app" },
  "pane.split": { title: "Split / move to other pane", chord: "Cmd+\\", sink: "menu", menu: "view", scope: "app" },
  "pane.focusOther": { title: "Focus other pane", chord: "Cmd+Shift+\\", sink: "menu", menu: "view", scope: "app" },
  "sidebar.toggle": { title: "Toggle sidebar", chord: "Cmd+B", sink: "menu", menu: "view", scope: "app" },
  "panel.toggle": { title: "Toggle session cards", chord: "Cmd+Shift+B", sink: "menu", menu: "view", scope: "app" },
  "surface.terminal": { title: "Toggle Terminal surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.review": { title: "Toggle Review surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.browser": { title: "Toggle Browser surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.files": { title: "Toggle Files surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.source-control": { title: "Toggle Source control surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.subagents": { title: "Toggle Subagents surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.background": { title: "Toggle Background work surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.session-info": { title: "Toggle Session info surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "surface.ask-sheet": { title: "Toggle Questions surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "panel.maximize": { title: "Expand surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  // P3-G (§D1.7): the panel's floating state, the third region state of the B family (⌘B the sidebar, ⇧⌘B the panel); a
  // page in the browser passes every ⌥⌘ chord to the menu, so it works with a page focused
  "panel.float": { title: "Float conversation over surface", chord: "Cmd+Alt+B", sink: "menu", menu: "view", scope: "app" },
  // P4-B3 (X32 amendment; its Decision Log 12): the focused pane takes the main area and the session beside it floats in
  // the split's card, as the editor header's Expand does; on a floating split it restores the split. No default chord.
  // P4-B3x (P4 Decision Log 40): it also folds an open right panel, which restoring the split opens again
  "main.expandArtifactPane": { title: "Expand pane", chord: null, sink: "menu", menu: "view", scope: "app" },
  // P4-B3 (X38; its Decision Log 21): the focused main artifact tab into the panel ("Show in panel"), and the shown
  // panel's Artifacts record into a main tab ("Move to tab"), as a drag does; refused with the drag's reason. No chords
  "artifact.moveToPanel": { title: "Move to side surface", chord: null, sink: "menu", menu: "view", scope: "app" },
  "artifact.moveToTab": { title: "Move to tab", chord: null, sink: "menu", menu: "view", scope: "app" },
  "theme.light": { title: "Appearance: Light", chord: null, sink: "menu", menu: "view", scope: "app" },
  "theme.dark": { title: "Appearance: Dark", chord: null, sink: "menu", menu: "view", scope: "app" },
  "theme.system": { title: "Appearance: System", chord: null, sink: "menu", menu: "view", scope: "app" },
  "palette.open": { title: "Command palette", chord: "Cmd+K", sink: "menu", menu: "go", scope: "app" },
  "session.previous": { title: "Previous session", chord: "Cmd+Shift+[", sink: "menu", menu: "go", scope: "app" },
  "session.next": { title: "Next session", chord: "Cmd+Shift+]", sink: "menu", menu: "go", scope: "app" },
  "session.markUnread": { title: "Mark session unread", chord: "Cmd+Alt+U", sink: "menu", menu: "go", scope: "app" },
  "attention.next": { title: "Next Needs-you", chord: "Cmd+Shift+J", sink: "menu", menu: "go", scope: "app" },
  "shortcuts.open": { title: "Keyboard shortcuts", chord: "Cmd+/", sink: "menu", menu: "help", scope: "app" },
  "diagnostics.open": { title: "Diagnostics", chord: null, sink: "menu", menu: "help", scope: "app" },
  "request.accept": { title: "Approve / answer the docked request", chord: "Enter", sink: "renderer", menu: null, scope: "pane" },
  // C7's card subscribes through useKeyChord
  "request.decline": { title: "Decline the docked request", chord: "Escape", sink: "renderer", menu: null, scope: "pane" },
  "composer.send": { title: "Send (multi-line editor)", chord: "Cmd+Enter", sink: "renderer", menu: null, scope: "composer" },
  // C7 consumes
  "composer.cycleMode": { title: "Cycle permission mode", chord: "Shift+Tab", sink: "renderer", menu: null, scope: "composer" },
  // C7 consumes
  // C7 start: the composer's own actions (C7 execution document, Keymap additions). Stop and Focus are app-scoped
  // because ⌘. is pressed while typing, where C5's dispatcher refuses every pane-scoped action, and are registered once
  // (ComposerAppKeys), resolving the focused pane. W10 (charter §4.2 as amended 2026-10-01): `composer.steer` (⌥Enter,
  // W1's hold until the turn ends) is gone with the hold; a saved override of it is dropped on read (RETIRED_ACTION_IDS).
  "composer.stop": { title: "Stop, holding waiting messages", chord: "Cmd+.", sink: "renderer", menu: null, scope: "app" },
  // W1: nothing runs after it
  "composer.focus": { title: "Focus the composer", chord: "Cmd+L", sink: "renderer", menu: null, scope: "app" },
  // C7 end
  // C11 start: the Settings tab and the ClaudeUsage hand-off (C11 execution document, Keymap and action entries).
  // settings.open's arg, when given, is the index of a Settings section; the relay card runs the hand-off. W6: the
  // Accounts tab retired; `accounts.open` keeps its id, which the settings' keymap overrides are keyed by, and opens the
  // top bar's usage popover.
  "settings.open": { title: "Settings\u2026", chord: "Cmd+,", sink: "menu", menu: "app", scope: "app" },
  "accounts.open": { title: "Usage", chord: null, sink: "menu", menu: "view", scope: "app" },
  "gateway.openClaudeUsage": { title: "Open ClaudeUsage", chord: null, sink: "renderer", menu: null, scope: "app" },
  // C11 end
  // E9 start: push-to-talk dictation into the focused pane's composer (E9 execution document, Design §5): app-scoped like
  // ⌘L, so it works wherever focus is. Unbound by default (the owner's ruling, 2026-10-06): the composer toolbar's
  // microphone is the primary control; a chord bound in Settings › Keyboard holds to dictate (⌥Space suits; ⌃Space
  // switches input sources on a multi-language Mac)
  "composer.dictate": { title: "Hold to dictate", chord: null, sink: "renderer", menu: null, scope: "app", hold: true },
  // E9 end
  // E5 start: the editor's save (E5 execution document, Interfaces *The close guard and the action*). A menu action
  // because macOS registers ⌘S in the menu and the page never sees it (as ⌘W); it saves the focused pane's file tab.
  "file.save": { title: "Save file", chord: "Cmd+S", sink: "menu", menu: "file", scope: "app" },
  // E5 end
  // E11 start (W-C; the comment gutter's keyboard and screen-reader path): opens the comment composer for the cursor's
  // line of the focused pane's file tab, as the gutter's mark does for its line. A menu action, so it reaches the
  // editor's cursor from the palette, File ▸ Comment on this line and a chord bound in Settings ▸ Keyboard alike;
  // unbound by default
  "file.commentLine": { title: "Comment on this line", chord: null, sink: "menu", menu: "file", scope: "app" },
  // E11 end
  // P2-C start (2026-10-09; the parent's Decision Log 19): the focused pane's session tab between its report and its
  // full transcript while the owner channel's lane is on, as the pane header's toggle does; unbound by default
  "transcript.toggleReport": { title: "Toggle report and transcript", chord: null, sink: "renderer", menu: null, scope: "app" },
  // P2-C end
  // P3-G (§D4.4): Mark up over the selected panel tab's surface, as the panel header's button does; unbound by default
  "markup.start": { title: "Mark up", chord: null, sink: "renderer", menu: null, scope: "app" },
  // P4-B1 start (2026-10-20; the P4 spec §4.3, Docs' View › Comments): every document's comment view, per user
  // (settings.artifacts.commentsView): Expand draws the cards in the margin, Minimize the icons at the anchors, Hide an
  // empty margin. Three flat items (the table has no submenu or checked state); unbound by default
  "comments.expand": { title: "Expand comments", chord: null, sink: "menu", menu: "view", scope: "app" },
  "comments.minimize": { title: "Minimize comments", chord: null, sink: "menu", menu: "view", scope: "app" },
  "comments.hide": { title: "Hide comments", chord: null, sink: "menu", menu: "view", scope: "app" }
  // P4-B1 end
};
var ACTION_IDS = Object.keys(ACTIONS);

// src/shared/ipc/schema/settings.ts
import * as z7 from "zod";

// src/shared/keymap/chord.ts
var MODIFIERS = {
  Cmd: "meta",
  Command: "meta",
  CmdOrCtrl: "meta",
  CommandOrControl: "meta",
  Super: "meta",
  Meta: "meta",
  Ctrl: "ctrl",
  Control: "ctrl",
  Alt: "alt",
  Option: "alt",
  Shift: "shift"
};
var PUNCTUATION = {
  "\\": "Backslash",
  "/": "Slash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote"
};
var PHYSICAL = { Space: "Space" };
var NAMED = {
  Tab: "Tab",
  Enter: "Enter",
  Return: "Enter",
  Escape: "Escape",
  Esc: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown"
};
var escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var alternatives = (tokens) => tokens.map(escape).join("|");
var CHORD_PATTERN = new RegExp(
  `^(?:(?:${alternatives(Object.keys(MODIFIERS))})\\+)*(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|${alternatives(Object.keys(PUNCTUATION))}|${alternatives(Object.keys(PHYSICAL))}|${alternatives(Object.keys(NAMED))})$`
);
var NAMED_KEYS = new Set(Object.values(NAMED));

// src/shared/engine/launch-spec.ts
import * as z3 from "zod";

// src/shared/graph/enums.ts
import * as z from "zod";
var PERMISSION_MODES = ["default", "acceptEdits", "plan", "auto", "bypassPermissions", "dontAsk"];
var PermissionModeSchema = z.enum(PERMISSION_MODES);
var AUTO_MODE_REFUSAL_CODES = [
  "auto_mode_settings",
  "auto_mode_circuit_breaker",
  "auto_mode_fast_mode",
  "auto_mode_model",
  "auto_mode_unavailable"
];
var AutoModeRefusalCodeSchema = z.enum(AUTO_MODE_REFUSAL_CODES);
var DENIAL_KINDS = [
  "user-rejected",
  "permission-rule",
  "automode-blocked",
  "automode-unavailable",
  "automode-parsing-error",
  "interrupted",
  "cancelled"
];
var DenialKindSchema = z.enum(DENIAL_KINDS);
var ATTENTION_KINDS = [
  "permission",
  "question",
  "plan",
  "dialog",
  "elicitation",
  "error",
  "interrupted",
  "held_peer_message",
  "auto_mode_unavailable",
  // P2-C start (2026-10-09; the P2-C document, Design §5): a question an agent left (`need-input`, unanswered) and a
  // must-read (`essential`, not marked read), each projected from the owner channel's marks table
  "async_input",
  "essential_unread"
  // P2-C end
];
var AttentionKindSchema = z.enum(ATTENTION_KINDS);
var ATTENTION_STATES = ["pending", "delivered", "confirmed", "retired"];
var AttentionStateSchema = z.enum(ATTENTION_STATES);
var SAFEGUARD_VERDICTS = ["not_evaluated", "skipped", "not_flagged", "flagged"];
var SafeguardVerdictSchema = z.enum(SAFEGUARD_VERDICTS);
var HANDOVER_REINIT_FAILED = "handover-reinit-failed";
var ExitCauseSchema = z.strictObject({ kind: z.literal(HANDOVER_REINIT_FAILED), detail: z.string() });

// src/shared/graph/ids.ts
import * as z2 from "zod";
var brandedId = () => z2.string().min(1).brand();
var SessionIdSchema = brandedId();
var AppSessionIdSchema = brandedId();
var MessageUuidSchema = brandedId();
var ApiMessageIdSchema = brandedId();
var ToolUseIdSchema = brandedId();
var ParentToolUseIdSchema = brandedId();
var TaskIdSchema = brandedId();
var AgentIdSchema = brandedId();
var RequestIdSchema = brandedId();
var ProjectIdSchema = brandedId();
var AttentionIdSchema = brandedId();
var EventIdSchema = brandedId();
var LooseAppSessionIdSchema = z2.string().brand();

// src/shared/engine/launch-spec.ts
var EffortSchema = z3.enum(["low", "medium", "high", "xhigh", "max"]);
var Text = z3.string().min(1);
var LaunchedBySpecSchema = z3.strictObject({ appSessionId: AppSessionIdSchema, member: Text, device: Text, opId: Text, proofFile: Text });
var LaunchSpecSchema = z3.strictObject({
  appSessionId: AppSessionIdSchema,
  cwd: z3.string(),
  // absolute; the engine canonicalises (realpath) and reports it in system/init.cwd
  additionalDirectories: z3.array(z3.string()),
  model: z3.string().nullable(),
  // --model; null = engine default
  effort: EffortSchema.nullable(),
  // via --settings { effortLevel }; null = settings
  permissionMode: PermissionModeSchema.nullable(),
  // --permission-mode; null = settings (auto for the owner, D-18)
  // W3 (additive X6; charter D-18 as amended 2026-10-01): the mode the host sets with `set_permission_mode` when the
  // spec asks for auto and the engine's initialize answers another mode (the engine refuses auto at launch silently,
  // pass2/auto-haiku.jsonl seq 4); absent or null: the refusal stands as the engine left it.
  permissionFallback: PermissionModeSchema.nullable().optional(),
  gateway: z3.enum(["gateway", "direct"]),
  // D-19 default is 'gateway'; the caller decides the fallback
  subagentModel: z3.string().nullable(),
  // CLAUDE_CODE_SUBAGENT_MODEL; null = the captured shell/settings value
  resume: z3.strictObject({ sessionId: SessionIdSchema, fork: z3.boolean() }).nullable(),
  sessionId: SessionIdSchema.nullable(),
  // --session-id for a new session; the host mints one when null
  trust: z3.strictObject({ accepted: z3.literal(true), directory: z3.string() }).nullable(),
  // initialize.workspaceTrust (C10 fills)
  mcpConfig: z3.record(z3.string(), z3.unknown()).nullable(),
  // --mcp-config JSON (C10/C11 extension; the live tests' elicitation server)
  extraSettings: z3.record(z3.string(), z3.unknown()).nullable(),
  // merged into --settings after the host's own keys (tests: ask rules, enableWorkflows)
  maxBudgetUsd: z3.number().positive().nullable(),
  // --max-budget-usd (live tests only; cumulative for the conversation, a resume's restored cost included; C11 M6; null on a side thread takes its parent's, P2-F D7, engine-host/launcher.ts)
  replay: z3.string().nullable(),
  // fixture path for ReplayTransport; refused unless MAWS_ENGINE_REPLAY=1
  // C10 start (additive X6, flagged to the coordinator): a fork carries the grants the human issued for the conversation
  // it copies. When set and the session's own snapshot is empty, start() loads the named session's snapshot, saves it
  // as this session's, and re-applies it in the resume rung (C10 execution document, Interfaces "X6 extensions").
  inheritGrantsFrom: AppSessionIdSchema.nullable(),
  // C10 end
  // C3 corrective start (additive X6, flagged to the architect; 2026-09-30 ledger): the one automatic retry of a resume
  // whose engine wrote nothing (`init_failed { no_output }`). The host journals the launch's reconnect rows as this
  // attempt of `maxAttempts` with the reason, and a notice saying MAWS is trying once more. Absent on every other launch.
  retry: z3.strictObject({ attempt: z3.number().int().positive(), maxAttempts: z3.number().int().positive(), reason: z3.string() }).optional(),
  // C3 corrective end
  // P2-C start (2026-10-09; additive X6, the P2-C document, Design §2 and Interfaces X6): the to-human contract MAWS
  // appends to the engine's system prompt (`--append-system-prompt`), and `--system-prompt-snapshot off`, which makes
  // the launch render its system prompt live rather than reuse the one the transcript recorded; `buildLaunch` passes
  // "off" only when the binary declares the flag. Main's launch decision (src/main/owner/launch.ts) sets both. Neither
  // is saved with the host's stored spec, so the state file an older build reads gains no key.
  appendSystemPrompt: z3.string().min(1).max(16384).nullable().optional(),
  systemPromptSnapshot: z3.literal("off").nullable().optional(),
  // P2-C end
  // P5 O12 M11 (docs/doperpowers/plans/2026-10-27-p5-o12-sminos-owners.md, Interfaces §H): the spawner of a session a
  // remote member spawned, its own record's `launchedBy` less the sealed action, which the spine writes to `proofFile`
  // before the launch; the engine host passes it as MAWS_LAUNCHED_BY, which sminos's record reads from the session's
  // first SessionStart. Absent for a session without one, a fork (its own record has none) and the trust bootstrap. Not
  // saved with the host's stored spec, as P2-C's keys are not: each launch takes it from the record.
  launchedBy: LaunchedBySpecSchema.optional()
});

// src/shared/usage/types.ts
import * as z4 from "zod";
var UsageWindowSchema = z4.strictObject({ percent: z4.number(), resetsAt: z4.string(), recordedAt: z4.string() });
var AccountUsageSchema = z4.strictObject({
  uuid: z4.string(),
  email: z4.string(),
  displayName: z4.string(),
  planLabel: z4.string().nullable(),
  rateLimitTier: z4.string().nullable(),
  needsReauthentication: z4.boolean(),
  lastSeenActive: z4.string().nullable(),
  pinnedSessionCount: z4.number().int().nonnegative(),
  // C11's ask: the pins entries whose accountUUID is this account's
  credentialOwnership: z4.enum(["legacy", "appManaged"]).nullable(),
  // C11's ask: accounts.json's field; null when absent
  // fiveHour: limitKey `session`; sevenDay: `weekly_all`; scoped: each `weekly_scoped#<Model>`
  windows: z4.strictObject({ fiveHour: UsageWindowSchema.nullable(), sevenDay: UsageWindowSchema.nullable(), scoped: z4.array(z4.strictObject({ model: z4.string(), window: UsageWindowSchema })) })
});
var UsageGatewaySchema = z4.strictObject({ routingEnabled: z4.boolean(), port: z4.number().int().nullable() });
var CodexAccountUsageSchema = z4.strictObject({ accountId: z4.string(), email: z4.string(), planLabel: z4.string().nullable(), needsReauthentication: z4.boolean(), pinnedSessionCount: z4.number().int().nonnegative() });
var UsageCodexSchema = z4.strictObject({
  accounts: z4.array(CodexAccountUsageSchema),
  drainTarget: z4.string().nullable(),
  // the account every model's route drains, null when they disagree or none is set
  drainTargetIsManual: z4.boolean()
});
var ACTIVITY_WINDOW_MS = 10 * 6e4;
var AccountActivitySchema = z4.strictObject({ account: z4.string(), requests: z4.number().int().nonnegative(), cacheHitRatio: z4.number().nullable(), lastServed: z4.string() });
var GatewayHealthSchema = z4.strictObject({
  requests: z4.number().int().nonnegative(),
  served: z4.number().int().nonnegative(),
  firstByteP50: z4.number().nullable(),
  // seconds
  firstByteP95: z4.number().nullable(),
  stalls: z4.number().int().nonnegative(),
  // a silence longer than 10 s
  transportFailures: z4.number().int().nonnegative(),
  refused: z4.number().int().nonnegative(),
  unreachable: z4.number().int().nonnegative(),
  held: z4.number().int().nonnegative()
});
var UsageActivitySchema = z4.strictObject({ accounts: z4.array(AccountActivitySchema), health: GatewayHealthSchema });
var UsageSnapshotSchema = z4.strictObject({
  available: z4.boolean(),
  dataDir: z4.string(),
  readAt: z4.string(),
  error: z4.string().nullable(),
  drainTarget: z4.string().nullable(),
  drainTargetIsManual: z4.boolean(),
  // C11's ask: pins.json's flag; false when an older file omits it
  accounts: z4.array(AccountUsageSchema),
  pinsFor: z4.record(z4.string(), z4.string()),
  // engine session id → account uuid, for the ids the caller named
  // W6 start
  gateway: UsageGatewaySchema.nullable(),
  codex: UsageCodexSchema.nullable(),
  activity: UsageActivitySchema.nullable()
  // as of `readAt`
  // W6 end
});

// src/shared/browser/url.ts
var isWebProtocol = (protocol) => protocol === "http:" || protocol === "https:";
function parse(input) {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}
function validateBrowserUrl(input) {
  const url = parse(input);
  if (url === null) return { ok: false, scheme: "" };
  return isWebProtocol(url.protocol) ? { ok: true, url: url.href } : { ok: false, scheme: url.protocol };
}
function isSearchUrlTemplate(template) {
  return template.includes("%s") && !/\s/.test(template) && validateBrowserUrl(template.replaceAll("%s", "x")).ok;
}

// src/shared/engine/app-mcp-servers.ts
import * as z5 from "zod";
var RESERVED_SERVER_NAME = "maws";
var MAX_APP_MCP_SERVERS = 32;
var MAX_SERVER_URL = 2048;
var NAME = /^[A-Za-z0-9_-]{1,64}$/;
var ENGINE_RESERVED_SERVER_NAMES = /* @__PURE__ */ new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "hearthbot",
  "remote-devices",
  "claude_ai",
  "widgets",
  "Claude_Pages",
  "Claude_Docs",
  "claude-in-chrome",
  "computer-use",
  "workspace",
  "webagent",
  "claude-code-remote",
  "remote-browser",
  "claude-device"
]);
var isServerUrl = (url) => {
  if (!URL.canParse(url) || url.trim() !== url) return false;
  const { protocol, hostname } = new URL(url);
  return (protocol === "https:" || protocol === "http:") && hostname !== "";
};
var AppMcpServerSchema = z5.strictObject({
  name: z5.string().regex(NAME, { message: "letters, digits, hyphens and underscores, at most 64" }).refine((name) => name !== RESERVED_SERVER_NAME, { message: `${RESERVED_SERVER_NAME} is MAWS's own server` }).refine((name) => !ENGINE_RESERVED_SERVER_NAMES.has(name), { message: "reserved by Claude Code" }),
  type: z5.literal("http"),
  url: z5.string().max(MAX_SERVER_URL).refine(isServerUrl, { message: "not an http or https URL" })
});
var AppMcpServersSchema = z5.array(AppMcpServerSchema).max(MAX_APP_MCP_SERVERS).refine((servers) => new Set(servers.map((s) => s.name)).size === servers.length, { message: "two servers share a name" });

// src/shared/engine/launch-profile.ts
import * as z6 from "zod";
var MAX_PROFILE_PLUGINS = 256;
var PluginIdSchema = z6.string().max(256).regex(/^[^\s@]+@[^\s@]+$/, "a plugin id, name@marketplace");
var LaunchProfileSchema = z6.strictObject({
  plugins: z6.strictObject({ off: z6.array(PluginIdSchema).max(MAX_PROFILE_PLUGINS) }),
  hooks: z6.enum(["user", "none"])
});
var userScopeProfile = () => ({ plugins: { off: [] }, hooks: "user" });

// src/shared/ipc/schema/settings.ts
var ThemeSettingSchema = z7.enum(["light", "dark", "system"]);
var ChordSchema = z7.string().regex(CHORD_PATTERN);
var NotificationKindsSchema = z7.strictObject({
  turnFinished: z7.boolean(),
  // UX1: v17 → v18 supplies the default
  approvals: z7.boolean(),
  questions: z7.boolean(),
  planReviews: z7.boolean(),
  errors: z7.boolean(),
  heldPeerMessages: z7.boolean(),
  // P2-C start (2026-10-09)
  asyncInput: z7.boolean(),
  essential: z7.boolean()
  // P2-C end
});
var AbsolutePathSchema = z7.string().refine((path) => path.startsWith("/"), { message: "must be an absolute path" });
var EngineSettingsSchema = z7.strictObject({
  binaryPath: AbsolutePathSchema.nullable(),
  // null = the installed Claude Code, resolved per launch (W13; engine-host/binary-info.ts)
  subagentModel: z7.string().nullable(),
  // the default CLAUDE_CODE_SUBAGENT_MODEL for new sessions; null = the captured shell's value
  // C12 start: version 4, the memory budget (C12 execution document, Interfaces "Settings, version 4"; charter §4.4).
  // memoryBudgetMiB: the limit on the sum of the engine process trees; null = 25% of physical memory.
  // statefulMcpServers: MCP server names, exactly as system/init reports them, whose state dies with their process; a
  // connected or connecting one keeps its session live under the budget.
  memoryBudgetMiB: z7.number().int().min(512).nullable(),
  statefulMcpServers: z7.array(z7.string().min(1).max(200)).max(64),
  // C12 end
  // W7: version 7, the budget's switch (charter §4.4 as amended 2026-10-01): off, no process is released for the budget
  // and engine processes never exit on their own; the two fields above are kept for when it is on again. An object, so
  // a patch replaces it whole.
  memoryBudget: z7.strictObject({ enabled: z7.boolean() }),
  // P4-R8: version 16, the MCP servers MAWS passes to every session it launches (`--mcp-config`) and to no terminal
  // session; an HTTP server by name and URL, replaced whole by a patch (src/shared/engine/app-mcp-servers.ts)
  mcpServers: AppMcpServersSchema,
  // P4-A2: version 17, the launch profile every session MAWS launches runs under (the owner's ruling of 2026-10-21: one
  // profile, set here, never chosen per session): which of the user's plugins load and whose hooks apply (version 19: no
  // output style, the user's always); flag-level `--settings` keys only, the user scope by default
  // (src/shared/engine/launch-profile.ts). Replaced whole by a patch.
  launchProfile: LaunchProfileSchema
});
var GatewaySettingsSchema = z7.strictObject({
  defaultRoute: z7.enum(["gateway", "direct"]),
  // D-19: 'gateway'; seeds C10's intent.gateway
  relayUnreachable: z7.enum(["ask", "wait", "direct"]),
  // the launch policy C10's session.start consults
  offerDirect: z7.boolean()
  // the per-session Direct option; D-19's fallback stays when the relay is unreachable
});
var UsageSettingsSchema = z7.strictObject({ nearLimitPercent: z7.number().int().min(50).max(100) });
var TranscriptWidthSchema = z7.union([z7.literal(768), z7.literal(960), z7.literal(1280)]);
var AppearanceSettingsSchema = z7.strictObject({
  monoFont: z7.string().min(1).max(200).nullable(),
  // prepended to --font-mono; null = the token stack
  transcriptWidth: TranscriptWidthSchema
  // W2, version 5
});
var NotificationSettingsSchema = z7.strictObject({ enabled: z7.boolean(), sound: z7.boolean(), kinds: NotificationKindsSchema });
var AutoFallbackSchema = PermissionModeSchema.exclude(["auto"]);
var PermissionsSettingsSchema = z7.strictObject({ autoFallback: AutoFallbackSchema });
var VoiceSettingsSchema = z7.strictObject({ locale: z7.string().min(2).max(32).nullable() });
var MAX_IDLE_MINUTES = 1440;
var SupervisorShapeSchema = z7.enum(["embedded", "daemon"]);
var SupervisorSettingsSchema = z7.strictObject({ idleExitMinutes: z7.number().int().min(1).max(MAX_IDLE_MINUTES).nullable(), keepRunningDefault: z7.boolean(), shape: SupervisorShapeSchema });
var BrowserSettingsSchema = z7.strictObject({
  profile: z7.string().min(1).max(200).nullable(),
  searchUrl: z7.string().max(2048).refine(isSearchUrlTemplate, { message: "not an http or https URL with %s" }),
  linkTarget: z7.enum(["in-app", "external"]),
  // cua #90: version 12, whether an imported profile's tabs show its bookmarks bar (⌘⇧B in the browser, Settings › Browser)
  bookmarksBar: z7.enum(["shown", "hidden"])
});
var ModsSettingsSchema = z7.strictObject({ toHuman: z7.strictObject({ enabled: z7.boolean() }) });
var ArtifactsSettingsSchema = z7.strictObject({
  defaultDesignSystem: z7.uuid().nullable(),
  spaceDesignSystems: z7.record(z7.uuid(), z7.uuid()),
  // Space id → design system id
  // P4-B1 (X36; the P4 interface ledger's §6 slot): version 15, View › Comments for every document: Expand (cards in the
  // margin), Minimize (icons at the anchors), Hide (an empty margin); per user, so it lives here and not on the artifact
  commentsView: z7.enum(["expand", "minimize", "hide"]),
  // WR 73: additive at v17; absent/null uses the routed account's name, or a neutral label, never the OS login.
  exportAuthorName: z7.string().trim().min(1).max(200).nullable().optional()
});
var SessionSettingsSchema = z7.strictObject({ archiveInactiveDays: z7.union([z7.literal(7), z7.literal(14), z7.literal(30)]).nullable() });
var SettingsSchema = z7.strictObject({
  version: z7.literal(21),
  // C11: version 3; C12: version 4 (engine.memoryBudgetMiB, engine.statefulMcpServers); W2: version 5 (appearance.transcriptWidth); W3: version 6 (permissions.autoFallback); W7: version 7 (engine.memoryBudget); W13: version 8 (engine.pinnedVersion removed); E9: version 9 (voice); E10: version 10 (supervisor); E4a: version 11 (browser); cua #90: version 12 (browser.bookmarksBar); P2-C: version 13 (mods, notifications.kinds.asyncInput and .essential); P3-D: version 14 (artifacts); P4-B1: version 15 (artifacts.commentsView); P4-R8: version 16 (engine.mcpServers); P4-A2: version 17 (engine.launchProfile); UX1: version 18 (sessions.archiveInactiveDays, notifications.kinds.turnFinished); version 19 (engine.launchProfile.outputStyle removed); P5 O2: version 20 (supervisor.shape); P5 O3-A: version 21, the client file's (the merged settings have no file of their own; the split by owner below)
  theme: ThemeSettingSchema,
  // Overrides only; null unbinds; absent means the default. `partialRecord`, because zod 4's enum-keyed `record` is
  // exhaustive and would reject `{}` and every single override; unknown keys are still rejected.
  keymap: z7.partialRecord(z7.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: NotificationSettingsSchema,
  // C11: C5's two fields plus kinds
  // C11 start
  engine: EngineSettingsSchema,
  gateway: GatewaySettingsSchema,
  usage: UsageSettingsSchema,
  appearance: AppearanceSettingsSchema,
  // C11 end
  permissions: PermissionsSettingsSchema,
  // W3
  voice: VoiceSettingsSchema,
  // E9
  supervisor: SupervisorSettingsSchema,
  // E10
  browser: BrowserSettingsSchema,
  // E4a
  mods: ModsSettingsSchema,
  // P2-C (2026-10-09)
  artifacts: ArtifactsSettingsSchema,
  // P3-D (2026-10-13)
  sessions: SessionSettingsSchema
  // UX1: v18 migration fills absent policy
});
var CLIENT_SETTINGS_VERSION = 21;
var MACHINE_SETTINGS_VERSION = 1;
var ClientSettingsSchema = z7.strictObject({
  version: z7.literal(CLIENT_SETTINGS_VERSION),
  theme: SettingsSchema.shape.theme,
  keymap: SettingsSchema.shape.keymap,
  notifications: SettingsSchema.shape.notifications,
  usage: SettingsSchema.shape.usage,
  // the status line's banner threshold
  appearance: SettingsSchema.shape.appearance,
  voice: SettingsSchema.shape.voice,
  browser: SettingsSchema.shape.browser,
  supervisor: SupervisorSettingsSchema.omit({ idleExitMinutes: true }),
  // the shape, read before any daemon; the quit question's default
  artifacts: ArtifactsSettingsSchema.pick({ commentsView: true, exportAuthorName: true })
  // a view preference; the name on the app's exports
});
var MachineSettingsSchema = z7.strictObject({
  version: z7.literal(MACHINE_SETTINGS_VERSION),
  engine: SettingsSchema.shape.engine,
  // every launch on the machine
  gateway: SettingsSchema.shape.gateway,
  // the inference route is per machine (RL6)
  permissions: SettingsSchema.shape.permissions,
  // applied at launch by the session service
  mods: SettingsSchema.shape.mods,
  // the owner channel's launch decision
  supervisor: SupervisorSettingsSchema.pick({ idleExitMinutes: true }),
  // the engine host's idle time; mawsd reads it with no app
  artifacts: ArtifactsSettingsSchema.pick({ defaultDesignSystem: true, spaceDesignSystems: true }),
  // relayed to the engine host's store
  sessions: SettingsSchema.shape.sessions
  // the sweep
});
var SettingsPatchSchema = z7.strictObject({
  theme: ThemeSettingSchema.optional(),
  keymap: SettingsSchema.shape.keymap.optional(),
  notifications: z7.strictObject({ enabled: z7.boolean().optional(), sound: z7.boolean().optional(), kinds: NotificationKindsSchema.partial().extend({ turnFinished: z7.boolean().optional() }).optional() }).optional(),
  engine: EngineSettingsSchema.partial().optional(),
  gateway: GatewaySettingsSchema.partial().optional(),
  usage: UsageSettingsSchema.partial().optional(),
  appearance: AppearanceSettingsSchema.partial().optional(),
  permissions: PermissionsSettingsSchema.partial().optional(),
  // W3
  voice: VoiceSettingsSchema.partial().optional(),
  // E9
  supervisor: SupervisorSettingsSchema.partial().optional(),
  // E10
  browser: BrowserSettingsSchema.partial().optional(),
  // E4a
  // P2-C start (2026-10-09): a mod's fields are patched one by one, so the to-human switch is written alone
  mods: z7.strictObject({ toHuman: ModsSettingsSchema.shape.toHuman.partial().optional() }).optional(),
  // P2-C end
  // P3-D start (2026-10-13): field by field; the Spaces' record is replaced whole, so a Space's default is removed by
  // leaving it out
  artifacts: ArtifactsSettingsSchema.partial().optional(),
  sessions: SessionSettingsSchema.partial().optional()
  // P3-D end
});
var MachineSettingsPatchSchema = z7.strictObject({
  engine: SettingsPatchSchema.shape.engine,
  gateway: SettingsPatchSchema.shape.gateway,
  permissions: SettingsPatchSchema.shape.permissions,
  mods: SettingsPatchSchema.shape.mods,
  supervisor: MachineSettingsSchema.shape.supervisor.partial().optional(),
  artifacts: MachineSettingsSchema.shape.artifacts.partial().optional(),
  sessions: SettingsPatchSchema.shape.sessions
});
var SettingsStateSchema = z7.strictObject({ settings: SettingsSchema, resolvedTheme: z7.enum(["light", "dark"]) });
var c7Commands = {
  "settings.usage": { input: z7.strictObject({ engineSessionIds: z7.array(z7.string()).max(64) }), output: UsageSnapshotSchema, owner: "main" }
};
var c7Events = {
  "settings.usageChanged": UsageSnapshotSchema
};
var CLAUDE_USAGE_BUNDLE_ID = "com.haegi.ClaudeUsage";
var ClaudeUsageStatusSchema = z7.strictObject({ installed: z7.boolean(), running: z7.boolean(), bundleId: z7.literal(CLAUDE_USAGE_BUNDLE_ID), dataDirPresent: z7.boolean(), checkedAt: z7.string() });
var ClaudeUsageOpenIntentSchema = z7.discriminatedUnion("intent", [
  z7.strictObject({ intent: z7.literal("panel") }),
  z7.strictObject({ intent: z7.literal("addAccount") }),
  z7.strictObject({ intent: z7.literal("reconnect"), accountEmail: z7.string().min(1) }),
  z7.strictObject({ intent: z7.literal("remove"), accountEmail: z7.string().min(1) })
]);
var ClaudeUsageOpenResultSchema = z7.strictObject({ opened: z7.boolean(), reason: z7.enum(["not_installed", "launch_failed"]).nullable(), instruction: z7.string() });
var c11Commands = {
  // installed: Spotlight knows the bundle id (cached 60 s); running: the relay's hello answered (the listener runs whenever
  // ClaudeUsage does); dataDirPresent: C7's reader found its files
  "settings.claudeUsage.status": { input: z7.void(), output: ClaudeUsageStatusSchema, owner: "main" },
  "settings.claudeUsage.open": { input: ClaudeUsageOpenIntentSchema, output: ClaudeUsageOpenResultSchema, owner: "main" },
  // shell.showItemInFolder for a path under the engine's config home or a session's directories; never opens or edits it
  "settings.reveal": { input: z7.strictObject({ path: z7.string() }), output: z7.strictObject({ revealed: z7.boolean() }), owner: "main" }
};
var UserEngineDefaultsSchema = z7.strictObject({ model: z7.string().nullable(), effortLevel: EffortSchema.nullable(), defaultMode: PermissionModeSchema.nullable() });
var w3Commands = {
  "settings.userEngineDefaults": { input: z7.void(), output: UserEngineDefaultsSchema, owner: "machine" }
};
var c12Commands = {
  "settings.engineApplied": { input: z7.void(), output: z7.void(), owner: "machine" }
};
var UsageControlReasonSchema = z7.enum([
  "no_route",
  // no token file, no port, a 404 or a refused connection: this ClaudeUsage has no control route
  "bad_token",
  // a 401, or a token file that cannot be read
  "timeout",
  // no answer within the client's limit
  "starting",
  // a 503: the relay answers but ClaudeUsage's app is not wired to it yet
  "failed"
  // any other status, or an answer that is not the state
]);
var UsageControlStateSchema = z7.strictObject({
  updatedAt: z7.string().nullable(),
  routing: z7.strictObject({ enabled: z7.boolean(), ready: z7.boolean(), port: z7.number().int().nullable(), drainTarget: z7.string().nullable(), drainTargetIsManual: z7.boolean() }),
  // `status` is ClaudeUsage's own case name in snake_case; `canRoute`, `canReconnect` and `canRemove` are ClaudeUsage's
  // own word on each account's actions, null when the state does not carry them
  accounts: z7.array(
    z7.strictObject({ uuid: z7.string(), email: z7.string(), status: z7.string(), isRoutingHere: z7.boolean(), canRoute: z7.boolean().nullable(), canReconnect: z7.boolean().nullable(), canRemove: z7.boolean().nullable() })
  ),
  codex: z7.array(z7.strictObject({ id: z7.string(), label: z7.string(), isDrainTarget: z7.boolean() }))
});
var UsageControlsAnswerSchema = z7.strictObject({ available: z7.boolean(), reason: UsageControlReasonSchema.nullable(), state: UsageControlStateSchema.nullable() });
var UsageActionSchema = z7.discriminatedUnion("action", [
  z7.strictObject({ action: z7.literal("route"), uuid: z7.string().min(1) }),
  // POST /claudeusage/route
  z7.strictObject({ action: z7.literal("add"), email: z7.string().min(1).nullable().optional() }),
  // POST /claudeusage/accounts/add: ClaudeUsage's sign-in sheet
  z7.strictObject({ action: z7.literal("reconnect"), uuid: z7.string().min(1) }),
  // POST /claudeusage/accounts/reconnect: the same sheet
  z7.strictObject({ action: z7.literal("remove"), uuid: z7.string().min(1), confirm: z7.boolean().optional() }),
  // POST /claudeusage/accounts/remove: refused without confirm
  z7.strictObject({ action: z7.literal("panel") })
  // POST /claudeusage/panel: toggles ClaudeUsage's own panel
]);
var UsageActionResultSchema = z7.discriminatedUnion("ok", [
  z7.strictObject({ ok: z7.literal(true), drainTarget: z7.string().nullable(), drainTargetIsManual: z7.boolean(), shown: z7.boolean().nullable() }),
  z7.strictObject({ ok: z7.literal(false), reason: z7.string(), message: z7.string() })
]);
var w6RouteCommands = {
  "settings.usageControls": { input: z7.void(), output: UsageControlsAnswerSchema, owner: "main" },
  "settings.usageAction": { input: UsageActionSchema, output: UsageActionResultSchema, owner: "main" }
};
var commands = {
  "settings.get": { input: z7.void(), output: SettingsStateSchema, owner: "main" },
  "settings.set": { input: SettingsPatchSchema, output: SettingsStateSchema, owner: "main" },
  ...c7Commands,
  // C7
  ...c11Commands,
  // C11
  ...c12Commands,
  // C12
  ...w3Commands,
  // W3
  ...w6RouteCommands
  // W6 route executor
};
var events = {
  "settings.changed": SettingsStateSchema,
  ...c7Events
  // C7
};

// src/shared/settings/defaults.ts
var SETTINGS_DEFAULTS_V21 = {
  version: 21,
  // C12: 4; W2: 5; W3: 6; W7: 7; W13: 8; E9: 9; E10: 10; E4a: 11; cua #90: 12; P2-C: 13; P3-D: 14; P4-B1: 15; P4-R8: 16; P4-A2: 17; UX1: 18; the launch profile's style removed: 19; P5 O2: 20; P5 O3-A: 21 (the client file's)
  sessions: { archiveInactiveDays: null },
  // UX1: opt-in only
  theme: "light",
  // light-first (D-4, charter §10 item 10)
  keymap: {},
  notifications: { enabled: true, sound: false, kinds: {
    turnFinished: true,
    approvals: true,
    questions: true,
    planReviews: true,
    errors: true,
    heldPeerMessages: false,
    asyncInput: true,
    essential: true
    /* P2-C */
  } },
  engine: {
    binaryPath: null,
    subagentModel: null,
    memoryBudgetMiB: null,
    statefulMcpServers: [],
    memoryBudget: { enabled: true },
    mcpServers: [],
    launchProfile: userScopeProfile()
    /* P4-A2: the user scope */
  },
  // W13: binaryPath null, the installed Claude Code
  gateway: { defaultRoute: "gateway", relayUnreachable: "ask", offerDirect: true },
  // D-19
  usage: { nearLimitPercent: 90 },
  appearance: {
    monoFont: null,
    transcriptWidth: 768
    /* W2 */
  },
  permissions: { autoFallback: "acceptEdits" },
  // W3: the owner's ruling of 2026-10-01 (charter D-18)
  voice: { locale: null },
  // E9: the system locale
  supervisor: { idleExitMinutes: 10, keepRunningDefault: true, shape: "daemon" },
  // E10: ruled by A-29 (residue 10 and 11); P5 O2 M7: the machine daemon
  browser: { profile: null, searchUrl: "https://www.google.com/search?q=%s", linkTarget: "in-app", bookmarksBar: "shown" },
  // E4a: the default partition; Google (Decision Log 10); new-window links in the app (Decision Log 11); cua #90: the bookmarks bar shown
  mods: { toHuman: { enabled: true } },
  // P2-C: the to-human lane on (the P2-C document, §9)
  artifacts: {
    defaultDesignSystem: null,
    spaceDesignSystems: {},
    commentsView: "expand"
    /* P4-B1: Docs' default, the cards in the margin */
  }
  // P3-D: the house system, no Space defaults (D9)
};
var SettingsV1Schema = z8.strictObject({ version: z8.literal(1), theme: ThemeSettingSchema });
var SettingsV2Schema = z8.strictObject({
  version: z8.literal(2),
  theme: ThemeSettingSchema,
  keymap: z8.partialRecord(z8.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: z8.strictObject({ enabled: z8.boolean(), sound: z8.boolean() })
});
var SettingsV20Schema = SettingsSchema.extend({ version: z8.literal(20) });
var SettingsV19Schema = SettingsSchema.extend({ version: z8.literal(19), supervisor: SupervisorSettingsSchema.omit({ shape: true }) });
var SettingsV18Schema = SettingsV19Schema.extend({
  version: z8.literal(18),
  engine: SettingsSchema.shape.engine.extend({ launchProfile: LaunchProfileSchema.extend({ outputStyle: z8.enum(["user", "maws"]) }) })
});
var SettingsV17Schema = SettingsV18Schema.extend({
  version: z8.literal(17),
  sessions: SettingsSchema.shape.sessions.optional(),
  notifications: SettingsSchema.shape.notifications.extend({ kinds: SettingsSchema.shape.notifications.shape.kinds.extend({ turnFinished: z8.boolean().optional() }) })
});
var SettingsV16Schema = SettingsV17Schema.omit({ sessions: true }).extend({ version: z8.literal(16), engine: SettingsSchema.shape.engine.omit({ launchProfile: true }), notifications: SettingsSchema.shape.notifications.extend({ kinds: SettingsSchema.shape.notifications.shape.kinds.omit({ turnFinished: true }) }) });
var SettingsV15Schema = SettingsV16Schema.extend({ version: z8.literal(15), engine: SettingsV16Schema.shape.engine.omit({ mcpServers: true }) });
var SettingsV14Schema = SettingsV15Schema.extend({ version: z8.literal(14), artifacts: SettingsSchema.shape.artifacts.omit({ commentsView: true }) });
var SettingsV13Schema = SettingsV14Schema.omit({ artifacts: true }).extend({ version: z8.literal(13) });
var SettingsV12Schema = SettingsV13Schema.omit({ mods: true }).extend({
  version: z8.literal(12),
  notifications: SettingsV13Schema.shape.notifications.extend({ kinds: SettingsV13Schema.shape.notifications.shape.kinds.omit({ asyncInput: true, essential: true }) })
});
var SettingsV11Schema = SettingsV12Schema.extend({ version: z8.literal(11), browser: BrowserSettingsSchema.omit({ bookmarksBar: true }) });
var SettingsV10Schema = SettingsV11Schema.omit({ browser: true }).extend({ version: z8.literal(10) });
var SettingsV9Schema = SettingsV10Schema.omit({ supervisor: true }).extend({ version: z8.literal(9) });
var SettingsV8Schema = SettingsV9Schema.omit({ voice: true }).extend({ version: z8.literal(8) });
var SettingsV7Schema = SettingsV8Schema.extend({ version: z8.literal(7), engine: SettingsV8Schema.shape.engine.extend({ pinnedVersion: z8.string() }) });
var SettingsV6Schema = SettingsV7Schema.extend({ version: z8.literal(6), engine: SettingsV7Schema.shape.engine.omit({ memoryBudget: true }) });
var SettingsV5Schema = SettingsV6Schema.omit({ permissions: true }).extend({ version: z8.literal(5) });
var SettingsV4Schema = SettingsV5Schema.extend({
  version: z8.literal(4),
  appearance: SettingsSchema.shape.appearance.omit({ transcriptWidth: true })
});
var SettingsV3Schema = SettingsV4Schema.extend({
  version: z8.literal(3),
  engine: SettingsV4Schema.shape.engine.omit({ memoryBudgetMiB: true, statefulMcpServers: true })
  // W7: version 4's engine, without the switch
});
function migrateMachineSettings(input) {
  return MachineSettingsSchema.parse(input);
}
export {
  migrateMachineSettings
};
