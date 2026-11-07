// The Share sheet's e2e fixture (P5 O8 M6b Task 3, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b's
// "Touches", e2e): e2e/share.spec.ts photographs the Share sheet and the rows' reach marks over sessions on several
// machines, which no real org holds at once (a private session shared with you, a machine whose sminos can't keep a
// reach, a save whose lines meet a skipped revision, an unknown refusal and an unknown outcome). Under MAWS_E2E=1, in a
// build that is not packaged, with MAWS_E2E_SHARE naming a JSON file the `org.*` and `machines.*` schemas admit, main
// answers from it through C5's `interceptCommand`, so the real renderer draws what main would send:
//   - `org.status`, `org.view`, `org.rows` and `machines.list` as the file says them (the other machines up);
//   - `org.policy.get`: a machine's read as the file holds it (`{machine}`), or that read cut to the one session
//     (`{address}`); a machine the file holds no read for is `offline`;
//   - `org.policy.set` and `org.owners.add`: the save the file holds for the address, else refused `busy`; nothing is
//     signed or sent, so the production session behind it stays untouched.
// The session's `org.changed` forwarding is stopped (`unpublish`), as the other org fixtures stop it, and so are the
// production rows' `org.rows.changed` (`holdRows`): signed out, they would replace the seeded rows with none. Only a
// harness build's main contains this module at all (app.ts's guard on `__MAWS_HARNESS_BUILD__`); a production launch
// never installs it.
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as z from 'zod';
import { MachinesSchema } from '@shared/ipc/schema/machines';
import { OrgPolicySchema, OrgPolicySetResultSchema, OrgRowsSchema, OrgStatusSchema, OrgViewSchema, type OrgPolicy, type OrgPolicySetResult } from '@shared/ipc/schema/org';
import { bareOf, isAddress, machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { interceptCommand } from '../ipc/router';

export const SHARE_FIXTURE_ENV = 'MAWS_E2E_SHARE';

export interface ShareFixtureInstall {
  env: Record<string, string | undefined>;
  packaged: boolean;
  intercept: typeof interceptCommand;
  /** Stops the production session's `org.changed` forwarding (what `registerOrgHandlers` returns); called once installed. */
  unpublish(): void;
  /** Stops the production rows' `org.rows.changed`; called once installed. */
  holdRows(): void;
}

/** Null unless the fixture is asked for; throws, naming the file, when the schemas refuse it. Returns the uninstall. */
export function installShareFixture(deps: ShareFixtureInstall): (() => void) | null {
  const path = deps.env[SHARE_FIXTURE_ENV];
  if (deps.env.MAWS_E2E !== '1' || deps.packaged || path === undefined || !isAbsolute(path)) return null;
  // Built here, not at the module's top, so a build whose guard drops the call keeps no schema call of this module's.
  const parsed = z
    .strictObject({
      status: OrgStatusSchema,
      view: OrgViewSchema.nullable(),
      rows: OrgRowsSchema,
      machines: MachinesSchema.shape.machines,
      policies: z.array(OrgPolicySchema),
      saves: z.record(z.string(), OrgPolicySetResultSchema),
    })
    .safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${SHARE_FIXTURE_ENV}: ${path} is not a Share fixture: ${parsed.error.message}`);
  const { status, view, rows, machines, policies, saves } = parsed.data;
  deps.unpublish();
  deps.holdRows();

  const readOf = (machine: MachineRef): OrgPolicy => policies.find((p) => p.machine === machine) ?? { ok: false, machine, reason: 'offline' };
  const saveOf = (address: string): OrgPolicySetResult => saves[address] ?? { ok: false, reason: 'busy' };
  const offs = [
    deps.intercept('org.status', () => status),
    deps.intercept('org.view', () => view),
    deps.intercept('org.rows', () => rows),
    deps.intercept('machines.list', () => ({ machines })),
    deps.intercept('org.policy.get', (input) => {
      if ('machine' in input) return readOf(input.machine as MachineRef);
      if (!isAddress(input.address)) return { ok: false, machine: machines[0]!.ref, reason: 'malformed' };
      const read = readOf(machineOf(input.address));
      if (!read.ok || !read.supported) return read;
      const session = bareOf(input.address);
      return { ...read, policies: read.policies.filter((p) => p.session === session) };
    }),
    deps.intercept('org.policy.set', (input) => saveOf(input.address)),
    deps.intercept('org.owners.add', (input) => saveOf(input.address)),
  ];
  return () => offs.forEach((off) => off());
}
