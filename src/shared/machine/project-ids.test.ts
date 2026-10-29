import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { machineProjectId } from './project-ids';

const FIXTURES = join(__dirname, '../../../test/fixtures/sminos');
const readVectors = <T>(file: string): { namespace: string; vectors: T[] } => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));

// remote-key.json's project ids are checked beside the remote keys they hash, in src/services/index/org-project.test.ts.
describe("sminos 1.15.0's vectors", () => {
  it('derives every machine project id of machine-project-id.json', () => {
    const { vectors } = readVectors<{ org: string; machine: string; id: string }>('machine-project-id.json');
    expect(vectors.length).toBeGreaterThan(4);
    for (const vector of vectors) expect(machineProjectId(vector.org, vector.machine)).toBe(vector.id);
  });
});
