// The spine's commands as its root registers them through its bus (P5 O3-C's D32 list after the lane A fold; P5 O3-E: with
// the checkouts; P5 O4: with the connectors and delivery, the library's reads and the catalog's machine half), pinned by src/services/spine-root.test.ts and served by mawsd's services front (P5 O3-D M2,
// src/mawsd/front.test.ts), sorted.
export const SPINE_COMMANDS = [
  // P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C): the connectors, their sign-in and
  // delivery, composed after the checkouts (CONNECTORS_COMMANDS below), interleaved here in sorted order
  'artifacts.connectorGrants', 'artifacts.grantConnectorTool', 'artifacts.revokeConnectorTool',
  'attention.acknowledge', 'attention.list', 'attention.request',
  'catalog.engine', 'catalog.engineRefresh', // P5 O4 M3: the catalog's machine half (LIBRARY_CATALOG_COMMANDS below)
  'connectors.adoptGrant', 'connectors.call', 'connectors.close', 'connectors.connect', 'connectors.declare', 'connectors.disconnect', 'connectors.open',
  'connectors.reconnect', 'connectors.refresh', 'connectors.servers', 'connectors.signIn', 'connectors.signInCancel', 'connectors.unwatch',
  'connectors.visibility', 'connectors.watch', 'connectors.windowShown',
  'delivery.cancel', 'delivery.connect', 'delivery.deliver', 'delivery.receipts', 'delivery.status',
  // P5 O3-E M2 (docs/doperpowers/plans/2026-10-30-p5-o3-e-checkout.md, Interfaces §C, D4): the checkouts, the root's last
  // parts (CHECKOUTS_COMMANDS below), interleaved here in sorted order
  'files.list', 'files.openExternal', 'files.read', 'files.readResolved', 'files.reveal', 'files.unwatch', 'files.upload', 'files.watch', 'files.write',
  'git.branches', 'git.diff', 'git.log', 'git.lsFiles', 'git.status', 'git.unwatch', 'git.watch',
  'git.worktree.add', 'git.worktree.branch', 'git.worktree.deleteBranch', 'git.worktree.list', 'git.worktree.remove', 'git.worktree.status',
  // P5 O9's lane A driver (O3 Decision Log 13): composed only while the run holds spine.lock, with no intercept or tap
  'laneA.answer', 'laneA.btw', 'laneA.catalog', 'laneA.command', 'laneA.compact', 'laneA.interrupt', 'laneA.list', 'laneA.media', 'laneA.model',
  'laneA.read', 'laneA.send', 'laneA.state', 'laneA.stopAgent', 'laneA.stopTask', 'laneA.tell', 'laneA.unwatch', 'laneA.watch',
  'library.content', // P5 O4 M3: the library's reads of a stored file (LIBRARY_CATALOG_COMMANDS below)
  'library.fileLinkedPaths', 'library.get', 'library.list', // P5 O3-D M5b: files' admission read, for main's mirror
  'library.openExternally', 'library.read', 'library.reveal', // P5 O4 M3
  'library.spaces',
  'machine.op', 'machine.opQuery', // P5 O3-D M4: the services' operation ledger, opened only while the run holds spine.lock
  'machineSettings.get', 'machineSettings.set', // P5 O3-D M5b (Interfaces §G): the machine half, for main's settings mirror
  'mods.list', 'mods.setSessionOverride',
  'ownerChannel.answered', 'ownerChannel.cancel', 'ownerChannel.markRead', 'ownerChannel.state',
  'scm.commit', 'scm.discard', 'scm.pr.create', 'scm.pr.plan', 'scm.pr.state', 'scm.push', 'scm.push.plan', 'scm.remote.cancel', 'scm.remote.last',
  'scm.stage', 'scm.status', 'scm.unstage',
  'session.acquire', 'session.appEvents', 'session.archive', 'session.archiveOlder', 'session.create', 'session.delete',
  'session.deletions.keep', 'session.deletions.list', 'session.deletions.preview', 'session.digests', 'session.drafts.get', 'session.drafts.set',
  'session.engineStatuses', // P5 O3-D M5b fix round 6: a scenario's statuses, for main's mirror
  'session.fork', 'session.get', 'session.history.append', 'session.history.list',
  'session.intent.discard', 'session.intent.get', 'session.intent.list', 'session.intent.patch', 'session.intent.release', 'session.intent.resolveWorktree',
  'session.launchMode', 'session.list', 'session.observedFacts',
  'session.projects.add', 'session.projects.addFolder', 'session.projects.list', 'session.projects.remove', 'session.projects.update',
  'session.recentTurns', 'session.rename', 'session.replay.fixtures', 'session.replay.start', 'session.revealPath', 'session.search',
  'session.setVisible', 'session.start', 'session.takeOver', 'session.takeOverPane', 'session.trust.check', 'session.update',
  'session.visible', // P5 O3-D M5b: the visible set, for main's mirror
  'settings.engineApplied', 'settings.userEngineDefaults',
  'side.screenshot.preview', 'side.sendToMain', 'side.thread.open',
];

// P5 O3-E M2: what the checkouts register through the spine's bus, in every run (a refused one too): the 26 retagged
// commands, files.readResolved (library.read's reach) and files.upload (M3's write; refused until then), sorted
export const CHECKOUTS_COMMANDS = [
  'files.list', 'files.openExternal', 'files.read', 'files.readResolved', 'files.reveal', 'files.unwatch', 'files.upload', 'files.watch', 'files.write',
  'git.branches', 'git.diff', 'git.log', 'git.lsFiles', 'git.status', 'git.unwatch', 'git.watch',
  'scm.commit', 'scm.discard', 'scm.pr.create', 'scm.pr.plan', 'scm.pr.state', 'scm.push', 'scm.push.plan', 'scm.remote.cancel', 'scm.remote.last',
  'scm.stage', 'scm.status', 'scm.unstage',
];

// P5 O4 M2 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C): what the connectors, their sign-in and
// delivery register through the spine's bus, in every run (a refused one too): the 21 retagged commands and the three
// new main-only ones (`connectors.windowShown`, `connectors.adoptGrant`, `delivery.deliver`), sorted
export const CONNECTORS_COMMANDS = [
  'artifacts.connectorGrants', 'artifacts.grantConnectorTool', 'artifacts.revokeConnectorTool',
  'connectors.adoptGrant', 'connectors.call', 'connectors.close', 'connectors.connect', 'connectors.declare', 'connectors.disconnect', 'connectors.open',
  'connectors.reconnect', 'connectors.refresh', 'connectors.servers', 'connectors.signIn', 'connectors.signInCancel', 'connectors.unwatch',
  'connectors.visibility', 'connectors.watch', 'connectors.windowShown',
  'delivery.cancel', 'delivery.connect', 'delivery.deliver', 'delivery.receipts', 'delivery.status',
];

// P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C): the library's reads of a stored file (4
// retagged) and the catalog's machine half (2 new), registered through the spine's bus in every run (a refused one too),
// sorted
export const LIBRARY_CATALOG_COMMANDS = [
  'catalog.engine', 'catalog.engineRefresh',
  'library.content', 'library.openExternally', 'library.read', 'library.reveal',
];
