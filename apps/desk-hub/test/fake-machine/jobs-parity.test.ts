// DX4's shared vectors (fake-machine/dx4/dx4-jobs.json, DC8's, vendored) against the fake machine's derivation, as
// doperpowers' jobs_parity.py runs them against the plane's: the normalization table, every case's widened `subagents`
// body ({subagents, jobs, mcp}) from its rows, metas, agent files and bridge state, and every `output` case answered
// over a file layout made under a temporary directory. A failure here is a disagreement with DC8's producer, for the
// composite's writer: the vectors are never edited to pass.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveFromRows, LoopIndex, TABLE, type BodyInput } from '../../fake-machine/jobs';
import { answerOutput } from '../../fake-machine/output';
import type { JsonObject } from '../../src/protocol/json';

type Layout = { path: string; file?: string; symlink?: string; dir?: true };
type OutputCase = {
  name: string;
  input: { session: string; roots: string[]; main: JsonObject[]; layout: Layout[]; request: { taskId: string; tail: number } };
  expect: JsonObject;
};
type Vectors = {
  table: Array<{ raw: string; status: string; terminal: boolean }>;
  cases: Array<{ name: string; input: BodyInput; expect: { subagents: unknown; jobs: unknown; mcp: unknown } }>;
  outputCases: OutputCase[];
};

const VECTORS = JSON.parse(readFileSync(new URL('../../fake-machine/dx4/dx4-jobs.json', import.meta.url), 'utf8')) as Vectors;
/** What goes on the wire: an absent field and an undefined one are the same there. */
const wire = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

describe("DX4's shared vectors", () => {
  it('hold the normalization table the derivation applies', () => {
    expect(Object.entries(TABLE).map(([raw, { status, terminal }]) => ({ raw, status, terminal }))).toEqual(VECTORS.table);
  });

  describe.each(VECTORS.cases)('the body: $name', (c) => {
    const got = wire(deriveFromRows(c.input)) as Record<string, unknown>;
    it.each(['subagents', 'jobs', 'mcp'] as const)('%s', (part) => {
      expect(got[part]).toEqual(c.expect[part]);
    });
  });

  it.each(VECTORS.outputCases)('output: $name', (c) => {
    const tmp = mkdtempSync(join(tmpdir(), 'dx4-output-'));
    try {
      const root = realpathSync(tmp);
      const { input, expect: want } = JSON.parse(JSON.stringify(c).split('<ROOT>').join(root)) as OutputCase;
      for (const item of input.layout) {
        mkdirSync(item.dir ? item.path : dirname(item.path), { recursive: true });
        if (item.file !== undefined) writeFileSync(item.path, item.file, 'utf8');
        else if (item.symlink !== undefined) symlinkSync(item.symlink, item.path);
      }
      const index = new LoopIndex();
      for (const row of input.main) index.feed(row);
      const got = answerOutput(input.request, index, input.session, input.roots) as Record<string, unknown>;
      // `reason` is a sentence for the human, compared only as one (the vectors' `about`); every other field exactly.
      if (want.result === 'refused') {
        expect(typeof got.reason === 'string' && got.reason.trim() !== '').toBe(true);
        delete got.reason;
      }
      expect(got).toEqual(want);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
