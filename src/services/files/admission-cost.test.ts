// What the admission costs a caller on another machine (UX wave U8c-2, M3; docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md,
// "What it proves", last paragraph, and Decision Log 9, point 8): 50 sequential `files.list` calls placed as the endpoint
// places them (remote, so the home rule runs), on a session whose working folder one of its facts names and on one whose
// record names its folder itself, over the same real repository. The admission is evaluated at every call and never
// cached, so each of the first session's calls reads git's files for it. The case asserts what each call answers, never
// a time; with MAWS_MEASURE=1 it prints the two totals and the difference per call (`vitest run` this file alone).
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { GitFixture } from '../../../test/support/git-fixture';
import type { AllowlistRecord } from './allowlist';
import { createFilesService } from './service';

const CALLS = 50;
const FACT = 'f1111111-1111-4111-8111-111111111111' as AppSessionId;
const NONE = 'e2222222-2222-4222-8222-222222222222' as AppSessionId;

describe('the admission’s cost to a remote caller’s files.list', () => {
  let repo: GitFixture;
  let wt: string;
  let beside: string;
  beforeAll(async () => {
    repo = await GitFixture.create();
    beside = realpathSync(mkdtempSync(join(tmpdir(), 'maws-admission-cost-')));
    wt = join(beside, 'wt');
    await repo.git('worktree', 'add', '-q', '-b', 'wt', wt);
  });
  afterAll(() => {
    repo.dispose();
    rmSync(beside, { recursive: true, force: true });
  });

  it(`answers each of ${CALLS} sequential calls with the working folder for the session whose fact names it, and not for the other`, async () => {
    const records = new Map<AppSessionId, AllowlistRecord>([
      [FACT, { directory: repo.root, additionalDirectories: [], worktree: null, agentFolder: { checkout: wt, cwd: wt, branch: 'wt', linked: true } }],
      [NONE, { directory: repo.root, additionalDirectories: [], worktree: null }],
    ]);
    const files = createFilesService({ records: (id) => records.get(id) ?? null, homes: () => ['/nonexistent-home-of-this-suite'] });
    try {
      const run = async (appSessionId: AppSessionId) => {
        const answers: string[][] = [];
        const start = performance.now();
        for (let i = 0; i < CALLS; i++) answers.push((await files.list({ appSessionId }, true)).entries.map((entry) => entry.path));
        return { total: performance.now() - start, answers };
      };
      await run(NONE); // warm both paths before either is counted
      await run(FACT);
      const none = await run(NONE);
      const fact = await run(FACT);
      expect(none.answers).toEqual(Array.from({ length: CALLS }, () => [repo.root]));
      expect(fact.answers).toEqual(Array.from({ length: CALLS }, () => [repo.root, wt]));
      if (process.env.MAWS_MEASURE === '1') {
        const perCall = (fact.total - none.total) / CALLS;
        console.log(`files.list x${CALLS}, remote: with a fact ${fact.total.toFixed(1)} ms, without ${none.total.toFixed(1)} ms, difference per call ${perCall.toFixed(2)} ms`);
      }
    } finally {
      files.dispose();
    }
  });
});
