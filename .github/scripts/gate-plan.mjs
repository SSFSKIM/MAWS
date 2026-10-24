// The gate set of one run of .github/workflows/gate.yml (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.1, §3.2,
// §3.6) and the runners its jobs take. The set: a manual run's `gates` input, else the pushed commit's `Gates:` trailer
// (scripts/ci-gate.sh writes it when its caller narrows the set), else class 1a, with unit:darwin and class 1's e2e
// groups added when the e2e lane is a macOS runner. Explicit unit:darwin runs on macOS regardless of the e2e lane, and so
// does `packaged` (the unsigned app built once, then its checks; Decision Log 35), which is only ever explicit.
// Class 1a's runner (static, unit, probes): the `class1a` input or the `Class1a:` trailer (`linux`, `macos` or `pool`),
// else the repository variable GATE_RUNNER, else `linux`. `pool` is ci-kit's pool, each job in a container of its own
// size (Decision Log 35; on GCE spot VMs since Decision Log 52); `pool=true` when a job runs there, for the plan job's
// pool-ensure.
// The e2e lane: the `runner` input or the `Runner:` trailer (`linux` or `macos`), else the repository variable
// GATE_E2E_RUNNER, else GATE_RUNNER unless it is `pool` (Electron would lose its sandbox in the pool's containers), else
// `linux`; a Linux lane takes only the groups that run green there (LINUX_E2E). The groups that drive no Electron
// (POOL_E2E) never take the Mac, whatever the lane: they run on the pool when class 1a does, else on the hosted Linux
// runner, so `Class1a:` and GATE_RUNNER place them (Decision Log 68; on a Mac desk-web's suite drives the system Google
// Chrome, whose TCC prompts held the mini, Decision Log 72); every other e2e job takes the lane's runner.
// `DefaultBeside:` (a push only): e2e groups that `default` treats as if they ran beside it, so a relaunch of part of a
// set narrows `default` to the specs the whole set's `default` ran (Decision Log 66). Passed through unchecked: a name
// the derivation cannot use makes `default` the bare set, never smaller (e2e-default-specs.mjs).
// `live`: the `live` input or a `Live: yes` trailer (ci-gate.sh --live), a paid run asked for on purpose. The e2e job
// then runs with MAWS_LIVE, MAWS_LIBRARY_LIVE and MAWS_LIVE_DOCUMENT at `1`, the flags the LIVE_E2E groups' specs skip
// without, and each spec caps its own spend. The plan refuses it unless every gate asked for is a LIVE_E2E group:
// `default`'s bare `pnpm e2e` collects every live spec and would run them all under those flags, and that no other
// group's spec reads them is only today's convention, MAWS_LIVE being the name a new live case most likely gates on.
// It refuses a LIVE_E2E group in a run that is not live too: design-live and dashboard-live set MAWS_LIVE in their own
// scripts and would spend, the others would build and skip (Decision Log 75). Every live run also takes the
// LIVE_GUARD_E2E groups (P4-A2, X34: the tool-time guard's heavy-case fixture), whichever live groups it names.
// `Selection: affected` (a push only; ci-gate.sh --affected): an iteration run whose unit and unit:darwin test only what
// its change, listed in the commit's `Affected:` trailers, can reach (gate-affected.mjs; ci-kit's test-history spec, M4).
// It adds `selection` and `related` (the paths for vitest related as JSON, or empty for the full suite) to the outputs
// and one line saying which to the summary; a run without the trailer writes neither. Such a run is never landing
// evidence.
// The Mac's two kinds of runner (ci-kit's mac-lane concurrency spec, M2): a Mac job asks for today's labels, which only
// ci-kit's exclusive instance carries, so it runs alone on the desktop, unless it is on MAC_SHARED_E2E, the e2e groups
// (and `unit:darwin`) a trial showed giving beside a neighbour the results they give alone; those ask for
// [ci-kit-mac-shared] alone, the label only the instances that run two jobs at a time carry. A MEASURED_E2E group, or a
// foreground one (its script sets MAWS_E2E_FOREGROUND=1), stays exclusive whatever the list says. Each kind's start may
// wait in ci-kit's job-started hook, counted against the job's timeout, which carries that bound on top of its own
// minutes (`timeouts`, and each e2e entry's `timeout`): an exclusive job MAC_EXCLUSIVE_WAIT_MINUTES for the shared
// instances to stop, a shared one MAC_SHARED_WAIT_MINUTES while an exclusive job holds the desktop.
// ci-kit's VM lane (the same spec, "The VM lane", V3): a group on MAC_VM_E2E asks for [ci-kit-mac-solo], which the
// exclusive instance and ci-kit's macOS guest, a second desktop on the Mac, both carry, so it runs on whichever is free;
// on the exclusive instance its start waits MAC_EXCLUSIVE_WAIT_MINUTES as any exclusive job's does, in the guest nowhere.
// A MEASURED_E2E group stays on today's labels whatever the list says: the guest runs 1.3-1.7x the host's time on other
// hardware, and the measured bounds are the host's. A group on both lists runs shared: beside a neighbour it leaves the
// exclusive instance alone, the scarcer of the two. `Lane:` (a push; the `lane` input on a dispatch; ci-gate.sh --lane)
// moves the run's MAC_VM_E2E groups, shared or not, to the guest alone: `vm`, [ci-kit-mac-vm], for a group's trial, a
// re-measurement, or a session that knows the host is held; `vm-trial`, [ci-kit-mac-vm-trial], the label only a candidate
// image's trial clone carries, for the commit of an image trial and nothing else.
// A job on the guest's labels (solo, vm or vm-trial) is guest-eligible, and never builds out/: the guest's 4 GB cannot run
// `electron-vite build` (the same spec, Decision Log "out/ is built on the pool"). The pool's e2e-build job builds the
// variants those jobs need at the tested sha, and each restores its own under MAWS_E2E_BUILD_REQUIRE=1
// (scripts/e2e-build.sh). So only a group whose script starts with `scripts/e2e-build.sh <harness|plain> &&` takes those
// labels; any other MAC_VM_E2E group (`default`, built by the e2e job's `pnpm build`; a group that builds nothing, or
// elsewhere) stays off them, as a measured one does. The outputs: `e2e`, every e2e job of the run (what ci-gate-alerts.mjs
// and e2e-default-specs.mjs read), each guest-eligible entry carrying its `variant`; `e2e_host` and `e2e_vm`, the e2e job's
// and the e2e-vm job's matrices, without and with a variant; `e2e_build`, the variants e2e-build builds (`[]` for none, so
// the job does not run), on `e2e_build_runner`, a pool box, for which the pool flag is set too.
// Writes the switches, the runners and the e2e matrix to the job's outputs and the set to its summary. Run from the
// checkout's root.
import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { affected } from './gate-affected.mjs';

