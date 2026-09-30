// X2 `fs.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/fs.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'fs.state', 'fs.scan', 'fs.bind', 'fs.unbind', 'fs.holders', 'fs.unfollow', 'fs.subagents', 'fs.agentEvents',
  'fs.workflows', 'fs.tasks', 'fs.readSpill',
] as const;

export const events = [
  'fs.sessionChanged', 'fs.sessionRemoved', 'fs.holderChanged', 'fs.scanProgress', 'fs.followState',
  'fs.subagentsChanged', 'fs.workflowChanged', 'fs.tasksChanged',
] as const;
