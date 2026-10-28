// OX9 grades of `session.*` (`../grades.ts`; M4's rubric in docs/doperpowers/plans/2026-10-27-p5-o1-seams.md).
import type { CommandGrades, GradeSpec } from '../grades';

// Text written into the session's input, or released into it from the queue: a slash command is graded by its effect
// (RL §5.5, indirect paths included).
const words = { floor: 'converse', byEffect: true } as const satisfies GradeSpec;

export const grades = {
  // lifecycle and state
  'session.launch': 'spawn',
  'session.status': 'view',
  'session.events': 'view',
  'session.stop': 'manage',
  'session.pendingRequest': 'view',
  'session.pendingItems': 'view', // P5 O10 M8: the broker's items, as `session.pendingRequest` reads one
  'session.catalog': 'view',
  // the composer
  'session.send': words,
  'session.steer': words,
  'session.queue.hold': 'converse',
  'session.queue.list': 'view',
  'session.queue.edit': words,
  'session.queue.remove': 'converse',
  'session.queue.promote': words, // writes a queued entry as a user message
  'session.queue.setPaused': words, // unpausing releases the queued entries
  'session.interrupt': 'converse',
  'session.answer': { floor: 'converse', byEffect: true }, // a question takes converse, a permission approve
  'session.bash': 'shell', // `!`: a shell command run on the machine (RL §5.5's policy: no arbitrary shell)
  'session.memoryAppend': { floor: 'manage', byEffect: true }, // `#`: a project or path file; the user's memory is machine-wide
  // mutations
  'session.setPermissionMode': 'manage',
  'session.setModel': 'converse',
  'session.setEffort': 'converse',
  'session.setThinking': 'converse',
  'session.applyFlagSettings': { floor: 'manage', byEffect: true }, // graded by the settings it applies (no arbitrary flags)
  'session.stopTask': 'converse',
  'session.rewind': 'manage',
  'session.rewindFiles': 'manage',
  'session.setCwd': 'manage',
  'session.renameSession': 'manage',
  'session.generateTitle': 'manage',
  'session.reloadPlugins': 'manage',
  'session.mcpReconnect': 'converse',
  'session.mcpToggle': 'manage',
  'session.sideQuestion': 'converse',
  // structured reads
  'session.getUsage': 'view',
  'session.getContextUsage': 'view',
  'session.getSettings': 'view',
  'session.listPermissionRules': 'view',
  'session.getHooksListing': 'view',
  'session.getMemoryDialog': 'view',
  'session.getSkillsDialog': 'view',
  'session.getSandboxDialog': 'view',
  'session.getWorkspaceDiff': 'view',
  'session.exportConversation': 'view',
  'session.getStatus': 'view',
  'session.mcpStatus': 'view',
  'session.listModels': 'view',
  'session.getSessionCost': 'view',
  'session.getBinaryVersion': 'view',
  // the index's records, projects and drafts
  'session.search': 'view', // hits carry transcript snippets: the endpoint keeps the sessions the caller views
  'session.list': 'list',
  'session.get': 'view',
  'session.update': { floor: 'view', byEffect: true }, // unread, lastSeen and pinned at the floor; title and archived take manage
  'session.projects.list': 'list',
  'session.projects.add': 'spawn',
  'session.projects.update': 'machine-admin',
  'session.projects.remove': 'machine-admin',
  'session.projects.addFolder': 'spawn',
  'session.drafts.get': 'view',
  'session.drafts.set': 'converse',
  'session.replay.start': 'spawn',
  'session.replay.launch': 'spawn',
  'session.replay.control': 'manage',
  'session.replay.fixtures': 'spawn',
  'session.digests': 'list',
  'session.setVisible': 'view',
  'session.launchMode': 'list',
  'session.appEvents': 'view',
  'session.history.list': 'view',
  'session.history.append': 'converse',
  // setup, start and the record's actions
  'session.trust.check': 'spawn',
  'session.forget': 'manage',
  'session.create': 'spawn',
  'session.intent.get': 'view',
  'session.intent.list': 'list',
  'session.intent.patch': 'spawn',
  'session.intent.release': 'spawn',
  'session.intent.discard': 'spawn',
  'session.intent.resolveWorktree': 'spawn',
  'session.start': 'spawn',
  'session.fork': 'spawn',
  'session.archiveOlder': 'manage',
  'session.archive': 'manage',
  'session.takeOverPane': 'spawn',
  'session.takeOver': 'spawn',
  'session.delete': 'manage',
  'session.rename': 'manage',
  'session.revealPath': 'view',
  'session.deletions.list': 'manage',
  'session.deletions.keep': 'manage',
  'session.deletions.preview': 'manage',
  // R2: the engine's remote surface
  'session.ui.render': 'view',
  // press, input and select run the plugin callback the caller names, a submission included, which may execute or
  // manage: the endpoint classifies the target or refuses it
  'session.ui.press': { floor: 'converse', byEffect: true },
  'session.ui.input': { floor: 'converse', byEffect: true },
  'session.ui.select': { floor: 'converse', byEffect: true },
  'session.ui.focus': 'view',
  'session.ui.scroll': 'view',
  'session.ui.panes': 'view',
  'session.ui.paneShow': 'converse',
  'session.ui.paneFocus': 'converse',
  'session.ui.close': 'converse',
  'session.ui.promptEdit': { floor: 'converse', byEffect: true }, // a text edit at the floor; a keyed edit is forwarded with what it triggers unknown
  'session.ui.answer': 'converse', // the attached surface's copy and prompt read, fill and suggest answers; nothing executes
  'session.reloadSkills': 'manage',
  'session.steer.cancel': 'converse',
  'session.promptHistory': 'view',
  'session.observedFacts': 'view',
  'session.acquire': { floor: 'converse', byEffect: true }, // joins a ready or starting session; a resume relaunches it
  'session.recentTurns': 'view',
  // main-only
  'session.mcpAuthenticate': 'internal',
  'session.mcpOAuthCallback': 'internal',
} as const satisfies CommandGrades<'session'>;
