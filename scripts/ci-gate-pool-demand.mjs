// Prints ci-kit's Pool-Demand trailer value for the exact tree and trailers ci-gate.sh will push. Repository variables
// arrive through GATE_RUNNER and GATE_E2E_RUNNER, read at push time; the planner, its dependencies and inputs come from sha.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
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

// Keep the target's imports and any legacy workflow side effects in a child. An unsupported planner may exit or print,
// but only successfully decoded outputs from its exported planOf can become the CLI's advisory hint.
function targetOutputs(gitDir, sha) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-ci-gate-pool-demand-'));
  try {
    const top = execFileSync('git', ['-C', gitDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    // bsdtar may exit before consuming git archive's padding; a file avoids EPIPE on its stdin.
    const archive = join(dir, 'archive.tar');
    execFileSync('git', ['-C', top, 'archive', '--format=tar', `--output=${archive}`, sha, '--', '.github/scripts', '.github/workflows/gate.yml', 'package.json'], { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('tar', ['-x', '-f', archive, '-C', dir], { timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const { scripts } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const env = {
      ...workflowEnv(readFileSync(join(dir, '.github/workflows/gate.yml'), 'utf8')),
      EVENT: 'push',
      HEAD_MESSAGE: process.env.HEAD_MESSAGE ?? '',
      GATE_RUNNER: process.env.GATE_RUNNER ?? '',
      GATE_E2E_RUNNER: process.env.GATE_E2E_RUNNER ?? '',
    };
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import { readFileSync } from 'node:fs';
      const { planner, env, scripts } = JSON.parse(readFileSync(0, 'utf8'));
      const { planOf } = await import(planner);
      process.stdout.write(JSON.stringify(planOf(env, scripts).outputs));
    `], {
      cwd: dir,
      env: { PATH: process.env.PATH },
      input: JSON.stringify({ planner: pathToFileURL(join(dir, '.github/scripts/gate-plan.mjs')).href, env, scripts }),
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const { values } = parseArgs({ options: { 'git-dir': { type: 'string' }, sha: { type: 'string' } } });
  if (!values['git-dir'] || !values.sha) throw new Error('--git-dir and --sha are required');
  process.stdout.write(`${poolDemand(targetOutputs(values['git-dir'], values.sha))}\n`);
} catch (error) {
  process.stderr.write(`ci-gate-pool-demand: ${error.message}\n`);
  process.exitCode = 1;
}
