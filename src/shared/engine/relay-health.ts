// The relay health answer (C3 execution document, Interfaces "Relay health"): what `engine.relayHealth` answers and what
// `session.launch` carries in `relay_unreachable`. The check itself lives in src/engine-host/relay-health.ts. Strict.
import * as z from 'zod';

export const RelayHealthSchema = z.strictObject({
  url: z.string(),
  ok: z.boolean(), // HTTP 200 from `${url}/api/hello`
  status: z.number().int().nullable(),
  latencyMs: z.number().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});
export type RelayHealth = z.infer<typeof RelayHealthSchema>;
