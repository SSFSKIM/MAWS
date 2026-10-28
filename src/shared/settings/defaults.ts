// The values of MAWS's own settings file (C11 execution document, Interfaces "Settings, version 3"): the current
// version's defaults (W13: version 8; E9: version 9; E10: version 10; E4a: version 11; cua #90: version 12; P2-C: version 13; P3-D: version 14; P4-B1: version 15; P4-R8: version 16; P4-A2: version 17; UX1: version 18; the launch profile's style removed: version 19), the one migration from every earlier version, and the one patch merge
// `settings.set` applies. Pure; main's store (src/main/settings/store.ts) reads, migrates, merges and writes with these,
// and nothing else does.
import * as z from 'zod';
import { ACTION_IDS, RETIRED_ACTION_IDS } from '../keymap/actions';
import { BrowserSettingsSchema, ChordSchema, SettingsSchema, ThemeSettingSchema, type Settings, type SettingsPatch } from '../ipc/schema/settings';
import { LaunchProfileSchema, userScopeProfile } from '../engine/launch-profile'; // P4-A2

export const SETTINGS_DEFAULTS_V19: Settings = {
  version: 19, // C12: 4; W2: 5; W3: 6; W7: 7; W13: 8; E9: 9; E10: 10; E4a: 11; cua #90: 12; P2-C: 13; P3-D: 14; P4-B1: 15; P4-R8: 16; P4-A2: 17; UX1: 18; the launch profile's style removed: 19
  sessions: { archiveInactiveDays: null }, // UX1: opt-in only
  theme: 'light', // light-first (D-4, charter §10 item 10)
  keymap: {},
  notifications: { enabled: true, sound: false, kinds: { turnFinished: true, approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false, asyncInput: true, essential: true /* P2-C */ } },
  engine: { binaryPath: null, subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */, memoryBudget: { enabled: true } /* W7 */, mcpServers: [] /* P4-R8: MAWS's code names no server */, launchProfile: userScopeProfile() /* P4-A2: the user scope */ }, // W13: binaryPath null, the installed Claude Code
  gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true }, // D-19
  usage: { nearLimitPercent: 90 },
  appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
  permissions: { autoFallback: 'acceptEdits' }, // W3: the owner's ruling of 2026-10-01 (charter D-18)
  voice: { locale: null }, // E9: the system locale
  supervisor: { idleExitMinutes: 10, keepRunningDefault: true }, // E10: ruled by A-29 (residue 10 and 11)
  browser: { profile: null, searchUrl: 'https://www.google.com/search?q=%s', linkTarget: 'in-app', bookmarksBar: 'shown' }, // E4a: the default partition; Google (Decision Log 10); new-window links in the app (Decision Log 11); cua #90: the bookmarks bar shown
  mods: { toHuman: { enabled: true } }, // P2-C: the to-human lane on (the P2-C document, §9)
  artifacts: { defaultDesignSystem: null, spaceDesignSystems: {}, commentsView: 'expand' /* P4-B1: Docs' default, the cards in the margin */ }, // P3-D: the house system, no Space defaults (D9)
};

