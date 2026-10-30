// The spine's commands as its root registers them through its bus (P5 O3-C's D32 list after the lane A fold), pinned by
// src/services/spine-root.test.ts and served by mawsd's services front (P5 O3-D M2, src/mawsd/front.test.ts), sorted.
export const SPINE_COMMANDS = [
  'attention.acknowledge', 'attention.list', 'attention.request',
  'git.worktree.add', 'git.worktree.branch', 'git.worktree.deleteBranch', 'git.worktree.list', 'git.worktree.remove', 'git.worktree.status',
  // P5 O9's lane A driver (O3 Decision Log 13): composed only while the run holds spine.lock, with no intercept or tap
  'laneA.answer', 'laneA.btw', 'laneA.catalog', 'laneA.command', 'laneA.compact', 'laneA.interrupt', 'laneA.list', 'laneA.media', 'laneA.model',
  'laneA.read', 'laneA.send', 'laneA.state', 'laneA.stopAgent', 'laneA.stopTask', 'laneA.tell', 'laneA.unwatch', 'laneA.watch',
  'library.fileLinkedPaths', 'library.get', 'library.list', 'library.spaces', // P5 O3-D M5b: files' admission read, for main's mirror
  'machine.op', 'machine.opQuery', // P5 O3-D M4: the services' operation ledger, opened only while the run holds spine.lock
  'machineSettings.get', 'machineSettings.set', // P5 O3-D M5b (Interfaces §G): the machine half, for main's settings mirror
  'mods.list', 'mods.setSessionOverride',
  'ownerChannel.answered', 'ownerChannel.cancel', 'ownerChannel.markRead', 'ownerChannel.state',
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
