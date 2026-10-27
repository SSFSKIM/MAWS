// X2 pieces several namespaces share. Imported through `@shared/ipc/schema`, never directly.
import * as z from 'zod';

// P5 O1 M5: `machine` is a machine-bound service's namespace, answered either by handlers inside main (the embedded
// binding) or by another process (the host binding), with the asker's `ClientRef` carried across (src/main/ipc/router.ts).
export type Owner = 'main' | 'machine' | 'engine-host' | 'pty-host';
export interface CommandSpec<I extends z.ZodType, O extends z.ZodType> {
  input: I;
  output: O;
  owner: Owner;
}

// A JSON value: what JSON.stringify would drop or rewrite (`undefined`, a function, NaN, Infinity) is refused at any
// depth, so a copy over a JSON wire is the value sent (P3-A M5's setAttr value; P3-H's connector results, whose required
// key must not be typed `unknown`, which JSON drops when undefined). The public type is one level deep and the rest
// `unknown`: a recursive type makes Playwright's typed `page.evaluate` over CommandInput infinitely deep (TS2589).
function isJsonValue(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false; // undefined, function, bigint, symbol, a cycle
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) return false; // a Date, Map, typed array, class instance
  ancestors.add(value);
  const keys = Object.keys(value);
  const ok = (!isArray || keys.length === (value as unknown[]).length) && keys.every((key) => isJsonValue((value as Record<string, unknown>)[key], ancestors));
  ancestors.delete(value);
  return ok;
}
export const JsonValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
  .refine((value) => isJsonValue(value), 'expected a JSON value');

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
