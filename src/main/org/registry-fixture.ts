// The project registry's e2e fixture (docs/doperpowers/plans/2026-11-10-project-registry.md, M11's "It proves", e2e):
// e2e/registry.spec.ts drives the page over an org whose registry holds a project with no folder on this Mac, missing,
// offline and replaced locations and a removal held for a machine that is off, which no real org holds at once. Under
// MAWS_E2E=1, in a build that is not packaged, with MAWS_E2E_REGISTRY naming a JSON file of `{status, view, rows, machines,
// projects, log}` that the `org.*` and `machines.*` schemas admit, main:
//   - answers `org.status`, `org.view`, `org.rows`, `machines.list` and `org.projects` from it, through C5's
//     `interceptCommand`, so the real renderer draws what main would send;
//   - stands in for the file's other machines (remote lane B's `standInForMachines`, ahead of every link and step-up):
//     `session.projects.resolve` answers the machine's own project (nothing decides the folder), and
//     `session.projects.addFolder` answers a new project there; any other command for them takes the link as before;
//   - answers `org.removals.cancel` by dropping that removal and saying `org.projects.changed` with the value left;
//   - writes each act it answered to `log` as one JSON line, `{name, machine?, input}`, which the spec reads back.
// The session's `org.changed` and the production rows' `org.rows.changed` are stopped, as the Share fixture stops them,
// and each `org.projects.changed` the production registry says (signed out: none) and each `machines.changed` the
// production connection manager says (this Mac alone, again at each change of its daemon's link) is followed at once by
// the seeded value, so the page keeps it whichever reaches it after its read. Nothing is signed or sent. Only a harness
// build's main contains this module at all (app.ts's guard on `__MAWS_HARNESS_BUILD__`); a production launch never
// installs it.
import { appendFileSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import * as z from 'zod';
import type { ProjectId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventPayload } from '@shared/ipc/schema';
import { MachinesSchema } from '@shared/ipc/schema/machines';
import { OrgProjectsSchema, OrgRowsSchema, OrgStatusSchema, OrgViewSchema } from '@shared/ipc/schema/org';
import type { OrgKey } from '@shared/machine/org-key';
import type { MachineRef } from '@shared/machine/ref';
import type { interceptCommand } from '../ipc/router';
import type { MachineStandIn } from '../lane-b/remote';

export const REGISTRY_FIXTURE_ENV = 'MAWS_E2E_REGISTRY';

/** The events whose production word the fixture follows with its seeded value. */
type Followed = 'org.projects.changed' | 'machines.changed';

export interface RegistryFixtureInstall {
  env: Record<string, string | undefined>;
  packaged: boolean;
  intercept: typeof interceptCommand;
  /** Remote lane B's `standInForMachines`: answers a command for another machine ahead of its link. */
  standIn(standIn: MachineStandIn): () => void;
  /** Main's `emit`, for the seeded `org.projects.changed` and `machines.changed`. */
  emit<N extends Followed>(name: N, payload: EventPayload<N>): unknown;
  /** Main's `onEmitted`: hears the production registry's `org.projects.changed` and the connection manager's `machines.changed`. */
  onEmitted<N extends Followed>(name: N, listener: (payload: EventPayload<N>) => void): () => void;
  /** Stops the production session's `org.changed` forwarding (what `registerOrgHandlers` returns); called once installed. */
  unpublish(): void;
  /** Stops the production rows' `org.rows.changed`; called once installed. */
  holdRows(): void;
}

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

/** Null unless the fixture is asked for; throws, naming the file, when the schemas refuse it. Returns the uninstall. */
export function installRegistryFixture(deps: RegistryFixtureInstall): (() => void) | null {
  const path = deps.env[REGISTRY_FIXTURE_ENV];
  if (deps.env.MAWS_E2E !== '1' || deps.packaged || path === undefined || !isAbsolute(path)) return null;
  // Built here, not at the module's top, so a build whose guard drops the call keeps no schema call of this module's.
  const parsed = z
    .strictObject({
      status: OrgStatusSchema,
      view: OrgViewSchema.nullable(),
      rows: OrgRowsSchema,
      machines: MachinesSchema.shape.machines,
      projects: OrgProjectsSchema,
      log: z.string().refine(isAbsolute, 'an absolute path'),
    })
    .safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) throw new Error(`${REGISTRY_FIXTURE_ENV}: ${path} is not a registry fixture: ${parsed.error.message}`);
  const { status, view, rows, machines, log } = parsed.data;
  let projects = parsed.data.projects;
  deps.unpublish();
  deps.holdRows();

  const write = (entry: { name: CommandName; machine?: MachineRef; input: unknown }) => appendFileSync(log, `${JSON.stringify(entry)}\n`);
  // the seeded value said again after each the production says; never heard as its own
  let saying = false;
  const say = <N extends Followed>(name: N, payload: EventPayload<N>) => {
    saying = true;
    try {
      deps.emit(name, payload);
    } finally {
      saying = false;
    }
  };
  const follow = <N extends Followed>(name: N, seeded: () => EventPayload<N>) =>
    deps.onEmitted(name, () => {
      if (!saying) say(name, seeded());
    });
  const others = new Set(machines.filter((m) => !m.local).map((m) => m.ref));
  const answered = <N extends CommandName>(value: unknown): CommandResult<N> => ({ ok: true, value }) as CommandResult<N>;

  const offs = [
    deps.intercept('org.status', () => status),
    deps.intercept('org.view', () => view),
    deps.intercept('org.rows', () => rows),
    deps.intercept('machines.list', () => ({ machines })),
    deps.intercept('org.projects', () => projects),
    deps.intercept('org.removals.cancel', (input) => {
      write({ name: 'org.removals.cancel', input });
      projects = { ...projects, removals: projects.removals.filter((r) => r.id !== input.id) };
      say('org.projects.changed', projects);
    }),
    follow('org.projects.changed', () => projects),
    follow('machines.changed', () => ({ machines })),
    deps.standIn((machine, name, input) => {
      if (!others.has(machine)) return undefined;
      const directory = () => (input as { directory: string }).directory; // the two handled commands' input; another's may be none
      if (name === 'session.projects.resolve') {
        write({ name, machine, input });
        return answered({ project: null, by: 'machine', at: null, label: { key: `folder:${machine}:${directory()}` as OrgKey, name: basename(directory()), source: 'folder', smnsId: null } });
      }
      if (name === 'session.projects.addFolder') {
        write({ name, machine, input });
        const path = directory();
        const project = { id: `added-${basename(path)}` as ProjectId, name: basename(path), directory: path, order: 0, createdAt: new Date().toISOString() };
        return answered({ project, location: { kind: 'directory', path }, by: 'minted', at: path, restated: true });
      }
      return undefined;
    }),
  ];
  return () => offs.forEach((off) => off());
}
