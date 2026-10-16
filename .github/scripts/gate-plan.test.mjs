import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scenarios = [
  { name: 'pushes retain failure-only uploads by default', env: {}, evidence: 'false' },
  { name: 'the Evidence: yes trailer enables success uploads', env: { HEAD_MESSAGE: 'ci-gate: test\n\nGates: unit\nEvidence: yes' }, evidence: 'true' },
  { name: 'a non-opt-in trailer leaves success uploads disabled', env: { HEAD_MESSAGE: 'Evidence: no' }, evidence: 'false' },
  { name: 'manual dispatch enables success uploads with its evidence input', env: { EVENT: 'workflow_dispatch', INPUT_EVIDENCE: 'true' }, evidence: 'true' },
  { name: 'manual dispatch false overrides a pushed evidence trailer', env: { EVENT: 'workflow_dispatch', INPUT_EVIDENCE: 'false', HEAD_MESSAGE: 'Evidence: yes' }, evidence: 'false' },
  { name: 'manual dispatch without an evidence input stays off despite a trailer', env: { EVENT: 'workflow_dispatch', HEAD_MESSAGE: 'Evidence: yes' }, evidence: 'false' },
];

for (const scenario of scenarios) {
  test(scenario.name, () => {
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
          ...scenario.env,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      });
      const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }));
      assert.equal(outputs.evidence, scenario.evidence);
      assert.equal(/evidence/i.test(readFileSync(summary, 'utf8')), scenario.evidence === 'true');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
