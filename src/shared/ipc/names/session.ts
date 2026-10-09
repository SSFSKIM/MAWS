// X2 `session.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/session.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'session.launch', 'session.status', 'session.events', 'session.stop', 'session.pendingRequest', 'session.catalog',
  'session.send', 'session.steer', 'session.queue.hold' /* W1 */, 'session.queue.list', 'session.queue.edit', 'session.queue.remove',
  'session.queue.promote', 'session.queue.setPaused', 'session.interrupt', 'session.answer', 'session.bash',
  'session.memoryAppend', 'session.setPermissionMode', 'session.setModel', 'session.setEffort', 'session.setThinking',
  'session.applyFlagSettings', 'session.stopTask', 'session.rewind', 'session.rewindFiles', 'session.setCwd',
  'session.renameSession', 'session.generateTitle', 'session.reloadPlugins', 'session.mcpReconnect',
  'session.mcpToggle', 'session.sideQuestion', 'session.getUsage', 'session.getContextUsage', 'session.getSettings',
  'session.listPermissionRules', 'session.getHooksListing', 'session.getMemoryDialog', 'session.getSkillsDialog',
  'session.getSandboxDialog', 'session.getWorkspaceDiff', 'session.exportConversation', 'session.getStatus',
  'session.mcpStatus', 'session.listModels', 'session.getSessionCost', 'session.getBinaryVersion', 'session.list',
  'session.get', 'session.update', 'session.projects.list', 'session.projects.add', 'session.projects.update',
  'session.projects.remove', 'session.drafts.get', 'session.drafts.set', 'session.replay.start',
  'session.replay.launch', 'session.replay.control', 'session.replay.fixtures', 'session.digests',
  'session.setVisible', 'session.launchMode', 'session.appEvents', 'session.history.list', 'session.history.append', 'session.trust.check',
  'session.forget', 'session.create', 'session.intent.get', 'session.intent.list', 'session.intent.patch',
  'session.intent.release', 'session.intent.discard', 'session.intent.resolveWorktree', 'session.start',
  'session.fork', 'session.archive', 'session.takeOverPane' /* W14 */, 'session.takeOver' /* W7 */, 'session.delete', 'session.rename', 'session.revealPath',
  'session.deletions.list', 'session.deletions.keep', 'session.deletions.preview', 'session.projects.addFolder' /* New chat */,
  // R2: the engine's remote surface
  'session.ui.render', 'session.ui.press', 'session.ui.input', 'session.ui.select', 'session.ui.focus', 'session.ui.scroll',
  'session.ui.panes', 'session.ui.paneShow', 'session.ui.paneFocus', 'session.ui.close', 'session.ui.promptEdit', 'session.ui.answer',
  'session.reloadSkills', // E8
  // P2-A start (2026-10-09)
  'session.observedFacts',
  'session.acquire',
  // P2-A end
  'session.recentTurns', // P2-D (2026-10-09): the resume chooser's preview read
] as const;

export const events = [
  'session.eventBatch', 'session.status', 'session.queue', 'session.brokerItems', 'session.operation',
  'session.forgotten', 'session.changed', 'session.removed', 'session.projects.changed', 'session.replay.progress',
  'session.digest', 'session.catalogChanged', 'session.setup', 'session.intent.changed',
] as const;
