// node --test scripts/ci-gate-hosted.test.mjs (from anywhere; no install needed). ci-gate.sh's download of a failed hosted
// group's report (ci-kit's docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md, The hosted workflow): the report
// stays in SSFSKIM/maws-app, and ci-gate.sh, on its caller's gh login, takes it from the maws-app run each failed waiter's
// log names. scripts/ci-gate-hosted.sh runs in bash as ci-gate.sh runs it, against a fake gh.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// The fake gh logs each call; it downloads run 4243's artifact and finds none for any other run.
const fakeGh = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$(dirname "$0")/gh-calls"
case "$*" in
  "-R SSFSKIM/maws-app run download 4243 -D "*) mkdir -p "$7/e2e-document-app" && echo report > "$7/e2e-document-app/index.html" ;;
  *) echo 'no valid artifacts found to download' >&2; exit 1 ;;
esac
`;

function hostedReports(log) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-gate-hosted-'));
  try {
    writeFileSync(join(dir, 'gh'), fakeGh);
    chmodSync(join(dir, 'gh'), 0o755);
    const reports = join(dir, 'reports');
    const stdout = execFileSync('bash', ['-c', 'set -uo pipefail; source "$0"; hosted_reports "$1" "$2"', join(root, 'scripts/ci-gate-hosted.sh'), log.join('\n'), reports], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    });
    const calls = join(dir, 'gh-calls');
    return {
      stdout: stdout.replaceAll(reports, '<reports>'),
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trimEnd().split('\n').map((call) => call.replace(reports, '<reports>')) : [],
      report: existsSync(join(reports, 'e2e-document-app/index.html')),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A failed waiter's lines, as `gh run view --log-failed` gives them: job, step, timestamp and line.
const verdict = (job, conclusion, run) => `${job}\tthe hosted run\t2026-10-26T08:10:02.1000000Z hosted: ${conclusion} https://github.com/SSFSKIM/maws-app/actions/runs/${run}/attempts/1`;

test("each failed hosted group's maws-app run is downloaded once into the reports directory; nothing else is asked for", () => {
  const log = [
    verdict('e2e:document-app', 'failure', 4243),
    'e2e:document-app\tthe hosted run\t2026-10-26T08:10:02.2000000Z   1) [electron] › e2e/document.spec.ts:119:3 › a broken assertion',
    verdict('e2e:document-app', 'failure', 4243),
    verdict('e2e:transcript', 'cancelled', 4244),
    'e2e:library\tRun .github/scripts/gate-run.sh\t2026-10-26T08:10:02.1000000Z   1 failed',
    'e2e:library\tRun .github/scripts/gate-run.sh\t2026-10-26T08:10:02.1000000Z hosted: failure https://github.com/SSFSKIM/other/actions/runs/9/attempts/1',
  ];
  const { stdout, calls, report } = hostedReports(log);
  assert.deepEqual(calls, ['-R SSFSKIM/maws-app run download 4243 -D <reports>', '-R SSFSKIM/maws-app run download 4244 -D <reports>']);
  assert.equal(stdout, 'ci-gate: the hosted report of SSFSKIM/maws-app run 4243 in <reports>/\nci-gate: no hosted report from SSFSKIM/maws-app run 4244\n');
  assert.ok(report);
});

test('a failed log with no hosted verdict downloads nothing and says nothing', () => {
  assert.deepEqual(hostedReports(['e2e:library\tRun .github/scripts/gate-run.sh\t2026-10-26T08:10:02.1000000Z   1 failed', '']), { stdout: '', calls: [], report: false });
});
