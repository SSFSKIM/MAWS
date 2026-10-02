// X2 engine names without schemas. The preload bridges `commands`; main-only commands stay host-internal.
// Together they cover schema/engine.ts, pinned by schema.ts and schema.test.ts.
export const commands = [
  'engine.ping', 'engine.hostState', 'engine.binaryInfo', 'engine.relayHealth', 'engine.sessions', 'engine.shutdown',
  'engine.models',
  // C12 start
  'engine.budget',
  // C12 end
] as const;

export const events = [
  'engine.hostState',
  // C12 start
  'engine.budget',
  // C12 end
] as const;

// Only main's settings coordinator may update host configuration or policy.
export const mainOnlyCommands = ['engine.configure', 'engine.policy.set'] as const;
