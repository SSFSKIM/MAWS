// The Org page's e2e fixture (P5 O8 M4a Task 8, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Decision Log
// "M4a gains Task 8"): e2e/org-page.spec.ts photographs the page over an org with real-world variety, which no one real
// session holds at once (a refusal that names no attempt is the key file refused at load, which leaves this Mac unable to
// run a pairing). Under MAWS_E2E=1, in a build that is not packaged, with MAWS_E2E_ORG_PAGE naming a JSON file of
// `{status, view, grants?, holdGrantSave?, provisioningSecret?}` that the `org.*` schemas admit, main answers `org.status`,
// `org.view`, (M4b) each machine's `org.grants.view`, by its ref (signed out for any other), and (M4c) the delegations'
// code destination, `org.provisioningSecret.get` (unset unless the file names one), from it through C5's
// `interceptCommand`, so the real renderer draws what main would send; every act is answered without effect, so the
// production session behind it stays untouched. Its status no longer reaches the renderer either: the fixture stops the
// session's `org.changed` forwarding (`unpublish`), since even a profile never signed in publishes once its load ends
// (org-session.ts's `changed(true)`), which would replace the seeded status. `org.rows`, M6b's `org.policy.get`, the project registry's `org.projects` (reads, without effect), its M12's `org.projectActs` and `.decide` (empty, and refusing every id, while no terminal asks) and M7a's `org.channel.*` stay main's; the registry's held removals are acts, answered without effect. Only a harness
// build's main contains this module at all (index.ts's guard on `__MAWS_HARNESS_BUILD__`); a production launch never installs it.
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as z from 'zod';
import {
  GrantsViewSchema,
  OrgStatusSchema,
  OrgViewSchema,
  ProvisioningSecretReadingSchema,
  type commands,
  type DelegationResult,
  type DiscardResult,
  type DropRetryResult,
  type EnrollStartResult,
  type GrantRegrantResult,
  type GrantSetResult,
  type HubHalfResult,
  type OrgPolicySetResult,
  type OrgAttempt,
  type PairStartResult,
  type PreviewResult,
  type ProvisioningSecretWrite,
  type SignResult,
} from '@shared/ipc/schema/org';
import type { interceptCommand, MainHandler } from '../ipc/router';

export const ORG_PAGE_FIXTURE_ENV = 'MAWS_E2E_ORG_PAGE';

export interface OrgPageFixtureInstall {
  env: Record<string, string | undefined>;
  packaged: boolean;
  intercept: typeof interceptCommand;
  /** Stops the production session's `org.changed` forwarding (what `registerOrgHandlers` returns); called once installed. */
  unpublish(): void;
}

type FixtureCommand = Exclude<keyof typeof commands, 'org.rows' | 'org.policy.get' | 'org.projects' | `org.projectActs${string}` | `org.channel.${string}`>;

/** Null unless the fixture is asked for; throws, naming the file, when the schemas refuse it. Returns the uninstall. */
export function installOrgPageFixture(deps: OrgPageFixtureInstall): (() => void) | null {
  const path = deps.env[ORG_PAGE_FIXTURE_ENV];
  if (deps.env.MAWS_E2E !== '1' || deps.packaged || path === undefined || !isAbsolute(path)) return null;
  // Built here, not at the module's top, so a build whose guard drops the call keeps no schema call of this module's.
  const parsed = z
    .strictObject({
      status: OrgStatusSchema,
      view: OrgViewSchema.nullable(),
      grants: z.record(z.string(), GrantsViewSchema).optional(),
      holdGrantSave: z.literal(true).optional(),
      provisioningSecret: ProvisioningSecretReadingSchema.optional(),
    })
    .safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${ORG_PAGE_FIXTURE_ENV}: ${path} is not an Org page fixture: ${parsed.error.message}`);
  const { status, view, grants = {}, holdGrantSave, provisioningSecret = null } = parsed.data;
  deps.unpublish();

  const detail = 'the e2e Org page fixture is in force';
  const attempt: OrgAttempt = { ok: false, reason: { code: 'busy', detail } };
  const sign: SignResult = { ok: false, reason: 'busy', detail };
  const preview: PreviewResult = { ok: false, reason: 'invalid', detail, findings: [] };
  const pair: PairStartResult = { ok: false, reason: 'busy', detail };
  const enroll: EnrollStartResult = { ok: false, reason: 'busy', detail };
  const retry: DropRetryResult = { ok: false, reason: 'none', detail };
  const discard: DiscardResult = { ok: false, reason: 'none' };
  // M4b's grants: each machine's view as the file seeds it; signing one has no effect, as every act here, or with
  // `holdGrantSave` never answers, so the grant sheet stays saving
  const grant: GrantSetResult & GrantRegrantResult = { ok: false, reason: 'busy', detail };
  const save: OrgPolicySetResult = { ok: false, reason: 'busy' };
  // M4c: no delegation is created, renewed or revoked, and the destination's file is neither read nor written: its
  // reading is the file's (`provisioningSecret`), so the section and the create sheet can be drawn with one
  const half: HubHalfResult = { ok: false, reason: 'none', detail };
  const delegated: DelegationResult = { ok: false, reason: 'busy', detail, phase: 'refused', stored: false, run: null, rev: 0 };
  const unwritten: ProvisioningSecretWrite = { ok: false, reason: 'io', detail };
  const answers: { [N in FixtureCommand]: MainHandler<N> } = {
    'org.status': () => status,
    'org.view': () => view,
    'org.register': () => attempt,
    'org.signIn': () => attempt,
    'org.reanchor': () => attempt,
    'org.rekey': () => attempt,
    'org.cancel': () => {},
    'org.signOut': () => {},
    'org.resign': () => sign,
    'org.revokeSuperseded': () => sign,
    'org.discardPending': () => discard,
    'org.resetSigning': () => {},
    'org.preview': () => preview,
    'org.change': () => sign,
    'org.pair.start': () => pair,
    'org.pair.approve': () => sign,
    'org.pair.cancel': () => {},
    'org.enroll.start': () => enroll,
    'org.enroll.approve': () => sign,
    'org.enroll.cancel': () => ({ ok: false, reason: 'not-current', detail }),
    'org.drop.retry': () => retry,
    'org.delegation.create': () => delegated,
    'org.delegation.rewrite': () => delegated,
    'org.delegation.renewHub': () => half,
    'org.delegation.revokeHub': () => half,
    'org.delegation.readKeys': () => view?.hubKeys ?? { at: null, failed: false }, // the seeded list, read again
    'org.provisioningSecret.get': () => provisioningSecret,
    'org.provisioningSecret.set': () => unwritten,
    'org.provisioningSecret.reset': () => unwritten,
    'org.grants.view': ({ ref }) => (Object.hasOwn(grants, ref) ? grants[ref]! : { ok: false, ref, reason: 'signed-out' }),
    'org.grants.set': () => (holdGrantSave === true ? new Promise<never>(() => {}) : grant),
    'org.grants.regrant': () => grant,
    'org.policy.set': () => save,
    'org.owners.add': () => save,
    'org.removals.hold': () => {}, // the project registry: nothing held, nothing sent
    'org.removals.cancel': () => {},
  };
  const offs = (Object.keys(answers) as FixtureCommand[]).map((name) => deps.intercept(name, answers[name] as MainHandler<typeof name>));
  return () => offs.forEach((off) => off());
}
