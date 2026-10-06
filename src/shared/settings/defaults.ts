// The values of MAWS's own settings file (C11 execution document, Interfaces "Settings, version 3"): the current
// version's defaults (W13: version 8; E9: version 9), the one migration from every earlier version, and the one patch merge
// `settings.set` applies. Pure; main's store (src/main/settings/store.ts) reads, migrates, merges and writes with these,
// and nothing else does.
import * as z from 'zod';
import { ACTION_IDS, RETIRED_ACTION_IDS } from '../keymap/actions';
import { ChordSchema, SettingsSchema, ThemeSettingSchema, type Settings, type SettingsPatch } from '../ipc/schema/settings';

export const SETTINGS_DEFAULTS_V9: Settings = {
  version: 9, // C12: 4; W2: 5; W3: 6; W7: 7; W13: 8; E9: 9
  theme: 'light', // light-first (D-4, charter §10 item 10)
  keymap: {},
  notifications: { enabled: true, sound: false, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
  engine: { binaryPath: null, subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */, memoryBudget: { enabled: true } /* W7 */ }, // W13: binaryPath null, the installed Claude Code
  gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true }, // D-19
  usage: { nearLimitPercent: 90 },
  appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
  permissions: { autoFallback: 'acceptEdits' }, // W3: the owner's ruling of 2026-10-01 (charter D-18)
  voice: { locale: null }, // E9: the system locale
};

// The earlier files, as their versions wrote them: C1's and C5's.
const SettingsV1Schema = z.strictObject({ version: z.literal(1), theme: ThemeSettingSchema });
const SettingsV2Schema = z.strictObject({
  version: z.literal(2),
  theme: ThemeSettingSchema,
  keymap: z.partialRecord(z.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: z.strictObject({ enabled: z.boolean(), sound: z.boolean() }),
});

// E9 start: W13's version 8, as it wrote it: version 9's sections less the voice section
const SettingsV8Schema = SettingsSchema.omit({ voice: true }).extend({ version: z.literal(8) });
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

const defaults = (): Settings => structuredClone(SETTINGS_DEFAULTS_V9);

// E9: v8 → v9, the voice section with the system locale
const fromV8 = (v8: SettingsV8): Settings => ({ ...v8, version: 9, voice: defaults().voice });
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
// (W13: the pin dropped) → v9 (E9: the voice section). A version 9 object is validated and returned as it is;
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
  const { notifications, engine, gateway, usage, appearance, permissions, voice, ...values } = patch;
  const next: Settings = { ...state, ...defined(values) };
  if (notifications) {
    const { kinds, ...fields } = notifications;
    next.notifications = { ...state.notifications, ...defined(fields), kinds: { ...state.notifications.kinds, ...defined(kinds ?? {}) } };
  }
  if (engine) next.engine = { ...state.engine, ...defined(engine) };
  if (gateway) next.gateway = { ...state.gateway, ...defined(gateway) };
  if (usage) next.usage = { ...state.usage, ...defined(usage) };
  if (appearance) next.appearance = { ...state.appearance, ...defined(appearance) };
  if (permissions) next.permissions = { ...state.permissions, ...defined(permissions) }; // W3
  if (voice) next.voice = { ...state.voice, ...defined(voice) }; // E9
  return next;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
