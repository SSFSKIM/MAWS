// X2 `daemon.*` (P5 O2 M5; docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, Interfaces "Commands"): the machine daemon's
// own namespace, served by `mawsd` on `<profile>/mawsd/machine.sock` to the app and the CLI. `machine`-owned and
// main-only: the renderer never invokes it; main reaches it through its `machine` host (M7), and a remote caller through
// the endpoint (O10), which grades each by its effect (grades/daemon.ts).
//
// What `daemon.status` returns to a remote caller carries no file path, no log location, no tailnet address and no key
// material. Each such field is marked local-only (`localOnly`: optional, with `localOnly: true` in its metadata); every
// local answer carries them, and `remoteDaemonStatus` drops every marked field by walking the schema, so the endpoint
// redacts O2's fields without knowing them, and the redacted answer still validates against this one schema.
import * as z from 'zod';
import { MachineRefSchema } from '../../machine/ref';
import type { CommandSpec } from './common';
import { AbsolutePathSchema } from './settings'; // P5 O5 M4: daemon.e2eRender's `to`

// Always set locally; never shown to a remote caller.
export const localOnly = <T extends z.ZodType>(schema: T) => schema.optional().meta({ localOnly: true });

// A host as `mawsd` reaches it. `state` is a string (`parked`, `starting`, `ready`, `restarting`, `crashed`, `waiting`),
// so a new state is additive.
export const DaemonHostSchema = z.strictObject({
  state: z.string(),
  pid: z.number().int().nullable(),
  build: z.string().nullable(),
  liveSessions: z.number().int().nullable(),
});
export type DaemonHost = z.infer<typeof DaemonHostSchema>;

// P5 O3-D (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A, §I): the spine in `mawsd`. `state` is the
// seam's (`cold`, `loading`, `loaded`, `refused`, `releasing`, `yielded`), a string as a host's is, so a new state is
// additive; `refused`, the lock's holder while refused; `loadedAt`, the last load's time; `heldDropped`, the engine-host
// events discarded with a hold no spine of this daemon would fold (a refused or yielded load).
export const DaemonSpineSchema = z.strictObject({
  state: z.string(),
  refused: z.string().nullable(),
  loadedAt: z.string().nullable(),
  heldDropped: z.number().int().nonnegative(),
});
export type DaemonSpine = z.infer<typeof DaemonSpineSchema>;

// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §C): the artifact endpoint on
// artifacts.sock. `loaded`, whether its handler's chunk is in (it loads at the first use, never at the start);
// `requests`, the requests its handler answered since the start.
export const DaemonArtifactsSchema = z.strictObject({
  loaded: z.boolean(),
  requests: z.number().int().nonnegative(),
});
export type DaemonArtifacts = z.infer<typeof DaemonArtifactsSchema>;

// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §B): the render seam. `state` is the seam's
// (`off`, `starting`, `ready`, `ending`, `unavailable`), a string as a host's is; `detail`, why it is unavailable or what
// it waits for; `pid`, the render host's while one runs; `starts`, the render hosts started since the daemon's start;
// `requests`, the requests in its table now.
export const DaemonRenderSchema = z.strictObject({
  state: z.string(),
  detail: z.string().nullable(),
  pid: z.number().int().nullable(),
  starts: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});
export type DaemonRender = z.infer<typeof DaemonRenderSchema>;

export const DaemonStatusSchema = z.strictObject({
  pid: z.number().int(),
  startedAt: z.string(),
  kind: z.enum(['unit', 'private']),
  // buildId: 16 hex of the SHA-1 of out/main/mawsd.js; engineHostBuildId: the engine-host bundle's build id this daemon
  // would start
  build: z.strictObject({ version: z.string(), commit: z.string(), builtAt: z.string(), buildId: z.string(), engineHostBuildId: z.string() }),
  machine: MachineRefSchema,
  profile: localOnly(z.string()),
  platform: z.string(),
  role: z.enum(['laptop', 'server']),
  hosts: z.strictObject({ 'engine-host': DaemonHostSchema, 'pty-host': DaemonHostSchema }),
  clients: z.strictObject({ engineHost: z.boolean(), ptyHost: z.boolean(), machine: z.number().int() }),
  idleExitAt: z.string().nullable(), // a private daemon's own exit clock, while it runs
  logPath: localOnly(z.string()),
  endpoint: z.strictObject({ present: z.boolean(), detail: z.unknown() }), // detail: the module's status() (O10), under the same rule
  spine: DaemonSpineSchema.optional(), // P5 O3-D: absent from a daemon before O3-D
  // P5 O16 M2: the engine host's session hosts (its supervisor status's `holder`): live, re-attached by a successor and
  // left unadopted; absent while the engine host is parked or did not answer, and from a daemon before O16
  sessionHosts: z.strictObject({ hosts: z.number().int(), adopted: z.number().int(), failed: z.number().int() }).optional(),
  artifacts: DaemonArtifactsSchema.optional(), // P5 O5 M2: absent from a daemon before it
  render: DaemonRenderSchema.optional(), // P5 O5 M4: absent from a daemon before it
});
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;

