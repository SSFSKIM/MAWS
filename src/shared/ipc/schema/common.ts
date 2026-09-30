// X2 pieces several namespaces share. Imported through `@shared/ipc/schema`, never directly.
import * as z from 'zod';

export type Owner = 'main' | 'engine-host' | 'pty-host';
export interface CommandSpec<I extends z.ZodType, O extends z.ZodType> {
  input: I;
  output: O;
  owner: Owner;
}

export { NAMESPACES, type Namespace } from '../names'; // the zod-free half the preload bundles

export const HostPingSchema = z.strictObject({ pid: z.number().int(), uptimeMs: z.number(), hostVersion: z.string() });
export type HostPing = z.infer<typeof HostPingSchema>;

export const HostStateSchema = z.strictObject({
  state: z.enum(['starting', 'ready', 'crashed', 'restarting']),
  pid: z.number().int().nullable(),
  restarts: z.number().int(),
  revision: z.number().int(), // increments on every transition of that host since app start; a consumer keeps the higher of snapshot and event
});
export type HostState = z.infer<typeof HostStateSchema>;
