// The run's Playwright retry passes, printed beside ci-gate.sh's verdict. All attempts: GitHub copies an unchanged
// job into a rerun without its annotations (as for ci-gate-preemptions.sh), so a pool preemption must not hide a flake.
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const api = (endpoint) => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { encoding: 'utf8', maxBuffer: 16 << 20, timeout: 15_000, killSignal: 'SIGKILL' }));

export function flakyReport(repo, run, gh = api) {
  const lines = new Set();
  const unreadable = new Set();
  for (const page of gh(`repos/${repo}/actions/runs/${run}/jobs?filter=all&per_page=100`)) {
    for (const job of page.jobs.filter((job) => job.name.startsWith('e2e:') && job.status === 'completed' && job.conclusion !== 'skipped' && job.runner_name)) {
      try {
        for (const notes of gh(`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`)) {
          for (const note of notes) {
            if (note.title !== 'MAWS flaky') continue;
            for (const line of note.message.split('\n')) if (/^flaky: .+:\d+$/.test(line)) lines.add(line);
          }
        }
      } catch { unreadable.add(job.name); }
    }
  }
  return { lines: [...lines], unreadable: [...unreadable] };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { lines, unreadable } = flakyReport(process.argv[2], process.argv[3]);
    for (const line of lines) console.log(line);
    if (unreadable.length) console.error(`ci-gate: warning: could not read flaky tests for jobs: ${unreadable.join(', ')}`);
  } catch (error) {
    console.error(`ci-gate: warning: could not read flaky tests for run ${process.argv[3]}: ${error.message}`);
    process.exitCode = 1;
  }
}
