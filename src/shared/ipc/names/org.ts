// X2 `org.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/org.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O8 M1; M4a
// adds the Org page's view, changes and pairing.
export const commands = [
  'org.status',
  'org.register',
  'org.signIn',
  'org.reanchor',
  'org.cancel',
  'org.signOut',
  'org.rows',
  'org.resign',
  'org.revokeSuperseded',
  'org.rekey',
  'org.discardPending',
  'org.resetSigning',
  'org.view',
  'org.preview',
  'org.change',
  'org.pair.start',
  'org.pair.approve',
  'org.pair.cancel',
] as const;

export const events = ['org.changed', 'org.rows.changed'] as const;
