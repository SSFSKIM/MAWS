// UX wave, U8 folder probe, the fourth reader: what MAWS's own index says of the session after each step. Not a
// regression test: it runs only when PZ_INDEX_FIXTURES names the folder probe's fixtures (uxwave-folder-headless and
// -resume, or the terminal half's) and PZ_INDEX_HOME the scratch HOME that recorded them, on the machine that recorded
// them (the index's `locate` reads the scratch repository and its worktrees). For each step_record it rebuilds the
// session's transcript as it stood at the end of that step (the final file cut to the step's row count, at the path the
// step found it), summarizes it as discovery does (`summarize`, 64 KiB windows) and upserts it into one fresh index in
// step order, then writes each step's summary facts and record to PZ_INDEX_OUT.
//   PZ_INDEX_FIXTURES=a.jsonl,b.jsonl PZ_INDEX_HOME=/tmp/pz-…/home PZ_INDEX_OUT=out.json node_modules/.bin/vitest run --config spikes/protocol-probe/uxwave-folder-index.vitest.config.ts
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEAD_TAIL_BYTES, summarize } from '../../src/engine-host/fs/summarize';
import { Index } from '../../src/services/index/index';
import { tempDir } from '../../test/support/index-fixture';

const FIXTURES = process.env.PZ_INDEX_FIXTURES?.split(',') ?? [];
const HOME = process.env.PZ_INDEX_HOME ?? '';
const OUT = process.env.PZ_INDEX_OUT ?? '';

type Step = { name: string; transcript: { file: string; total: number }[] };
const steps = (fixture: string): Step[] =>
  readFileSync(fixture, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).frame).filter((f) => f.event === 'step_record');

describe.runIf(FIXTURES.length > 0 && HOME !== '')('U8 folder probe: the index after each step', () => {
  it('summarizes and upserts each step', () => {
    const projects = join(HOME, '.claude/projects');
    const finalFile = (sid: string) => readdirSync(projects).map((d) => join(projects, d, sid + '.jsonl')).find(existsSync);
    const dir = tempDir('pz-index-');
    const index = new Index(join(dir.path, 'index.sqlite'));
    const out: unknown[] = [];
    for (const fixture of FIXTURES)
      for (const step of steps(fixture)) {
        const main = step.transcript.filter((t) => !t.file.includes('/subagents/'));
        for (const t of main) {
          const [folder, name] = t.file.split('/');
          const sid = name!.replace(/\.jsonl$/, '');
          const source = finalFile(sid)!;
          const lines = readFileSync(source, 'utf8').split('\n').filter(Boolean).slice(0, t.total);
          const text = lines.join('\n') + '\n';
          const copy = join(dir.path, 'projects', folder!, name!);
          mkdirSync(join(dir.path, 'projects', folder!), { recursive: true });
          writeFileSync(copy, text);
          const buf = Buffer.from(text);
          const st = statSync(copy);
          const summary = summarize(buf.subarray(0, HEAD_TAIL_BYTES), buf.subarray(Math.max(0, buf.length - HEAD_TAIL_BYTES)), { size: st.size, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs }, copy, folder!);
          const { record } = index.sessions.upsertFromSummary(summary);
          const rows = lines.map((l) => JSON.parse(l));
          const newestMain = [...rows].reverse().find((r) => typeof r.cwd === 'string' && r.isSidechain === false);
          out.push({
            step: step.name, fixture: fixture.split('/').at(-1), transcriptFolder: folder, rows: t.total,
            summary: { directory: summary.directory, relocatedCwd: summary.relocatedCwd, gitBranch: summary.gitBranch },
            record: { directory: record.directory, worktree: record.worktree, branch: record.branch, projectId: record.projectId },
            newestMainRow: newestMain ? { cwd: newestMain.cwd, gitBranch: newestMain.gitBranch } : null,
          });
        }
      }
    index.close();
    if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
    expect(out.length).toBeGreaterThan(0);
  });
});
