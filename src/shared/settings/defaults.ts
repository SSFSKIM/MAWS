// The values of MAWS's own settings file (C11 execution document, Interfaces "Settings, version 3"): the version 3
// defaults, the one migration from every earlier version, and the one patch merge `settings.set` applies. Pure; main's
// store (src/main/settings/store.ts) reads, migrates, merges and writes with these, and nothing else does.
import * as z from 'zod';
import { ACTION_IDS } from '../keymap/actions';
import { ChordSchema, SettingsSchema, ThemeSettingSchema, type Settings, type SettingsPatch } from '../ipc/schema/settings';

export const SETTINGS_DEFAULTS_V4: Settings = {
  version: 4, // C12
  theme: 'light', // light-first (D-4, charter §10 item 10)
  keymap: {},
  notifications: { enabled: true, sound: false, kinds: { approvals: true, questions: true, planReviews: true, errors: true, heldPeerMessages: false } },
  engine: { binaryPath: null, pinnedVersion: '2.1.283', subagentModel: null, memoryBudgetMiB: null, statefulMcpServers: [] /* C12 */ }, // C3's ENGINE_VERSION
  gateway: { defaultRoute: 'gateway', relayUnreachable: 'ask', offerDirect: true }, // D-19
  usage: { nearLimitPercent: 90 },
  appearance: { monoFont: null },
};

// The earlier files, as their versions wrote them: C1's and C5's.
const SettingsV1Schema = z.strictObject({ version: z.literal(1), theme: ThemeSettingSchema });
const SettingsV2Schema = z.strictObject({
  version: z.literal(2),
  theme: ThemeSettingSchema,
  keymap: z.partialRecord(z.enum(ACTION_IDS), ChordSchema.nullable()),
  notifications: z.strictObject({ enabled: z.boolean(), sound: z.boolean() }),
});

// C12 start: C11's version 3, as it wrote it: version 4's sections less the budget's two engine fields
const SettingsV3Schema = SettingsSchema.extend({
  version: z.literal(3),
  engine: SettingsSchema.shape.engine.omit({ memoryBudgetMiB: true, statefulMcpServers: true }),
});
// C12 end

const defaults = (): Settings => structuredClone(SETTINGS_DEFAULTS_V4);

// v1 → v2 (C5's step: no keymap overrides, the notification defaults) → v3 (the sections C11 adds, with their
// defaults). A version 3 object is validated and returned as it is; anything else (another version, an invalid file of
// a known version) throws the schema's error, which the store turns into the defaults with a warning.
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
    // C12 start: v3 → v4, the budget's defaults (25% of physical memory, no stateful servers)
    case 3: {
      const v3 = SettingsV3Schema.parse(raw);
      const { engine } = defaults();
      return { ...v3, version: 4, engine: { ...v3.engine, memoryBudgetMiB: engine.memoryBudgetMiB, statefulMcpServers: engine.statefulMcpServers } };
    }
    // C12 end
    default:
      return SettingsSchema.parse(raw);
  }
}

// The one merge rule (Interfaces, stated once): a patch is merged one level deep, section by section and field by
// field, and `notifications.kinds` a second level, key by key, so a kinds patch never replaces the sibling kinds. The
// theme and the keymap are values of their own and are replaced whole. A key present as `undefined` changes nothing.
export function applySettingsPatch(state: Settings, patch: SettingsPatch): Settings {
  const { notifications, engine, gateway, usage, appearance, ...values } = patch;
  const next: Settings = { ...state, ...defined(values) };
  if (notifications) {
    const { kinds, ...fields } = notifications;
    next.notifications = { ...state.notifications, ...defined(fields), kinds: { ...state.notifications.kinds, ...defined(kinds ?? {}) } };
  }
  if (engine) next.engine = { ...state.engine, ...defined(engine) };
  if (gateway) next.gateway = { ...state.gateway, ...defined(gateway) };
  if (usage) next.usage = { ...state.usage, ...defined(usage) };
  if (appearance) next.appearance = { ...state.appearance, ...defined(appearance) };
  return next;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
