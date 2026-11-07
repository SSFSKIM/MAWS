// The project channel's e2e fixture (P5 O8 M7a Task 3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's
// "Touches", e2e): e2e/channel.spec.ts photographs the Channel tab over a channel with real-world variety, which no one
// real log holds at once (a refused word and a not-sent one beside a 40-message exchange, migrated and legacy history,
// an offline "as of"). Under MAWS_E2E=1, in a build that is not packaged, with MAWS_E2E_CHANNEL naming a JSON file of
// `{status, project, answer}` that the `org.*` schemas admit, main answers `org.status` and that project's
// `org.channel.open` from it through C5's `interceptCommand`, so the real renderer draws what main would send: the
// status's `hubAccess` reads the Offline line's reason and its member "You"; any other project reads `unknown-project`,
// a close does nothing, and words are refused `no-hub` with nothing sent, so the production session behind it stays
// untouched. The session's `org.changed` forwarding is stopped (`unpublish`), as the Org page's fixture stops it, since
// even a profile never signed in publishes once its load ends and would replace the seeded status. The waiting cards
// are attention's, not the channel's: the spec seeds them through C5's stub scenario. Only a harness build's main
// contains this module at all (app.ts's guard on `__MAWS_HARNESS_BUILD__`); a production launch never installs it.
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as z from 'zod';
import { ChannelAnswerSchema, OrgStatusSchema, type ChannelSendResult } from '@shared/ipc/schema/org';
import type { interceptCommand } from '../ipc/router';

export const CHANNEL_FIXTURE_ENV = 'MAWS_E2E_CHANNEL';

export interface ChannelFixtureInstall {
  env: Record<string, string | undefined>;
  packaged: boolean;
  intercept: typeof interceptCommand;
  /** Stops the production session's `org.changed` forwarding (what `registerOrgHandlers` returns); called once installed. */
  unpublish(): void;
}

/** Null unless the fixture is asked for; throws, naming the file, when the schemas refuse it. Returns the uninstall. */
export function installChannelFixture(deps: ChannelFixtureInstall): (() => void) | null {
  const path = deps.env[CHANNEL_FIXTURE_ENV];
  if (deps.env.MAWS_E2E !== '1' || deps.packaged || path === undefined || !isAbsolute(path)) return null;
  // Built here, not at the module's top, so a build whose guard drops the call keeps no schema call of this module's.
  const parsed = z.strictObject({ status: OrgStatusSchema, project: z.string().min(1), answer: ChannelAnswerSchema }).safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${CHANNEL_FIXTURE_ENV}: ${path} is not a channel fixture: ${parsed.error.message}`);
  const { status, project, answer } = parsed.data;
  deps.unpublish();

  const unsent: ChannelSendResult = { ok: false, reason: 'no-hub', detail: 'the e2e channel fixture is in force' };
  const offs = [
    deps.intercept('org.status', () => status),
    deps.intercept('org.channel.open', (input) => (input.project === project ? answer : { ok: false, reason: 'unknown-project', rev: answer.rev })),
    deps.intercept('org.channel.close', () => {}),
    deps.intercept('org.channel.send', () => unsent),
  ];
  return () => offs.forEach((off) => off());
}
