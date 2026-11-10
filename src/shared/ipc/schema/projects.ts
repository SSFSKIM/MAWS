// X2 `projects.*` (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md, M12 and Interfaces §K):
// what `mawsd` serves the `maws` command line on machine.sock, the front's own and no service's:
//   - `projects.registry`: the org's projects as this machine's endpoint holds them (§H's `RegistryRead`): the held records
//     and the machine's own, assembled as the endpoint assembles its directory, with the machines' names from the head.
//     On a machine that is not enrolled, `enrolled: false` and no projects.
//   - `projects.forward`: a verb aimed at another machine, which only a member's device can sign. The daemon posts
//     `projects.act.request` to the attached app whose hello lists `machine.project-acts` and answers with the app's
//     `projects.act.answer` for that id; with no such app, or once the app's connection ends, `{ok: false, code: 'no-app'}`.
// An event and a command, as the client port's request and answer are: a ninth client-port kind would be an enum member
// on the wire, which takes a major (the execution document's Decision Log 6).
import * as z from 'zod';
import { MachineRefSchema } from '../../machine/ref';
import type { CommandSpec } from './common';

/** A projects record's location (org-protocol's `ProjectLocation`, §A) with the machine that holds it. */
export const RegistryLocationSchema = z.strictObject({
  pid: z.string().min(1),
  id: z.string().min(1),
  key: z.string(),
  name: z.string(),
  nameRev: z.number().int().positive().optional(),
  path: z.string(),
  source: z.enum(['smns', 'remote', 'repository', 'folder']),
  stated: z.enum(['minted', 'linked']).optional(),
  hub: z.literal(false).optional(),
  remote: z.string().optional(),
  state: z.enum(['missing', 'replaced']).optional(),
  machine: MachineRefSchema,
});
/** org-protocol's `RegistryProject` (§A), as `assembleProjects` gives it. */
export const RegistryProjectSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  hub: z.boolean(),
  renamable: z.boolean(),
  locations: z.array(RegistryLocationSchema),
  known: z.array(MachineRefSchema),
});
const MachineNamedSchema = z.strictObject({ ref: MachineRefSchema, name: z.string() });
export const ProjectsRegistrySchema = z.strictObject({ enrolled: z.boolean(), machine: MachineNamedSchema, machines: z.array(MachineNamedSchema), projects: z.array(RegistryProjectSchema) });
export type ProjectsRegistry = z.infer<typeof ProjectsRegistrySchema>;

export const PROJECT_VERBS = ['add', 'remove', 'link'] as const;
/** A verb aimed at another machine: `machine` its name in the org, `path` absolute there; `into` a project id (null unlinks). */
export const ProjectForwardSchema = z.strictObject({
  verb: z.enum(PROJECT_VERBS),
  machine: z.string().min(1).max(128),
  path: z.string().startsWith('/').max(4096),
  into: z.string().min(1).max(64).nullable().optional(),
  own: z.literal(true).optional(),
  name: z.string().min(1).max(128).optional(),
});
export type ProjectForward = z.infer<typeof ProjectForwardSchema>;
/** What `maws` prints: the act's words, or a refusal's code and its sentence. */
export const ProjectForwardResultSchema = z.union([z.strictObject({ ok: z.literal(true), text: z.string() }), z.strictObject({ ok: z.literal(false), code: z.string().min(1), text: z.string() })]);
export type ProjectForwardResult = z.infer<typeof ProjectForwardResultSchema>;

export const commands = {
  'projects.registry': { input: z.void(), output: ProjectsRegistrySchema, owner: 'machine' }, // main-only: a machine.sock client's
  'projects.forward': { input: ProjectForwardSchema, output: ProjectForwardResultSchema, owner: 'machine' }, // main-only: a machine.sock client's
  'projects.act.answer': { input: z.strictObject({ id: z.string().min(1), result: ProjectForwardResultSchema }), output: z.void(), owner: 'machine' }, // main-only: the attached app's
} as const satisfies Record<`projects.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'projects.act.request': ProjectForwardSchema.extend({ id: z.string().min(1) }), // to the attached app alone
} as const satisfies Record<`projects.${string}`, z.ZodType>;
