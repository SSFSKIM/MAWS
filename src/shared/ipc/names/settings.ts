// X2 `settings.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/settings.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'settings.get', 'settings.set', 'settings.usage', 'settings.claudeUsage.status', 'settings.claudeUsage.open',
  'settings.reveal',
  'settings.engineApplied', // C12 (W13: settings.engineCustody retired)
  'settings.userEngineDefaults', // W3
  'settings.usageControls', 'settings.usageAction', // W6 route executor
] as const;

export const events = [
  'settings.changed', 'settings.usageChanged',
] as const;
