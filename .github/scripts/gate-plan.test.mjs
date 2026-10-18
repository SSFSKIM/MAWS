import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scenarios = [
  { name: 'pushes retain failure-only uploads by default', env: {}, evidence: 'false' },
  { name: 'the Evidence: yes trailer enables success uploads', env: { HEAD_MESSAGE: 'ci-gate: test\n\nGates: unit\nEvidence: yes' }, evidence: 'true' },
  { name: 'a non-opt-in trailer leaves success uploads disabled', env: { HEAD_MESSAGE: 'Evidence: no' }, evidence: 'false' },
  { name: 'manual dispatch enables success uploads with its evidence input', env: { EVENT: 'workflow_dispatch', INPUT_EVIDENCE: 'true' }, evidence: 'true' },
  { name: 'manual dispatch false overrides a pushed evidence trailer', env: { EVENT: 'workflow_dispatch', INPUT_EVIDENCE: 'false', HEAD_MESSAGE: 'Evidence: yes' }, evidence: 'false' },
  { name: 'manual dispatch without an evidence input stays off despite a trailer', env: { EVENT: 'workflow_dispatch', HEAD_MESSAGE: 'Evidence: yes' }, evidence: 'false' },
];

// One run of the plan: its outputs and its summary.
function plan(scenarioEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-gate-plan-'));
  const output = join(dir, 'output');
  const summary = join(dir, 'summary');
  try {
    execFileSync(process.execPath, [join(root, '.github/scripts/gate-plan.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        EVENT: 'push',
        HEAD_MESSAGE: '',
        INPUT_GATES: '',
        INPUT_RUNNER: '',
        INPUT_CLASS1A: '',
        INPUT_EVIDENCE: '',
        GATE_RUNNER: '',
        GATE_E2E_RUNNER: '',
        CLASS1_E2E: '',
        LINUX_E2E: '',
        LIBREOFFICE_E2E: '',
        ...scenarioEnv,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    return { outputs, summary: readFileSync(summary, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const scenario of scenarios) {
  test(scenario.name, () => {
    const { outputs, summary } = plan(scenario.env);
    assert.equal(outputs.evidence, scenario.evidence);
    assert.equal(/evidence/i.test(summary), scenario.evidence === 'true');
  });
}

test("the DefaultBeside: trailer's groups reach the e2e jobs, less default, e2e: prefixes and repeats; a dispatch has none", () => {
  const relaunch = 'ci-gate: test\n\nGates: e2e:default,e2e:side\nRunner: macos\nDefaultBeside: default,side, library e2e:tools,library';
  const { outputs, summary } = plan({ HEAD_MESSAGE: relaunch });
  assert.equal(outputs.default_beside, '["side","library","tools"]');
  assert.deepEqual(JSON.parse(outputs.e2e).map((entry) => entry.group), ['default', 'side']);
  assert.match(summary, /Default beside: side, library, tools\./);
  assert.equal(plan({}).outputs.default_beside, '[]');
  assert.equal(plan({ EVENT: 'workflow_dispatch', INPUT_GATES: 'e2e:default', INPUT_RUNNER: 'macos', HEAD_MESSAGE: relaunch }).outputs.default_beside, '[]');
});
