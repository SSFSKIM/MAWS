// scripts/ci-gate.sh's check before it pushes. Each macOS runner, `ci-kit-mac-<machine>`, refuses jobs while a system
// dialog holds its Mac's front (ci-kit's job-started check, gate-offload Decision Log 58), and ci-kit's watcher opens one
// issue per episode per machine in SSFSKIM/ci-kit-sandbox, labelled `ci-kit-alert` and titled
// `ci-kit alert: <machine>: <dialog process> since <YYYY-MM-DDTHH:MMZ>[ (<source>)]`. A run that puts jobs on a Mac is not
// pushed while no online Mac runner is free of such an alert: its Mac jobs would only be refused. A run whose jobs all go
// to Linux or the pool is not checked. A guest (ci-kit's macOS guest) counts as a free Mac only for a run whose Mac jobs all
// can run in it, and the tested commit's own plan decides that: gate-plan.mjs of the commit, run on its gate.yml's env, says
// where each job goes, and a job can take the guest only on the labels the guest carries (ci-kit-mac-solo, ci-kit-mac-vm, or
// the trial slot's ci-kit-mac-vm-trial). A run with any other Mac job, a host job (packaged, the plan job, a class 1a job, a
// job on the exclusive instance's or the shared instances' labels), needs a host free of alerts, for the guest cannot take
// that job and the host's alert would refuse it. Whatever keeps that plan from running (no tree, a refusal, a workflow the
// reader does not know) leaves the run needing a host; only a failed GitHub read goes ahead with a warning, since the
// runner's own check still refuses.
// Usage: node scripts/ci-gate-alerts.mjs --gates <list> --runner <lane> --class1a <runner> --lane <lane> --live <yes>
// --git-dir <dir> --sha <commit>, ci-gate.sh's own values (empty when not given; its `--gates all` comes as empty, the
// default set; the directory and the commit are the tested tree). Prints its lines on stdout and exits 2
// when the run is not to be pushed, else 0. The parsing and the decision are exported for scripts/ci-gate-alerts.test.mjs.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = 'SSFSKIM/MAWS';
const ALERTS = 'SSFSKIM/ci-kit-sandbox';
const ALERT = /^ci-kit alert: ([a-z0-9-]+): (\S+) since (\S+)(?: \((.*)\))?/;
// A runner's machine (ci-kit's mac-lane concurrency spec): a shared instance, `ci-kit-mac-<machine>-<n>`, shares its
// machine's desktop, so its machine's alert holds it too (ci-kit refuses a machine name ending in `-<n>`); ci-kit's
// macOS guest, `ci-kit-mac-<machine>-vm` (`-vm-trial` its trial slot), has a desktop of its own, so it is a machine of
// its own, `<machine>-vm`, and opens no alert.
const MAC_RUNNER = /^ci-kit-mac-(.+?)(?:-\d+)?$/;
const words = (text = '') => text.split(/[\s,]+/).filter(Boolean);
// What a folded machine is: `vm-trial` for the trial slot's identity (`<machine>-vm-trial`, which carries the one label
// ci-kit-mac-vm-trial), `vm` for a guest (`<machine>-vm…`, which carries ci-kit-mac-solo and ci-kit-mac-vm), else null, a host.
const guestOf = (machine) => (/-vm-trial$/.test(machine) ? 'vm-trial' : machine.includes('-vm') ? 'vm' : null);
const list = (items) => items.join(', ');

// One alert issue's title as { machine, dialog, since, source }, or null for any other title (another alert kind).
export function parseAlert(title) {
  const match = ALERT.exec(title);
  return match && { machine: match[1], dialog: match[2], since: match[3], source: match[4] };
}

export const alertLine = ({ machine, dialog, since, source }) => `${machine}: ${dialog} since ${since}${source === undefined ? '' : ` (${source})`}`;

