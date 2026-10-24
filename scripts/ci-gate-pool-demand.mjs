// Prints ci-kit's Pool-Demand trailer value for the exact tree and trailers ci-gate.sh will push. Repository variables
// arrive through GATE_RUNNER and GATE_E2E_RUNNER, read at push time; package scripts and workflow env come from sha.
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { planOf } from '../.github/scripts/gate-plan.mjs';
import { workflowEnv } from './ci-gate-alerts.mjs';

// Count jobs, not distinct sizes: each unit shard, each e2e-build variant and each pool e2e group takes its own box.
function poolDemand(outputs) {
  const counts = new Map();
  const add = (json, count = 1) => {
    const runner = JSON.parse(json);
    if (!Array.isArray(runner) || !runner.includes('ci-kit-pool')) return;
    const size = runner.find((label) => /^cpus-(2|4|8|16)$/.test(label))?.slice(5);
    if (!size) throw new Error(`pool runner has no supported size: ${json}`);
    counts.set(Number(size), (counts.get(Number(size)) ?? 0) + count);
  };
  for (const gate of ['static', 'unit', 'probes']) {
    if (outputs[gate] === 'true') add(outputs[`${gate}_runner`], gate === 'unit' ? JSON.parse(outputs.unit_shards).length : 1);
  }
  const builds = JSON.parse(outputs.e2e_build);
  if (builds.length > 0) add(outputs.e2e_build_runner, builds.length);
  for (const entry of JSON.parse(outputs.e2e)) add(entry.runner);
  return [...counts].sort(([a], [b]) => b - a).map(([size, count]) => `${size}x${count}`).join(' ') || 'none';
}

try {
  const { values } = parseArgs({ options: { 'git-dir': { type: 'string' }, sha: { type: 'string' } } });
  if (!values['git-dir'] || !values.sha) throw new Error('--git-dir and --sha are required');
  const read = (path) => execFileSync('git', ['-C', values['git-dir'], 'show', `${values.sha}:${path}`], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const { scripts } = JSON.parse(read('package.json'));
  const { outputs } = planOf({
    ...workflowEnv(read('.github/workflows/gate.yml')),
    EVENT: 'push',
    HEAD_MESSAGE: process.env.HEAD_MESSAGE ?? '',
    GATE_RUNNER: process.env.GATE_RUNNER ?? '',
    GATE_E2E_RUNNER: process.env.GATE_E2E_RUNNER ?? '',
  }, scripts);
  process.stdout.write(`${poolDemand(outputs)}\n`);
} catch (error) {
  process.stderr.write(`ci-gate-pool-demand: ${error.message}\n`);
  process.exitCode = 1;
}
