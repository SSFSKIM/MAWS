// node --test scripts/ci-gate-alerts.test.mjs (from anywhere; no install needed). The parsing, the decision and the
// failed reads run against a fake `gh`; the resolution of which runs need a Mac is checked against
// .github/scripts/gate-plan.mjs itself and the runs-on lines of .github/workflows/gate.yml.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { alertLine, check, decide, macJobs, parseAlert } = await import(join(root, 'scripts/ci-gate-alerts.mjs'));

test('an alert title parses into machine, dialog, time and source; other alert kinds do not', () => {
  assert.deepEqual(parseAlert('ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)'), { machine: 'mini', dialog: 'SecurityAgent', since: '2026-10-17T20:06Z', source: 'source unknown' });
  assert.deepEqual(parseAlert('ci-kit alert: mac-2: UserNotificationCenter since 2026-10-18T01:00Z'), { machine: 'mac-2', dialog: 'UserNotificationCenter', since: '2026-10-18T01:00Z', source: undefined });
  assert.deepEqual(parseAlert('ci-kit alert: mini: UserNotificationCenter since 2026-10-17T07:57Z (SkyComputerUseService (TCC), CursorUIViewService)').source, 'SkyComputerUseService (TCC), CursorUIViewService');
  for (const title of [
    'ci-kit alert: pool hours on 2026-10-16 above 8',
    'ci-kit alert: pool server 170673580 deleted, heartbeat stale',
    'ci-kit alert: system dialog on the mini (UserNotificationCenter: source unknown)',
    'ci-kit alert: Mini: SecurityAgent since 2026-10-17T20:06Z',
    'Re: ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z',
  ]) {
    assert.equal(parseAlert(title), null, title);
  }
});

test("an alert's line is its machine, dialog, time and source, the source only when the title has one", () => {
  assert.equal(alertLine(parseAlert('ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)')), 'mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)');
  assert.equal(alertLine(parseAlert('ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z')), 'mini: SecurityAgent since 2026-10-17T20:06Z');
});