// The earlier files, as their versions wrote them: C1's and C5's.
const SettingsV1Schema = z.strictObject({ version: z.literal(1), theme: ThemeSettingSchema });
const SettingsV2Schema = z.strictObject({
  version: z.literal(2),
  theme: ThemeSettingSchema,
  keymap: z.partialRecord(z.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: z.strictObject({ enabled: z.boolean(), sound: z.boolean() }),
});

// The launch profile's style removed (the owner's ruling of 2026-10-28): UX1's version 18, as it wrote it: version 19's
// sections with the launch profile's output style, the user's or MAWS's (the engine's default style)
const SettingsV18Schema = SettingsSchema.extend({
  version: z.literal(18),
  engine: SettingsSchema.shape.engine.extend({ launchProfile: LaunchProfileSchema.extend({ outputStyle: z.enum(['user', 'maws']) }) }),
});
type SettingsV18 = z.infer<typeof SettingsV18Schema>;

// UX1-A + UX1-B: v17 predates both policies. The independently built batches could
// also write either field at v17; preserve those choices when migrating. (Re-based on version 18 when the style went.)
const SettingsV17Schema = SettingsV18Schema.extend({
  version: z.literal(17),
  sessions: SettingsSchema.shape.sessions.optional(),
  notifications: SettingsSchema.shape.notifications.extend({ kinds: SettingsSchema.shape.notifications.shape.kinds.extend({ turnFinished: z.boolean().optional() }) }),
});
type SettingsV17 = z.infer<typeof SettingsV17Schema>;

// P4-A2 start (2026-10-21): P4-R8's version 16, as it wrote it: version 17's sections less the launch profile
const SettingsV16Schema = SettingsV17Schema.omit({ sessions: true }).extend({ version: z.literal(16), engine: SettingsSchema.shape.engine.omit({ launchProfile: true }), notifications: SettingsSchema.shape.notifications.extend({ kinds: SettingsSchema.shape.notifications.shape.kinds.omit({ turnFinished: true }) }) });
type SettingsV16 = z.infer<typeof SettingsV16Schema>;
// P4-A2 end
// P4-R8 start (2026-10-21): P4-B1's version 15, as it wrote it: version 16's sections less the app's MCP servers (P4-A2:
// re-based on version 16)
const SettingsV15Schema = SettingsV16Schema.extend({ version: z.literal(15), engine: SettingsV16Schema.shape.engine.omit({ mcpServers: true }) });
type SettingsV15 = z.infer<typeof SettingsV15Schema>;
// P4-R8 end
// P4-B1 start (2026-10-20): P3-D's version 14, as it wrote it: version 15's sections less the comments view (P4-R8:
// re-based on version 15)
const SettingsV14Schema = SettingsV15Schema.extend({ version: z.literal(14), artifacts: SettingsSchema.shape.artifacts.omit({ commentsView: true }) });
type SettingsV14 = z.infer<typeof SettingsV14Schema>;
// P4-B1 end
// P3-D start (2026-10-13): P2-C's version 13, as it wrote it: version 14's sections less the design-system defaults
const SettingsV13Schema = SettingsV14Schema.omit({ artifacts: true }).extend({ version: z.literal(13) });
type SettingsV13 = z.infer<typeof SettingsV13Schema>;
// P3-D end

// P2-C start (2026-10-09): cua #90's version 12, as it wrote it: version 13's sections less the mods section, and the
// notification kinds less the owner channel's two groups (P3-D: re-based on version 13)
const SettingsV12Schema = SettingsV13Schema.omit({ mods: true }).extend({
  version: z.literal(12),
  notifications: SettingsV13Schema.shape.notifications.extend({ kinds: SettingsV13Schema.shape.notifications.shape.kinds.omit({ asyncInput: true, essential: true }) }),
});
type SettingsV12 = z.infer<typeof SettingsV12Schema>;
// P2-C end

// cua #90 start: E4a's version 11, as it wrote it: version 12's sections less the bookmarks bar's switch (P2-C: re-based on version 12)
const SettingsV11Schema = SettingsV12Schema.extend({ version: z.literal(11), browser: BrowserSettingsSchema.omit({ bookmarksBar: true }) });
type SettingsV11 = z.infer<typeof SettingsV11Schema>;
// cua #90 end

// E4a start: E10's version 10, as it wrote it: version 11's sections less the browser section (cua #90: re-based on version 11)
const SettingsV10Schema = SettingsV11Schema.omit({ browser: true }).extend({ version: z.literal(10) });
type SettingsV10 = z.infer<typeof SettingsV10Schema>;
// E4a end

// E10 start: E9's version 9, as it wrote it: version 10's sections less the supervisor section (E4a: re-based on version 10)
const SettingsV9Schema = SettingsV10Schema.omit({ supervisor: true }).extend({ version: z.literal(9) });
type SettingsV9 = z.infer<typeof SettingsV9Schema>;
// E10 end

// E9 start: W13's version 8, as it wrote it: version 9's sections less the voice section (E10: re-based on version 9)
const SettingsV8Schema = SettingsV9Schema.omit({ voice: true }).extend({ version: z.literal(8) });
type SettingsV8 = z.infer<typeof SettingsV8Schema>;
// E9 end

// W13 start: W7's version 7, as it wrote it: version 8's sections with the engine's pin (E9: re-based on version 8)
const SettingsV7Schema = SettingsV8Schema.extend({ version: z.literal(7), engine: SettingsV8Schema.shape.engine.extend({ pinnedVersion: z.string() }) });
type SettingsV7 = z.infer<typeof SettingsV7Schema>;
// W13 end

// W7 start: W3's version 6, as it wrote it: version 7's sections less the budget's switch
const SettingsV6Schema = SettingsV7Schema.extend({ version: z.literal(6), engine: SettingsV7Schema.shape.engine.omit({ memoryBudget: true }) });
type SettingsV6 = z.infer<typeof SettingsV6Schema>;
// W7 end

// W3 start: W2's version 5, as it wrote it: version 6's sections less the permissions
const SettingsV5Schema = SettingsV6Schema.omit({ permissions: true }).extend({ version: z.literal(5) });
type SettingsV5 = z.infer<typeof SettingsV5Schema>;
// W3 end

// W2 start: C12's version 4, as it wrote it: version 5's sections less the transcript's width
const SettingsV4Schema = SettingsV5Schema.extend({
  version: z.literal(4),
  appearance: SettingsSchema.shape.appearance.omit({ transcriptWidth: true }),
});
type SettingsV4 = z.infer<typeof SettingsV4Schema>;
// W2 end

// C12 start: C11's version 3, as it wrote it: version 4's sections less the budget's two engine fields
const SettingsV3Schema = SettingsV4Schema.extend({
  version: z.literal(3),
  engine: SettingsV4Schema.shape.engine.omit({ memoryBudgetMiB: true, statefulMcpServers: true }), // W7: version 4's engine, without the switch
});
// C12 end

const defaults = (): Settings => structuredClone(SETTINGS_DEFAULTS_V19);

// v18 → v19, the launch profile's output style dropped: a profile that chose MAWS's (the engine's default style) keeps
// the user's own from now on, as every profile does
const fromV18 = (v18: SettingsV18): Settings => {
  const { outputStyle: _style, ...launchProfile } = v18.engine.launchProfile;
  void _style;
  return { ...v18, version: 19, engine: { ...v18.engine, launchProfile } };
};
// UX1: v17 → v18, archive Never and completed-turn notifications on unless already chosen; then v18 → v19
const fromV17 = (v17: SettingsV17): Settings => fromV18({ ...v17, version: 18, sessions: v17.sessions ?? defaults().sessions, notifications: { ...v17.notifications, kinds: { ...v17.notifications.kinds, turnFinished: v17.notifications.kinds.turnFinished ?? defaults().notifications.kinds.turnFinished } } });

// P4-A2: v16 → v17, the user scope (nothing changes until the owner sets a profile in Settings › Engine), whose style
// was the user's
const fromV16 = (v16: SettingsV16): Settings => fromV17({ ...v16, version: 17, engine: { ...v16.engine, launchProfile: { ...defaults().engine.launchProfile, outputStyle: 'user' } } });
// P4-R8: v15 → v16, no app MCP servers (the owner adds theirs in Settings › Engine); P4-A2: then v16 → v17
const fromV15 = (v15: SettingsV15): Settings => fromV16({ ...v15, version: 16, engine: { ...v15.engine, mcpServers: [] } });
// P4-B1: v14 → v15, the comments view at its default (the cards in the margin); P4-R8: then v15 → v16
const fromV14 = (v14: SettingsV14): Settings => fromV15({ ...v14, version: 15, artifacts: { ...v14.artifacts, commentsView: defaults().artifacts.commentsView } });
// P3-D: v13 → v14, the design-system defaults empty: the house system, no Space defaults; P4-B1: then v14 → v15
const fromV13 = (v13: SettingsV13): Settings => {
  const { commentsView: _view, ...artifacts } = defaults().artifacts;
  void _view;
  return fromV14({ ...v13, version: 14, artifacts });
};
// P2-C: v12 → v13, the mods section with the to-human lane on, and the owner channel's two notification groups on;
// P3-D: then v13 → v14
const fromV12 = (v12: SettingsV12): Settings => {
  const { mods, notifications } = defaults();
  return fromV13({ ...v12, version: 13, notifications: { ...v12.notifications, kinds: { ...v12.notifications.kinds, asyncInput: notifications.kinds.asyncInput, essential: notifications.kinds.essential } }, mods });
};
// cua #90: v11 → v12, the bookmarks bar shown; P2-C: then v12 → v13
const fromV11 = (v11: SettingsV11): Settings => fromV12({ ...v11, version: 12, browser: { ...v11.browser, bookmarksBar: defaults().browser.bookmarksBar } });
// E4a: v10 → v11, the browser section with its defaults (cua #90: then v11 → v12)
const fromV10 = (v10: SettingsV10): Settings => {
  const { bookmarksBar: _bar, ...browser } = defaults().browser;
  void _bar;
  return fromV11({ ...v10, version: 11, browser });
};
// E10: v9 → v10, the supervisor section with its defaults; E4a: then v10 → v11
const fromV9 = (v9: SettingsV9): Settings => fromV10({ ...v9, version: 10, supervisor: defaults().supervisor });
// E9: v8 → v9, the voice section with the system locale; E10: then v9 → v10
const fromV8 = (v8: SettingsV8): Settings => fromV9({ ...v8, version: 9, voice: defaults().voice });
// W13: v7 → v8, the pin dropped (charter D-1 as amended 2026-10-01): a chosen binaryPath stays chosen; E9: then v8 → v9
const fromV7 = (v7: SettingsV7): Settings => {
  const { pinnedVersion: _pin, ...engine } = v7.engine;
  void _pin;
  return fromV8({ ...v7, version: 8, engine });
};
// W7: v6 → v7, the budget's switch on (the architect's default, charter §4.4 as amended 2026-10-01); W13: then v7 → v8
const fromV6 = (v6: SettingsV6): Settings => fromV7({ ...v6, version: 7, engine: { ...v6.engine, memoryBudget: defaults().engine.memoryBudget } });
// W3: v5 → v6, the auto fallback's default (W7: then v6 → v7)
const fromV5 = (v5: SettingsV5): Settings => fromV6({ ...v5, version: 6, permissions: defaults().permissions });
// W2: v4 → v5, the transcript's default width (W3: then v5 → v6)
const fromV4 = (v4: SettingsV4): Settings => fromV5({ ...v4, version: 5, appearance: { ...v4.appearance, transcriptWidth: defaults().appearance.transcriptWidth } });

// v1 → v2 (C5's step: no keymap overrides, the notification defaults) → v3 (the sections C11 adds, with their
// defaults) → v4 (C12's budget) → v5 (W2's transcript width) → v6 (W3's auto fallback) → v7 (W7's budget switch) → v8
// (W13: the pin dropped) → v9 (E9: the voice section) → v10 (E10: the supervisor section) → v11 (E4a: the browser
// section) → v12 (cua #90: the bookmarks bar's switch) → v13 (P2-C: the mods section and two notification groups) → v14
// (P3-D: the design-system defaults) → v15 (P4-B1: the comments view) → v16 (P4-R8: the app's MCP servers) → v17 (P4-A2:
// the launch profile) → v18 (UX1: inactive archive and turn-finished notifications) → v19 (the launch profile's style
// dropped). A version 19 object is validated and returned as it is;
// anything else (another version, an invalid file of a known version) throws the schema's error, which the store turns
// into the defaults with a warning. At any version, overrides of a retired action are dropped first (W10).
export function migrateSettings(input: unknown): Settings {
  const raw = withoutRetiredActions(input);
  const version = typeof raw === 'object' && raw !== null ? (raw as { version?: unknown }).version : undefined;
  switch (version) {
    case 1: {
      const v1 = SettingsV1Schema.parse(raw);
      return { ...defaults(), theme: v1.theme };
    }
    case 2: {
      const v2 = SettingsV2Schema.parse(raw);
      const base = defaults();
      return { ...base, theme: v2.theme, keymap: v2.keymap, notifications: { ...v2.notifications, kinds: base.notifications.kinds } };
    }
    // C12 start: v3 → v4, the budget's defaults (25% of physical memory, no stateful servers); W2: then v4 → v5
    case 3: {
      const v3 = SettingsV3Schema.parse(raw);
      const { engine } = defaults();
      return fromV4({ ...v3, version: 4, engine: { ...v3.engine, memoryBudgetMiB: engine.memoryBudgetMiB, statefulMcpServers: engine.statefulMcpServers } });
    }
    // C12 end
    case 4:
      return fromV4(SettingsV4Schema.parse(raw)); // W2
    case 5:
      return fromV5(SettingsV5Schema.parse(raw)); // W3
    case 6:
      return fromV6(SettingsV6Schema.parse(raw)); // W7
    case 7:
      return fromV7(SettingsV7Schema.parse(raw)); // W13
    case 8:
      return fromV8(SettingsV8Schema.parse(raw)); // E9
    case 9:
      return fromV9(SettingsV9Schema.parse(raw)); // E10
    case 10:
      return fromV10(SettingsV10Schema.parse(raw)); // E4a
    case 11:
      return fromV11(SettingsV11Schema.parse(raw)); // cua #90
    case 12:
      return fromV12(SettingsV12Schema.parse(raw)); // P2-C
    case 13:
      return fromV13(SettingsV13Schema.parse(raw)); // P3-D
    case 14:
      return fromV14(SettingsV14Schema.parse(raw)); // P4-B1
    case 15:
      return fromV15(SettingsV15Schema.parse(raw)); // P4-R8
    case 16:
      return fromV16(SettingsV16Schema.parse(raw)); // P4-A2
    case 17:
      return fromV17(SettingsV17Schema.parse(raw)); // UX1-A + UX1-B
    case 18:
      return fromV18(SettingsV18Schema.parse(raw)); // the launch profile's style removed
    default:
      return SettingsSchema.parse(raw);
  }
}

// W10: a keymap override naming an action that no longer exists (⌥Enter's hold) would fail the keymap's schema and
// reset the whole file to the defaults; it is left out instead, and the file loses it at its next write.
function withoutRetiredActions(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const keymap = (raw as { keymap?: unknown }).keymap;
  if (typeof keymap !== 'object' || keymap === null || !RETIRED_ACTION_IDS.some((id) => id in keymap)) return raw;
  return { ...raw, keymap: Object.fromEntries(Object.entries(keymap).filter(([id]) => !RETIRED_ACTION_IDS.includes(id))) };
}

// The one merge rule (Interfaces, stated once): a patch is merged one level deep, section by section and field by
// field, and `notifications.kinds` a second level, key by key, so a kinds patch never replaces the sibling kinds. The
// theme and the keymap are values of their own and are replaced whole. A key present as `undefined` changes nothing.
export function applySettingsPatch(state: Settings, patch: SettingsPatch): Settings {
  const { notifications, engine, gateway, usage, appearance, permissions, voice, supervisor, browser, mods, artifacts, sessions, ...values } = patch; // E4a: browser; P2-C: mods; P3-D: artifacts
  const next: Settings = { ...state, ...defined(values) };
  if (notifications) {
    const { kinds, ...fields } = notifications;
    next.notifications = { ...state.notifications, ...defined(fields), kinds: { ...state.notifications.kinds, ...defined(kinds ?? {}) } };
  }
  if (engine) next.engine = { ...state.engine, ...defined(engine) }; // P4-R8: the MCP servers' list replaced whole; P4-A2: the profile too
  if (gateway) next.gateway = { ...state.gateway, ...defined(gateway) };
  if (usage) next.usage = { ...state.usage, ...defined(usage) };
  if (appearance) next.appearance = { ...state.appearance, ...defined(appearance) };
  if (permissions) next.permissions = { ...state.permissions, ...defined(permissions) }; // W3
  if (voice) next.voice = { ...state.voice, ...defined(voice) }; // E9
  if (supervisor) next.supervisor = { ...state.supervisor, ...defined(supervisor) }; // E10
  if (browser) next.browser = { ...state.browser, ...defined(browser) }; // E4a
  if (mods?.toHuman) next.mods = { ...state.mods, toHuman: { ...state.mods.toHuman, ...defined(mods.toHuman) } }; // P2-C: a mod's fields one by one
  if (sessions) next.sessions = { ...state.sessions, ...defined(sessions) };
  if (artifacts) next.artifacts = { ...state.artifacts, ...defined(artifacts) }; // P3-D: the Spaces' record replaced whole
  return next;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