// The e2e groups gate.yml's POOL_E2E names, which never take a Mac whatever the lane (Decision Log 72).
export const poolE2e = (workflow) => words(/^ {2}POOL_E2E: (.*)$/m.exec(workflow)?.[1]);

// The jobs a run puts on a Mac, resolved as .github/scripts/gate-plan.mjs resolves them (the e2e lane, class 1a's runner,
// the gate set) and as .github/workflows/gate.yml places them (the plan job on the Mac under GATE_RUNNER=macos; unit:darwin
// and packaged always on the Mac). `runner`, `class1a` and `gates` are ci-gate.sh's flags, which become the run's
// trailers; `variables` holds the repository's variables; `offMac` the POOL_E2E groups. Empty when every job goes to
// Linux or the pool.
export function macJobs({ gates = '', runner = '', class1a = '', variables = {}, offMac = [] }) {
  const gateRunner = (variables.GATE_RUNNER ?? '').toLowerCase();
  const class1aRunner = (class1a || gateRunner || 'linux').toLowerCase();
  const lane = (runner || variables.GATE_E2E_RUNNER || (gateRunner === 'pool' ? '' : gateRunner) || 'linux').toLowerCase();
  const asked = words(gates);
  const set = asked.length > 0 ? asked : ['static', 'unit', 'probes', ...(lane === 'macos' ? ['unit:darwin', 'the class-1 e2e groups'] : [])];
  return [
    ...(gateRunner === 'macos' ? ['plan'] : []),
    ...set.filter((gate) => {
      if (['static', 'unit', 'probes'].includes(gate)) return class1aRunner === 'macos';
      if (gate === 'unit:darwin' || gate === 'packaged') return true;
      return lane === 'macos' && !offMac.includes(gate.slice(4)); // an e2e group
    }),
  ];
}

// Whether the run goes ahead, and what to print: `alerts` the parsed open alerts (each with its issue `number`),
// `runners` MAWS's self-hosted runners as { name, status }, `guest` the guest the run's Mac jobs can all run in (guestRun):
// `vm` (a guest that carries ci-kit-mac-solo or ci-kit-mac-vm), `vm-trial` (the trial slot's), or null, a run that needs a host.
export function decide({ jobs, alerts, runners, guest = null }) {
  if (jobs.length === 0 || alerts.length === 0) return { stop: false, lines: [] };
  const blocked = [...new Set(alerts.map((alert) => alert.machine))];
  const machines = [
    ...new Set(
      runners
        .filter((runner) => runner.status === 'online')
        .map((runner) => MAC_RUNNER.exec(runner.name)?.[1])
        .filter((machine) => machine !== undefined && !blocked.includes(machine)),
    ),
  ];
  const free = machines.filter((machine) => guestOf(machine) === null || guestOf(machine) === guest);
  const guests = machines.filter((machine) => guestOf(machine) !== null);
  if (free.length > 0) return { stop: false, lines: [`ci-gate: ci-kit alert open on ${list(blocked)}; going ahead on ${list(free)}`] };
  return {
    stop: true,
    lines: [
      `ci-gate: not pushing: this run puts jobs on a Mac (${list(jobs)}) and no online Mac runner is free of an open ci-kit alert, so ci-kit's job-started check would refuse them:`,
      ...alerts.map((alert) => `  ${alertLine(alert)}`),
      ...(guests.length > 0 ? [`ci-gate: ci-kit's macOS guest (${list(guests)}) is online, but it does not count: not every Mac job of this run can run in it, on the labels it carries`] : []),
      `ci-gate: rerun once the alert closes: ${alerts.map((alert) => `https://github.com/${ALERTS}/issues/${alert.number}`).join(' ')}`,
    ],
  };
}