const words = (text = '') => text.split(/[\s,]+/).filter(Boolean);
// `default` is the bare `pnpm e2e` set (after `pnpm build`, as `verify` orders them), which the e2e job narrows to the specs
// no other e2e group of the run collects (e2e-default-specs.mjs, Decision Log 60(2)); every other group is `e2e:<group>`.
const scriptOf = (group) => (group === 'default' ? 'e2e' : `e2e:${group}`);
const refuse = (message) => {
  throw new Error(message);
};

// Pure planning boundary: all workflow inputs (including its env lists and repository variables), and package scripts.
// Output values are the exact strings GitHub receives; property order preserves GITHUB_OUTPUT byte for byte.
export function planOf(env, scripts) {
  const dispatched = env.EVENT === 'workflow_dispatch';
  const trailer = (key) =>
    (env.HEAD_MESSAGE ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}:`))
      .at(-1)
      ?.slice(key.length + 1)
      .trim();

  // The shared label alone: ci-kit registers the shared instances with nothing else, so no job asking for `self-hosted`
  // (today's, an old commit's) can reach one.
  const RUNNERS = {
    linux: 'ubuntu-24.04',
    macos: ['self-hosted', 'macOS', 'ARM64'],
    macShared: ['ci-kit-mac-shared'],
    // ci-kit's VM lane: the exclusive instance or the guest; the guest alone; the guest under the trial slot's identity.
    macSolo: ['ci-kit-mac-solo'],
    macVm: ['ci-kit-mac-vm'],
    macVmTrial: ['ci-kit-mac-vm-trial'],
  };
  // ci-kit's bounds on the waits in its job-started hook; past one, the hook refuses the job with the `ci-kit: … rerun`
  // line ci-gate.sh relaunches. Added to the job's own minutes, so the refusal comes before GitHub's timeout.
  const MAC_EXCLUSIVE_WAIT_MINUTES = 10;
  const MAC_SHARED_WAIT_MINUTES = 60;
  // A solo job may land on the exclusive instance, so it carries that wait; a job that asks for the guest alone waits nowhere.
  const timeoutOn = (runner, minutes) =>
    minutes + (runner === RUNNERS.macos || runner === RUNNERS.macSolo ? MAC_EXCLUSIVE_WAIT_MINUTES : runner === RUNNERS.macShared ? MAC_SHARED_WAIT_MINUTES : 0);
  const poolBox = (cpus) => ['self-hosted', 'ci-kit-pool', `cpus-${cpus}`];
  // The guest's labels: a job asking for one of these may run in the guest.
  const GUEST = [RUNNERS.macSolo, RUNNERS.macVm, RUNNERS.macVmTrial];
  // e2e-build's box: one `electron-vite build`, which exhausted V8's default heap (about 1 GB) in the 4 GB guest (widgets);
  // the workflow's NODE_OPTIONS lifts that limit to 5 GB, which cpus-4's c3d-highcpu-4, with 8 GB, holds.
  const E2E_BUILD_BOX = poolBox(4);
  // On the pool the whole unit suite runs as UNIT_SHARDS jobs, `unit <k>/<n>`, each vitest's --shard=<k>/<n> on a box of
  // UNIT_CPUS. One vitest process keeps its box's cores only 55-70% busy (its main process transforms for every worker),
  // so more processes on more boxes end the suite sooner than more cores on one. Five or more shards, or 16-core shards,
  // turned suites red that wait on those transforms cold (TranscriptSlot's hooks under renderer-compiled); four shards of
  // eight cores did not (CI-opt's critical-path arms, 2026-10-21). A selected run that tests only the related suites, and
  // a run off the pool, is the one job `unit`.
  const UNIT_SHARDS = 4;
  const UNIT_CPUS = 8;
  const CLASS1A_RUNNERS = {
    linux: { static: RUNNERS.linux, unit: RUNNERS.linux, probes: RUNNERS.linux },
    macos: { static: RUNNERS.macos, unit: RUNNERS.macos, probes: RUNNERS.macos },
    // Each pool job is a GCE VM of its own (Decision Log 52). static runs its checks at once and needs the 16-core box's
    // 32 GB (about 15 GB at its peak); unit's box is each shard's (UNIT_SHARDS).
    pool: { static: poolBox(16), unit: poolBox(UNIT_CPUS), probes: poolBox(2) },
  };
  const gateRunner = (env.GATE_RUNNER ?? '').toLowerCase();
  const class1a = ((dispatched ? env.INPUT_CLASS1A : trailer('Class1a')) || gateRunner || 'linux').toLowerCase();
  if (!Object.hasOwn(CLASS1A_RUNNERS, class1a)) refuse(`no such class-1a runner: ${class1a} (linux, macos or pool)`);

  const lane = ((dispatched ? env.INPUT_RUNNER : trailer('Runner')) || env.GATE_E2E_RUNNER || (gateRunner === 'pool' ? '' : gateRunner) || 'linux').toLowerCase();
  if (lane !== 'linux' && lane !== 'macos') refuse(`no such runner: ${lane} (linux or macos; the pool takes class 1a and the POOL_E2E groups, through Class1a: pool)`);

  // Where `Lane:` sends the run's MAC_VM_E2E groups; none keeps them on [ci-kit-mac-solo].
  const LANES = { vm: RUNNERS.macVm, 'vm-trial': RUNNERS.macVmTrial };
  const vmLane = ((dispatched ? env.INPUT_LANE : trailer('Lane')) || '').toLowerCase();
  if (vmLane && !Object.hasOwn(LANES, vmLane)) refuse(`no such lane: ${vmLane} (vm or vm-trial, through ci-gate.sh --lane; none for the default routing)`);

  const evidence = dispatched ? env.INPUT_EVIDENCE === 'true' : trailer('Evidence')?.toLowerCase() === 'yes';
  const live = dispatched ? env.INPUT_LIVE === 'true' : trailer('Live')?.toLowerCase() === 'yes';
  const asked = dispatched ? env.INPUT_GATES : trailer('Gates');
  const defaults = ['static', 'unit', 'probes', ...(lane === 'macos' ? ['unit:darwin', ...words(env.CLASS1_E2E).filter((group) => scriptOf(group) in scripts).map((group) => `e2e:${group}`)] : [])];
  const gates = new Set(words(asked).length > 0 ? words(asked) : defaults);
  // P4-A2 (X34): a live run takes the tool-time guard's heavy-case fixture beside the live groups it names (LIVE_GUARD_E2E,
  // LIVE_E2E groups that spend nothing), so every gate that runs live specs holds the heaviest known cases under the bound.
  if (live) for (const group of words(env.LIVE_GUARD_E2E)) gates.add(`e2e:${group}`);

  const unknown = [...gates].filter((gate) => !['static', 'unit', 'unit:darwin', 'probes', 'packaged'].includes(gate) && !(gate.startsWith('e2e:') && scriptOf(gate.slice(4)) in scripts));
  if (unknown.length > 0) refuse(`no such gate: ${unknown.join(', ')} (static, unit, unit:darwin, probes, packaged, e2e:default or e2e:<group> with a package.json script)`);
  // The packaged app's e2e scripts read dist/, which only the packaged job builds.
  const packagedOnly = [...gates].filter((gate) => gate.startsWith('e2e:') && /(^|:)packaged$/.test(gate.slice(4)));
  if (packagedOnly.length > 0) refuse(`${packagedOnly.join(', ')} run inside the packaged gate, after its build: ask with Gates: packaged`);

  // A live run takes the live groups and nothing else: beside them `default` would run every live spec its bare set
  // collects. A live group runs only in a live run: two of them spend under their own scripts' flag (Decision Log 75).
  const liveGroups = words(env.LIVE_E2E).map((group) => `e2e:${group}`);
  const notLive = live ? [...gates].filter((gate) => !liveGroups.includes(gate)) : [];
  if (notLive.length > 0) refuse(`a live run takes only the live e2e groups (${liveGroups.join(', ')}), not ${words(asked).length > 0 ? notLive.join(', ') : 'the default set'}: ask with Gates: naming those alone (ci-gate.sh --live --gates e2e:<group>,…)`);
  const paid = live ? [] : [...gates].filter((gate) => liveGroups.includes(gate));
  if (paid.length > 0) refuse(`${paid.join(', ')} run only in a live run, a paid one: ask with Live: yes (ci-gate.sh --live)`);

  // A Linux lane runs only the groups §3.1's table found green there; the rest are macOS work, refused here rather than
  // scheduled to fail.
  const linux = new Set(words(env.LINUX_E2E));
  const macOnly = lane === 'linux' ? [...gates].filter((gate) => gate.startsWith('e2e:') && !linux.has(gate.slice(4))) : [];
  if (macOnly.length > 0) refuse(`${macOnly.join(', ')} run on the macOS runner (§3.1): ask with Runner: macos (ci-gate.sh --runner macos)`);

  const libreoffice = new Set(words(env.LIBREOFFICE_E2E));
  // The timing-measured groups: on a Mac their job waits first for the desktop to settle, with a longer timeout.
  const measured = new Set(words(env.MEASURED_E2E));
  // desk-web, the one POOL_E2E group, is one Playwright worker; a cpus-4 box is a c3d-highcpu-4 with 8 GB, where cpus-2's
  // e2-highcpu-2 has 2 GB for the build, two browsers and the hub double, at about the same price (Decision Log 68).
  const offMac = new Set(words(env.POOL_E2E));
  // MAC_SHARED_E2E less what never shares the desktop (the spec's "What it must not be"): a measured group, whose bounds
  // were calibrated alone, and a foreground one, whose cases test the app in front. An unknown name matches no job.
  const foreground = (group) => /(^|\s)MAWS_E2E_FOREGROUND=1\s/.test(scripts[scriptOf(group)] ?? '');
  const listedShared = words(env.MAC_SHARED_E2E);
  const keptAlone = listedShared.filter((name) => name !== 'unit:darwin' && (measured.has(name) || foreground(name)));
  const macShared = new Set(listedShared.filter((name) => !keptAlone.includes(name)));
  // The out/ variant a group's job restores in the guest: its script's leading `scripts/e2e-build.sh <variant> &&`, read as
  // e2e-default-specs.mjs reads it; undefined for a group that builds another way or not at all.
  const variantOf = (group) => /^scripts\/e2e-build\.sh (harness|plain) && /.exec((scripts[scriptOf(group)] ?? '').trim())?.[1];
  // MAC_VM_E2E less the measured groups, which keep the host's exclusive instance their bounds were calibrated on, and the
  // groups whose out/ e2e-build cannot make (unit:darwin builds none).
  const listedVm = words(env.MAC_VM_E2E);
  const keptOffVm = listedVm.filter((name) => measured.has(name));
  const unbuilt = listedVm.filter((name) => name !== 'unit:darwin' && !measured.has(name) && variantOf(name) === undefined);
  const macVm = new Set(listedVm.filter((name) => !measured.has(name) && !unbuilt.includes(name)));
  const onMac = (name) => (macVm.has(name) && vmLane ? LANES[vmLane] : macShared.has(name) ? RUNNERS.macShared : macVm.has(name) ? RUNNERS.macSolo : RUNNERS.macos);
  const placed = (group) => (!offMac.has(group) ? (lane === 'macos' ? onMac(group) : RUNNERS[lane]) : class1a === 'pool' ? poolBox(4) : RUNNERS.linux);
  const e2e = [...gates]
    .filter((gate) => gate.startsWith('e2e:'))
    .map((gate) => {
      const group = gate.slice(4);
      const where = placed(group);
      const runner = JSON.stringify(where);
      const guest = GUEST.includes(where) ? { variant: variantOf(group) } : {};
      return { group, script: scriptOf(group), slug: group.replace(/[^\w-]/g, '-'), build: group === 'default', libreoffice: libreoffice.has(group), measured: measured.has(group), runner, timeout: timeoutOn(where, measured.has(group) ? 45 : 30), ...guest };
    });
  const e2eHost = e2e.filter((entry) => entry.variant === undefined);
  const e2eVm = e2e.filter((entry) => entry.variant !== undefined);
  const e2eBuild = [...new Set(e2eVm.map((entry) => entry.variant))].sort();
  const unitDarwinRunner = onMac('unit:darwin');

  // Group names; an `e2e:` prefix, as --gates writes them, is read as the group.
  const defaultBeside = dispatched ? [] : [...new Set(words(trailer('DefaultBeside')).map((name) => name.replace(/^e2e:/, '')))].filter((group) => group !== 'default');

  const selectionAsked = dispatched ? undefined : trailer('Selection')?.toLowerCase();
  if (selectionAsked !== undefined && selectionAsked !== 'affected') refuse(`no such selection: ${selectionAsked} (affected, through ci-gate.sh --affected)`);
  const selection = selectionAsked && affected(env.HEAD_MESSAGE ?? '');

  const has = (gate) => String(gates.has(gate));
  const runners = CLASS1A_RUNNERS[class1a];
  const pool = (class1a === 'pool' && (['static', 'unit', 'probes'].some((gate) => gates.has(gate)) || e2e.some((entry) => offMac.has(entry.group)))) || e2eBuild.length > 0;
  // The unit job's matrix: its shards, each with the `--shard` value and the suffix of its JUnit artifact's name
  // (test-results-unit-<k>of<n>-<attempt>, which ci-kit's test-history collector reads as one `unit` report), or the one
  // unsharded job.
  const shards = class1a === 'pool' && !selection?.related ? UNIT_SHARDS : 1;
  const unitShards = shards > 1 ? Array.from({ length: shards }, (_, i) => ({ shard: `${i + 1}/${shards}`, slug: `-${i + 1}of${shards}` })) : [{ shard: '', slug: '' }];
  // The jobs' minutes outside the e2e matrix (whose entries carry their own): packaged is always on the exclusive instance.
  const timeouts = { static: timeoutOn(runners.static, 30), unit: timeoutOn(runners.unit, 30), probes: timeoutOn(runners.probes, 30), unit_darwin: timeoutOn(unitDarwinRunner, 30) };
  const outputs = {
    static: has('static'), unit: has('unit'), unit_darwin: has('unit:darwin'), probes: has('probes'), e2e: JSON.stringify(e2e),
    static_runner: JSON.stringify(runners.static), unit_runner: JSON.stringify(runners.unit), probes_runner: JSON.stringify(runners.probes), pool: String(pool),
    packaged: has('packaged'), evidence: String(evidence), live: String(live), default_beside: JSON.stringify(defaultBeside),
    unit_shards: JSON.stringify(unitShards), unit_darwin_runner: JSON.stringify(unitDarwinRunner), timeouts: JSON.stringify(timeouts),
    e2e_host: JSON.stringify(e2eHost), e2e_vm: JSON.stringify(e2eVm), e2e_build: JSON.stringify(e2eBuild), e2e_build_runner: JSON.stringify(E2E_BUILD_BOX),
  };
  const from = words(asked).length > 0 ? (dispatched ? 'the `gates` input' : 'the `Gates:` trailer') : 'the default (class 1a, with unit:darwin and class 1 e2e on a macOS lane)';
  const beside = defaultBeside.length > 0 ? ` Default beside: ${defaultBeside.join(', ')}.` : '';
  // The groups placed off the lane's runner: on the pool, or on the hosted Linux runner beside a macOS lane.
  const moved = e2e.filter((entry) => offMac.has(entry.group) && entry.runner !== JSON.stringify(RUNNERS[lane])).map((entry) => entry.group);
  const pooledNote = moved.length > 0 ? ` (${class1a === 'pool' ? 'on the pool' : 'on the hosted Linux runner'}: ${moved.join(', ')})` : '';
  // Said only when MAC_SHARED_E2E or MAC_VM_E2E reaches a job of this run, or names one it keeps on the exclusive instance,
  // and whenever the run has a Lane:.
  const jobsOn = (runner) => [...(gates.has('unit:darwin') && unitDarwinRunner === runner ? ['unit:darwin'] : []), ...e2e.filter((entry) => entry.runner === JSON.stringify(runner)).map((entry) => `e2e:${entry.group}`)];
  const inRun = (groups) => groups.map((group) => `e2e:${group}`).filter((gate) => gates.has(gate));
  const said = (lead, jobs) => (jobs.length > 0 ? ` ${lead}: ${jobs.join(', ')}.` : '');
  const laneJobs = vmLane ? jobsOn(LANES[vmLane]) : [];
  const laneNote = !vmLane ? '' : laneJobs.length > 0 ? said(`Lane: ${vmLane}, on [${LANES[vmLane]}] alone`, laneJobs) : ` Lane: ${vmLane}, but no job of this run is on MAC_VM_E2E.`;
  const macNote =
    said('Shared Mac instances', jobsOn(RUNNERS.macShared)) +
    said('On MAC_SHARED_E2E but measured or foreground, so alone', inRun(keptAlone)) +
    said('Solo Mac (the exclusive instance or the guest, whichever is free)', jobsOn(RUNNERS.macSolo)) +
    laneNote +
    said('On MAC_VM_E2E but measured, so on the exclusive instance', inRun(keptOffVm)) +
    said('On MAC_VM_E2E but not built through scripts/e2e-build.sh, so off the guest', lane === 'macos' ? inRun(unbuilt.filter((group) => !offMac.has(group))) : []) +
    said('Out/ built on the pool (e2e-build) for the guest-eligible jobs', e2eBuild);
  let summary = `### Gates\n\n${[...gates].map((gate) => `- \`${gate}\``).join('\n')}\n\nFrom: ${from}. Class 1a: ${class1a}. E2e lane: ${lane}${pooledNote}.${evidence ? ' Evidence: yes.' : ''}${live ? ' Live: yes (MAWS_LIVE, MAWS_LIBRARY_LIVE, MAWS_LIVE_DOCUMENT at 1).' : ''}${beside}${macNote}\n`;
  let stdout = `${[...gates].join('\n')}\nclass 1a: ${class1a}\nlane: ${lane}${pooledNote}\n${live ? 'live: yes\n' : ''}${defaultBeside.length > 0 ? `default beside: ${defaultBeside.join(' ')}\n` : ''}${macNote ? `${macNote.trim()}\n` : ''}`;
  if (selection) {
    const line = selection.related
      ? `Selection: affected — ${selection.paths} paths, unit runs vitest related`
      : `Selection: affected — full suite: ${selection.reason}`;
    outputs.selection = 'affected';
    outputs.related = selection.related ? JSON.stringify(selection.related) : '';
    summary += `\n${line}\n`;
    stdout += `${line}\n${(selection.related ?? []).map((path) => `  ${path}\n`).join('')}`;
  }
  return { outputs, summary, stdout };
}

// Importing the planner does no I/O. The workflow entry point alone reads its checkout and appends its artifacts.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
    const { outputs, summary, stdout } = planOf(process.env, scripts);
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(stdout);
  } catch (error) {
    process.stderr.write(`gate-plan: ${error.message}\n`);
    process.exitCode = 1;
  }
}
