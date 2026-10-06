// The wire fingerprint (E10 execution document, §Design 2 and 6): a hash of the JSON schemas of everything that
// crosses the main ↔ engine-host wire, and nothing else: every engine-host-owned command's input and output, and every
// event in HOST_EVENTS, in name order. Two builds that changed no host shape share it even when their build ids
// differ, which is what lets an app serve an older supervisor's kept sessions; one changed `strictObject` on the wire
// changes it. Main-owned commands and main-emitted events are left out, or every settings bump would strand kept
// sessions. Main and the supervisor each compute it once, at the first handshake.
import { createHash } from 'node:crypto';
import * as z from 'zod';
import { commands, events, HOST_EVENTS } from './schema';

interface FingerprintRegistry {
  commands: Record<string, { input: z.ZodType; output: z.ZodType; owner: string }>;
  events: Record<string, z.ZodType>;
}

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any' });

// The fingerprint of a registry; `wireFingerprint` is this over the real one. Exported for its tests.
export function fingerprintOf(registry: FingerprintRegistry, hostEvents: readonly string[]): string {
  const wire = {
    commands: Object.keys(registry.commands)
      .filter((name) => registry.commands[name].owner === 'engine-host')
      .sort()
      .map((name) => [name, jsonSchema(registry.commands[name].input), jsonSchema(registry.commands[name].output)]),
    events: [...hostEvents].sort().map((name) => [name, jsonSchema(registry.events[name])]),
  };
  return createHash('sha1').update(JSON.stringify(wire)).digest('hex').slice(0, 16);
}

let cached: string | null = null;

export function wireFingerprint(): string {
  cached ??= fingerprintOf({ commands, events }, HOST_EVENTS);
  return cached;
}
