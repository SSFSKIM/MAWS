// The committed vectors (generate.ts writes them) and their replay. Consumers replay them in their own runtime:
//
//     import { replayVectors, VECTORS } from 'org-protocol/vectors';
//     expect(await replayVectors(VECTORS)).toEqual([]);
//
// VECTOR_KEYS holds the scenario's test keys (private JWKs included) for suites that sign beyond the vectors.
//
// PROJECT_RULE is the project registry's shared rule vectors (project-rule.json, hand-written; Interfaces §B of
// docs/doperpowers/plans/2026-11-10-project-registry.md), which sminos vendors and MAWS's harness runs.
import type { KeyName, VectorSet } from './scenario.ts';
import keys from './keys.json' with { type: 'json' };
import rule from './project-rule.json' with { type: 'json' };
import vectors from './vectors.json' with { type: 'json' };

export type VectorKey = { pub: string; kid: string; jwk: JsonWebKey };

export const VECTORS = vectors as unknown as VectorSet;
export const VECTOR_KEYS = keys.keys as unknown as Record<KeyName, VectorKey>;

/** A path relative to a case's fresh directory. */
type RulePath = string;
export type RuleEntry =
  | { dir: RulePath }
  | { repo: RulePath; remote?: string; remotes?: Record<string, string> }
  | { worktree: RulePath; of: RulePath }
  | { smns: RulePath; project: string; name?: string; hub?: true | false | 'other-org' }
  | { symlink: RulePath; to: RulePath };
export type RuleStatement = { path: RulePath; minted?: string; linked?: string; removed?: true; replaced?: true };
export type RuleAsk = { dir: RulePath; project: string | { remote: string } | 'machine'; by: 'link' | 'minted' | 'smns' | 'remote' | 'machine'; at?: RulePath };
export type RuleCase = { name: string; platform?: 'darwin' | 'linux'; under?: string; tree: RuleEntry[]; statements: RuleStatement[]; ask: RuleAsk[] };
export type AnchorCase = {
  name: string;
  anchor: { dev: string; ino: string; birth: string };
  reading: { dev: string; ino: string; birthNs?: string; birthSeconds?: number };
  same: boolean;
};
export type ProjectRuleVectors = { about: string; version: number; org: string; machine: string; cases: RuleCase[]; anchors: AnchorCase[] };
export const PROJECT_RULE = rule as unknown as ProjectRuleVectors;
export { A, B, KEY_NAMES, ORG, PROJECT, REF_MINI, REF_NEWCOMER, REF_VM1, REF_VM_BUILD, type Case, type DualCase, type EnrollmentCase, type KeyName, type PairingVector, type ProvisioningVector, type VectorSet } from './scenario.ts';
export { replayVectors } from './replay.ts';