// Whether a field's schema carries the local-only mark.
export const isLocalOnly = (schema: z.ZodType): boolean => (schema.meta() as { localOnly?: unknown } | undefined)?.localOnly === true;

// The status less every field the schema marks local-only, at any depth; still a valid DaemonStatus.
export function remoteDaemonStatus(status: DaemonStatus): DaemonStatus {
  return withoutLocalOnly(DaemonStatusSchema, status) as DaemonStatus;
}

function withoutLocalOnly(schema: z.ZodType, value: unknown): unknown {
  if (!(schema instanceof z.ZodObject) || typeof value !== 'object' || value === null) return value;
  const shape = schema.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    const fieldSchema = shape[key];
    if (fieldSchema && isLocalOnly(fieldSchema)) continue;
    out[key] = fieldSchema ? withoutLocalOnly(fieldSchema, field) : field;
  }
  return out;
}

const machine = <I extends z.ZodType, O extends z.ZodType>(input: I, output: O) => ({ input, output, owner: 'machine' as const });

export const commands = {
  'daemon.status': machine(z.void(), DaemonStatusSchema),
  'daemon.restart': machine(z.void(), z.void()), // answers, then the daemon exits 75 (its unit restarts it)
  // P5 O16 M3b (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D9, D40): `mawsd restart --engine-host`, the
  // engine host asked to hand its sessions over to a successor of this build. `detaching`: answered once the successor
  // is ready and its adoptions have ended (bounded), with its pid and how many sessions it adopted (absent past the
  // bounds); `deferred`: answered at once, with the calls still in flight (the successor follows the drain).
  'daemon.restartEngineHost': machine(
    z.void(),
    z.strictObject({ state: z.enum(['detaching', 'deferred']), inFlight: z.number().int().nonnegative(), pid: z.number().int().optional(), adopted: z.number().int().nonnegative().optional() }),
  ),
  // the CLI's `mawsd endpoint …` (and its aliases `enroll`, `keys`), passed to the endpoint module's `cli`; `secret` is the
  // enrollment code from stdin or a prompt, never argv, never logged
  'daemon.endpoint': machine(
    z.strictObject({ command: z.string(), args: z.array(z.string()), secret: z.string().optional() }),
    z.strictObject({ code: z.number().int(), out: z.string() }),
  ),
  // M5b fix round 2 (D11): the e2e's seams that live with the spine, run in `mawsd` on the daemon shape (src/mawsd/e2e-seam.ts):
  // the scenario's manual clock played to `ms`, the library's refreshes held; refused unless `mawsd` runs under MAWS_E2E=1
  'daemon.e2eSeam': machine(
    z.discriminatedUnion('seam', [z.strictObject({ seam: z.literal('scenario.advanceTo'), ms: z.number().int().nonnegative() }), z.strictObject({ seam: z.literal('library.holdRefreshes') })]),
    z.void(),
  ),
  // P5 O5 M4 (Interfaces §K): a capture through the render seam, fed to it as the engine host's `maws.artifact.capture`
  // would be, its PNG written to `to` (src/mawsd/e2e-seam.ts); refused unless `mawsd` runs under MAWS_E2E=1. A command of
  // its own, since a member added to daemon.e2eSeam's union would break the wire.
  'daemon.e2eRender': machine(
    z.strictObject({ artifactId: z.uuid(), revision: z.number().int().min(0), width: z.number().int().min(16).max(4096), height: z.number().int().min(16).max(4096), to: AbsolutePathSchema }),
    z.void(),
  ),
} as const satisfies Record<`daemon.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`daemon.${string}`, z.ZodType>;
