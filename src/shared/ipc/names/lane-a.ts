// X2 `laneA.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/lane-a.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O9 M2.
export const commands = [
  'laneA.list', 'laneA.state', 'laneA.watch', 'laneA.unwatch', 'laneA.catalog', 'laneA.read',
  'laneA.send', 'laneA.interrupt', 'laneA.answer', 'laneA.model', 'laneA.command', 'laneA.btw', 'laneA.compact',
  'laneA.stopAgent', 'laneA.tell', 'laneA.stopTask', 'laneA.media',
] as const;

export const events = ['laneA.changed', 'laneA.plane'] as const;
