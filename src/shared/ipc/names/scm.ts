// X2 `scm.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/scm.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`: an entry
// added there adds its name here.
export const commands = [
  'scm.status', 'scm.stage', 'scm.unstage', 'scm.discard', 'scm.commit', 'scm.push.plan', 'scm.push', 'scm.pr.plan', 'scm.pr.create',
  'scm.remote.cancel', 'scm.remote.last', 'scm.pr.state',
] as const;

export const events = [
  'scm.remote.output',
] as const;
