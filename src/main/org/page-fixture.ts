// The Org page's e2e fixture (P5 O8 M4a Task 8, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Decision Log
// "M4a gains Task 8"): e2e/org-page.spec.ts photographs the page over an org with real-world variety, which no one real
// session holds at once (a refusal that names no attempt is the key file refused at load, which leaves this Mac unable to
// run a pairing). Under MAWS_E2E=1, in a build that is not packaged, with MAWS_E2E_ORG_PAGE naming a JSON file of
// `{status, view}` that the `org.*` schemas admit, main answers `org.status` and `org.view` from it through C5's
// `interceptCommand`, so the real renderer draws what main would send; every act is answered without effect, so the
// production session behind it stays untouched. `org.rows` stays main's. Only a harness build's main contains this
// module at all (index.ts's guard on `__MAWS_HARNESS_BUILD__`); a production launch never installs it.
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as z from 'zod';
import {
  OrgStatusSchema,
  OrgViewSchema,
  type commands,
  type DiscardResult,
  type OrgAttempt,
  type OrgStatus,
  type OrgView,
  type PairStartResult,
  type PreviewResult,
  type SignResult,
} from '@shared/ipc/schema/org';
import type { interceptCommand, MainHandler } from '../ipc/router';

export const ORG_PAGE_FIXTURE_ENV = 'MAWS_E2E_ORG_PAGE';

/** What the file holds, as the spec writes it. */
export type OrgPageFixture = { status: OrgStatus; view: OrgView | null };

export interface OrgPageFixtureInstall {
  env: Record<string, string | undefined>;
  packaged: boolean;
  intercept: typeof interceptCommand;
}

type FixtureCommand = Exclude<keyof typeof commands, 'org.rows'>;

/** Null unless the fixture is asked for; throws, naming the file, when the schemas refuse it. Returns the uninstall. */
export function installOrgPageFixture(deps: OrgPageFixtureInstall): (() => void) | null {
  const path = deps.env[ORG_PAGE_FIXTURE_ENV];
  if (deps.env.MAWS_E2E !== '1' || deps.packaged || path === undefined || !isAbsolute(path)) return null;
  // Built here, not at the module's top, so a build whose guard drops the call keeps no schema call of this module's.
  const parsed = z.strictObject({ status: OrgStatusSchema, view: OrgViewSchema.nullable() }).safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${ORG_PAGE_FIXTURE_ENV}: ${path} is not an Org page fixture: ${parsed.error.message}`);
  const { status, view } = parsed.data;

  const detail = 'the e2e Org page fixture is in force';
  const attempt: OrgAttempt = { ok: false, reason: { code: 'busy', detail } };
  const sign: SignResult = { ok: false, reason: 'busy', detail };
  const preview: PreviewResult = { ok: false, reason: 'invalid', detail, findings: [] };
  const pair: PairStartResult = { ok: false, reason: 'busy', detail };
  const discard: DiscardResult = { ok: false, reason: 'none' };
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
  };
  const offs = (Object.keys(answers) as FixtureCommand[]).map((name) => deps.intercept(name, answers[name] as MainHandler<typeof name>));
  return () => offs.forEach((off) => off());
}