test('the Mac jobs of a run, from the flags and the repository variables', () => {
  const today = { GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos' };
  assert.deepEqual(macJobs({ variables: today }), ['unit:darwin', 'the class-1 e2e groups']);
  assert.deepEqual(macJobs({ gates: 'static,unit,probes', variables: today }), []);
  assert.deepEqual(macJobs({ runner: 'linux', variables: today }), []);
  assert.deepEqual(macJobs({ gates: 'e2e:library', runner: 'linux', variables: today }), []);
  assert.deepEqual(macJobs({ gates: 'static,e2e:side,e2e:library', variables: today }), ['e2e:side', 'e2e:library']);
  assert.deepEqual(macJobs({ gates: 'unit:darwin', runner: 'linux', variables: today }), ['unit:darwin']);
  assert.deepEqual(macJobs({ gates: 'packaged', variables: {} }), ['packaged']);
  assert.deepEqual(macJobs({ gates: 'static,probes', class1a: 'macos', variables: today }), ['static', 'probes']);
  assert.deepEqual(macJobs({ gates: 'static', variables: { GATE_RUNNER: 'macos' } }), ['plan', 'static']);
  assert.deepEqual(macJobs({ gates: 'static', class1a: 'pool', variables: { GATE_RUNNER: 'MacOS' } }), ['plan']);
});

// Every combination of the flags and the variables over a few gate sets, against the plan the workflow would run.
test('a run needs a Mac exactly when gate-plan.mjs and gate.yml put one of its jobs on a Mac', async () => {
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  const mac = '["self-hosted","macOS","ARM64"]';
  // The placements gate-plan.mjs does not write: the plan job on the Mac under GATE_RUNNER=macos; unit:darwin and
  // packaged always on the Mac.
  assert.match(workflow, /\n {2}plan:\n(?: {4}.*\n|\n)*? {4}runs-on: \$\{\{ vars\.GATE_RUNNER == 'macos' && fromJSON\('\["self-hosted","macOS","ARM64"\]'\) \|\| 'ubuntu-slim' \}\}\n/);
  for (const job of ['unit-darwin', 'packaged']) assert.match(workflow, new RegExp(`\\n {2}${job}:\\n(?: {4}.*\\n)*? {4}runs-on: \\[self-hosted, macOS, ARM64\\]\\n`), job);
  const onMac = (runner) => JSON.stringify(JSON.parse(runner)) === mac;

  const cases = [];
  for (const gates of ['', 'static', 'static,unit,probes', 'unit:darwin', 'packaged', 'e2e:library'])
    for (const runner of ['', 'linux', 'macos'])
      for (const class1a of ['', 'linux', 'macos', 'pool'])
        for (const GATE_RUNNER of ['', 'linux', 'macos', 'pool'])
          for (const GATE_E2E_RUNNER of ['', 'linux', 'macos']) cases.push({ gates, runner, class1a, GATE_RUNNER, GATE_E2E_RUNNER });
  const dir = mkdtempSync(join(tmpdir(), 'maws-ci-gate-alerts-'));
  try {
    const plan = async ({ gates, runner, class1a, GATE_RUNNER, GATE_E2E_RUNNER }, index) => {
      // The trailers ci-gate.sh writes.
      const trailers = ['Nonce: 1', gates && `Gates: ${gates}`, runner && `Runner: ${runner}`, class1a && `Class1a: ${class1a}`].filter(Boolean).join('\n');
      const output = join(dir, `output-${index}`);
      await promisify(execFile)(process.execPath, [join(root, '.github/scripts/gate-plan.mjs')], {
        cwd: root,
        env: { ...process.env, EVENT: 'push', HEAD_MESSAGE: `ci-gate: test\n\n${trailers}`, GATE_RUNNER, GATE_E2E_RUNNER, CLASS1_E2E: 'library', LINUX_E2E: 'library', LIBREOFFICE_E2E: '', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, `summary-${index}`) },
      });
      const out = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
      return (
        GATE_RUNNER === 'macos' ||
        ['static', 'unit', 'probes'].some((gate) => out[gate] === 'true' && onMac(out[`${gate}_runner`])) ||
        out.unit_darwin === 'true' ||
        out.packaged === 'true' ||
        (JSON.parse(out.e2e).length > 0 && onMac(out.e2e_runner))
      );
    };
    const results = new Array(cases.length);
    let next = 0;
    const worker = async () => {
      while (next < cases.length) {
        const index = next++;
        results[index] = await plan(cases[index], index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, availableParallelism()) }, worker));
    const wrong = cases.filter((entry, index) => results[index] !== macJobs({ ...entry, variables: entry }).length > 0);
    assert.deepEqual(wrong, []);
    assert.ok(results.some(Boolean) && !results.every(Boolean));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const alert = (number, title) => ({ ...parseAlert(title), number });
const mini = alert(12, 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)');
const jobs = ['unit:darwin', 'the class-1 e2e groups'];

test('nothing to say when the run needs no Mac or no alert is open', () => {
  assert.deepEqual(decide({ jobs: [], alerts: [mini], runners: [] }), { stop: false, lines: [] });
  assert.deepEqual(decide({ jobs, alerts: [], runners: [] }), { stop: false, lines: [] });
});

test('a healthy online Mac left: go ahead with a note naming the blocked machines', () => {
  const runners = [
    { name: 'ci-kit-mac-mini', status: 'online' },
    { name: 'ci-kit-mac-studio', status: 'online' },
  ];
  assert.deepEqual(decide({ jobs, alerts: [mini], runners }), { stop: false, lines: ['ci-gate: ci-kit alert open on mini; going ahead on studio'] });
});

test('no online Mac free of an alert: stop, naming each alert and where it lives', () => {
  const studio = alert(13, 'ci-kit alert: studio: UserNotificationCenter since 2026-10-17T20:10Z');
  const expected = {
    stop: true,
    lines: [
      "ci-gate: not pushing: this run puts jobs on a Mac (unit:darwin, the class-1 e2e groups) and no online Mac runner is free of an open ci-kit alert, so ci-kit's job-started check would refuse them:",
      '  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)',
      '  studio: UserNotificationCenter since 2026-10-17T20:10Z',
      'ci-gate: rerun once the alert closes: https://github.com/SSFSKIM/ci-kit-sandbox/issues/12 https://github.com/SSFSKIM/ci-kit-sandbox/issues/13',
    ],
  };
  // The watcher took the alerted mini offline; the other Mac is offline for its own reasons; a Linux runner counts for nothing.
  const runners = [
    { name: 'ci-kit-mac-mini', status: 'offline' },
    { name: 'ci-kit-mac-studio', status: 'online' },
    { name: 'ci-kit-mac-m3', status: 'offline' },
    { name: 'ci-kit-pool-1', status: 'online' },
  ];
  assert.deepEqual(decide({ jobs, alerts: [mini, studio], runners }), expected);
  // The mini still online (busy when the dialog came) with no other Mac: still stopped.
  assert.equal(decide({ jobs, alerts: [mini], runners: [{ name: 'ci-kit-mac-mini', status: 'online' }] }).stop, true);
});

// A fake gh: each read answers with the lines of its --jq, or throws as execFileSync does on a failed gh.
function fakeGh({ variables = [['GATE_RUNNER', 'pool'], ['GATE_E2E_RUNNER', 'macos']], issues = [], runners = [], fail }) {
  const calls = [];
  const gh = (args) => {
    const path = args[2];
    calls.push(path);
    if (fail && path.includes(fail)) throw Object.assign(new Error('Command failed: gh api'), { stderr: 'gh: Not Found (HTTP 404)\n' });
    const rows = path.includes('/variables') ? variables : path.includes('/issues') ? issues : runners;
    return rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  };
  return { gh, calls };
}

test('the reads: only what the decision needs, other alert kinds dropped', () => {
  const issues = [
    { number: 4, title: 'ci-kit alert: pool hours on 2026-10-16 above 8' },
    { number: 12, title: 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)' },
  ];
  const runners = [{ name: 'ci-kit-mac-mini', status: 'offline' }];
  const linux = fakeGh({ issues, runners });
  assert.deepEqual(check({ gates: 'static,unit,probes', runner: '', class1a: '', gh: linux.gh }), { stop: false, lines: [] });
  assert.deepEqual(linux.calls, ['repos/SSFSKIM/MAWS/actions/variables?per_page=30']);
  const quiet = fakeGh({ issues: issues.slice(0, 1), runners });
  assert.deepEqual(check({ gates: '', runner: '', class1a: '', gh: quiet.gh }), { stop: false, lines: [] });
  assert.equal(quiet.calls.length, 2);
  const episode = fakeGh({ issues, runners });
  const result = check({ gates: 'e2e:side', runner: '', class1a: '', gh: episode.gh });
  assert.equal(result.stop, true);
  assert.deepEqual(result.lines.slice(1), ['  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)', 'ci-gate: rerun once the alert closes: https://github.com/SSFSKIM/ci-kit-sandbox/issues/12']);
});

test('a failed read warns and goes ahead', () => {
  const issues = [{ number: 12, title: 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)' }];
  for (const [fail, what] of [
    ['/variables', "the repository's variables"],
    ['/issues', 'the open ci-kit alerts (SSFSKIM/ci-kit-sandbox)'],
    ['/runners', "SSFSKIM/MAWS's runners"],
  ]) {
    const { gh } = fakeGh({ issues, fail });
    assert.deepEqual(check({ gates: '', runner: '', class1a: '', gh }), {
      stop: false,
      lines: [`ci-gate: warning: could not read ${what} (gh: Not Found (HTTP 404)); going ahead without the ci-kit alert check (the runner's job-started check still refuses jobs under a dialog)`],
    });
  }
  const garbled = check({ gates: '', runner: '', class1a: '', gh: () => 'not json\n' });
  assert.equal(garbled.stop, false);
  assert.match(garbled.lines[0], /^ci-gate: warning: could not read the repository's variables \(.*JSON.*\); going ahead/);
});
