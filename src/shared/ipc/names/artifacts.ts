// X2 `artifacts.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`,
// exactly the keys of `../schema/artifacts.ts`, pinned at compile time in `../schema.ts` and per namespace in
// `../schema.test.ts`.
export const commands = [
  'artifacts.list', 'artifacts.get', 'artifacts.create', 'artifacts.update', 'artifacts.delete', 'artifacts.duplicate',
  'artifacts.search', 'artifacts.versions', 'artifacts.saveVersion', 'artifacts.restore', 'artifacts.markViewed',
  'artifacts.pruneVersions', 'artifacts.versionState', 'artifacts.attributions', 'artifacts.uploadAsset',
  'artifacts.testLoopDelay', 'artifacts.status', 'artifacts.testWrite', 'artifacts.open',
] as const;

export const events = ['artifacts.changed'] as const;

// Only main relays the design-system defaults it owns in settings, and only main's `maws-artifact:` scheme resolves a
// stored file's path (P3-A Decision Log 14, 22d).
export const mainOnlyCommands = ['artifacts.setDefaults', 'artifacts.content'] as const;
