// X2 `connectors.*` names without their schemas, which the preload bridges (`../names.ts`). With `mainOnlyCommands`,
// exactly the keys of `../schema/connectors.ts`, pinned at compile time in `../schema.ts` and per namespace in
// `../schema.test.ts`. P3-H H3b.
export const commands = [
  'connectors.open', 'connectors.declare', 'connectors.call', 'connectors.watch', 'connectors.unwatch', 'connectors.refresh',
  'connectors.visibility', 'connectors.close',
  'connectors.servers', 'connectors.connect', 'connectors.reconnect', 'connectors.disconnect', // P3-HD M3c2: the owner's, from the sheet
  'connectors.add', 'connectors.remove', 'connectors.signIn', 'connectors.signInCancel', // P4-AGG M4: Customize › Connectors
  'connectors.signInServer', // P5 O7 M8: the session's MCP widget
  'connectors.signInDynamicServer', // UX wave U11a M8: a plugin's connector and one of MAWS's own list
] as const;

export const events = ['connectors.watchUpdate', 'connectors.operation', 'connectors.grantChanged', 'connectors.directOperation' /* P3-HD */, 'connectors.serversChanged' /* P3-HD M3c2 */, 'connectors.signInChanged' /* P4-AGG M4 */, 'connectors.reset' /* P5 O4 M2: main's, to its windows (D28) */] as const;

// The grant store and route E's engine leg: main's alone, never bridged to a window (a window grants and revokes through
// main's `artifacts.*` grant commands, which take the route's fingerprint and stop work in flight first).
export const mainOnlyCommands = [
  'connectors.grants', 'connectors.grant', 'connectors.revoke', 'connectors.check',
  'connectors.resolve', 'connectors.start', 'connectors.take', 'connectors.cancel',
  // P3-HD: route D's host half, main's alone like route E's (a credential rides directStart and directDiscover)
  'connectors.directResolve', 'connectors.directStart', 'connectors.directDiscover', 'connectors.directTake', 'connectors.directCancel', 'connectors.directClose',
  // P4-B5: the owner's delivery through route D, and route E's observation of one live session
  'connectors.directLocate', 'connectors.directSend', 'connectors.observe',
  // P5 O4 M2 (Interfaces §C): the machine's, main's alone to send: the page's window as the app reads it (D8), and a grant
  // the app opened from Electron's safeStorage for the machine to re-seal (U7, D23)
  'connectors.windowShown', 'connectors.adoptGrant',
  // P5 O7 M5c: a consent's redirect, main's alone to relay from its loopback listener to the machine whose flow it is
  'connectors.callback',
] as const;