// gate.yml's workflow-level `env:` as the plan job gets it, read for the names it holds: plain and quoted scalars on one
// line, and block scalars (`>-`, `|`) whose lines are joined, which is all the plan's lists need (it splits them on
// whitespace). It throws on anything else, a flow list, an anchor, a nested map, a double-quoted escape, so that a workflow
// it does not know leaves the run needing a host rather than reading a list wrongly.
export function workflowEnv(workflow) {
  const lines = workflow.split('\n');
  const env = {};
  const start = lines.findIndex((line) => /^env:\s*$/.test(line));
  if (start < 0) return env;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!line.startsWith(' ')) break;
    const entry = /^ {2}([A-Za-z_][A-Za-z0-9_]*): *(.*?) *$/.exec(line);
    if (!entry) throw new Error(`gate.yml env: cannot read ${JSON.stringify(line)}`);
    const [, name, value] = entry;
    const block = /^([>|])[+-]?$/.exec(value);
    if (block) {
      const body = [];
      while (i + 1 < lines.length && /^( {4,}.*|\s*)$/.test(lines[i + 1])) body.push(lines[++i].trim());
      env[name] = body.filter(Boolean).join(block[1] === '>' ? ' ' : '\n');
      continue;
    }
    const single = /^'(.*)'$/.exec(value);
    const double = /^"(.*)"$/.exec(value);
    if (single && !single[1].replaceAll("''", '').includes("'")) env[name] = single[1].replaceAll("''", "'");
    else if (double && !/["\\]/.test(double[1])) env[name] = double[1];
    else if (value !== '' && !/^[[{&*!|>%@`'"#]|^- | #|: |:$/.test(value)) env[name] = value;
    else throw new Error(`gate.yml env: cannot read ${name}`);
  }
  return env;
}

// What a runs-on label set (the JSON the plan writes) is to a guest: `vm` for [ci-kit-mac-solo] or [ci-kit-mac-vm] (the
// guest carries both), `vm-trial` for [ci-kit-mac-vm-trial] (the trial slot's identity alone), `other` for what needs no Mac
// (hosted Linux, the pool), and `host` for anything else, which includes the exclusive instance's labels, the shared
// instances' [ci-kit-mac-shared] and every label set not known here.
export function runsOn(json) {
  const labels = JSON.parse(json);
  if (typeof labels === 'string') return /^ubuntu-[\d.]+$|^ubuntu-slim$/.test(labels) ? 'other' : 'host';
  if (!Array.isArray(labels)) return 'host';
  if (labels.includes('ci-kit-pool')) return 'other';
  if (labels.length === 1 && ['ci-kit-mac-solo', 'ci-kit-mac-vm'].includes(labels[0])) return 'vm';
  if (labels.length === 1 && labels[0] === 'ci-kit-mac-vm-trial') return 'vm-trial';
  return 'host';
}

// The guest a run's Mac jobs can all run in, from the tested commit's own plan: `vm`, `vm-trial`, or null when any job needs
// a host, no job takes a guest, the plan refuses the run, or anything cannot be read. The commit's .github/scripts,
// .github/workflows/gate.yml and package.json are extracted from `sha` in `gitDir` to a temporary directory, and its
// gate-plan.mjs runs there as the plan job runs it: gate.yml's env, the repository variables, and the trailers ci-gate.sh
// pushes (`gates`, `runner`, `class1a`, `lane`, `live`).
export function guestRun({ gitDir, sha, gates = '', runner = '', class1a = '', lane = '', live = '', variables = {} }) {
  if (!gitDir || !sha || (variables.GATE_RUNNER ?? '').toLowerCase() === 'macos') return null; // the plan job itself is on the host
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'maws-ci-gate-alerts-'));
    const top = execFileSync('git', ['-C', gitDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const archive = execFileSync('git', ['-C', top, 'archive', '--format=tar', sha, '--', '.github/scripts', '.github/workflows/gate.yml', 'package.json'], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    execFileSync('tar', ['-x', '-C', dir], { input: archive, stdio: ['pipe', 'pipe', 'pipe'] });
    const trailers = Object.entries({ Gates: gates, Runner: runner, Class1a: class1a, Lane: lane, Live: live }).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`);
    const output = join(dir, 'github-output');
    execFileSync(process.execPath, ['.github/scripts/gate-plan.mjs'], {
      cwd: dir,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        ...workflowEnv(readFileSync(join(dir, '.github/workflows/gate.yml'), 'utf8')),
        EVENT: 'push',
        HEAD_MESSAGE: `ci-gate: alert check\n\n${trailers.join('\n')}`,
        GATE_RUNNER: variables.GATE_RUNNER ?? '',
        GATE_E2E_RUNNER: variables.GATE_E2E_RUNNER ?? '',
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: join(dir, 'github-summary'),
      },
    });
    const out = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    const kinds = [
      ...(out.packaged === 'true' ? ['host'] : []), // packaged is always on the exclusive instance (gate.yml)
      ...['static', 'unit', 'probes'].filter((gate) => out[gate] === 'true').map((gate) => runsOn(out[`${gate}_runner`])),
      ...(out.unit_darwin === 'true' ? [runsOn(out.unit_darwin_runner)] : []),
      ...JSON.parse(out.e2e).map((entry) => runsOn(entry.runner)),
    ].filter((kind) => kind !== 'other');
    const guests = new Set(kinds);
    return guests.size === 1 && !guests.has('host') ? kinds[0] : null;
  } catch {
    return null;
  } finally {
    try {
      if (dir) rmSync(dir, { recursive: true, force: true });
    } catch {
      // a temp directory left behind changes nothing the run needs
    }
  }
}

// The reads, through `gh` (args to stdout, throwing on failure), and the decision; any failed read goes ahead with a warning.
export function check({ gates, runner, class1a, lane, live, gitDir, sha, offMac, gh }) {
  const read = (path, jq) =>
    gh(['api', '--paginate', path, '--jq', jq])
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  let step = "the repository's variables";
  try {
    const variables = Object.fromEntries(read(`repos/${REPO}/actions/variables?per_page=30`, '.variables[] | [.name, .value]'));
    const jobs = macJobs({ gates, runner, class1a, variables, offMac });
    if (jobs.length === 0) return { stop: false, lines: [] };
    step = `the open ci-kit alerts (${ALERTS})`;
    const alerts = read(`repos/${ALERTS}/issues?labels=ci-kit-alert&state=open&per_page=100`, '.[] | select(.pull_request == null) | {number, title}')
      .map(({ number, title }) => {
        const alert = parseAlert(title);
        return alert && { ...alert, number };
      })
      .filter(Boolean);
    if (alerts.length === 0) return { stop: false, lines: [] };
    step = `${REPO}'s runners`;
    const runners = read(`repos/${REPO}/actions/runners?per_page=100`, '.runners[] | {name, status}');
    return decide({ jobs, alerts, runners, guest: guestRun({ gitDir, sha, gates, runner, class1a, lane, live, variables }) });
  } catch (error) {
    const reason = String(error.stderr ?? '').split('\n').find((line) => line.trim()) ?? error.message;
    return { stop: false, lines: [`ci-gate: warning: could not read ${step} (${reason.trim()}); going ahead without the ci-kit alert check (the runner's job-started check still refuses jobs under a dialog)`] };
  }
}

// realpath: node resolves argv[1] but not its symlinks (a worktree under /tmp), while import.meta.url is the real path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { gates: { type: 'string', default: '' }, runner: { type: 'string', default: '' }, class1a: { type: 'string', default: '' }, lane: { type: 'string', default: '' }, live: { type: 'string', default: '' }, 'git-dir': { type: 'string', default: '' }, sha: { type: 'string', default: '' } } });
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const offMac = poolE2e(readFileSync(new URL('../.github/workflows/gate.yml', import.meta.url), 'utf8'));
  const { stop, lines } = check({ ...values, gitDir: values['git-dir'], offMac, gh });
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.exit(stop ? 2 : 0);
}
