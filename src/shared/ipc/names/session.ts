// X2 `session.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/session.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'session.launch', 'session.status', 'session.events', 'session.stop', 'session.pendingRequest', 'session.catalog',
  'session.send', 'session.steer', 'session.queue.list', 'session.queue.edit', 'session.queue.remove',
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
  'session.setVisible', 'session.launchMode', 'session.history.list', 'session.history.append', 'session.trust.check',
  'session.forget', 'session.create', 'session.intent.get', 'session.intent.list', 'session.intent.patch',
  'session.intent.release', 'session.intent.discard', 'session.intent.resolveWorktree', 'session.start',
  'session.fork', 'session.archive', 'session.delete', 'session.rename', 'session.revealPath',
  'session.deletions.list', 'session.deletions.keep', 'session.deletions.preview',
] as const;

export const events = [
  'session.eventBatch', 'session.status', 'session.queue', 'session.brokerItems', 'session.operation',
  'session.forgotten', 'session.changed', 'session.removed', 'session.projects.changed', 'session.replay.progress',
  'session.digest', 'session.catalogChanged', 'session.setup', 'session.intent.changed',
] as const;
