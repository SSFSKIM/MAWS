// DX4's shared vectors (fake-machine/dx4/dx4-jobs.json, DC8's, vendored) against the fake machine's derivation, as
// doperpowers' jobs_parity.py runs them against the plane's: the normalization table, every case's widened `subagents`
// body ({subagents, jobs, mcp}) from its rows, metas, agent files and bridge state, and every `output` case answered
// over a file layout made under a temporary directory. A failure here is a disagreement with DC8's producer, for the
// composite's writer: the vectors are never edited to pass.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveFromRows, indexOf, LoopIndex, loopJobs, TABLE, type BodyInput } from '../../fake-machine/jobs';
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

// `loopJobs`'s `also`, which no vector's input carries (sminos's unit test pins its side): a subagent loop's jobs fold the
// main loop's words on its tasks, and the engine's queue records sit in the main loop's transcript whichever loop they
// are for. Case 18's rows split so: its calls and results as a subagent's own transcript, its queue records as the main
// loop's, its delivered copy left out, so only the main loop says how each task ended.
describe("the main loop's queue records on a subagent loop's tasks", () => {
  const c = VECTORS.cases.find((k) => k.name === 'notices the engine queued')!;
  const queued = c.input.main.filter((row) => row.type === 'queue-operation');
  const own = c.input.main.filter((row) => row.type !== 'queue-operation' && (row.origin as JsonObject | undefined)?.kind !== 'task-notification');
  const ends = (jobs: Array<{ taskId: string; status: string; endedAt?: string }>) => jobs.map((j) => [j.taskId, j.status, j.endedAt ?? null]);

  it("end them, a monitor's expiry judged by the subagent loop that started it", () => {
    expect(ends(loopJobs(indexOf(own), false).jobs)).toEqual(['bqueue001', 'bqueue002', 'bqueue003', 'bqueue004'].map((t) => [t, 'exited', null]));
    expect(ends(loopJobs(indexOf(own), false, indexOf(queued)).jobs)).toEqual([
      ['bqueue001', 'completed', '2026-10-17T09:00:10.000Z'],
      ['bqueue002', 'failed', '2026-10-17T09:00:11.000Z'],
      ['bqueue003', 'exited', null],
      ['bqueue004', 'completed', '2026-10-17T09:00:18.000Z'],
    ]);
  });

  // The engine enqueues a notice before it hands the agent its copy, so the main loop's word is the older: the loop's own
  // end stands, its word, time and summary, where an older queued word would otherwise be folded over it.
  it("count only while the loop's own rows leave the task running", () => {
    const summary = 'Background command "Build the app" failed with exit code 2';
    const delivered: JsonObject = {
      type: 'user', uuid: '00000012-0000-4000-8000-0000000000aa', timestamp: '2026-10-17T09:00:19.000Z', isMeta: true, origin: { kind: 'task-notification' },
      message: { role: 'user', content: `<task-notification>\n<task-id>bqueue001</task-id>\n<tool-use-id>toolu_18J1</tool-use-id>\n<status>failed</status>\n<summary>${summary}</summary>\n</task-notification>` },
    };
    const [job] = loopJobs(indexOf([...own, delivered]), false, indexOf(queued)).jobs;
    expect([job.taskId, job.status, job.endedAt, job.summary]).toEqual(['bqueue001', 'failed', '2026-10-17T09:00:19.000Z', summary]);
  });
});
