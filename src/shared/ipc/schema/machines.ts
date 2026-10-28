// X2 `machines.*` (P5 O6 M3, docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "`machines.list` and
// `machines.changed`"; OX2): the app's connection manager (src/main/machines/manager.ts), so owned by main and graded
// `client`: every machine this app knows, with its link's state. The local machine is always `up`; a machine another
// profile serves is `connecting` from launch until its link first answers, then `up` or `down`. `generation` counts a
// machine's welcomes (+1 each), so the renderer can tell a restarted machine, whose counters start afresh (M4).
import * as z from 'zod';
import { MachineRefSchema } from '../../machine/ref';
import type { CommandSpec } from './common';

export const MachineStateSchema = z.strictObject({
  ref: MachineRefSchema,
  name: z.string(), // a display attribute, never an identity (OX2)
  local: z.boolean(),
  state: z.enum(['connecting', 'up', 'down']),
  since: z.string(), // when it entered this state (ISO-8601)
  generation: z.number().int().nonnegative(),
  // P5 O7 M1 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, Interfaces §D): how main reaches the machine while
  // it is `up` (a profile's socket, or an RL2 channel direct over the tailnet or through the hub), and the permanent
  // verdict holding an RL2 link down (the machine removed this device). Main-to-renderer only; nothing draws them yet.
  carrier: z.enum(['socket', 'direct', 'relay']).optional(),
  refusal: z.string().optional(),
});
export type MachineState = z.infer<typeof MachineStateSchema>;
export const MachinesSchema = z.strictObject({ machines: z.array(MachineStateSchema) }); // the whole list, the local machine first

export const commands = {
  'machines.list': { input: z.void(), output: MachinesSchema, owner: 'main' },
} as const satisfies Record<`machines.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'machines.changed': MachinesSchema, // on every transition, the whole list
} as const satisfies Record<`machines.${string}`, z.ZodType>;
