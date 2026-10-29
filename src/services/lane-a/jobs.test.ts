// sminos's DX4 jobs vectors (test/fixtures/lane-a/dx4-jobs.json, a two-repo contract; its PROVENANCE beside it),
// replayed over the port: each case's main rows fed in file order give its expected `jobs`, the session running or not.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { derive, fold, Ledger } from './jobs';

interface Case {
  name: string;
  input: { session: { running: boolean }; main: unknown[] };
  expect: { jobs: unknown[] };
}
interface Vectors {
  table: { raw: string; status: string; terminal: boolean }[];
  cases: Case[];
}

const vectors = JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures/lane-a/dx4-jobs.json'), 'utf8')) as Vectors;

describe('the jobs port over dx4-jobs.json', () => {
  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const ledger = new Ledger();
    ledger.feed(c.input.main);
    expect(derive(ledger, { sessionRunning: c.input.session.running })).toEqual({ subagents: [], jobs: c.expect.jobs, mcp: [] });
  });

  it('the cases hold background shells and monitors, ended and running', () => {
    const jobs = vectors.cases.flatMap((c) => c.expect.jobs as { kind: string; status: string }[]);
    expect(new Set(jobs.map((j) => j.kind))).toEqual(new Set(['shell', 'monitor']));
    expect(new Set(jobs.map((j) => j.status))).toEqual(new Set(['running', 'completed', 'failed', 'stopped', 'exited']));
  });

  it.each(vectors.table.map((t) => [t.raw, t] as const))('the table maps %s', (raw, t) => {
    const outcome = fold([{ raw, at: 'B' }], { status: 'running', raw: 'running', at: 'A' });
    expect(outcome).toEqual({ status: t.status, raw, at: 'B' }); // a recognized word replaces a running outcome
    expect(fold([{ raw: 'running', at: 'C' }], outcome).at).toBe(t.terminal ? 'B' : 'C'); // a later running never undoes a terminal word
  });

  it('an unrecognized word replaces only raw', () => {
    expect(fold([{ raw: 'paused', at: 'B' }], { status: 'running', raw: 'running', at: 'A' })).toEqual({ status: 'running', raw: 'paused', at: 'A' });
  });
});
