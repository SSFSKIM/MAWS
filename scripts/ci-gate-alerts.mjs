// scripts/ci-gate.sh's check before it pushes. Each macOS runner, `ci-kit-mac-<machine>`, refuses jobs while a system
// dialog holds its Mac's front (ci-kit's job-started check, gate-offload Decision Log 58), and ci-kit's watcher opens one
// issue per episode per machine in SSFSKIM/ci-kit-sandbox, labelled `ci-kit-alert` and titled
// `ci-kit alert: <machine>: <dialog process> since <YYYY-MM-DDTHH:MMZ>[ (<source>)]`. A run that puts jobs on a Mac is not
// pushed while no online Mac runner is free of such an alert: its Mac jobs would only be refused. A run whose jobs all go
// to Linux or the pool is not checked. The guest counts as a free Mac only for a run whose Mac jobs all can run in it: every
// one an e2e group, or unit:darwin, on gate.yml's MAC_VM_E2E (an e2e group not on MEASURED_E2E, which keeps its group on the
// host). A run with any other Mac job, a host job (packaged, the plan job, a class 1a job, a measured or unlisted group, an
// unlisted unit:darwin), needs a host free of alerts, for the guest cannot take that job and the host's alert would refuse it. Every failed read warns and
// goes ahead, since the runner's own check still refuses.
// Usage: node scripts/ci-gate-alerts.mjs --gates <list> --runner <lane> --class1a <runner> --lane <lane>, ci-gate.sh's own
// values (empty when not given; its `--gates all` comes as empty, the default set). Prints its lines on stdout and exits 2
// when the run is not to be pushed, else 0. The parsing and the decision are exported for scripts/ci-gate-alerts.test.mjs.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
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
// A guest's machine, as the fold names it: `<machine>-vm`, `<machine>-vm-trial`, `<machine>-vm2`.
const isGuest = (machine) => machine.includes('-vm');
const list = (items) => items.join(', ');

// One alert issue's title as { machine, dialog, since, source }, or null for any other title (another alert kind).
export function parseAlert(title) {
  const match = ALERT.exec(title);
  return match && { machine: match[1], dialog: match[2], since: match[3], source: match[4] };
}

export const alertLine = ({ machine, dialog, since, source }) => `${machine}: ${dialog} since ${since}${source === undefined ? '' : ` (${source})`}`;

// The names gate.yml's env list `name` holds (a quoted empty list, `''`, is none), read as gate-plan.mjs reads its env.
const listed = (workflow, name) => words(new RegExp(`^ {2}${name}: (.*)$`, 'm').exec(workflow)?.[1].replace(/^(['"])(.*)\1$/, '$2'));

// The e2e groups gate.yml's POOL_E2E names, which never take a Mac whatever the lane (Decision Log 72).
export const poolE2e = (workflow) => listed(workflow, 'POOL_E2E');

// The Mac jobs of a run that gate-plan.mjs places on a runner the guest carries, as names (an e2e group, or `unit:darwin`,
// which the plan places by the same lists): those on MAC_VM_E2E, less the MEASURED_E2E
// groups (which keep the host's exclusive instance) and, when the run has no `Lane:` (`vmLane` empty), less the MAC_SHARED_E2E
// groups (which then take the shared instances, a label only host instances carry; a `Lane:` sends them to the guest). A
// foreground group on both lists is left out too, though the plan would not share it: it only makes the check stricter.
export const vmE2e = (workflow, vmLane = '') => {
  const out = new Set([...listed(workflow, 'MEASURED_E2E'), ...(vmLane ? [] : listed(workflow, 'MAC_SHARED_E2E'))]);
  return listed(workflow, 'MAC_VM_E2E').filter((group) => !out.has(group));
};

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
// `runners` MAWS's self-hosted runners as { name, status }, `vmGroups` the names the guest can take (vmE2e). The guest
// is a free Mac only when every one of the run's Mac jobs is an `e2e:<group>`, or `unit:darwin`, in `vmGroups`; any other job
// needs a host.
export function decide({ jobs, alerts, runners, vmGroups = [] }) {
  if (jobs.length === 0 || alerts.length === 0) return { stop: false, lines: [] };
  const blocked = [...new Set(alerts.map((alert) => alert.machine))];
  const guestOk = jobs.every((job) => (job === 'unit:darwin' ? vmGroups.includes(job) : job.startsWith('e2e:') && vmGroups.includes(job.slice(4))));
  const machines = [
    ...new Set(
      runners
        .filter((runner) => runner.status === 'online')
        .map((runner) => MAC_RUNNER.exec(runner.name)?.[1])
        .filter((machine) => machine !== undefined && !blocked.includes(machine)),
    ),
  ];
  const free = machines.filter((machine) => guestOk || !isGuest(machine));
  const guests = machines.filter(isGuest);
  if (free.length > 0) return { stop: false, lines: [`ci-gate: ci-kit alert open on ${list(blocked)}; going ahead on ${list(free)}`] };
  return {
    stop: true,
    lines: [
      `ci-gate: not pushing: this run puts jobs on a Mac (${list(jobs)}) and no online Mac runner is free of an open ci-kit alert, so ci-kit's job-started check would refuse them:`,
      ...alerts.map((alert) => `  ${alertLine(alert)}`),
      ...(guests.length > 0 && !guestOk ? [`ci-gate: ci-kit's macOS guest (${list(guests)}) is online, but it takes only the jobs on MAC_VM_E2E, and a job of this run needs a host`] : []),
      `ci-gate: rerun once the alert closes: ${alerts.map((alert) => `https://github.com/${ALERTS}/issues/${alert.number}`).join(' ')}`,
    ],
  };
}

// The reads, through `gh` (args to stdout, throwing on failure), and the decision; any failed read goes ahead with a warning.
export function check({ gates, runner, class1a, offMac, vmGroups, gh }) {
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
    return decide({ jobs, alerts, runners, vmGroups });
  } catch (error) {
    const reason = String(error.stderr ?? '').split('\n').find((line) => line.trim()) ?? error.message;
    return { stop: false, lines: [`ci-gate: warning: could not read ${step} (${reason.trim()}); going ahead without the ci-kit alert check (the runner's job-started check still refuses jobs under a dialog)`] };
  }
}

// realpath: node resolves argv[1] but not its symlinks (a worktree under /tmp), while import.meta.url is the real path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { gates: { type: 'string', default: '' }, runner: { type: 'string', default: '' }, class1a: { type: 'string', default: '' }, lane: { type: 'string', default: '' } } });
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const workflow = readFileSync(new URL('../.github/workflows/gate.yml', import.meta.url), 'utf8');
  const { stop, lines } = check({ gates: values.gates, runner: values.runner, class1a: values.class1a, offMac: poolE2e(workflow), vmGroups: vmE2e(workflow, values.lane), gh });
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.exit(stop ? 2 : 0);
}
