// Advisory only: a probes-only landing added a fixture read by directory enumeration and broke master's unit suite
// (#289, fixed by #292). Imports cannot see that edge, so any change outside docs/ warrants the unit gate.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function unitCoverageAt({ gitDir, sha, gates }) {
  const selected = gates.split(/[\s,]+/).filter(Boolean);
  if (selected.includes('unit') || gates === 'all') return '';
  const git = (...args) => execFileSync('git', ['-C', gitDir, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const base = git('merge-base', 'origin/master', sha).trim();
  // Both ends of a move count: moving a fixture into docs/ still removes it from a suite's input directory.
  const paths = git('diff', '--name-only', '--no-renames', '-z', base, sha).split('\0').filter((path) => path && !path.startsWith('docs/'));
  return paths.length ? `unit omitted; ${paths.length} changed paths outside docs/; include unit in --gates before landing (advisory only)` : '';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'git-dir': { type: 'string' }, sha: { type: 'string' }, gates: { type: 'string' } } });
    const advice = unitCoverageAt({ gitDir: values['git-dir'], sha: values.sha, gates: values.gates });
    if (advice) {
      process.stderr.write(`ci-gate: warning: ${advice}\n`);
      process.stdout.write(`Unit-Coverage: ${advice}\n`);
    }
  } catch (error) {
    process.stderr.write(`ci-gate: unit coverage: ${error.message.split('\n')[0]}\n`);
    process.exitCode = 1;
  }
}
