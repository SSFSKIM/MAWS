// X2 `connectors.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`,
// exactly the keys of `../schema/connectors.ts`, pinned at compile time in `../schema.ts` and per namespace in
// `../schema.test.ts`. P3-H H3b.
export const commands = [
  'connectors.open', 'connectors.declare', 'connectors.call', 'connectors.watch', 'connectors.unwatch', 'connectors.refresh',
  'connectors.visibility', 'connectors.close',
] as const;

export const events = ['connectors.watchUpdate', 'connectors.operation', 'connectors.grantChanged', 'connectors.directOperation' /* P3-HD */] as const;

// The grant store and route E's engine leg: main's alone, never bridged to a window (a window grants and revokes through
// main's `artifacts.*` grant commands, which take the route's fingerprint and stop work in flight first).
export const mainOnlyCommands = [
  'connectors.grants', 'connectors.grant', 'connectors.revoke', 'connectors.check',
  'connectors.resolve', 'connectors.start', 'connectors.take', 'connectors.cancel',
  // P3-HD: route D's host half, main's alone like route E's (a credential rides directStart and directDiscover)
  'connectors.directResolve', 'connectors.directStart', 'connectors.directDiscover', 'connectors.directTake', 'connectors.directCancel', 'connectors.directClose',
] as const;
