// Introspects the X2 registry: for each command, the property names anywhere in its input schema.
import * as z from 'zod';
import { commands, events } from '/private/tmp/maws-arch/src/shared/ipc/schema';

function keys(node: unknown, out: Set<string>, seen = new Set<unknown>()): void {
  if (node === null || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) { for (const n of node) keys(n, out, seen); return; }
  const rec = node as Record<string, unknown>;
  if (rec.properties && typeof rec.properties === 'object') for (const k of Object.keys(rec.properties as object)) out.add(k);
  for (const v of Object.values(rec)) keys(v, out, seen);
}
const result: Record<string, { owner: string; inputKeys: string[]; outputKeys: string[] }> = {};
for (const [name, spec] of Object.entries(commands as Record<string, { input: z.ZodType; output: z.ZodType; owner: string }>)) {
  const ik = new Set<string>(); const ok = new Set<string>();
  try { keys(z.toJSONSchema(spec.input, { unrepresentable: 'any', io: 'input' }), ik); } catch (e) { ik.add('!err'); }
  try { keys(z.toJSONSchema(spec.output, { unrepresentable: 'any' }), ok); } catch (e) { ok.add('!err'); }
  result[name] = { owner: spec.owner, inputKeys: [...ik].sort(), outputKeys: [...ok].sort() };
}
const ev: Record<string, string[]> = {};
for (const [name, schema] of Object.entries(events as Record<string, z.ZodType>)) {
  const k = new Set<string>();
  try { keys(z.toJSONSchema(schema, { unrepresentable: 'any' }), k); } catch { k.add('!err'); }
  ev[name] = [...k].sort();
}
console.log(JSON.stringify({ commands: result, events: ev }));
