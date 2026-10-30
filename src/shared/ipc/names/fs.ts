// X2 `fs.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`, exactly
// the keys of `../schema/fs.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an
// entry added there adds its name here.
export const commands = [
  'fs.sessionText', 'fs.state', 'fs.holders', 'fs.unfollow', 'fs.subagents', 'fs.agentEvents',
  'fs.workflows', 'fs.tasks', 'fs.readSpill',
] as const;

// P5 O3-D (P5 Decision Log 36): the index's scan, bind and unbind, which only the spine's index source sends
export const mainOnlyCommands = ['fs.scan', 'fs.bind', 'fs.unbind'] as const;

export const events = [
  'fs.sessionChanged', 'fs.sessionRemoved', 'fs.holderChanged', 'fs.scanProgress', 'fs.followState',
  'fs.subagentsChanged', 'fs.workflowChanged', 'fs.tasksChanged', 'fs.foreignWrite',
] as const;
