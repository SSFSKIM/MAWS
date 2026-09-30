// X2 `engine.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/engine.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'engine.ping', 'engine.hostState', 'engine.binaryInfo', 'engine.relayHealth', 'engine.sessions', 'engine.shutdown',
  'engine.models', 'engine.configure',
  // C12 start
  'engine.policy.set', 'engine.budget',
  // C12 end
] as const;

export const events = [
  'engine.hostState',
  // C12 start
  'engine.budget',
  // C12 end
] as const;
