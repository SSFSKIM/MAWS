// The gate set of one run of .github/workflows/gate.yml (docs/doperpowers/plans/2026-10-14-gate-offload.md §3.1, §3.2,
// §3.6) and the runners its jobs take. The set: a manual run's `gates` input, else the pushed commit's `Gates:` trailer
// (scripts/ci-gate.sh writes it when its caller narrows the set), else class 1a, with unit:darwin and class 1's e2e
// groups added when the e2e lane is a macOS runner. Explicit unit:darwin runs on macOS regardless of the e2e lane, and so
// does `packaged` (the unsigned app built once, then its checks; Decision Log 35), which is only ever explicit.
// Class 1a's runner (static, unit, probes): the `class1a` input or the `Class1a:` trailer (`linux`, `macos` or `pool`),
// else the repository variable GATE_RUNNER, else `linux`. `pool` is ci-kit's pool, each job in a container of its own
// size (Decision Log 35; on GCE spot VMs since Decision Log 52); `pool=true` when a job runs there (ci-kit's launcher
// starts pool VMs from the queued jobs themselves; the plan job's pool-ensure went with ci-kit's Hetzner pool).
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
// The Mac runners (ci-kit's mac-lane concurrency spec, M2): on the macOS lane a MEASURED_E2E group, a MAC_HOME_E2E group and
// every group of a live run (LIVE_E2E and LIVE_GUARD_E2E) ask for [self-hosted, macOS, ARM64, ci-kit-mac-home], the mini's
// exclusive instance alone: measured bounds were calibrated there, and only it holds the engine login and ClaudeUsage's
// relay (the EC2 Mac carries today's labels too, but neither). These stay home whatever the shared
// and VM lists or Lane: say. Other Mac jobs keep today's labels, carried by the exclusive instances, unless on MAC_SHARED_E2E,
// the e2e groups (and `unit:darwin`) a trial showed giving beside a neighbour the results they give alone; those ask for
// [ci-kit-mac-shared] alone, the label only the instances that run two jobs at a time carry. A foreground group (its script
// sets MAWS_E2E_FOREGROUND=1) stays exclusive whatever the shared list says. Each kind's start may
// wait in ci-kit's job-started hook, counted against the job's timeout, which carries that bound on top of its own
// minutes (`timeouts`, and each e2e entry's `timeout`): an exclusive job MAC_EXCLUSIVE_WAIT_MINUTES for the shared
// instances to stop, a shared one MAC_SHARED_WAIT_MINUTES while an exclusive job holds the desktop.
// ci-kit's VM lane (the same spec, "The VM lane", V3): a group on MAC_VM_E2E asks for [ci-kit-mac-solo], which the
// exclusive instance and ci-kit's macOS guest, a second desktop on the Mac, both carry, so it runs on whichever is free;
// on the exclusive instance its start waits MAC_EXCLUSIVE_WAIT_MINUTES as any exclusive job's does, in the guest nowhere.
// Measured and live groups stay on the home labels whatever the list says. The guest runs 1.3-1.7x the host's time on other
// hardware, and the measured bounds are the home Mac's. A group on both lists runs shared: beside a neighbour it leaves the
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
// GitHub's hosted Macs (ci-kit's hosted-Mac spec, docs/doperpowers/specs/2026-10-26-maws-hosted-mac-design.md, Placement):
// on a macOS lane an eligible e2e group on HOSTED_MAC_E2E is hosted: its job is a waiter on the pool's cpus-2 box
// (.github/scripts/hosted-mac.sh), which pushes the filtered tree to SSFSKIM/maws-app, waits for that group's run on a
// hosted Mac there and ends with its verdict. Eligible is none of `default` (its selection is derived from the whole run,
// which does not cross), MEASURED_E2E, LIVE_E2E or LIVE_GUARD_E2E, MAC_SECRET_E2E (a credential stays on the mini),
// MAC_HOME_E2E, POOL_E2E; a live run hosts none, nor does a Linux lane, nor a run on a reserved final ref (FINAL_LABELS). A list naming
// an ineligible group is refused. `Lane: hosted`
// hosts every eligible group of the run and names the rest in the summary; `Lane: no-hosted` hosts none; under
// `Lane: vm` or `vm-trial` a group on both lists goes to the guest. A hosted entry carries `hosted: true`, the waiter's
// box and timeout and no variant; it stays in `e2e` (default's derivation, the pool-demand hint) and makes `e2e_hosted`,
// the e2e-hosted job's matrix, and the pool flag; never `e2e_host`, `e2e_vm` or `e2e_build`.
// The peer groups (PEER_E2E; the two-build check, e2e/cross-build.spec.ts): each runs this tree's app against another
// build's supervisor on one profile, and the reverse. The other build is the commit of the `Peer:` trailer (a push only),
// which scripts/ci-gate.sh resolves (the merge base with master, unless its --peer names another) beside each tree's
// wire as its manifest records it, `Peer-Wire:` and `Wire:` (major.minor). Whenever the two are a minor apart within one
// major the plan adds the peer groups itself to a run that tests code, one whose gates hold unit (or unit:darwin) or an
// e2e group, so every WIRE_MINOR bump is checked without anyone asking, class 1a and the default set included, while a
// static or probes check stays quick; not to a live run (its live groups alone) nor a `Selection: affected` one (never
// landing evidence). gate-peer-held supplies PEER_HELD_BY when an older run holds this tree and peer's check,
// suppressing the automatic join but never an explicit request. A peer group's job fetches the
// peer's one commit and builds it beside this tree (gate.yml), so it takes the Mac's exclusive instance whatever the lane:
// never a hosted Mac (maws-app holds one filtered tree and no history to fetch a peer from), the shared instances or the
// guest. Its entry carries the `peer` sha; asked for without a Peer: trailer it has none, and its spec runs nothing.
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
// The reserved final refs' labels: a run whose ref starts `ci/<label>-` is that label's final run, where a final-bundle group
// writes the build it ran into the run's evidence (e2e/support/final-bundle.ts, which reads the ref the same way:
// GITHUB_REF or GITHUB_REF_NAME, less `refs/heads/`). The labels are the reporters' own (design's e1-final, dashboard's
// e2-final and p3f-final, connectors' h-final through MAWS_E2E_FINAL_BUNDLE), which gate-plan.test.mjs keeps equal.
// A hosted group would run on maws-app's ref and runner, so no bundle could reach the run: a final run hosts no group.
export const FINAL_LABELS = ['e1-final', 'e2-final', 'h-final', 'p3f-final'];
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
    macHome: ['self-hosted', 'macOS', 'ARM64', 'ci-kit-mac-home'],
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
    minutes + (runner === RUNNERS.macos || runner === RUNNERS.macHome || runner === RUNNERS.macSolo ? MAC_EXCLUSIVE_WAIT_MINUTES : runner === RUNNERS.macShared ? MAC_SHARED_WAIT_MINUTES : 0);
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

  // Where `Lane:` sends the run's MAC_VM_E2E groups; none keeps them on [ci-kit-mac-solo]. `hosted` and `no-hosted` move
  // the run's e2e groups onto GitHub's hosted Macs or off them, and leave the guest's routing as with no lane.
  const LANES = { vm: RUNNERS.macVm, 'vm-trial': RUNNERS.macVmTrial };
  const laneAsked = ((dispatched ? env.INPUT_LANE : trailer('Lane')) || '').toLowerCase();
  if (laneAsked && !Object.hasOwn(LANES, laneAsked) && laneAsked !== 'hosted' && laneAsked !== 'no-hosted') refuse(`no such lane: ${laneAsked} (vm, vm-trial, hosted or no-hosted, through ci-gate.sh --lane; none for the default routing)`);
  const vmLane = Object.hasOwn(LANES, laneAsked) ? laneAsked : '';

  const evidence = dispatched ? env.INPUT_EVIDENCE === 'true' : trailer('Evidence')?.toLowerCase() === 'yes';
  const live = dispatched ? env.INPUT_LIVE === 'true' : trailer('Live')?.toLowerCase() === 'yes';
  const asked = dispatched ? env.INPUT_GATES : trailer('Gates');
  const defaults = ['static', 'unit', 'probes', ...(lane === 'macos' ? ['unit:darwin', ...words(env.CLASS1_E2E).filter((group) => scriptOf(group) in scripts).map((group) => `e2e:${group}`)] : [])];
  const gates = new Set(words(asked).length > 0 ? words(asked) : defaults);
  // P4-A2 (X34): a live run takes the tool-time guard's heavy-case fixture beside the live groups it names (LIVE_GUARD_E2E,
  // LIVE_E2E groups that spend nothing), so every gate that runs live specs holds the heaviest known cases under the bound.
  if (live) for (const group of words(env.LIVE_GUARD_E2E)) gates.add(`e2e:${group}`);
  // The peer groups, and the trailers that name their peer: a full sha (it reaches the job's `git fetch`) and two wires.
  const peerGroups = new Set(words(env.PEER_E2E));
  const peer = (dispatched ? '' : trailer('Peer')) || '';
  if (peer && !/^[0-9a-f]{40}$/.test(peer)) refuse(`no such peer: ${peer} (a commit's full sha, as ci-gate.sh writes it)`);
  const wireOf = (key) => {
    const value = dispatched ? undefined : trailer(key);
    if (!value) return null;
    const [, major, minor] = /^(\d+)\.(\d+)$/.exec(value) ?? refuse(`no such wire: ${key}: ${value} (major.minor, as ci-gate.sh writes it)`);
    return { major: Number(major), minor: Number(minor), text: value };
  };
  const [treeWire, peerWire] = [wireOf('Wire'), wireOf('Peer-Wire')];
  const minorApart = peer !== '' && treeWire !== null && peerWire !== null && treeWire.major === peerWire.major && treeWire.minor !== peerWire.minor;
  const testsCode = [...gates].some((gate) => gate === 'unit' || gate === 'unit:darwin' || gate.startsWith('e2e:'));
  // Expose eligibility before deduplication to gate-peer-held: a candidate uses this same rule, including when it
  // explicitly requested a peer group. PEER_HELD_BY suppresses only additions, never a group already in Gates.
  const peerCheck = { peer, minorApart, groups: minorApart && testsCode && !live && !trailer('Selection') ? [...peerGroups].filter((group) => scriptOf(group) in scripts) : [] };
  const peerAdditions = peerCheck.groups.filter((group) => !gates.has(`e2e:${group}`));
  const heldBy = /^(\d+) (queued|in_progress|waiting|succeeded|plan (?:queued|in_progress|waiting|pending|requested))$/.exec(env.PEER_HELD_BY ?? '');
  const peerJoined = heldBy ? [] : peerAdditions;
  for (const group of peerJoined) gates.add(`e2e:${group}`);
  // The missing Mac job is replaced by a hosted-Linux verdict waiter, never by an unobserved dependency. The mini's
  // queue has reached 71 minutes before the peer job's 25-minute bound; leave both room within the hosted job's limit.
  const peerWait = heldBy ? peerAdditions.map((group) => ({ group, run: heldBy[1], timeout: 180, wait: 175 })) : [];

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
  const macOnly = lane === 'linux' ? [...gates].filter((gate) => gate.startsWith('e2e:') && !linux.has(gate.slice(4)) && !peerGroups.has(gate.slice(4))) : [];
  if (macOnly.length > 0) refuse(`${macOnly.join(', ')} run on the macOS runner (§3.1): ask with Runner: macos (ci-gate.sh --runner macos)`);

  const libreoffice = new Set(words(env.LIBREOFFICE_E2E));
  const poppler = new Set(words(env.POPPLER_E2E));
  // The timing-measured groups: on a Mac their job waits first for the desktop to settle, with a longer timeout.
  const measured = new Set(words(env.MEASURED_E2E));
  // The groups that need what only the mini's exclusive instance has (ClaudeUsage's relay): the home Mac on a macOS lane.
  const home = new Set(words(env.MAC_HOME_E2E));
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
  const placed = (group) => (peerGroups.has(group) ? RUNNERS.macos : lane === 'macos' && (measured.has(group) || home.has(group) || live) ? RUNNERS.macHome : !offMac.has(group) ? (lane === 'macos' ? onMac(group) : RUNNERS[lane]) : class1a === 'pool' ? poolBox(4) : RUNNERS.linux);
  // The hosted Macs. Why a group never goes there, if it never does: its selection is the whole run's (`default`), its
  // bounds the mini's (measured), it spends (live), it needs a credential (secret), it needs the mini (home), or it never
  // takes a Mac (pool).
  const secret = new Set(words(env.MAC_SECRET_E2E));
  const liveOnes = new Set([...words(env.LIVE_E2E), ...words(env.LIVE_GUARD_E2E)]);
  const notHosted = (group) =>
    [group === 'default' && 'default', measured.has(group) && 'measured', liveOnes.has(group) && 'live', secret.has(group) && 'secret', home.has(group) && 'home', offMac.has(group) && 'pool', peerGroups.has(group) && 'peer'].filter(Boolean);
  const named = (groups, prefix = '') => groups.map((group) => `${prefix}${group} (${notHosted(group).join(', ')})`).join(', ');
  const listedHosted = words(env.HOSTED_MAC_E2E);
  const contradictions = listedHosted.filter((group) => notHosted(group).length > 0);
  if (contradictions.length > 0) refuse(`HOSTED_MAC_E2E names what never goes to a hosted Mac: ${named(contradictions)}`);
  const hostable = (group) =>
    lane === 'macos' && !live && notHosted(group).length === 0 &&
    (laneAsked === 'hosted' || (laneAsked !== 'no-hosted' && listedHosted.includes(group) && !(vmLane && listedVm.includes(group))));
  const finalRef = [env.GITHUB_REF, env.GITHUB_REF_NAME]
    .map((value) => value?.replace(/^refs\/heads\//, ''))
    .find((ref) => ref !== undefined && FINAL_LABELS.some((label) => ref.startsWith(`ci/${label}-`)));
  const hostedOf = (group) => finalRef === undefined && hostable(group);
  // The waiter: the pool's smallest box, about $0.0006 a minute while it waits. Its timeout is above the waiter's own
  // 95-minute deadline and under the pool's 120-minute bound on a box's run.
  const HOSTED_WAITER = poolBox(2);
  const HOSTED_TIMEOUT_MINUTES = 100;
  // A peer group's minutes: the peer's fetch, install and build, this tree's build and the spec's two crossings, which
  // took 3 min 22 s on the mini (run 40495960740: the peer 47 s, this tree's build 40 s, the crossings 1.4 min), four
  // times over for a cold store or a slow Mac.
  const PEER_MINUTES = 15;
  const e2e = [...gates]
    .filter((gate) => gate.startsWith('e2e:'))
    .map((gate) => {
      const group = gate.slice(4);
      const hosted = hostedOf(group);
      const where = hosted ? HOSTED_WAITER : placed(group);
      const runner = JSON.stringify(where);
      const guest = GUEST.includes(where) ? { variant: variantOf(group) } : {};
      const timeout = hosted ? HOSTED_TIMEOUT_MINUTES : timeoutOn(where, measured.has(group) ? 45 : peerGroups.has(group) ? PEER_MINUTES : 30);
      return { group, script: scriptOf(group), slug: group.replace(/[^\w-]/g, '-'), build: group === 'default', libreoffice: libreoffice.has(group), poppler: poppler.has(group), measured: measured.has(group), ...(hosted && { hosted }), runner, timeout, ...guest, ...(peerGroups.has(group) && peer && { peer }) };
    });
  const e2eHosted = e2e.filter((entry) => entry.hosted);
  const e2eHost = e2e.filter((entry) => entry.variant === undefined && !entry.hosted);
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
  const pool = (class1a === 'pool' && (['static', 'unit', 'probes'].some((gate) => gates.has(gate)) || e2e.some((entry) => offMac.has(entry.group)))) || e2eBuild.length > 0 || e2eHosted.length > 0;
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
    e2e_hosted: JSON.stringify(e2eHosted), peer_wait: JSON.stringify(peerWait),
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
  // The hosted groups, and what a hosted lane left where it was.
  const keptOffHosted = laneAsked === 'hosted' && lane === 'macos' && finalRef === undefined ? e2e.map((entry) => entry.group).filter((group) => notHosted(group).length > 0) : [];
  const keptForFinal = finalRef !== undefined && e2e.some((entry) => hostable(entry.group));
  const hostedNote =
    (keptForFinal ? ` On the reserved final ref ${finalRef}, so no group of this run is hosted: a group's final bundle is written only on the runner that ran it.` : '') +
    said('Hosted Mac (SSFSKIM/maws-app, each through a waiter on the pool)', e2eHosted.map((entry) => `e2e:${entry.group}`)) +
    (keptOffHosted.length > 0 ? ` Lane: hosted, but never on a hosted Mac, so where it would be: ${named(keptOffHosted, 'e2e:')}.` : '') +
    (laneAsked === 'hosted' && e2eHosted.length === 0 && keptOffHosted.length === 0 && !keptForFinal ? ' Lane: hosted, but no e2e group of this run is hosted.' : '') +
    (laneAsked === 'no-hosted' ? ' Lane: no-hosted, so no group of this run is hosted.' : '');
  const laneNote = !vmLane ? '' : laneJobs.length > 0 ? said(`Lane: ${vmLane}, on [${LANES[vmLane]}] alone`, laneJobs) : ` Lane: ${vmLane}, but no job of this run is on MAC_VM_E2E.`;
  const macNote =
    said('Home Mac', jobsOn(RUNNERS.macHome)) +
    said('Shared Mac instances', jobsOn(RUNNERS.macShared)) +
    said('On MAC_SHARED_E2E but measured or foreground, so alone', inRun(keptAlone)) +
    said('Solo Mac (the exclusive instance or the guest, whichever is free)', jobsOn(RUNNERS.macSolo)) +
    laneNote +
    said('On MAC_VM_E2E but measured, so on the exclusive instance', inRun(keptOffVm)) +
    said('On MAC_VM_E2E but not built through scripts/e2e-build.sh, so off the guest', lane === 'macos' ? inRun(unbuilt.filter((group) => !offMac.has(group))) : []) +
    said('Out/ built on the pool (e2e-build) for the guest-eligible jobs', e2eBuild) +
    hostedNote;
  // The peer, when a trailer names one, and the groups its minor brought in.
  const peerLine = peer === '' ? '' : `Peer: ${peer.slice(0, 8)}${peerWire ? `, wire ${peerWire.text}` : ''}${treeWire ? `; this tree's ${treeWire.text}` : ''}${minorApart ? ', a minor apart' : ''}${heldBy && peerAdditions.length > 0 ? `; ${peerAdditions.map((group) => `e2e:${group}`).join(', ')} ${peerAdditions.length === 1 ? 'is' : 'are'} checked in run ${heldBy[1]} (${heldBy[2]}), so not here` : peerJoined.length > 0 ? `, so ${peerJoined.map((group) => `e2e:${group}`).join(', ')} joined` : minorApart && !testsCode ? ', but the peer groups join only a run with unit or an e2e group' : ''}.`;
  const peerWaitLine = peerWait.length > 0 ? 'The peer verdict is awaited on hosted Linux; this run fails if its holder does not pass the check.' : '';
  let summary = `### Gates\n\n${[...gates].map((gate) => `- \`${gate}\``).join('\n')}\n\nFrom: ${from}. Class 1a: ${class1a}. E2e lane: ${lane}${pooledNote}.${evidence ? ' Evidence: yes.' : ''}${live ? ' Live: yes (MAWS_LIVE, MAWS_LIBRARY_LIVE, MAWS_LIVE_DOCUMENT at 1).' : ''}${beside}${macNote}${peerLine && ` ${peerLine}`}\n`;
  let stdout = `${[...gates].join('\n')}\nclass 1a: ${class1a}\nlane: ${lane}${pooledNote}\n${live ? 'live: yes\n' : ''}${defaultBeside.length > 0 ? `default beside: ${defaultBeside.join(' ')}\n` : ''}${macNote ? `${macNote.trim()}\n` : ''}${peerLine && `${peerLine}\n`}`;
  if (peerWaitLine) {
    summary += `\n${peerWaitLine}\n`;
    stdout += `${peerWaitLine}\n`;
  }
  if (selection) {
    const line = selection.related
      ? `Selection: affected — ${selection.paths} paths, unit runs vitest related`
      : `Selection: affected — full suite: ${selection.reason}`;
    outputs.selection = 'affected';
    outputs.related = selection.related ? JSON.stringify(selection.related) : '';
    summary += `\n${line}\n`;
    stdout += `${line}\n${(selection.related ?? []).map((path) => `  ${path}\n`).join('')}`;
  }
  return { outputs, summary, stdout, peerCheck };
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
