// X2 `connectors.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`,
// exactly the keys of `../schema/connectors.ts`, pinned at compile time in `../schema.ts` and per namespace in
// `../schema.test.ts`. P3-H H3b.
export const commands = [
  'connectors.open', 'connectors.declare', 'connectors.call', 'connectors.watch', 'connectors.unwatch', 'connectors.refresh',
  'connectors.visibility', 'connectors.close',
  'connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect', // P3-HD M3c2: the owner's, from the sheet
  'connectors.add', 'connectors.remove', 'connectors.signIn', 'connectors.signInCancel', // P4-AGG M4: Customize › Connectors
] as const;

export const events = ['connectors.watchUpdate', 'connectors.operation', 'connectors.grantChanged', 'connectors.directOperation' /* P3-HD */, 'connectors.serversChanged' /* P3-HD M3c2: main's, targeted */, 'connectors.signInChanged' /* P4-AGG M4: main's */] as const;

// The grant store and route E's engine leg: main's alone, never bridged to a window (a window grants and revokes through
// main's `artifacts.*` grant commands, which take the route's fingerprint and stop work in flight first).
export const mainOnlyCommands = [
  'connectors.grants', 'connectors.grant', 'connectors.revoke', 'connectors.check',
  'connectors.resolve', 'connectors.start', 'connectors.take', 'connectors.cancel',
  // P3-HD: route D's host half, main's alone like route E's (a credential rides directStart and directDiscover)
  'connectors.directResolve', 'connectors.directStart', 'connectors.directDiscover', 'connectors.directTake', 'connectors.directCancel', 'connectors.directClose',
  // P4-B5: the owner's delivery through route D, and route E's observation of one live session
  'connectors.directLocate', 'connectors.directSend', 'connectors.observe',
] as const;
