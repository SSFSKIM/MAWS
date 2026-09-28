// X2 `engine.*`. C1 ships the ping and the host-state snapshot; C3 fills the rest of the namespace.
import * as z from 'zod';
import { HostPingSchema, HostStateSchema, type CommandSpec } from './common';

export const commands = {
  'engine.ping': { input: z.void(), output: HostPingSchema, owner: 'engine-host' },
  // Snapshot command, answered by the supervisor in main so a crashed host still reports; same name as the event.
  'engine.hostState': { input: z.void(), output: HostStateSchema, owner: 'main' },
} as const satisfies Record<`engine.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'engine.hostState': HostStateSchema,
} as const satisfies Record<`engine.${string}`, z.ZodType>;
