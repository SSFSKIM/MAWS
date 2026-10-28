// The committed vectors (generate.ts writes them) and their replay. Consumers replay them in their own runtime:
//
//     import { replayVectors, VECTORS } from 'org-protocol/vectors';
//     expect(await replayVectors(VECTORS)).toEqual([]);
//
// VECTOR_KEYS holds the scenario's test keys (private JWKs included) for suites that sign beyond the vectors.
import type { KeyName, VectorSet } from './scenario.ts';
import keys from './keys.json' with { type: 'json' };
import vectors from './vectors.json' with { type: 'json' };

export type VectorKey = { pub: string; kid: string; jwk: JsonWebKey };

export const VECTORS = vectors as unknown as VectorSet;
export const VECTOR_KEYS = keys.keys as unknown as Record<KeyName, VectorKey>;
export { A, B, KEY_NAMES, ORG, PROJECT, REF_MINI, REF_NEWCOMER, REF_VM1, REF_VM_BUILD, type Case, type DualCase, type EnrollmentCase, type KeyName, type PairingVector, type ProvisioningVector, type VectorSet } from './scenario.ts';
export { replayVectors } from './replay.ts';
