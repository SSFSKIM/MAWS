// node --test scripts/ci-gate-alerts.test.mjs (from anywhere; no install needed). The parsing, the decision and the
// failed reads run against a fake `gh`; the resolution of which runs need a Mac is checked against
// .github/scripts/gate-plan.mjs itself and the runs-on lines of .github/workflows/gate.yml.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test, { after } from 'node:test';
import { URL, fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { alertLine, check, decide, guestRun, macJobs, macPlan, parseAlert, poolE2e, runsOn, workflowEnv } = await import(join(root, 'scripts/ci-gate-alerts.mjs'));

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
  // A POOL_E2E group never takes a Mac (Decision Log 72): the desk lane's own run shape needs none.
  const offMac = poolE2e(readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8'));
  assert.deepEqual(offMac, ['desk-web']);
  assert.deepEqual(macJobs({ gates: 'static,unit,e2e:desk-web', variables: today, offMac }), []);
  assert.deepEqual(macJobs({ gates: 'e2e:side,e2e:desk-web', class1a: 'linux', variables: today, offMac }), ['e2e:side']);
});

// Every combination of the flags and the variables over a few gate sets, against the plan the workflow would run.
test('a run needs a Mac exactly when gate-plan.mjs and gate.yml put one of its jobs on a Mac', async () => {
  const workflow = readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8');
  // The exclusive instance's labels, the shared instances' one (ci-kit's mac-lane concurrency spec, M2), or the VM
  // lane's: solo (the exclusive instance or the guest), the guest alone, its trial slot (V3).
  const macs = ['["self-hosted","macOS","ARM64"]', '["self-hosted","macOS","ARM64","ci-kit-mac-home"]', '["ci-kit-mac-shared"]', '["ci-kit-mac-solo"]', '["ci-kit-mac-vm"]', '["ci-kit-mac-vm-trial"]'];
  // The placements gate-plan.mjs does not write: the plan job on the Mac under GATE_RUNNER=macos; packaged always on
  // the Mac. unit:darwin takes the Mac runner the plan writes for it.
  assert.match(workflow, /\n {2}plan:\n(?: {4}.*\n|\n)*? {4}runs-on: \$\{\{ vars\.GATE_RUNNER == 'macos' && fromJSON\('\["self-hosted","macOS","ARM64"\]'\) \|\| 'ubuntu-slim' \}\}\n/);
  assert.match(workflow, /\n {2}packaged:\n(?: {4}.*\n)*? {4}runs-on: \[self-hosted, macOS, ARM64\]\n/);
  assert.match(workflow, /\n {2}unit-darwin:\n(?: {4}.*\n)*? {4}runs-on: \$\{\{ fromJSON\(needs\.plan\.outputs\.unit_darwin_runner\) \}\}\n/);
  // Each e2e job takes the runner its matrix entry carries, the lane's or, for POOL_E2E, the pool's or hosted Linux.
  assert.match(workflow, /\n {2}e2e:\n(?: {4}.*\n)*? {4}runs-on: \$\{\{ fromJSON\(matrix\.runner\) \}\}\n/);
  const onMac = (runner) => macs.includes(JSON.stringify(JSON.parse(runner)));

  const cases = [];
  for (const gates of ['', 'static', 'static,unit,probes', 'unit:darwin', 'packaged', 'e2e:library', 'e2e:desk-web', 'e2e:library,e2e:desk-web'])
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
        env: { ...process.env, EVENT: 'push', HEAD_MESSAGE: `ci-gate: test\n\n${trailers}`, GATE_RUNNER, GATE_E2E_RUNNER, CLASS1_E2E: 'library', LINUX_E2E: 'library desk-web', POOL_E2E: 'desk-web', LIBREOFFICE_E2E: '', HOSTED_MAC_E2E: '', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: join(dir, `summary-${index}`) },
      });
      const out = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
      return (
        GATE_RUNNER === 'macos' ||
        ['static', 'unit', 'probes'].some((gate) => out[gate] === 'true' && onMac(out[`${gate}_runner`])) ||
        (out.unit_darwin === 'true' && onMac(out.unit_darwin_runner)) ||
        out.packaged === 'true' ||
        JSON.parse(out.e2e).some((entry) => onMac(entry.runner))
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
    const wrong = cases.filter((entry, index) => results[index] !== macJobs({ ...entry, variables: entry, offMac: ['desk-web'] }).length > 0);
    assert.deepEqual(wrong, []);
    assert.ok(results.some(Boolean) && !results.every(Boolean));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const alert = (number, title) => ({ ...parseAlert(title), number });
const mini = alert(12, 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)');
const jobs = ['unit:darwin', 'the class-1 e2e groups'];

const online = (...names) => names.map((name) => ({ name, status: 'online' }));

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

// A machine's runners (ci-kit's mac-lane concurrency spec): its exclusive instance, ci-kit-mac-<machine>; its shared
// instances, ci-kit-mac-<machine>-<n>, on the same desktop, which a dialog there holds as it holds the exclusive one; and
// its guest, ci-kit-mac-<machine>-vm (labels ci-kit-mac-solo and ci-kit-mac-vm; the trial slot, -vm-trial, carries
// ci-kit-mac-vm-trial alone), a desktop of its own, so a machine of its own, which opens no alert and is no free Mac for a
// run with a host job.
test("a shared instance is its machine's, held by its alert; the guest is a machine of its own", () => {
  assert.equal(decide({ jobs, alerts: [mini], runners: online('ci-kit-mac-mini', 'ci-kit-mac-mini-2', 'ci-kit-mac-mini-3') }).stop, true);
  assert.deepEqual(decide({ jobs, alerts: [mini], runners: online('ci-kit-mac-mini-2', 'ci-kit-mac-studio-2') }).lines, ['ci-gate: ci-kit alert open on mini; going ahead on studio']);
  for (const [guest, machine] of [['ci-kit-mac-mini-vm', 'mini-vm'], ['ci-kit-mac-mini-vm2', 'mini-vm2']]) {
    assert.deepEqual(decide({ jobs, guest: 'vm', alerts: [mini], runners: online('ci-kit-mac-mini', guest) }), { stop: false, lines: [`ci-gate: ci-kit alert open on mini; going ahead on ${machine}`] }, guest);
  }
  // Two instances of one free machine name it once.
  assert.deepEqual(decide({ jobs, alerts: [mini], runners: online('ci-kit-mac-studio', 'ci-kit-mac-studio-2') }).lines, ['ci-gate: ci-kit alert open on mini; going ahead on studio']);
});

test('a run with a host Mac job is refused at the host alert though the guest is online and free', () => {
  const runners = online('ci-kit-mac-mini', 'ci-kit-mac-mini-vm');
  const result = decide({ jobs, alerts: [mini], runners });
  assert.equal(result.stop, true);
  assert.equal(result.lines[1], '  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)');
  assert.match(result.lines[2], /^ci-gate: ci-kit's macOS guest \(mini-vm\) is online, but it does not count/);
  // A free host still takes a host run, the guest not named among the free.
  assert.deepEqual(decide({ jobs, alerts: [mini], runners: [...runners, ...online('ci-kit-mac-studio')] }).lines, ['ci-gate: ci-kit alert open on mini; going ahead on studio']);
});

// The runners as the runners API lists them (2026-10-26): the mini's exclusive instance alone carries ci-kit-mac-home, the
// label of the measured and live jobs; the EC2 Mac carries the exclusive labels without it.
const HOST = ['self-hosted', 'macOS', 'ARM64', 'ci-kit-mac'];
const HOME = [...HOST, 'ci-kit-mac-solo', 'ci-kit-mac-home'];
const labelled = (name, labels, status = 'online') => ({ name, status, labels });
const ec2 = labelled('ci-kit-mac-ec2', HOST);

test('a run with home Mac jobs needs an online ci-kit-mac-home runner on a machine free of alerts, and names that machine when there is none', () => {
  // The alerted mini online (busy when the dialog came) or drained offline by the watcher, the EC2 Mac online and free.
  for (const status of ['online', 'offline']) {
    const runners = [labelled('ci-kit-mac-mini', HOME, status), labelled('ci-kit-mac-mini-2', ['ci-kit-mac-shared'], status), ec2];
    assert.deepEqual(decide({ jobs: ['e2e:perf'], home: ['e2e:perf'], alerts: [mini], runners }), {
      stop: true,
      lines: [
        'ci-gate: not pushing: this run puts jobs on the home Mac (e2e:perf), which only a runner labelled ci-kit-mac-home takes, and no such runner is online on a machine free of an open ci-kit alert:',
        '  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)',
        'ci-gate: ec2 is online and free of alerts, but carries no ci-kit-mac-home, so it does not take these jobs',
        'ci-gate: rerun once the alert closes: https://github.com/SSFSKIM/ci-kit-sandbox/issues/12',
      ],
    }, status);
    // The same runners for a run whose Mac jobs are not the home Mac's: today's rule, any free host.
    assert.deepEqual(decide({ jobs: ['e2e:design'], alerts: [mini], runners }), { stop: false, lines: ['ci-gate: ci-kit alert open on mini; going ahead on ec2'] }, status);
  }
  // The mini free of alerts: the home jobs go ahead on it, whichever other machine is alerted.
  const ec2Alert = alert(14, 'ci-kit alert: ec2: UserNotificationCenter since 2026-10-26T01:00Z');
  assert.deepEqual(decide({ jobs: ['e2e:perf'], home: ['e2e:perf'], alerts: [ec2Alert], runners: [labelled('ci-kit-mac-mini', HOME), ec2] }), { stop: false, lines: ['ci-gate: ci-kit alert open on ec2; going ahead on mini'] });
  // The mini free of alerts but its home runner offline (its shared instance online): stopped, naming the mini and why.
  const away = decide({ jobs: ['e2e:perf', 'e2e:design'], home: ['e2e:perf'], alerts: [ec2Alert], runners: [labelled('ci-kit-mac-mini', HOME, 'offline'), labelled('ci-kit-mac-mini-2', ['ci-kit-mac-shared']), ec2] });
  assert.deepEqual(away.lines.slice(1), [
    '  mini: no ci-kit-mac-home runner online',
    'ci-gate: rerun once a runner carrying ci-kit-mac-home is online',
  ]);
  assert.equal(away.stop, true);
  // No alert open: a home run goes ahead though the mini's runner is offline (a hold, a restart): its jobs queue.
  assert.deepEqual(decide({ jobs: ['e2e:perf'], home: ['e2e:perf'], alerts: [], runners: [labelled('ci-kit-mac-mini', HOME, 'offline'), ec2] }), { stop: false, lines: [] });
  // No runner carries the label at all.
  assert.deepEqual(decide({ jobs: ['e2e:perf'], home: ['e2e:perf'], alerts: [mini], runners: [ec2] }).lines.slice(1), [
    '  no runner of SSFSKIM/MAWS carries ci-kit-mac-home',
    'ci-gate: ec2 is online and free of alerts, but carries no ci-kit-mac-home, so it does not take these jobs',
    'ci-gate: rerun once a runner carrying ci-kit-mac-home is online',
  ]);
});

test('a run whose Mac jobs the guest takes goes ahead on it past the host alert; the trial slot counts only for a trial run', () => {
  const vmJobs = ['e2e:side', 'e2e:tools'];
  assert.deepEqual(decide({ jobs: vmJobs, guest: 'vm', alerts: [mini], runners: online('ci-kit-mac-mini', 'ci-kit-mac-mini-vm') }), { stop: false, lines: ['ci-gate: ci-kit alert open on mini; going ahead on mini-vm'] });
  assert.equal(decide({ jobs: vmJobs, guest: 'vm', alerts: [mini], runners: online('ci-kit-mac-mini', 'ci-kit-mac-mini-vm-trial') }).stop, true);
  assert.equal(decide({ jobs: vmJobs, guest: 'vm-trial', alerts: [mini], runners: online('ci-kit-mac-mini', 'ci-kit-mac-mini-vm') }).stop, true);
  assert.deepEqual(decide({ jobs: vmJobs, guest: 'vm-trial', alerts: [mini], runners: online('ci-kit-mac-mini', 'ci-kit-mac-mini-vm-trial') }).lines, ['ci-gate: ci-kit alert open on mini; going ahead on mini-vm-trial']);
  // The guest offline, there is nothing free: stopped, with no word on the guest.
  const offline = [{ name: 'ci-kit-mac-mini', status: 'online' }, { name: 'ci-kit-mac-mini-vm', status: 'offline' }];
  assert.equal(decide({ jobs: vmJobs, guest: 'vm', alerts: [mini], runners: offline }).lines.length, 3);
  // With no alert, either kind of run goes ahead.
  assert.deepEqual(decide({ jobs, alerts: [], runners: online('ci-kit-mac-mini-vm') }), { stop: false, lines: [] });
  assert.deepEqual(decide({ jobs: vmJobs, guest: 'vm', alerts: [], runners: online('ci-kit-mac-mini-vm') }), { stop: false, lines: [] });
});

// gate.yml's env as the plan job gets it: plain, quoted and block scalars; anything else throws, so a workflow it does not
// know leaves the run needing a host.
test("gate.yml's env: scalars and folded lists are read, anything else throws", () => {
  const env = (body) => workflowEnv(`name: gate\n\nenv:\n${body}\ndefaults:\n  run:\n    shell: bash\n`);
  assert.deepEqual(env("  # a comment\n  A: --max-old-space-size=5120\n  B: ''\n  C: 'side tools'\n  D: \"x\"\n  E: >-\n    side\n    tools\n\n    more\n  F: |\n    one\n    two\n  G: 1"), { A: '--max-old-space-size=5120', B: '', C: 'side tools', D: 'x', E: 'side tools more', F: 'one\ntwo', G: '1' });
  for (const bad of ['  A: [side, tools]', '  A: {x: 1}', '  A:\n    nested: 1', '  A: &anchor side', '  A: "a\\nb"', '  A: side # note', '  A: *x', '  A: !!str side']) assert.throws(() => env(bad), /gate\.yml env/, bad);
  assert.deepEqual(workflowEnv('name: gate\n'), {});
  const own = workflowEnv(readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8'));
  assert.equal(own.POOL_E2E, 'desk-web');
  assert.ok(own.CLASS1_E2E.split(' ').includes('library'));
  assert.equal(own.MAC_VM_E2E, 'document-app widgets to-human transcript panel c7 code scm library document settings tools dashboard side presentations deliverables supervisor browser browser-comment browser-import agents c12 available design-systems browser-chrome composer layout delivery connectors-oauth artifacts browser-cua connectors connectors-direct');
});

test('a runs-on label set is the guest, the trial slot, no Mac, or a host', () => {
  for (const [labels, kind] of [
    [['ci-kit-mac-solo'], 'vm'],
    [['ci-kit-mac-vm'], 'vm'],
    [['ci-kit-mac-vm-trial'], 'vm-trial'],
    [['self-hosted', 'macOS', 'ARM64'], 'host'],
    [['self-hosted', 'macOS', 'ARM64', 'ci-kit-mac-home'], 'host'],
    [['ci-kit-mac-shared'], 'host'],
    [['ci-kit-mac-solo', 'macOS'], 'host'],
    [['ci-kit-mac-other'], 'host'],
    [['self-hosted', 'ci-kit-pool', 'cpus-4'], 'other'],
    ['ubuntu-24.04', 'other'],
    ['ubuntu-slim', 'other'],
    ['macos-latest', 'host'],
    [[], 'host'],
    [null, 'host'],
  ]) assert.equal(runsOn(JSON.stringify(labels)), kind, JSON.stringify(labels));
});

// The guest decision runs the tested commit's own gate-plan.mjs: each tree here is a git repository holding this checkout's
// plan scripts, a package.json and a gate.yml of its own, committed, as `git archive` takes them.
const trees = [];
after(() => {
  for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});
// A group the guest can take restores out/ from the pool's e2e-build job, so it builds through scripts/e2e-build.sh (the
// plan keeps any other off the guest's labels); `nobuild` builds another way.
const built = (variant, rest) => `scripts/e2e-build.sh ${variant} && ${rest}`;
const packageJson = JSON.stringify({
  scripts: {
    e2e: 'x',
    'e2e:side': built('harness', 'playwright test side'),
    'e2e:tools': built('plain', 'playwright test tools'),
    'e2e:library': built('plain', 'playwright test library'),
    'e2e:perf': built('plain', 'playwright test perf'),
    'e2e:fg': built('harness', 'MAWS_E2E_FOREGROUND=1 playwright test fg'),
    'e2e:nobuild': 'x',
  },
});
function tree(workflow, scripts = packageJson) {
  const dir = mkdtempSync(join(tmpdir(), 'maws-ci-gate-alerts-tree-'));
  trees.push(dir);
  cpSync(join(root, '.github/scripts'), join(dir, '.github/scripts'), { recursive: true });
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/gate.yml'), workflow);
  writeFileSync(join(dir, 'package.json'), scripts);
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'tree');
  return { gitDir: dir, sha: git('rev-parse', 'HEAD').trim() };
}
const envOf = (body) => `name: gate\n\nenv:\n${body}\njobs:\n  plan:\n    runs-on: ubuntu-slim\n`;
// Today's repository variables: class 1a on the pool, the e2e lane on the Mac.
const today = { GATE_RUNNER: 'pool', GATE_E2E_RUNNER: 'macos' };
const listed = tree(envOf('  CLASS1_E2E: side tools\n  MEASURED_E2E: perf\n  MAC_SHARED_E2E: ""\n  MAC_VM_E2E: side tools unit:darwin\n'));

test("the guest decision follows the tested tree's workflow; own-workflow runs take the guest only when no Mac job needs a host", () => {
  const ask = (target, gates, extra = {}) => guestRun({ ...target, gates, variables: today, ...extra });
  assert.equal(ask(listed, 'e2e:side,e2e:tools'), 'vm');
  assert.equal(ask(listed, 'e2e:side,unit:darwin'), 'vm');
  // This checkout admits the wave-2, wave-2b, wave-2c, wave-2d, wave-3 and wave-4 groups, but unit:darwin and other host-only jobs still prevent an all-guest run.
  // The mini's own placement, with no group on HOSTED_MAC_E2E; runs with hosted groups have their own tests below.
  const own = tree(readFileSync(join(root, '.github/workflows/gate.yml'), 'utf8').replace(/^ {2}HOSTED_MAC_E2E: (?:>-\n(?: {4}.*\n)+|.*\n)/m, "  HOSTED_MAC_E2E: ''\n"), readFileSync(join(root, 'package.json'), 'utf8'));
  const routes = [{}, { runner: 'macos' }, { lane: 'vm' }, { lane: 'vm-trial' }];
  for (const gates of ['e2e:library', 'e2e:library,e2e:document', 'static,unit,e2e:panel', 'e2e:dashboard', 'e2e:panel,e2e:dashboard', 'e2e:side', 'e2e:panel,e2e:side', 'e2e:dashboard,e2e:side', 'e2e:presentations', 'e2e:panel,e2e:presentations', 'e2e:side,e2e:presentations',
    'e2e:browser', 'e2e:agents,e2e:browser-comment', 'e2e:c12,e2e:supervisor', 'e2e:composer,e2e:layout', 'e2e:panel,e2e:browser-chrome', 'e2e:delivery,e2e:connectors-oauth', 'e2e:artifacts,e2e:browser-cua', 'e2e:connectors,e2e:connectors-direct'])
    for (const extra of routes) assert.equal(ask(own, gates, extra), extra.lane ?? 'vm', `${gates} ${JSON.stringify(extra)}`);
  for (const gates of ['', 'unit:darwin', 'packaged', 'e2e:design', 'e2e:side,e2e:design', 'e2e:presentations,e2e:design', 'e2e:browser,e2e:terminal', 'e2e:artifacts,e2e:terminal', 'e2e:browser-cua,e2e:design', 'e2e:connectors,e2e:document-scale',
    'e2e:panel,unit:darwin', 'e2e:panel,packaged', 'e2e:panel,e2e:design', 'e2e:panel,e2e:document-scale'])
    for (const extra of routes) assert.equal(ask(own, gates, extra), null, `${gates} ${JSON.stringify(extra)}`);
  for (const extra of routes) assert.equal(ask(own, 'static,unit,e2e:panel', { ...extra, class1a: 'macos' }), null, `Mac class 1a ${JSON.stringify(extra)}`);
});

test("the tested tree's plan names its home Mac jobs, the measured and live ones, which keep the run off the guest under any lane", () => {
  const home = tree(envOf('  CLASS1_E2E: side tools\n  MEASURED_E2E: perf\n  LIVE_E2E: library tools\n  LIVE_GUARD_E2E: tools\n  MAC_VM_E2E: perf library tools side\n'));
  for (const lane of ['', 'vm', 'vm-trial']) {
    assert.deepEqual(macPlan({ ...home, gates: 'e2e:perf,e2e:side', lane, variables: today }), { jobs: ['e2e:perf', 'e2e:side'], guest: null, home: ['e2e:perf'] }, lane);
    assert.deepEqual(macPlan({ ...home, gates: 'e2e:library,e2e:tools', live: 'yes', lane, variables: today }), { jobs: ['e2e:library', 'e2e:tools'], guest: null, home: ['e2e:library', 'e2e:tools'] }, lane);
  }
  // The other Mac jobs are not the home Mac's: the guest's, the exclusive instance's, packaged and unit:darwin.
  assert.deepEqual(macPlan({ ...home, gates: 'e2e:side', variables: today }), { jobs: ['e2e:side'], guest: 'vm', home: [] });
  assert.deepEqual(macPlan({ ...home, gates: 'e2e:nobuild,packaged,unit:darwin', variables: today }), { jobs: ['packaged', 'unit:darwin', 'e2e:nobuild'], guest: null, home: [] });
  // The plan job on the host leaves the run needing a host, and the plan still names the home jobs.
  assert.deepEqual(macPlan({ ...home, gates: 'e2e:perf', variables: { GATE_RUNNER: 'macos' } }), { jobs: ['plan', 'e2e:perf'], guest: null, home: ['e2e:perf'] });
  // A plan that cannot run names no home job: the run keeps the host rule.
  assert.equal(macPlan({ gates: 'e2e:perf', variables: today }), null);
});

// The peer's trailers (ci-gate-peer.mjs, through ci-gate.sh's --trailers) reach the tested plan, so a run they add a peer
// group to needs a host free of alerts, though its gates ask for no Mac job and the group is on MAC_VM_E2E.
test("the peer's trailers reach the tested plan: a tree a minor from its peer puts its peer group on the host", () => {
  const peered = tree(envOf('  PEER_E2E: side\n  MAC_VM_E2E: side tools\n'));
  const trailers = (wire) => `Peer: ${'f'.repeat(40)}\nPeer-Wire: 3.0\nWire: ${wire}`;
  assert.deepEqual(macPlan({ ...peered, gates: 'static,unit,probes', class1a: 'pool', trailers: trailers('3.1'), variables: today }), { jobs: ['e2e:side'], guest: null, home: [] });
  assert.deepEqual(macPlan({ ...peered, gates: 'e2e:tools', trailers: trailers('3.1'), variables: today }), { jobs: ['e2e:tools', 'e2e:side'], guest: null, home: [] });
  assert.deepEqual(macPlan({ ...peered, gates: 'static,unit,probes', class1a: 'pool', trailers: trailers('3.0'), variables: today }), { jobs: [], guest: 'none', home: [] });
  assert.deepEqual(macPlan({ ...peered, gates: 'static,unit,probes', class1a: 'pool', variables: today }), { jobs: [], guest: 'none', home: [] });
  // an iteration run (ci-gate.sh --affected passes its Selection) and a static check take no peer group, so no Mac
  assert.deepEqual(macPlan({ ...peered, gates: 'unit', class1a: 'pool', trailers: `${trailers('3.1')}\nSelection: affected`, variables: today }), { jobs: [], guest: 'none', home: [] });
  assert.deepEqual(macPlan({ ...peered, gates: 'static', class1a: 'pool', trailers: trailers('3.1'), variables: today }), { jobs: [], guest: 'none', home: [] });
});

test('a folded MAC_SHARED_E2E keeps its groups on the shared instances, off the guest, unless the run has a Lane:', () => {
  const folded = tree(envOf('  CLASS1_E2E: side tools\n  MAC_SHARED_E2E: >-\n    tools\n    side\n  MAC_VM_E2E: >-\n    side\n    tools\n'));
  const ask = (gates, lane) => guestRun({ ...folded, gates, lane, variables: today });
  assert.equal(ask('e2e:side,e2e:tools', ''), null);
  assert.equal(ask('e2e:side,e2e:tools', 'vm'), 'vm');
  assert.equal(ask('e2e:side', 'vm-trial'), 'vm-trial');
});

test('a foreground group on both lists goes to the solo label with no Lane:, so the guest takes it', () => {
  const both = tree(envOf('  CLASS1_E2E: side fg\n  MAC_SHARED_E2E: side fg\n  MAC_VM_E2E: side fg\n'));
  assert.equal(guestRun({ ...both, gates: 'e2e:fg', variables: today }), 'vm');
  assert.equal(guestRun({ ...both, gates: 'e2e:side', variables: today }), null);
  assert.equal(guestRun({ ...both, gates: 'e2e:side', lane: 'vm', variables: today }), 'vm');
});

test('--gates all: the default set takes the guest when unit:darwin and every class-1 group are listed, and not when one is not', () => {
  assert.equal(guestRun({ ...listed, gates: '', variables: today }), 'vm');
  const without = (list, measured = '') => tree(envOf(`  CLASS1_E2E: side tools\n  MEASURED_E2E: ${measured || "''"}\n  MAC_VM_E2E: ${list}\n`));
  assert.equal(guestRun({ ...without('side tools'), gates: '', variables: today }), null); // unit:darwin unlisted
  assert.equal(guestRun({ ...without('side unit:darwin'), gates: '', variables: today }), null); // tools unlisted
  assert.equal(guestRun({ ...without('side tools unit:darwin', 'tools'), gates: '', variables: today }), null); // tools measured
});

test('anything that keeps the plan from running leaves the run needing a host', () => {
  const ask = (target, extra = {}) => guestRun({ gates: 'e2e:side', variables: today, ...target, ...extra });
  assert.equal(ask(listed), 'vm');
  assert.equal(ask({}), null); // no tree
  assert.equal(ask({ gitDir: listed.gitDir, sha: '0'.repeat(40) }), null);
  assert.equal(ask(listed, { gates: 'e2e:nope' }), null); // the plan refuses the gate
  assert.equal(ask(listed, { gates: 'static,e2e:side', class1a: 'macos' }), null); // class 1a on a Mac: static on the host
  assert.equal(ask(listed, { variables: { GATE_RUNNER: 'macos' } }), null); // the plan job on the host
  assert.equal(ask(listed, { gates: 'e2e:side,packaged' }), null);
  assert.equal(ask(tree(envOf('  CLASS1_E2E: side\n  MAC_VM_E2E: [side]\n'))), null); // an env it cannot read
  assert.equal(ask(tree('name: gate\n')), null); // no list: every group on the host's labels
  assert.equal(ask(tree(envOf('  MAC_VM_E2E: side\n'), '{')), null); // a package.json the plan cannot read
});

// The plan keeps a group whose out/ e2e-build cannot make off the guest's labels (ci-kit's mac-lane concurrency spec,
// "out/ is built on the pool"); e2e-build itself runs on the pool, no Mac.
test("a MAC_VM_E2E group that does not build through scripts/e2e-build.sh needs a host; e2e-build's pool job does not", () => {
  const vm = tree(envOf('  CLASS1_E2E: side nobuild\n  MAC_VM_E2E: side nobuild\n'));
  assert.equal(guestRun({ ...vm, gates: 'e2e:side', variables: today }), 'vm');
  for (const lane of ['', 'vm']) assert.equal(guestRun({ ...vm, gates: 'e2e:side,e2e:nobuild', lane, variables: today }), null, lane);
  assert.equal(guestRun({ ...vm, gates: 'e2e:nobuild', variables: today }), null);
});

// ci-kit's hosted-Mac spec (Placement): a hosted group's job is a waiter on the pool, so the tested commit's plan puts it on
// no Mac. A run whose every Mac job would be such a group has no Mac job, and a mini alert does not hold it; guestRun
// says `none` for it, which a run that needs the host never is.
const hostedTree = () => tree(envOf('  CLASS1_E2E: side tools library\n  MAC_VM_E2E: side\n  HOSTED_MAC_E2E: tools\n'));

test("a run whose e2e groups are all hosted puts no job on a Mac: guestRun says none, and one host or guest job beside them says otherwise", () => {
  const hosted = hostedTree();
  const ask = (gates, extra = {}) => guestRun({ ...hosted, gates, runner: 'macos', variables: today, ...extra });
  assert.equal(ask('e2e:tools'), 'none');
  assert.equal(ask('static,unit,probes,e2e:tools'), 'none'); // class 1a on the pool
  assert.equal(ask('e2e:side,e2e:library', { lane: 'hosted' }), 'none');
  assert.equal(ask('e2e:tools,e2e:library'), null);
  assert.equal(ask('e2e:tools,unit:darwin'), null);
  assert.equal(ask('e2e:tools', { lane: 'no-hosted' }), null);
  assert.equal(ask('e2e:tools,e2e:side'), 'vm');
  assert.deepEqual(macPlan({ ...hosted, gates: 'e2e:tools,e2e:library,e2e:side', runner: 'macos', variables: today }), { jobs: ['e2e:library', 'e2e:side'], guest: null, home: [] });
  assert.deepEqual(macPlan({ ...hosted, gates: 'e2e:tools', runner: 'macos', variables: today }), { jobs: [], guest: 'none', home: [] });
  assert.equal(macPlan({ gates: 'e2e:tools', variables: today }), null); // no tree
});

test('check: a hosted-only run goes ahead past a mini alert; a run with one hosted and one host group stops, naming the host one', () => {
  const issues = [{ number: 12, title: 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)' }];
  const runners = [{ name: 'ci-kit-mac-mini', status: 'online' }];
  const hosted = hostedTree();
  const run = (gates, extra = {}) => check({ gates, runner: 'macos', class1a: '', ...hosted, gh: fakeGh({ issues, runners }).gh, ...extra });
  // No Mac job, so no alert or runner is read.
  for (const [gates, extra] of [['e2e:tools', {}], ['e2e:side,e2e:library', { lane: 'hosted' }]]) {
    const { gh, calls } = fakeGh({ issues, runners });
    assert.deepEqual(check({ gates, runner: 'macos', class1a: '', ...hosted, gh, ...extra }), { stop: false, lines: [] }, gates);
    assert.deepEqual(calls, ['repos/SSFSKIM/MAWS/actions/variables?per_page=30'], gates);
  }
  const mixed = run('e2e:tools,e2e:library');
  assert.equal(mixed.stop, true);
  assert.match(mixed.lines[0], /^ci-gate: not pushing: this run puts jobs on a Mac \(e2e:library\) and no online Mac runner is free/);
  assert.equal(mixed.lines[1], '  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)');
  assert.equal(run('e2e:tools', { lane: 'no-hosted' }).stop, true);
});

test('hosted-only runs pass a mini alert, but a home job beside hosted work still needs the home runner', () => {
  const workflow = tree(envOf('  MEASURED_E2E: perf\n  LIVE_E2E: library tools\n  LIVE_GUARD_E2E: tools\n  HOSTED_MAC_E2E: side\n'));
  const issues = [{ number: 12, title: 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)' }];
  const runners = [labelled('ci-kit-mac-mini', HOME), ec2];
  const run = (gates, extra = {}) => check({ ...workflow, gates, runner: 'macos', gh: fakeGh({ issues, runners }).gh, ...extra });
  assert.deepEqual(run('e2e:side'), { stop: false, lines: [] });
  for (const lane of ['', 'hosted', 'no-hosted']) {
    const measured = run('e2e:side,e2e:perf', { lane });
    assert.equal(measured.stop, true, lane);
    assert.match(measured.lines[0], /home Mac \(e2e:perf\)/, lane);
    const live = run('e2e:library', { live: 'yes', lane });
    assert.equal(live.stop, true, lane);
    assert.match(live.lines[0], /home Mac \(e2e:library, e2e:tools\)/, lane);
  }
});

// The Mac jobs are the tested commit's plan's, not this checkout's reading of the lists: a target whose POOL_E2E differs
// from the caller's (offMac) is held by the alert when its own plan puts the group on the Mac, and goes ahead when its
// own plan keeps it off.
test("check reads the run's Mac jobs from the tested commit's plan, whatever the caller's POOL_E2E says", () => {
  const issues = [{ number: 12, title: 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)' }];
  const runners = [{ name: 'ci-kit-mac-mini', status: 'online' }];
  const run = (target, offMac) => check({ gates: 'e2e:side', runner: 'macos', class1a: '', ...target, offMac, gh: fakeGh({ issues, runners }).gh });
  const onTheMac = tree(envOf("  CLASS1_E2E: side\n  POOL_E2E: ''\n"));
  const result = run(onTheMac, ['side']);
  assert.equal(result.stop, true);
  assert.match(result.lines[0], /^ci-gate: not pushing: this run puts jobs on a Mac \(e2e:side\) /);
  const offTheMac = tree(envOf('  CLASS1_E2E: side\n  LINUX_E2E: side\n  POOL_E2E: side\n'));
  assert.deepEqual(run(offTheMac, []), { stop: false, lines: [] });
  // Only a plan that cannot be run falls back to the caller's lists.
  assert.deepEqual(run({}, ['side']), { stop: false, lines: [] });
  assert.equal(run({}, []).stop, true);
});

// The reads, the tree and the decision together, for the runs the architect's ruling names.
test('check: a run with host jobs is refused at the host alert, an all-VM run goes ahead on the guest, a mix is refused', () => {
  const issues = [{ number: 12, title: 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)' }];
  const runners = [labelled('ci-kit-mac-mini', HOME), labelled('ci-kit-mac-mini-vm', ['ci-kit-mac-solo', 'ci-kit-mac-vm'])];
  const workflow = tree(envOf('  CLASS1_E2E: side tools\n  MEASURED_E2E: perf\n  MAC_VM_E2E: side tools perf\n'));
  const run = (gates, extra = {}, rows = { issues, runners }) => check({ gates, runner: '', class1a: '', ...workflow, gh: fakeGh(rows).gh, ...extra });
  for (const gates of ['unit:darwin', 'e2e:library', 'e2e:perf', 'e2e:side,e2e:library', 'e2e:side,unit:darwin', 'e2e:side,packaged', 'e2e:side,e2e:perf']) {
    const result = run(gates);
    assert.equal(result.stop, true, gates);
    assert.equal(result.lines[1], '  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)', gates);
  }
  assert.deepEqual(run('e2e:side,e2e:tools'), { stop: false, lines: ['ci-gate: ci-kit alert open on mini; going ahead on mini-vm'] });
  assert.deepEqual(run('e2e:side', { lane: 'vm' }), { stop: false, lines: ['ci-gate: ci-kit alert open on mini; going ahead on mini-vm'] });
  assert.equal(run('e2e:side', { lane: 'vm-trial' }).stop, true); // the trial slot is not online
  assert.equal(run('e2e:side,e2e:tools', { gitDir: undefined, sha: undefined }).stop, true); // no tree to ask
  // A temp directory that cannot be made is the guest decision failing, not a failed GitHub read: still refused.
  const tmp = process.env.TMPDIR;
  process.env.TMPDIR = join(root, 'no-such-directory');
  try {
    const result = run('e2e:side,e2e:tools');
    assert.equal(result.stop, true);
    assert.equal(result.lines[1], '  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)');
  } finally {
    if (tmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = tmp;
  }
  // No alert: both kinds of run go ahead, as before.
  assert.deepEqual(run('e2e:library', {}, { runners }), { stop: false, lines: [] });
  assert.deepEqual(run('e2e:side,e2e:tools', {}, { runners }), { stop: false, lines: [] });
});

// The reads, the tree and the decision together for the home Mac: a measured or live job waits for the mini's own runner
// when the mini is alerted, though the EC2 Mac is online and free; an ordinary Mac job goes ahead on the EC2 Mac.
test('check: measured and live jobs are refused at the mini alert though the EC2 Mac is free; other Mac jobs go ahead on it', () => {
  const miniAlert = [{ number: 12, title: 'ci-kit alert: mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)' }];
  const ec2Alert = [{ number: 14, title: 'ci-kit alert: ec2: UserNotificationCenter since 2026-10-26T01:00Z' }];
  const runners = [labelled('ci-kit-mac-mini', HOME, 'offline'), ec2];
  const workflow = tree(envOf('  CLASS1_E2E: side tools\n  MEASURED_E2E: perf\n  LIVE_E2E: library\n  MAC_VM_E2E: side tools perf library\n'));
  const run = (gates, extra = {}, rows = {}) => check({ gates, runner: '', class1a: '', ...workflow, gh: fakeGh({ issues: miniAlert, runners, ...rows }).gh, ...extra });
  const refused = [
    'ci-gate: not pushing: this run puts jobs on the home Mac (e2e:perf), which only a runner labelled ci-kit-mac-home takes, and no such runner is online on a machine free of an open ci-kit alert:',
    '  mini: SecurityAgent since 2026-10-17T20:06Z (source unknown)',
    'ci-gate: ec2 is online and free of alerts, but carries no ci-kit-mac-home, so it does not take these jobs',
    'ci-gate: rerun once the alert closes: https://github.com/SSFSKIM/ci-kit-sandbox/issues/12',
  ];
  for (const lane of ['', 'vm']) assert.deepEqual(run('e2e:perf,e2e:side', { lane }), { stop: true, lines: refused }, lane);
  assert.deepEqual(run('e2e:perf', {}, { variables: [['GATE_RUNNER', 'macos'], ['GATE_E2E_RUNNER', 'macos']] }), { stop: true, lines: refused });
  const live = run('e2e:library', { live: 'yes' });
  assert.equal(live.stop, true);
  assert.equal(live.lines[0], refused[0].replace('(e2e:perf)', '(e2e:library)'));
  // Not the home Mac's: an exclusive-instance job, packaged, a guest job under a Lane: (no guest online, the host takes it).
  for (const [gates, extra] of [['e2e:side', {}], ['packaged,unit:darwin', {}], ['e2e:side,e2e:tools', { lane: 'vm' }]]) {
    assert.deepEqual(run(gates, extra), { stop: false, lines: ['ci-gate: ci-kit alert open on mini; going ahead on ec2'] }, gates);
  }
  // The mini free of alerts and online: the home jobs go ahead on it.
  assert.deepEqual(run('e2e:perf', {}, { issues: ec2Alert, runners: [labelled('ci-kit-mac-mini', HOME), ec2] }), { stop: false, lines: ['ci-gate: ci-kit alert open on ec2; going ahead on mini'] });
  assert.deepEqual(run('e2e:library', { live: 'yes' }, { issues: ec2Alert, runners: [labelled('ci-kit-mac-mini', HOME), ec2] }), { stop: false, lines: ['ci-gate: ci-kit alert open on ec2; going ahead on mini'] });
  // No alert open: measured and live runs go ahead with the mini offline, reading no runners; their jobs queue for it.
  for (const [gates, extra] of [['e2e:perf', {}], ['e2e:library', { live: 'yes' }]]) {
    const quiet = fakeGh({ issues: [], runners });
    assert.deepEqual(check({ gates, runner: '', class1a: '', ...workflow, gh: quiet.gh, ...extra }), { stop: false, lines: [] }, gates);
    assert.equal(quiet.calls.some((path) => path.includes('/runners')), false, gates);
  }
});

// A fake gh: each read answers with the lines of its --jq, or throws as execFileSync does on a failed gh.
function fakeGh({ variables = [['GATE_RUNNER', 'pool'], ['GATE_E2E_RUNNER', 'macos']], issues = [], runners = [], fail }) {
  const calls = [];
  const gh = (args) => {
    const path = args[2];
    calls.push(path);
    if (path.includes('/runners')) assert.equal(args[4], '.runners[] | {name, status, labels: [.labels[].name]}'); // the shape the runners API answers to (checked live 2026-10-26)
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
