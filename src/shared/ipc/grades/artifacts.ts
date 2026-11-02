// OX9 grades of `artifacts.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md):
// reads `view`, edits `manage` (OX9).
import type { CommandGrades } from '../grades';

export const grades = {
  'artifacts.list': 'view',
  'artifacts.get': 'view',
  'artifacts.create': 'manage',
  'artifacts.update': 'manage',
  'artifacts.delete': 'manage',
  'artifacts.duplicate': 'manage',
  'artifacts.search': 'view',
  'artifacts.versions': 'view',
  'artifacts.saveVersion': 'manage',
  'artifacts.nameVersion': 'manage',
  'artifacts.restore': 'manage',
  'artifacts.markViewed': 'view',
  'artifacts.pruneVersions': 'manage',
  'artifacts.versionState': 'view',
  'artifacts.attributions': 'view',
  'artifacts.acceptSuggestion': 'manage',
  'artifacts.rejectSuggestion': 'manage',
  'artifacts.uploadAsset': 'manage',
  // P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The `artifact` target rule"): it names two
  // artifacts and no `artifactId`: `manage` on `to` (the write, its target), and `view` on `from` by the endpoint's
  // BY_EFFECT rule, which runs only for a by-effect declaration
  'artifacts.copyAsset': { floor: 'manage', byEffect: true },
  'artifacts.readDataset': 'view',
  'artifacts.datasetFiles': 'view',
  'artifacts.rereadDatasetFile': 'manage', // an explicit human write, captured as a version
  'artifacts.testLoopDelay': 'machine-admin', // the e2e seams, refused outside MAWS_E2E
  'artifacts.status': 'list', // the store's health, no artifact's content
  'artifacts.testWrite': 'machine-admin',
  'artifacts.open': 'manage', // the document's port writes as the human
  'artifacts.export': 'view', // a rendering of what the caller can read
  'artifacts.downloadAsset': 'client',
  'artifacts.connectorGrants': 'view',
  'artifacts.grantConnectorTool': 'machine-admin', // the owner's connector grants
  'artifacts.revokeConnectorTool': 'machine-admin',
  'artifacts.holdDatasets': 'view', // a viewing window's holds
  'artifacts.releaseDatasets': 'view',
  // main-only
  'artifacts.setDefaults': 'internal',
  'artifacts.content': 'internal',
  'artifacts.state': 'internal',
  'artifacts.assets': 'internal',
  'artifacts.captureDatasetState': 'internal',
  'artifacts.holdAssets': 'internal',
  'artifacts.releaseAssets': 'internal',
  'artifacts.datasetRefreshRequest': 'internal',
} as const satisfies CommandGrades<'artifacts'>;
