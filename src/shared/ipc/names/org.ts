// X2 `org.*` names without their schemas, which the preload bridges (`../names.ts`). Exactly the keys of
// `../schema/org.ts`, pinned at compile time in `../schema.ts` and per namespace in `../schema.test.ts`. P5 O8 M1; M4a
// adds the Org page's view, changes and pairing; M7a the project channel; M6b a session's reach (and M5b's owner add);
// M4b the enrollment, a drop's retry and the grants; M4c the delegations and the provisioning code's destination; the
// project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §I) the registry and its held removals.
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
  'org.enroll.start',
  'org.enroll.approve',
  'org.enroll.cancel',
  'org.drop.retry',
  'org.delegation.create',
  'org.delegation.rewrite',
  'org.delegation.readKeys',
  'org.delegation.renewHub',
  'org.delegation.revokeHub',
  'org.provisioningSecret.get',
  'org.provisioningSecret.set',
  'org.provisioningSecret.reset',
  'org.grants.view',
  'org.grants.set',
  'org.grants.regrant',
  'org.channel.open',
  'org.channel.close',
  'org.channel.send',
  'org.policy.get',
  'org.policy.set',
  'org.owners.add',
  'org.projects',
  'org.removals.hold',
  'org.removals.cancel',
  'org.projectActs', // the project registry's M12 (§K): a terminal's request aimed at another machine
  'org.projectActs.decide',
] as const;

export const events = ['org.changed', 'org.rows.changed', 'org.channel.changed', 'org.policies.changed', 'org.grants.changed', 'org.projects.changed', 'org.projectActs.changed' /* M12 */] as const;
