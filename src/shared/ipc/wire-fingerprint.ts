// The wire fingerprint (E10 execution document, §Design 2 and 6): a hash of the JSON schemas of everything that
// crosses the main ↔ engine-host wire, and nothing else: every engine-host-owned command's input and output, and every
// event in HOST_EVENTS, in name order. Two builds that changed no host shape share it even when their build ids
// differ, which is what lets an app serve an older supervisor's kept sessions; one changed `strictObject` on the wire
// changes it. Main-owned commands and main-emitted events are left out, or every settings bump would strand kept
// sessions.
// P5 O1 M6 (OX1): protocol 3 replaced the exact match with the wire's major and minor (wire.ts). The fingerprint stays
// for the protocol-2 window alone (socket-protocol.ts): a pre-O1 supervisor is spoken to as protocol 2 only when its
// fingerprint equals this build's, and `refuse` and host.status's `appWire` keep carrying it. It goes with the window.
// The O17 footprint fix: the value is computed when the wire changes, not in every process at its start, where
// `z.toJSONSchema` over every engine-host command left cached state on each schema it visited (about 340 KiB in mawsd
// and in the engine host alike). wire-fingerprint.json holds `fingerprintOf` over the real registry;
// wire-fingerprint.test.ts holds it equal, and `pnpm wire:manifest` rewrites it beside the wire manifest.
import { createHash } from 'node:crypto';
import * as z from 'zod';
import committed from './wire-fingerprint.json';

interface FingerprintRegistry {
  commands: Record<string, { input: z.ZodType; output: z.ZodType; owner: string }>;
  events: Record<string, z.ZodType>;
}

const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any' });

// The fingerprint of a registry; wire-fingerprint.json is this over the real one. Exported for its tests, which write
// the file.
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

export function wireFingerprint(): string {
  return committed.fingerprint;
}
