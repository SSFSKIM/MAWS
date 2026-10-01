// The values of MAWS's own settings file (C11 execution document, Interfaces "Settings, version 3"): the version 3
// defaults, the one migration from every earlier version, and the one patch merge `settings.set` applies. Pure; main's
// store (src/main/settings/store.ts) reads, migrates, merges and writes with these, and nothing else does.
import * as z from 'zod';
import { ACTION_IDS } from '../keymap/actions';
import { ChordSchema, SettingsSchema, ThemeSettingSchema, type Settings, type SettingsPatch } from '../ipc/schema/settings';

export const SETTINGS_DEFAULTS_V6: Settings = {
  version: 6, // C12: 4; W2: 5; W3: 6
  theme: 'light', // light-first (D-4, charter §10 item 10)
  keymap: {},
  notifications: { enabled: true, sound: false, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
  engine: { binaryPath: null, pinnedVersion: '2.1.283', subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */ }, // C3's ENGINE_VERSION
  gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true }, // D-19
  usage: { nearLimitPercent: 90 },
  appearance: { monoFont: null, transcriptWidth: 768 /* W2 */ },
  permissions: { autoFallback: 'acceptEdits' }, // W3: the owner's ruling of 2026-10-01 (charter D-18)
};

// The earlier files, as their versions wrote them: C1's and C5's.
const SettingsV1Schema = z.strictObject({ version: z.literal(1), theme: ThemeSettingSchema });
const SettingsV2Schema = z.strictObject({
  version: z.literal(2),
  theme: ThemeSettingSchema,
  keymap: z.partialRecord(z.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: z.strictObject({ enabled: z.boolean(), sound: z.boolean() }),
});

// W3 start: W2's version 5, as it wrote it: version 6's sections less the permissions
const SettingsV5Schema = SettingsSchema.omit({ permissions: true }).extend({ version: z.literal(5) });
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
  engine: SettingsSchema.shape.engine.omit({ memoryBudgetMiB: true, statefulMcpServers: true }),
});
// C12 end

const defaults = (): Settings => structuredClone(SETTINGS_DEFAULTS_V6);

// W3: v5 → v6, the auto fallback's default
const fromV5 = (v5: SettingsV5): Settings => ({ ...v5, version: 6, permissions: defaults().permissions });
// W2: v4 → v5, the transcript's default width (W3: then v5 → v6)
const fromV4 = (v4: SettingsV4): Settings => fromV5({ ...v4, version: 5, appearance: { ...v4.appearance, transcriptWidth: defaults().appearance.transcriptWidth } });

// v1 → v2 (C5's step: no keymap overrides, the notification defaults) → v3 (the sections C11 adds, with their
// defaults) → v4 (C12's budget) → v5 (W2's transcript width) → v6 (W3's auto fallback). A version 6 object is validated
// and returned as it is;
// anything else (another version, an invalid file of a known version) throws the schema's error, which the store turns
// into the defaults with a warning.
export function migrateSettings(raw: unknown): Settings {
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
    default:
      return SettingsSchema.parse(raw);
  }
}

// The one merge rule (Interfaces, stated once): a patch is merged one level deep, section by section and field by
// field, and `notifications.kinds` a second level, key by key, so a kinds patch never replaces the sibling kinds. The
// theme and the keymap are values of their own and are replaced whole. A key present as `undefined` changes nothing.
export function applySettingsPatch(state: Settings, patch: SettingsPatch): Settings {
  const { notifications, engine, gateway, usage, appearance, permissions, ...values } = patch;
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
  return next;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
