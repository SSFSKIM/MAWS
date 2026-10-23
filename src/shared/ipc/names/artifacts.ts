// X2 `artifacts.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`,
// exactly the keys of `../schema/artifacts.ts`, pinned at compile time in `../schema.ts` and per namespace in
// `../schema.test.ts`.
export const commands = [
  'artifacts.list', 'artifacts.get', 'artifacts.create', 'artifacts.update', 'artifacts.delete', 'artifacts.duplicate',
  'artifacts.search', 'artifacts.versions', 'artifacts.saveVersion', 'artifacts.nameVersion', 'artifacts.restore', 'artifacts.markViewed',
  'artifacts.pruneVersions', 'artifacts.versionState', 'artifacts.attributions',
  'artifacts.acceptSuggestion', 'artifacts.rejectSuggestion', // P3-A M8
  'artifacts.uploadAsset',
  'artifacts.copyAsset', // P3-C (Decision Log 25)
  'artifacts.readDataset', // P3-E (E2 M2)
  'artifacts.datasetFiles', 'artifacts.rereadDatasetFile', // WR 67
  'artifacts.testLoopDelay', 'artifacts.status', 'artifacts.testWrite', 'artifacts.open',
  'artifacts.export', // P3-A M7: main's
  'artifacts.downloadAsset', // P3-E (E2 M3): main's
  'artifacts.connectorGrants', 'artifacts.grantConnectorTool', 'artifacts.revokeConnectorTool', // P3-H H3b: main's
  'artifacts.holdDatasets', 'artifacts.releaseDatasets', // E3: main's, a window's holds
] as const;

export const events = ['artifacts.changed', 'artifacts.resync' /* P3-A M5: main's */, 'artifacts.console' /* P3-A M7: main's */] as const;

// Only main relays the design-system defaults it owns in settings, and only main's `maws-artifact:` scheme resolves a
// stored file's path (P3-A Decision Log 14, 22d).
export const mainOnlyCommands = ['artifacts.setDefaults', 'artifacts.content', 'artifacts.state' /* M7: the export service's */, 'artifacts.assets' /* M8: the export service's */, 'artifacts.captureDatasetState', 'artifacts.holdAssets', 'artifacts.releaseAssets' /* E3: main's holds */, 'artifacts.datasetRefreshRequest' /* E3: an agent's refresh, main's to read */] as const;
