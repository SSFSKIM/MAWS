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
  // the CLI's `mawsd endpoint …` (and its aliases `enroll`, `keys`), passed to the endpoint module's `cli`; `secret` is the
  // enrollment code from stdin or a prompt, never argv, never logged
  'daemon.endpoint': machine(
    z.strictObject({ command: z.string(), args: z.array(z.string()), secret: z.string().optional() }),
    z.strictObject({ code: z.number().int(), out: z.string() }),
  ),
} as const satisfies Record<`daemon.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {} as const satisfies Record<`daemon.${string}`, z.ZodType>;
