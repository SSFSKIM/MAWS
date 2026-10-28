// The run's Playwright retry passes, printed beside ci-gate.sh's verdict. All attempts: GitHub copies an unchanged
// job into a rerun without its annotations (as for ci-gate-preemptions.sh), so a pool preemption must not hide a flake.
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const api = (endpoint) => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { encoding: 'utf8', maxBuffer: 16 << 20 }));

export function flakyLines(repo, run, gh = api) {
  const lines = new Set();
  for (const page of gh(`repos/${repo}/actions/runs/${run}/jobs?filter=all&per_page=100`)) {
    for (const job of page.jobs.filter((job) => job.name.startsWith('e2e:'))) {
      for (const notes of gh(`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`)) {
        for (const note of notes) if (note.title === 'MAWS flaky' && /^flaky: .+:\d+$/.test(note.message)) lines.add(note.message);
      }
    }
  }
  return [...lines];
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const line of flakyLines(process.argv[2], process.argv[3])) console.log(line);
  } catch (error) {
    console.error(`ci-gate: warning: could not read flaky tests for run ${process.argv[3]}: ${error.message}`);
    process.exitCode = 1;
  }
}
