// sminos's project ids (P5 O6 M5; sminos 1.15.0's `repo_project_id` and `machine_project_id` in
// skills/sminos/scripts/sminos.py, its vectors vendored in test/fixtures/sminos/). Neutral ground (P5 O3-C, D3): the
// spine's org-project derivation (src/services/index/org-project.ts) and main's org rows (src/main/org/rows.ts) both
// derive them.
import { createHash } from 'node:crypto';

const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 appendix C, Python's uuid.NAMESPACE_URL

// RFC 4122 §4.3, name-based with SHA-1: Python's `uuid.uuid5`.
export function uuid5(namespace: string, name: string): string {
  const hash = createHash('sha1').update(Buffer.from(namespace.replace(/-/g, ''), 'hex')).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// sminos's `repo_project_id`: the project a remote key derives in an org.
export const repoProjectId = (org: string, key: string): string => uuid5(NAMESPACE_URL, `smns-repo:${org}:${key}`);
// sminos's `machine_project_id`: an enrolled machine's own project, its name lower-cased as the hub compares names.
export const machineProjectId = (org: string, machine: string): string => uuid5(NAMESPACE_URL, `smns-machine:${org}:${machine.toLowerCase()}`);
