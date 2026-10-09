// X2 `plugins.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/plugins.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'plugins.env', 'plugins.list', 'plugins.available', 'plugins.install', 'plugins.update', 'plugins.uninstall',
  'plugins.enable', 'plugins.disable', 'plugins.cancel',
  'plugins.manifest', // P2-B (2026-10-09)
] as const;

export const events = [
  'plugins.operation', 'plugins.changed',
] as const;
