// Writes keys.json and vectors.json: the scenario (scenario.ts) run with fresh P-256 keys. ECDSA is randomized, so a
// run writes new signatures and keys; every expectation holds for any keys, and the package's suites check that with
// keys of their own. Run it from the package (Node 22, type stripping):
//
//     pnpm --filter org-protocol vectors
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSigningKey, keyId } from '../src/keys.ts';
import { buildScenario, KEY_NAMES, type Keys } from './scenario.ts';

const keys = {} as Keys;
const written: Record<string, { pub: string; kid: string; jwk: JsonWebKey }> = {};
for (const name of KEY_NAMES) {
  keys[name] = await generateSigningKey(true);
  written[name] = { pub: keys[name].pub, kid: await keyId(keys[name].pub), jwk: await crypto.subtle.exportKey('jwk', keys[name].privateKey) };
}
const set = await buildScenario(keys);
const about = 'org-protocol vectors (docs/doperpowers/plans/2026-10-27-p5-o11-hub-v2.md, M1): written by vectors/generate.ts; test keys only.';
writeFileSync(join(import.meta.dirname, 'keys.json'), `${JSON.stringify({ about, keys: written }, null, 1)}\n`);
writeFileSync(join(import.meta.dirname, 'vectors.json'), `${JSON.stringify({ about, ...set }, null, 1)}\n`);
console.log(`${set.cases.length} cases, ${set.dual.length} dual-coded events, ${Object.keys(set.fixtures).length} fixtures`);
