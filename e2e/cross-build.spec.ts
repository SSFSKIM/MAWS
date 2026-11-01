// The two-build cross-minor check (P5 OX1: O1's execution document, M6 and its residue 11; docs/tech-debt-tracker.md's
// row "No real two-build check exists"; O6's residue 38): this checkout's built app against another build's supervisor
// on one profile, and the other build's app against this one's. The other build is the peer the gate checked out and
// built beside this checkout (MAWS_E2E_PEER_ROOT: its root, with its own out/ and node_modules; gate.yml's PEER_E2E and
// the `Peer:` trailer scripts/ci-gate.sh writes, the merge base with master unless `--peer` names another). Without a
// peer the group runs nothing. Of the two builds the older is the one of the lower WIRE_MINOR (on a tie, the peer).
//   (update)    the older app starts a kept session and quits with keep; the newer app attaches to its supervisor;
//   (downgrade) the newer app keeps the session; the older one attaches.
// In each, the attaching app's hello crosses the minor (host.log names the app's wire, the app's main the supervisor's),
// the app is served as another build (`matches: 'build'`, the update banner, exit-when-idle armed), the kept session's
// tail reaches its main (the background failure journaled while no app ran raises the Needs-you item only main's live
// derivation raises; the request raised while away is pending, its answer is played on and its rows arrive live), a
// launch on the kept supervisor plays a turn, and once every session there is idle the kept supervisor exits by itself
// and the app moves to a supervisor of its own build, which serves a launch too.
// Across the gap, OX1's negotiation (src/shared/ipc/wire.ts): a peer that lacks a command answers `unknown_command`,
// and one that lacks an event or an object key drops it (the tolerant reader, logged once), refusing nothing else a
// peer of its major sends. So in the update a command the newer build added that the engine host serves answers
// `unknown_command` from the older supervisor and is served once the app has moved, and one main serves answers alike
// whichever supervisor is attached; in both directions neither end logs a refusal of what the other sent. The older app
// cannot name a command it lacks: its preload bridges only its own registry.
// P5 O3-D M6, the probe's rule for `machine`-owned commands (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §J): since O3-D the spine's commands are `machine`'s, served under the `host` binding by the daemon on the
// daemon shape and by main on the embedded one. In every scene here the attacher's own build serves them, its own
// `mawsd` (this build's on the daemon shape: the keeper's never serves the attacher) or its own main, so their two
// probes compare equal as main's do. A scene whose daemon were not the attacher's build (none today) would compare that
// older daemon's `unknown_command` with the own daemon's answer, as the `engine-host` rule does (`servedByAttacher`).
// The `(pre-O3 app, daemon)` scene asserts the refusal, not a probe.
// P5 O2 M8 (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md, M9's two-build check, "this branch's mawsd against that
// build's engine host"): the same crossing with this build on the daemon shape (MAWS_HOST_MODE=daemon), whose private
// `mawsd` is the engine host's client, the peer on the embedded shape's detached supervisor, which every build since
// E10 has and a build before O2 is limited to:
//   (update, daemon)    the peer's app keeps a session on its own supervisor; this build's app attaches on the daemon
//                       shape: its `mawsd` connects to the peer's engine host across the minor, which it serves until
//                       idle (exit-when-idle armed, as E10's replace policy), relays it to the app, and then starts an
//                       engine host of its own build, the same `mawsd` serving both;
//   (downgrade, daemon) this build's app keeps a session under its `mawsd`; the peer's app, launched on the embedded
//                       shape, attaches to that engine host directly, is served as another build and moves to a
//                       supervisor of its own. A peer at or past O2 (wire minor 5) ends `mawsd` as it leaves the daemon
//                       shape, before its hosts start (O3 Decision Log 11 (14)); one before O2 would take the engine
//                       host from `mawsd`, which would exit 0 (residue 38). P5 O3-D M6: the peer's app never says hello
//                       to this build's `mawsd`, so the relay's refusal of an app without `machine.spine` (Interfaces
//                       §L) is not met here; `mawsd`'s exit releases its spine and `spine.lock`, so the peer's own spine
//                       runs alone: one writer, the lock the peer's main's (a peer from O3-A on) or none (a peer before
//                       it, which knows no lock).
// P5 O3-D M6 (acceptance 9; the M6 section's last decision): in `(update, daemon)` the kept engine host is the peer's, a
// build before O3-D whose welcome lists no `host.attachment` while O3-D is not on master. To such a host `mawsd` keeps
// O2's connection per app attachment, so the scene quits this build's app mid-turn and reattaches it while the kept
// host serves: `mawsd`'s link to it is recycled at the departure and at the reattach and is never told the attachment,
// the turn's end, journaled while no app ran, reaches the reattached app and the spine's digest, and its error item is
// still one. Once the kept host is replaced at idle by one of this build, a quit and a reattach cross no new connection:
// the permanent client. A peer whose host lists the capability gets the permanent connection from the start, and the
// pre-O3 peer's run (`--peer <O2-era sha>`) keeps the recycle's checks. What acceptance 9 also names, a bridge request,
// a hold and a remote subscription outstanding at the quit, is not driven here: see the M6 report's residue.
//   (pre-O3 app, daemon) acceptance 11's second half: this build's app leaves its `mawsd` running the spine on a
//                       post-D profile; an O2-era peer's app (before O3-A: no `spine.lock`, no `machine.spine`) is
//                       launched on the daemon shape. It is refused at the relay, `mawsd` yields its spine to it, the
//                       old app finds the index unavailable, and no spine file changes after the yield while it idles.
//                       Run only with such a peer (`--peer <O2-era master sha>`); skipped otherwise.
// P5 O5 M2 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, acceptance 10's artifact page): in (update, daemon) this
// build's app loads an artifact page made in the kept engine host, the peer's: through its own `mawsd`'s artifact
// endpoint when that `mawsd`'s welcome lists `machine.artifacts`, which resolves the URL through the peer's engine host
// (`artifacts.content`, unchanged since P3-A), through main's own handler when it lists it not. A newer app held on an
// older `mawsd` is not staged: the app's build check restarts a private `mawsd` of another build at its first status
// read (src/main/hosts/daemon.ts, watchDaemon), so it serves the app only until then; main reads the welcome at each
// request (src/main/artifacts/index.ts), and its unit test holds that choice.
// P5 O5 M4 (acceptance 10, both directions of the render service): an app of one build on a `mawsd` of the other. A
// private `mawsd` of another build would be restarted by the app's build check at its first status read, so each scene
// runs the other build's `mawsd` as the profile's LaunchAgent (./support/unit-daemon.ts), which the check leaves as it
// is; they load a LaunchAgent, so they run in CI alone, and the gate job sweeps the label prefix at its end.
//   (update, render)    this build's app on the peer's unit `mawsd`, whose welcome lists no `machine.render`: main keeps
//                       today's capture and export services, so an artifact page loads through main's handler, main's
//                       capture renders it, and `artifacts.export`, machine-owned now, is answered in main (the router's
//                       fallback) for the library's Export and with Send to's `dialect`, the peer's `mawsd` rendering
//                       nothing;
//   (downgrade, render) the peer's app on this build's unit `mawsd`: the peer's library Export stays its main's, and the
//                       unit's render seam renders beside it (a capture through `daemon.e2eRender` from a bare
//                       machine.sock client, the render host started by the unit's `mawsd`).
// A session's `artifact_screenshot` and `artifact_export` through either pair is not driven: the unit and render-seam
// unit tests (src/mawsd/daemon-render.test.ts) hold that a post-O5 `mawsd` takes the engine host's requests and posts
// them to no client, and that an older one's are answered by main's listeners (src/main/artifacts/index.ts).
// P5 O4 M4 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, acceptance 10; D11, D31): route D's sealed grants and
// the connectors left the app for `mawsd` at O4, so a post-O4 `mawsd` refuses the hello of an app whose capabilities
// list `machine.spine` but not `machine.connectors`, on each of its sockets (OX1's exception; D45 for pty-host.sock):
//   (pre-O4 app, daemon) this build's app leaves its `mawsd` running, idle, over a grant it adopted; the peer's app,
//                       from O3-D to before O4 (it lists `machine.spine`, not `machine.connectors`), is launched on the
//                       daemon shape over it. Its three sockets refuse it, naming `machine.connectors`; the refusal says
//                       a session is live (D45), so it shows the update banner; and `mawsd` still exits once idle. What
//                       its build check does, whether a Connectors sheet is reachable in it (D11's residual: a Forget it
//                       could still make by hand), and what follows the idle exit are recorded. Run with
//                       such a peer (the merge-base peer until O4 lands); skipped for an O2-era peer, which the
//                       (pre-O3 app, daemon) scene covers, and for a peer that lists `machine.connectors`.
//   (downgrade, daemon) also carries a grant as a pre-O4 build kept it (format 1, sealed by this build's own
//                       safeStorage under the mock keychain), which the keeper's launch adopts (format 2) before the peer
//                       launches; a pre-O4 peer's sheet lists it as an unreadable row (D11: a downgrade's residual).
//   (update, daemon)    also proves acceptance 3's old-host rule at app level. Both ends' logs say which engine host was
//                       told the connectors are its client's (`host.connectors`): the kept older host's welcome lists it
//                       not, the host of this build lists it. And at each of acceptance 9's two quits, while no app
//                       runs, an agent's dataset refresh is asked through the serving host's dashboard seam: the kept
//                       older host settles it `noClient` (O3-D's rule, the app's attachment), the host that replaced it
//                       at idle hands it to `mawsd`, whose connectors answer it with no app.
// P5 O16 M3c (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3; D9, D11; acceptance 1): every crossing branches on
// `host.holder`. Where both builds list it, the kept engine host is asked to hand over as soon as the other build's
// client (its main, or its `mawsd`) is welcomed: the kept session, on the stub engine under a session host (a replay
// launch survives no handover), is adopted at once by a host of the attacher's build, which serves the app from then on,
// with no banner and no wait for idle (handedOverCrossing). Where either does not (the merge-base peer at O16's landing),
// O3-D's crossing above stands; the first landing after O16 that bumps WIRE_MINOR runs the handover's branch against
// O16's merge as the peer.
// Run by `pnpm e2e:cross-build` (MAWS_CROSS_BUILD_E2E=1), which the gate adds to a run whose tree and peer differ in
// WIRE_MINOR (.github/scripts/gate-plan.mjs).
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostStatus } from '@shared/ipc/schema/host';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { classifyWireChange, type WireManifest } from '@shared/ipc/wire';
import { daemonPaths } from '@shared/daemon/files';
import { CONNECTORS_CAPABILITY, CONNECTORS_CLIENT_CAPABILITY, HOLDER_CAPABILITY, MACHINE_SPINE_CAPABILITY } from '@shared/host/socket-protocol';
import { DEFAULT_IDLE_EXIT_MS } from '../src/mawsd/clocks';
import { reachMachine } from '../src/mawsd/machine-client';
import { invoke, replaySpec, turnsJournal, value } from './support/c7-replay';
import { AgentSeam } from './support/dashboards';
import { DATASET, readDataset, SOURCE, writeBoard } from './support/live-data';
import { readSealedText } from './support/connector-direct-checks';
import { expectMockCustody } from './support/connector-direct-oauth';
import { placeholderGrantText, sealWithAppSafeStorage, writeLegacySealed } from './support/connector-oauth';
import { ciRefusal, e2eLabel, runIdOf } from './support/daemon-unit-guard.mjs';
import { installUnitDaemon, type UnitDaemon } from './support/unit-daemon';
import { REPO_ROOT } from './support/launch';
import { answerOf, fitTo, refusedSample, sampleOf, samplesFor, type ProbeAnswer } from './support/cross-build-samples';
import { endProfileProcesses, isAlive } from './support/processes';
import { spineFiles, spineFilesOpen } from '../test/support/spine-files';
import { adoptedOf, attentionOf, eventsOf, isRequestRow, isTaskFailureRow, pendingPermissions, PERMISSION, PROMPT, statusOf, suffix, tailFixture, TASK_FAILED, withScratch, type Run, type Scratch } from './support/supervisor-scratch';
import { stubSpec } from './support/stub-engine'; // P5 O16 M3c

const PEER = process.env.MAWS_E2E_PEER_ROOT || null;
test.skip(process.env.MAWS_CROSS_BUILD_E2E !== '1', 'the two-build check runs under pnpm e2e:cross-build (MAWS_CROSS_BUILD_E2E=1)');
test.skip(PEER === null, 'no peer build beside this checkout (MAWS_E2E_PEER_ROOT): the gate builds one for a run whose Peer: trailer names it');

const ROW_MS = '250'; // the kept turn: about 11 s from the prompt to the request, 10 s from the answer to the result
const IDLE_MS = 10_000; // the attaching app's idle time: its sessions on the kept supervisor are released this long after they idle
// P5 O3-D M6 fix round 1 (item 6): on the daemon shape the kept turn ends while no app runs and the app reattaches after
// it, so the kept supervisor must stay that long: its released session would let it exit before the reattach
const REATTACH_IDLE_MS = 30_000;
// P5 O3-D M6: the ceiling on the yield's refusal-to-release, set from its first measured run (cross-build --peer 0c94ece9b,
// run 41036338153, a hosted macos-26: refusal → released 10 ms, the old app's launch → released 967 ms). The refusal and
// the yield are the hello's own synchronous check (spine.lock read, the pid's liveness and start), and an idle spine's
// release is its stores' close (the index's WAL checkpoint, milliseconds); the scene's spine is idle, so a release that
// waited on work in flight (the product's own bound, SPINE_TIMING.yieldSettleMs, 60 s) would itself be the finding.
// 5 s is 500 times the reading, a margin for a loaded Mac's checkpoint and log writes.
const REFUSAL_TO_RELEASE_MS = 5_000;

// ---- the two builds ---------------------------------------------------------------------------------------------------

interface Build {
  label: string;
  root: string | undefined; // launch.ts's `root`: undefined for this checkout
  manifest: WireManifest; // its src/shared/ipc/wire-manifest.json, which its wire.test.ts holds its code to
  mainOnly: Set<string>; // the commands its windows cannot send: its preload bridges only the others
}
const wireOf = (build: Build) => `${build.manifest.major}.${build.manifest.minor}`;
type CommandEntry = { owner: string; input: unknown };
const commandOf = (build: Build, name: string) => build.manifest.entries[`commands.${name}`] as CommandEntry | undefined;

function buildAt(root: string, label: string): Build {
  const path = join(root, 'src/shared/ipc/wire-manifest.json');
  if (!existsSync(path)) throw new Error(`${label} at ${root} has no ${path}: a build before protocol 3 has no minor to cross`);
  return { label, root: root === REPO_ROOT ? undefined : root, manifest: JSON.parse(readFileSync(path, 'utf8')) as WireManifest, mainOnly: mainOnlyOf(root) };
}

// Every `mainOnlyCommands` list of a build's src/shared/ipc/names/*.ts (its schema.ts pins them, with the bridged lists,
// to its registry's keys), read from its source with the comments dropped.
function mainOnlyOf(root: string): Set<string> {
  const dir = join(root, 'src/shared/ipc/names');
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [, list] of source.matchAll(/mainOnlyCommands\s*=\s*\[([^\]]*)\]/g)) for (const [, name] of list!.matchAll(/'([^']+)'/g)) names.add(name!);
  }
  if (!names.has('host.configure')) throw new Error(`${dir} names no main-only command the check can read (host.configure is one)`);
  return names;
}

function builds(): { older: Build; newer: Build; here: Build; peer: Build } {
  const here = buildAt(REPO_ROOT, 'this build');
  const peer = buildAt(PEER!, 'the peer');
  expect(peer.manifest.major, `the peer speaks wire ${wireOf(peer)} and this build ${wireOf(here)}: the group checks two builds of one major`).toBe(here.manifest.major);
  const [older, newer] = here.manifest.minor < peer.manifest.minor ? [here, peer] : [peer, here];
  // OX1's rule between the two, as between two minors: within a major nothing may change but additively (a JSON Schema
  // rendering rebased after a zod upgrade reads as breaking here too; such a pair is not one this check can vouch for)
  expect(classifyWireChange(older.manifest, newer.manifest).breaking, `${older.label} (wire ${wireOf(older)}) to ${newer.label} (wire ${wireOf(newer)})`).toEqual([]);
  return { older, newer, here, peer };
}

// ---- the samples (./support/cross-build-samples.ts) ------------------------------------------------------------------

const inputsOf = (s: Scratch) => samplesFor(s.userData);

// ---- one crossing -----------------------------------------------------------------------------------------------------

type Answer = ProbeAnswer;

// Each command `newer` added that its windows can send, invoked from one of `newer`'s app with its sample input.
async function probe(page: Page, newer: Build, older: Build, inputs: Record<string, unknown>): Promise<Map<string, Answer>> {
  const answers = new Map<string, Answer>();
  for (const name of addedCommands(newer, older).filter((name) => !newer.mainOnly.has(name))) {
    const input = name in inputs ? inputs[name] : sampleOf(commandOf(newer, name)!.input);
    answers.set(name, answerOf(await page.evaluate(([n, i]) => window.maws.invoke(n as never, i as never), [name, input] as const), input));
  }
  return answers;
}
const addedCommands = (newer: Build, older: Build) =>
  Object.keys(newer.manifest.entries).filter((key) => key.startsWith('commands.') && !(key in older.manifest.entries)).map((key) => key.slice('commands.'.length));

// A launch from this checkout's defaults, fitted to the build whose app receives it.
async function launchOn(build: Build, page: Page, id: string, replay: string, s: Scratch): Promise<void> {
  const input = fitTo(commandOf(build, 'session.launch')!.input, { spec: replaySpec(id, replay, { cwd: s.repo }) });
  expect(value(await invoke(page, 'session.launch', input as CommandInput<'session.launch'>))).toMatchObject({ status: 'launching' });
  await expect.poll(async () => value(await invoke(page, 'session.status', { appSessionId: id as AppSessionId })).process).toBe('ready');
}
const turnEnded = (page: Page, id: AppSessionId, timeout = 60_000) =>
  expect.poll(async () => (await statusOf(page, id)).turn === null && (await eventsOf(page, id)).some((e) => e.kind === 'turn.ended'), { timeout, message: 'the turn has ended' }).toBe(true);
const banner = (page: Page, text: string) => page.locator('[data-banner-host]').getByRole('status').filter({ hasText: text });

// What a receiver logs when it refuses what the other build sent (src/main/hosts/supervisor.ts; src/shared/host/runtime.ts
// and socket-server.ts). A key or an event a build lacks is dropped and logged as such (DROPPED), which is no refusal.
// A handler's own output its registry refuses is logged too (`produced an invalid output`): a wire fault either way.
const MAIN_REFUSES = /\[hosts\] (?:dropped a malformed message from engine-host|dropped engine-host's invalid |engine-host answered \S+ with an invalid output|dropped engine-host's response to unknown request)|\[ipc\] \S+ produced an invalid output/;
const HOST_REFUSES = /dropped a malformed message from main|closed the client: |closed a connection: |refused to emit |\[host\] \S+ produced an invalid output/;
const DROPPED = /dropped \S+ from .*, a field this build does not know|dropped engine-host's event \S+: not in this build's event registry/;

// The shape each app runs on: the embedded shape's detached supervisor, or the daemon shape (P5 O2), whose `mawsd` is
// the engine host's client and relays it to the app.
type Shape = 'detached' | 'daemon';
interface Shapes { keeper: Shape; attacher: Shape }
const DAEMON_SHAPE_MINOR = 5; // P5 O2's wire minor: a build at or past it knows the daemon shape, and leaves it on purpose
const EMBEDDED: Shapes = { keeper: 'detached', attacher: 'detached' };
const onShape = (shape: Shape) => (st: HostStatus) => shape === 'detached' || st.daemon !== null; // the daemon shape's main also knows its mawsd
// P5 O3-D M6: whether a build's engine host serves `host.attachment` (its manifest's capabilities, the union its peers
// list), so a post-D `mawsd` keeps one permanent connection to it rather than O2's per attachment
const hostsAttachment = (build: Build) => build.manifest.capabilities.includes('host.attachment');
// P5 O4 M4: whether a build's engine host keys connector operations and dataset refreshes on a client that lists
// `host.connectors` (Interfaces §D), and whether its app lists `machine.connectors` (an app from O4 on, which obeys
// `mawsd` as the connectors' owner and reads the sealed store's format 2)
const hostsConnectors = (build: Build) => build.manifest.capabilities.includes(CONNECTORS_CAPABILITY);
// P5 O16 M3c: whether a build's engine host hands its sessions over and its clients ask it to (`host.holder`, on the
// engine host's welcome and on the app's and `mawsd`'s hellos alike); a crossing hands over only where both builds do
const holds = (build: Build) => build.manifest.capabilities.includes(HOLDER_CAPABILITY);
const appObeysConnectors = (build: Build) => build.manifest.capabilities.includes(CONNECTORS_CLIENT_CAPABILITY);
// P5 O3-D M6: whether a build's app takes `spine.lock` (O3-A on): one before it runs its spine with no lock at all
const takesSpineLock = (build: Build) => ['src/main/settings/spine-lock.ts', 'src/services/settings/spine-lock.ts'].some((file) => existsSync(join(build.root ?? REPO_ROOT, file)));
// The profile's spine.lock as takeLock writes it, or null when no process holds it
function spineLockOf(userData: string): { pid: number; buildId: string } | null {
  try {
    return JSON.parse(readFileSync(join(userData, 'spine.lock'), 'utf8')) as { pid: number; buildId: string };
  } catch {
    return null;
  }
}
// P5 O3-D M6 (Interfaces §J): who serves a command of `owner` to the attaching app in every scene here: the attacher's
// own build for `main` and `machine` (its main, or its own mawsd on the daemon shape), the attached supervisor for
// `engine-host`. A `machine` command served by a daemon of the other build would take the `engine-host` rule.
const servedByAttacher = (owner: string) => owner !== 'engine-host';
// The connections a supervisor's log shows from one client (a `mawsd`'s pid, as its hello's appPid), counted
const connectsFrom = (log: string, appPid: number) => (log.match(new RegExp(`client connected: appPid ${appPid} `, 'g')) ?? []).length;
// The departures a supervisor's log shows: `client disconnected`, which the socket server of every build from E10 on
// prints when a welcomed client's connection closes (src/shared/host/socket-server.ts, at the O2-era peer 0c94ece9b, the
// merge-base peer and this tree alike), so an older host's own word that its client left
const departuresIn = (log: string) => (log.match(/client disconnected/g) ?? []).length;
// What `mawsd`'s own log says of its link to an engine host (P5 O3-D M6 fix round 1): the capabilities the host's
// latest welcome listed (the transport's `connected to supervisor pid … capabilities […]`, from which `mawsd` chooses
// its permanent link or O2's recycle at each welcome), and the recycles it made (`recycling the connection to pid …`)
function welcomedWith(daemonLog: string, hostPid: number): string[] | null {
  const line = daemonLog.split('\n').filter((l) => l.includes(`connected to supervisor pid ${hostPid} build `)).at(-1);
  const listed = line === undefined ? null : /capabilities \[([^\]]*)\]/.exec(line);
  return listed ? listed[1]!.split(', ').filter(Boolean) : null;
}
const recyclesTo = (daemonLog: string, hostPid: number) => daemonLog.split('\n').filter((l) => l.includes(`recycling the connection to pid ${hostPid}`)).length;

// P5 O4 M4: what a scene adds to a crossing, each answering the lines it records: `keeperReady`, once the keeper's app
// is on its own supervisor, before its session; `attacherMoved`, at the end, the attacher on a supervisor of its build;
// on the daemon attacher's two reattaches (acceptance 9), while no app runs: `awayOnKept`, the kept older engine host
// serving, `awayOnOwn`, the engine host of the attacher's build serving. `env`, added to every launch's.
interface CrossingSteps {
  env?: Record<string, string>;
  keeperReady?(run: Run): Promise<string[]>;
  awayOnKept?(): Promise<string[]>;
  awayOnOwn?(): Promise<string[]>;
  attacherMoved?(run: Run): Promise<string[]>;
}

async function crossing(s: Scratch, keeper: Build, attacher: Build, gap: { newer: Build; older: Build } | null, shapes: Shapes = EMBEDDED, steps: CrossingSteps = {}): Promise<string[]> {
  if (holds(keeper) && holds(attacher)) return handedOverCrossing(s, keeper, attacher, shapes, steps); // P5 O16 M3c
  const shapeOf = (shape: Shape) => (shape === 'daemon' ? ' on the daemon shape' : '');
  const said: string[] = [`${keeper.label} (wire ${wireOf(keeper)})${shapeOf(shapes.keeper)} keeps a session; ${attacher.label} (wire ${wireOf(attacher)})${shapeOf(shapes.attacher)} attaches`];

  // the keeper: a paced replay kept across a quit, its background failure and its request still ahead
  const first = await s.launch({ MAWS_HOST_MODE: shapes.keeper, MAWS_E2E_QUIT_ANSWER: 'keep', MAWS_E2E_REPLAY_ROW_MS: ROW_MS, ...steps.env }, keeper.root);
  const own = await s.ready(first.page, onShape(shapes.keeper));
  expect(own, `${keeper.label} on its own supervisor`).toMatchObject({ matches: 'same', supervisor: { buildId: own.appBuildId } });
  const kept = own.supervisor!;
  const keeperDaemon = shapes.keeper === 'daemon' ? own.daemon!.pid : null;
  if (steps.keeperReady) said.push(...(await steps.keeperReady(first)));
  const id = await s.record(first.page);
  const fixture = tailFixture(s.root);
  await launchOn(keeper, first.page, id, fixture, s);
  value(await invoke(first.page, 'session.send', { appSessionId: id, content: PROMPT }));
  await expect.poll(async () => (await eventsOf(first.page, id)).length, { message: 'a few rows have streamed' }).toBeGreaterThan(5);
  expect(first.maws.consoleErrors()).toEqual([]);
  await s.quit(first);
  // P5 O3-D (Q1): a keeper on the daemon shape (this build) is not asked; its sessions outlive the app under its mawsd
  expect(first.quitLines()).toContain(shapes.keeper === 'daemon' ? 'quit-guard: 1 mid-turn, not asked: they outlive the app' : 'quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
  expect(isAlive(kept.pid), 'the kept supervisor outlives its app').toBe(true);
  if (keeperDaemon !== null) expect(isAlive(keeperDaemon), 'the keeper’s mawsd serves its kept session').toBe(true);
  const atQuit = s.journal(id);
  const seqAtQuit = Math.max(...atQuit.map((r) => r.seq));
  expect(atQuit.filter((r) => isTaskFailureRow(r) || isRequestRow(r)), 'the failure and the request come after the app has exited').toEqual([]);
  await expect.poll(() => s.journal(id).some(isRequestRow), { timeout: 30_000, message: 'the request reaches the journal while no app runs' }).toBe(true);

  // the other build's app attaches, and is served as another build until the kept sessions are idle
  const idleMs = shapes.attacher === 'daemon' ? REATTACH_IDLE_MS : IDLE_MS;
  const attach = () => s.launch({ MAWS_HOST_MODE: shapes.attacher, MAWS_E2E_SUPERVISOR_IDLE_MS: String(idleMs), ...steps.env }, attacher.root);
  let second = await attach();
  const attacherRuns: Run[] = [second]; // P5 O3-D M6: the attacher's launches (acceptance 9 quits and reattaches it)
  const served = await s.ready(second.page, (st) => st.supervisor!.exitWhenIdle && onShape(shapes.attacher)(st));
  expect(served, `${attacher.label} served by ${keeper.label}'s supervisor`).toMatchObject({ matches: 'build', supervisor: { pid: kept.pid, buildId: kept.buildId, liveSessions: 1, exitWhenIdle: true } });
  const build = served.appBuildId;
  expect(build, 'two builds').not.toBe(kept.buildId);
  await expect(banner(second.page, 'MAWS was updated.')).toContainText('1 session is still running');
  // the hello across the minor, as each end logged it; on the daemon shape the engine host's client is `mawsd`, which
  // says this build's engine-host build and wire, and the app's main reads the welcome `mawsd` reflects from upstream
  const attacherDaemon = shapes.attacher === 'daemon' ? served.daemon!.pid : null;
  const hello = `client connected: appPid ${attacherDaemon ?? second.child.pid} build ${build} wire ${wireOf(attacher)} capabilities [`;
  expect(s.log(), `host.log: the attaching ${attacherDaemon === null ? 'app' : 'app’s mawsd'}'s hello, at its own minor`).toContain(hello);
  const welcome = `connected to supervisor pid ${kept.pid} build ${kept.buildId} wire ${wireOf(keeper)} capabilities [`;
  expect(second.output(), "the attaching app's main: the welcome, at the supervisor's minor").toContain(welcome);
  if (attacherDaemon !== null) expect(s.daemonLog(), "mawsd's log: the upstream's welcome, at the supervisor's minor").toContain(welcome);
  said.push(`  hello: ${hello}…`, `  welcome: ${welcome}…`);
  if (keeperDaemon !== null) {
    // How the keeper's `mawsd` goes depends on the attacher's build. One that knows the daemon shape (P5 O2, wire minor 5)
    // leaves it on purpose: launched embedded on a profile with a `mawsd`, it ends that `mawsd` before its own hosts start
    // (src/main/hosts/daemon.ts, prepareShape and leaveDaemonShape), and the kept engine host runs on. One from before
    // O2 takes the engine host from the `mawsd`, which stops reaching it and exits 0 (residue 38).
    const leaves = attacher.manifest.minor >= DAEMON_SHAPE_MINOR;
    await expect.poll(() => isAlive(keeperDaemon), { timeout: 15_000, message: 'the keeper’s mawsd exits once the engine host is taken' }).toBe(false);
    if (leaves) {
      expect(second.output(), `${attacher.label}'s main ends the profile's mawsd as it leaves the daemon shape`).toContain(`[hosts] ending mawsd, pid ${keeperDaemon}, as the profile leaves the daemon shape`);
      expect(s.daemonLog(), 'mawsd says why it left').toContain('exiting (signal)');
      said.push(`  mawsd pid ${keeperDaemon} exited: ${attacher.label}'s app ended it, leaving the daemon shape`);
      // P5 O3-D M6 (§2's one writer across the downgrade): mawsd's exit gave up its spine and spine.lock, so the peer's
      // own spine runs alone, the lock its main's (a peer from O3-A on) or no lock (a peer before O3-A, which knows none)
      const lock = spineLockOf(s.userData);
      if (takesSpineLock(attacher)) expect(lock?.pid, `${attacher.label}'s main holds spine.lock, mawsd having given it up`).toBe(second.child.pid);
      else expect(lock, `no spine.lock: mawsd gave it up and ${attacher.label} knows none`).toBeNull();
      said.push(`  spine.lock: ${lock === null ? 'none' : `pid ${lock.pid} (${attacher.label}'s main)`}`);
    } else {
      expect(s.daemonLog(), 'mawsd says why it left').toContain('the engine-host was taken by another client; exiting');
      said.push(`  mawsd pid ${keeperDaemon} exited: the engine host was taken by ${attacher.label}'s app`);
    }
  }

  // the tail: what the kept supervisor journaled while no app ran reaches this main, its live derivation included
  const atAttach = await eventsOf(second.page, id);
  const seqOf = (e: SessionEvent) => Number(suffix(e.id).split(':')[0]);
  expect(atAttach.filter((e) => seqOf(e) > seqAtQuit).length, 'events from rows journaled after the keeper had exited').toBeGreaterThan(0);
  const failure = atAttach.find((e) => e.kind === 'task.notification');
  expect(failure && seqOf(failure), 'the failure was journaled after the keeper had exited').toBeGreaterThan(seqAtQuit);
  // P5 O3-D M6 (the architect's ruling; O3 Decision Log 5(1)): on a pre-A attacher after this build's mawsd held the
  // stream, the failure's item is the one gap of the downgrade. mawsd, the engine host's permanent client while no app
  // ran, took the tail (the host's connect burst sends only what no client has received, src/engine-host/session-stream.ts
  // `republish`) and its spine derived the item into the index at 14, which a pre-A app cannot read (its 13): so neither
  // the item nor the events reach the old app. Every other check of the scene runs. Without the daemon no client takes
  // the tail while away, and the burst brings it to the old app, which derives the item live.
  const derivedUnreadable = shapes.keeper === 'daemon' && !takesSpineLock(attacher);
  if (derivedUnreadable) {
    test.info().annotations.push({ type: 'skipped check', description: `the failure's Needs-you item, derived from the tail: ${attacher.label} (wire ${wireOf(attacher)}) is from before O3-A; this build's mawsd took the tail while away and derived the item into the index at 14, which it cannot read (O3 DL 5(1))` });
    said.push(`  tail: the failure's Needs-you item not checked: ${attacher.label} is from before O3-A and cannot read the index at 14 where mawsd derived it (O3 DL 5(1))`);
  } else {
    await expect.poll(async () => (await attentionOf(second.page, id, 'error')).map((i) => i.summary), { message: 'the failure’s Needs-you item, derived from the tail' }).toEqual([`Background task failed: ${TASK_FAILED}`]);
  }
  await expect.poll(async () => (await pendingPermissions(second.page, id)).length, { message: 'the request raised while away' }).toBe(1);
  said.push(`  tail: ${atAttach.filter((e) => seqOf(e) > seqAtQuit).length} events journaled after the keeper's quit; ${derivedUnreadable ? "the request's item" : "the failure's item and the request's"} reached main`);

  // P5 O5 M2: an artifact page of the kept engine host, loaded by this build's app on the daemon shape
  if (attacherDaemon !== null) said.push(await artifactPage(s, second, attacher.label, servesArtifacts(attacher)));

  // across the gap: the newer build's commands, as the older supervisor answers them
  const before = gap ? await probe(second.page, gap.newer, gap.older, inputsOf(s)) : null;

  // a launch on the kept supervisor plays a turn
  const launched = `xb-launch-${Date.now()}` as AppSessionId;
  await launchOn(attacher, second.page, launched, turnsJournal(s.root, 'launch', 1), s);
  value(await invoke(second.page, 'session.send', { appSessionId: launched, content: 'turn 1' }));
  await turnEnded(second.page, launched, 30_000);
  await s.ready(second.page, (st) => st.supervisor!.pid === kept.pid && st.supervisor!.liveSessions === 2); // the launch ran on the kept supervisor

  // the kept request answered through this app: the kept supervisor plays on, its rows arriving live
  await second.page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __xb: string[] }).__xb = seen;
    window.maws.on('session.eventBatch', (batch) => seen.push(...batch.events.map((e) => `${batch.appSessionId}|${e.id}`)));
  });
  const requested = atAttach.find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
  value(await invoke(second.page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
  const arrived = () => second.page.evaluate((id) => (window as unknown as { __xb: string[] }).__xb.filter((k) => k.startsWith(`${id}|`)).length, id);
  await expect.poll(arrived, { message: 'rows arrive live after the answer' }).toBeGreaterThan(5);
  const live = await arrived();
  // P5 O3-D M6 (acceptance 9): this build's app quits mid-turn and reattaches while the kept, older engine host serves
  if (attacherDaemon !== null) second = await quitAndReattach(s, second, attach, attacherRuns, { kept, daemon: attacherDaemon, id, capable: hostsAttachment(keeper), connectors: hostsConnectors(keeper), away: steps.awayOnKept, said });
  await turnEnded(second.page, id);
  said.push(`  served: a launch played its turn on the kept supervisor; the kept turn played on after this app's answer, ${live} rows live`);

  // the move: once both sessions are idle they are released, the kept supervisor exits, and the app starts its own
  const moved = await s.ready(second.page, (st) => st.supervisor!.pid !== kept.pid && onShape(shapes.attacher)(st), idleMs + 45_000);
  expect(moved, `${attacher.label} on a supervisor of its own build`).toMatchObject({ matches: 'same', supervisor: { buildId: build, exitWhenIdle: false } });
  if (attacherDaemon !== null) expect(moved.daemon!.pid, 'the same mawsd serves the new engine host').toBe(attacherDaemon);
  await expect.poll(() => isAlive(kept.pid), { timeout: 10_000, message: 'the kept supervisor is gone' }).toBe(false);
  expect(s.lock(), 'the lock names the new supervisor').toMatchObject({ pid: moved.supervisor!.pid, buildId: build });
  expect(s.log(), 'the kept supervisor exited by itself once idle').toContain('exiting (exitWhenIdle)');
  expect(second.output()).toContain(`connected to supervisor pid ${moved.supervisor!.pid} build ${build} wire ${wireOf(attacher)} capabilities [`);
  await expect(banner(second.page, 'MAWS was updated.')).toHaveCount(0);
  const afterMove = `xb-after-${Date.now()}` as AppSessionId;
  await launchOn(attacher, second.page, afterMove, join(REPO_ROOT, PERMISSION), s);
  said.push(`  moved: supervisor pid ${kept.pid} (build ${kept.buildId}) exited when idle; pid ${moved.supervisor!.pid} (build ${build}) serves a launch`);
  // P5 O3-D M6 (acceptance 9): the engine host of this build, which lists host.attachment, has mawsd's permanent client
  if (attacherDaemon !== null) second = await permanentAcrossReattach(s, second, attach, attacherRuns, { host: moved.supervisor!.pid, daemon: attacherDaemon, id: afterMove, connectors: hostsConnectors(attacher), away: steps.awayOnOwn, said });

  // across the gap, against what the newer build's own supervisor answers
  if (gap && before) {
    const after = await probe(second.page, gap.newer, gap.older, inputsOf(s));
    for (const [name, onOlder] of before) {
      const onOwn = after.get(name)!;
      const { owner } = commandOf(gap.newer, name)!;
      expect(!refusedSample(onOwn), `${name}: its sample input is refused (${onOwn.ok ? '' : onOwn.message}); give it one in e2e/support/cross-build-samples.ts (INPUTS, or samplesFor for one naming a scratch path)`).toBe(true);
      if (!servedByAttacher(owner)) {
        expect(onOwn, `${name} is served by its own build's supervisor`).not.toMatchObject({ ok: false, code: 'unknown_command' });
        expect(onOlder, `${name}, which the older supervisor lacks`).toMatchObject({ ok: false, code: 'unknown_command' });
        said.push(`  gap: ${name} (${owner}) answers unknown_command from the older supervisor and ${onOwn.ok ? 'ok' : onOwn.code} from its own`);
      } else {
        expect(onOlder, `${name} (owner ${owner}) answers alike whichever supervisor is attached: the attacher's own build serves it`).toEqual(onOwn);
        said.push(`  gap: ${name} (${owner}) answers ${onOwn.ok ? 'ok' : onOwn.code} on either supervisor, served by ${attacher.label}'s own ${owner === 'machine' && shapes.attacher === 'daemon' ? 'mawsd' : 'main'}`);
      }
    }
    for (const name of addedCommands(gap.newer, gap.older).filter((name) => gap.newer.mainOnly.has(name))) said.push(`  gap: ${name} is main-only, out of a window's reach; the scenes' own traffic is its check`);
    if (addedCommands(gap.newer, gap.older).length === 0) said.push(`  gap: ${gap.newer.label} adds no command to ${gap.older.label}'s wire`);
  }

  // neither end refused what the other build sent; what either dropped as unknown is named
  const appLines = attacherRuns.flatMap((run) => run.output().split('\n'));
  const hostLines = s.log().split('\n');
  expect(appLines.filter((l) => MAIN_REFUSES.test(l)), `${attacher.label}'s main refuses nothing ${keeper.label}'s supervisor sent`).toEqual([]);
  expect(hostLines.filter((l) => HOST_REFUSES.test(l)), 'neither supervisor refuses what the other build sent').toEqual([]);
  // `mawsd` forwards raw, so it has nothing of the other build's to refuse; its log is read for the record, not held to
  // the pattern, since it also closes its own machine.sock probes
  const daemonLines = s.daemonLog().split('\n');
  if (shapes.keeper === 'daemon' || shapes.attacher === 'daemon') said.push(`  mawsd's log: ${daemonLines.filter((l) => HOST_REFUSES.test(l)).length} lines of the refusal pattern${daemonLines.filter((l) => HOST_REFUSES.test(l)).map((l) => ` | ${l.trim()}`).join('')}`);
  const dropped = [...appLines, ...hostLines, ...daemonLines].filter((l) => DROPPED.test(l));
  said.push(dropped.length === 0 ? '  dropped: nothing, at either end' : `  dropped (the tolerant reader): ${dropped.map((l) => l.trim()).join(' | ')}`);
  for (const run of attacherRuns) expect(run.maws.consoleErrors()).toEqual([]);
  if (steps.attacherMoved) said.push(...(await steps.attacherMoved(second)));
  return said;
}

// P5 O16 M3c (M3; D9, D11, D40): the crossing where both builds list `host.holder`. The keeper's session is a stub launch
// under a session host, kept across the quit as above; the attacher's client is welcomed by the kept host, finds another
// build that hands over, and asks it to at once, so the kept host drains, detaches the session and exits, and a host of
// the attacher's build, started by that client, adopts it and serves the app from the start: no banner, no exit armed
// for idle, the session live with the same engine process. What the older supervisor would have answered across the gap
// is not probed (it never serves the app), nor acceptance 9's reattach to it; the permanent link to the attacher's own
// host is, as in the crossing above.
async function handedOverCrossing(s: Scratch, keeper: Build, attacher: Build, shapes: Shapes, steps: CrossingSteps): Promise<string[]> {
  const shapeOf = (shape: Shape) => (shape === 'daemon' ? ' on the daemon shape' : '');
  const said: string[] = [`${keeper.label} (wire ${wireOf(keeper)})${shapeOf(shapes.keeper)} keeps a session; ${attacher.label} (wire ${wireOf(attacher)})${shapeOf(shapes.attacher)} attaches; both list ${HOLDER_CAPABILITY}: the handover`];
  const stub = s.useStub({ rowMs: Number(ROW_MS) });

  // the keeper: a paced stub launch kept across a quit, its background failure and its request still ahead
  const first = await s.launch({ MAWS_HOST_MODE: shapes.keeper, MAWS_E2E_QUIT_ANSWER: 'keep', MAWS_E2E_REPLAY_ROW_MS: ROW_MS, ...steps.env }, keeper.root);
  const own = await s.ready(first.page, onShape(shapes.keeper));
  expect(own, `${keeper.label} on its own supervisor`).toMatchObject({ matches: 'same', supervisor: { buildId: own.appBuildId } });
  const kept = own.supervisor!;
  const keeperDaemon = shapes.keeper === 'daemon' ? own.daemon!.pid : null;
  if (steps.keeperReady) said.push(...(await steps.keeperReady(first)));
  const id = await s.record(first.page);
  const input = fitTo(commandOf(keeper, 'session.launch')!.input, { spec: stubSpec(stub, id, tailFixture(s.root), { cwd: s.repo }) });
  expect(value(await invoke(first.page, 'session.launch', input as CommandInput<'session.launch'>))).toMatchObject({ status: 'launching' });
  await expect.poll(async () => (await statusOf(first.page, id)).process).toBe('ready');
  value(await invoke(first.page, 'session.send', { appSessionId: id, content: PROMPT }));
  await expect.poll(async () => (await eventsOf(first.page, id)).length, { message: 'a few rows have streamed' }).toBeGreaterThan(5);
  const engine = (await statusOf(first.page, id)).pid;
  expect(engine, 'the kept session runs a process (the stub, under a session host)').not.toBeNull();
  expect(first.maws.consoleErrors()).toEqual([]);
  await s.quit(first);
  expect(first.quitLines()).toContain(shapes.keeper === 'daemon' ? 'quit-guard: 1 mid-turn, not asked: they outlive the app' : 'quit-guard: 1 mid-turn, auto-answered keep, 1 session kept');
  expect(isAlive(kept.pid), 'the kept supervisor outlives its app').toBe(true);
  const seqAtQuit = Math.max(...s.journal(id).map((r) => r.seq));
  await expect.poll(() => s.journal(id).some(isRequestRow), { timeout: 30_000, message: 'the request reaches the journal while no app runs' }).toBe(true);

  // the other build's app attaches: its client asks the kept host to hand over, and a host of its own build adopts
  const attach = () => s.launch({ MAWS_HOST_MODE: shapes.attacher, MAWS_E2E_SUPERVISOR_IDLE_MS: String(shapes.attacher === 'daemon' ? REATTACH_IDLE_MS : IDLE_MS), ...steps.env }, attacher.root);
  let second = await attach();
  const attacherRuns: Run[] = [second];
  const served = await s.ready(second.page, (st) => st.supervisor!.pid !== kept.pid && onShape(shapes.attacher)(st), 90_000);
  const build = served.appBuildId;
  expect(build, 'two builds').not.toBe(kept.buildId);
  expect(served, `${attacher.label} on a supervisor of its own build at once`).toMatchObject({ matches: 'same', supervisor: { buildId: build, exitWhenIdle: false } });
  await expect.poll(() => isAlive(kept.pid), { timeout: 15_000, message: 'the kept supervisor is gone' }).toBe(false);
  const attacherDaemon = shapes.attacher === 'daemon' ? served.daemon!.pid : null;
  const hello = `client connected: appPid ${attacherDaemon ?? second.child.pid} build ${build} wire ${wireOf(attacher)} capabilities [`;
  expect(s.log(), `host.log: the attaching ${attacherDaemon === null ? 'app' : 'app’s mawsd'}'s hello to the kept host, at its own minor`).toContain(hello);
  expect(s.log(), 'host.log: the kept host handed over').toContain('exiting (handover)');
  await expect(banner(second.page, 'MAWS was updated.'), 'no banner: the kept host hands over, never waits for idle (P5 O16 M3c fix wave 2: served at most until its first quiet status)').toHaveCount(0);
  if (keeperDaemon !== null) {
    await expect.poll(() => isAlive(keeperDaemon), { timeout: 15_000, message: 'the keeper’s mawsd exits once the engine host is taken' }).toBe(false);
    expect(second.output(), `${attacher.label}'s main ends the profile's mawsd as it leaves the daemon shape`).toContain(`[hosts] ending mawsd, pid ${keeperDaemon}, as the profile leaves the daemon shape`);
  }
  await expect.poll(() => adoptedOf(second.page, id), { timeout: 60_000, message: 'the kept session adopted' }).toBe(true);
  expect((await statusOf(second.page, id)).pid, 'the same engine process').toBe(engine);
  said.push(`  hello: ${hello}…`, `  handed over: supervisor pid ${kept.pid} (build ${kept.buildId}) exited by the handover; pid ${served.supervisor!.pid} (build ${build}) adopted the session (engine pid ${engine})`);

  // the tail: what was journaled while no app ran reaches this main, its live derivation included
  const atAttach = await eventsOf(second.page, id);
  const seqOf = (e: SessionEvent) => Number(suffix(e.id).split(':')[0]);
  expect(atAttach.filter((e) => seqOf(e) > seqAtQuit).length, 'events from rows journaled after the keeper had exited').toBeGreaterThan(0);
  await expect.poll(async () => (await attentionOf(second.page, id, 'error')).map((i) => i.summary), { message: 'the failure’s Needs-you item, derived from the tail' }).toEqual([`Background task failed: ${TASK_FAILED}`]);
  await expect.poll(async () => (await pendingPermissions(second.page, id)).length, { message: 'the request raised while away, once' }).toBe(1);
  if (attacherDaemon !== null) said.push(await artifactPage(s, second, attacher.label, servesArtifacts(attacher)));
  said.push('  gap: not probed: the older supervisor never served this app (its session was handed over at the attach)');

  // a launch on the successor plays a turn; the kept request answered there, the adopted session plays on
  const launched = `xb-launch-${Date.now()}` as AppSessionId;
  await launchOn(attacher, second.page, launched, turnsJournal(s.root, 'launch', 1), s);
  value(await invoke(second.page, 'session.send', { appSessionId: launched, content: 'turn 1' }));
  await turnEnded(second.page, launched, 30_000);
  const requested = (await eventsOf(second.page, id)).find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
  value(await invoke(second.page, 'session.answer', { appSessionId: id, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
  await turnEnded(second.page, id);
  expect(s.journal(id).filter((r) => r.direction === 'out' && r.frame.type === 'user'), 'the prompt was written once').toHaveLength(1);
  said.push('  served: the adopted session played its turn to the end on the successor; a launch played its turn there too');
  const afterMove = `xb-after-${Date.now()}` as AppSessionId;
  await launchOn(attacher, second.page, afterMove, join(REPO_ROOT, PERMISSION), s);
  if (attacherDaemon !== null) second = await permanentAcrossReattach(s, second, attach, attacherRuns, { host: served.supervisor!.pid, daemon: attacherDaemon, id: afterMove, connectors: hostsConnectors(attacher), away: steps.awayOnOwn, said });

  // neither end refused what the other build sent; what either dropped as unknown is named
  const appLines = attacherRuns.flatMap((run) => run.output().split('\n'));
  expect(appLines.filter((l) => MAIN_REFUSES.test(l)), `${attacher.label}'s main refuses nothing ${keeper.label}'s supervisor sent`).toEqual([]);
  expect(s.log().split('\n').filter((l) => HOST_REFUSES.test(l)), 'neither supervisor refuses what the other build sent').toEqual([]);
  const dropped = [...appLines, ...s.log().split('\n'), ...s.daemonLog().split('\n')].filter((l) => DROPPED.test(l));
  said.push(dropped.length === 0 ? '  dropped: nothing, at either end' : `  dropped (the tolerant reader): ${dropped.map((l) => l.trim()).join(' | ')}`);
  for (const run of attacherRuns) expect(run.maws.consoleErrors()).toEqual([]);
  if (steps.attacherMoved) said.push(...(await steps.attacherMoved(second)));
  return said;
}

// P5 O3-D M6 (acceptance 9; §8 of O3's design): this build's app, attached through its `mawsd` to the kept engine host,
// quits mid-turn and reattaches while that host serves. To a host whose welcome lists no `host.attachment` (a build
// before O3-D, kept across the update) `mawsd` keeps O2's connection per attachment: its link is recycled at the
// departure and at the reattach (a new connection in the host's log each time) and the host is never sent the signal
// (it knows no such command and would answer `unknown_command`, which `mawsd` logs as `failed`). To a host that lists
// it, neither: one permanent connection. Either way the turn plays on while no app runs, and its end reaches the
// reattached app's status and the spine's digest (O2's burst on a recycled link, or the front's follow from the app's
// cursor), and the session's background failure is still one Needs-you item.
// Fix round 1 (the architect's ruling): M3's unit tests prove the outstanding-at-quit items (a bridge request, a hold, a
// remote subscription) against a fake older host; this scene ties that fake to the real one, each end in its own words.
// `mawsd`'s log: the kept host's welcome it chose its path from (no host.attachment listed), its recycles at the
// departure and at the reattach, and no host.attachment sent. The older host's log: its client leaving at the quit
// (`client disconnected`, which O2-era and current hosts both print) and a fresh one coming.
async function quitAndReattach(s: Scratch, run: Run, attach: () => Promise<Run>, runs: Run[], o: { kept: { pid: number }; daemon: number; id: AppSessionId; capable: boolean; connectors: boolean; away?: () => Promise<string[]>; said: string[] }): Promise<Run> {
  const before = connectsFrom(s.log(), o.daemon);
  const leftBefore = departuresIn(s.log());
  const recycledBefore = recyclesTo(s.daemonLog(), o.kept.pid);
  const listed = welcomedWith(s.daemonLog(), o.kept.pid);
  expect(listed, `mawsd’s log: the kept host’s welcome (pid ${o.kept.pid})`).not.toBeNull();
  expect(listed!.includes('host.attachment'), `mawsd’s log: the kept host’s welcome ${o.capable ? 'lists' : 'lists no'} host.attachment, so mawsd ${o.capable ? 'keeps a permanent link' : 'takes O2’s recycle'}`).toBe(o.capable);
  // P5 O4 M4 (acceptance 3's old-host rule, D10): a kept host from before O4 lists no host.connectors, so it keys its
  // connector operations and dataset refreshes on the app's attachment, as at O3-D, until it is replaced at idle
  expect(listed!.includes(CONNECTORS_CAPABILITY), `mawsd’s log: the kept host’s welcome ${o.connectors ? 'lists' : 'lists no'} ${CONNECTORS_CAPABILITY}`).toBe(o.connectors);
  o.said.push(`  ${CONNECTORS_CAPABILITY} (acceptance 3's old-host rule): the kept host's welcome ${o.connectors ? 'lists it: its refreshes key on mawsd’s connection' : 'lists it not: its refreshes keep the app’s attachment until it is replaced at idle'}`);
  const lastSeq = () => Math.max(0, ...s.journal(o.id).map((r) => r.seq));
  await s.quit(run);
  expect(run.quitLines().filter((line) => line.startsWith('quit-guard: ')), 'the daemon shape asks nothing at quit (Q1)').toEqual([expect.stringMatching(/not asked: they outlive the app$/)]);
  const awayFrom = lastSeq();
  await expect.poll(lastSeq, { timeout: 30_000, message: 'the turn journals rows while no app runs' }).toBeGreaterThan(awayFrom);
  if (!o.capable) {
    await expect.poll(() => recyclesTo(s.daemonLog(), o.kept.pid), { timeout: 15_000, message: 'mawsd’s log: it recycles its link to the older host at the departure' }).toBeGreaterThan(recycledBefore);
    await expect.poll(() => departuresIn(s.log()), { timeout: 15_000, message: 'the older host’s log: its client left at the quit (client disconnected)' }).toBeGreaterThan(leftBefore);
    await expect.poll(() => connectsFrom(s.log(), o.daemon), { timeout: 15_000, message: 'the older host’s log: mawsd connects afresh after the departure' }).toBeGreaterThan(before);
  }
  // the turn ends while no app runs (fix round 1, item 6): what the reattach recovers is then known, the end included
  const endRow = () => s.journal(o.id).find((r) => r.seq > awayFrom && r.direction === 'in' && r.frame.type === 'result');
  await expect.poll(() => endRow() !== undefined, { timeout: 30_000, message: 'the turn ends while no app runs' }).toBe(true);
  if (o.away) o.said.push(...(await o.away())); // P5 O4 M4: the kept older host serving, no app
  const departed = connectsFrom(s.log(), o.daemon);
  const leftAway = departuresIn(s.log());
  const recycledAway = recyclesTo(s.daemonLog(), o.kept.pid);
  const atReattach = lastSeq();
  const next = await attach();
  runs.push(next);
  await s.ready(next.page, (st) => st.supervisor!.pid === o.kept.pid && st.daemon?.pid === o.daemon);
  if (o.capable) {
    expect(connectsFrom(s.log(), o.daemon), 'the permanent client: no new connection across the quit and the reattach').toBe(before);
    expect(departuresIn(s.log()), 'the permanent client: the host saw no client leave').toBe(leftBefore);
    expect(recyclesTo(s.daemonLog(), o.kept.pid), 'mawsd’s log: a permanent link is not recycled').toBe(recycledBefore);
  } else {
    await expect.poll(() => recyclesTo(s.daemonLog(), o.kept.pid), { timeout: 15_000, message: 'mawsd’s log: it recycles its link to the older host at the reattach' }).toBeGreaterThan(recycledAway);
    await expect.poll(() => departuresIn(s.log()), { timeout: 15_000, message: 'the older host’s log: the link it served while no app ran left at the reattach' }).toBeGreaterThan(leftAway);
    await expect.poll(() => connectsFrom(s.log(), o.daemon), { timeout: 15_000, message: 'the older host’s log: mawsd connects afresh at the reattach' }).toBeGreaterThan(departed);
  }
  expect(s.daemonLog(), o.capable ? 'the host of this build hears each attachment' : 'mawsd sent no host.attachment to the older host, which would answer unknown_command, logged as failed').not.toMatch(/host\.attachment \{attached: (true|false)\} failed/);
  // the catch-up at the reattach, by identity (fix round 1, item 6): the rows journaled while no app ran (awayFrom <
  // seq <= atReattach, the turn's end among them) are the session's events, and the turn's end, its `turn.ended` at the
  // end row's seq, reaches main's view (the engine status, through the front's follow from the app's cursor) and the
  // spine's (the digest's lastTurnEndedAt is that event's own time, folded from the recycled link's burst on an older
  // host: the spine heard no event while no app ran there); the refold adds no second item for the failure folded before
  // the quit
  const ended = endRow()!;
  expect(ended.seq, 'the turn’s end was journaled before the reattach').toBeLessThanOrEqual(atReattach);
  const seqOfEvent = (e: SessionEvent) => Number(suffix(e.id).split(':')[0]);
  const awayEvents = (await eventsOf(next.page, o.id)).filter((e) => seqOfEvent(e) > awayFrom && seqOfEvent(e) <= atReattach);
  const endEvent = awayEvents.find((e) => e.kind === 'turn.ended');
  expect(endEvent && seqOfEvent(endEvent), 'the turn’s end is the event of the end row journaled while no app ran').toBe(ended.seq);
  await turnEnded(next.page, o.id);
  await expect
    .poll(async () => {
      const digest = value(await invoke(next.page, 'session.digests', undefined)).digests.find((d) => d.appSessionId === o.id);
      return digest === undefined ? null : { lastTurnEndedAt: digest.lastTurnEndedAt, working: digest.phase === 'working' };
    }, { message: 'the spine’s digest has the turn’s end recovered at the reattach' })
    .toEqual({ lastTurnEndedAt: endEvent!.at, working: false });
  const away = s.journal(o.id).filter((r) => r.seq > awayFrom && r.seq <= atReattach).length;
  expect((await attentionOf(next.page, o.id, 'error')).map((i) => i.summary), 'the background failure is still one Needs-you item').toEqual([`Background task failed: ${TASK_FAILED}`]);
  expect(await pendingPermissions(next.page, o.id), 'the request answered before the quit stays answered').toEqual([]);
  o.said.push(
    `  reattach (acceptance 9, ${o.capable ? 'a host that serves host.attachment: one permanent connection' : 'an older host: O2’s link per attachment'}): connections from mawsd pid ${o.daemon} ${before} → ${departed} at the departure → ${connectsFrom(s.log(), o.daemon)} at the reattach; ${away} rows journaled while no app ran, the turn’s end (seq ${ended.seq}) among them; ${awayEvents.length} events of theirs, the end’s recovered by the digest`,
  );
  return next;
}

// P5 O3-D M6 (acceptance 9): once the kept host was replaced at idle by an engine host of this build, which lists
// host.attachment, `mawsd` is its permanent client: a session held mid-turn at its request (the unpaced replay holds there,
// so neither the park nor the idle release ends the host while no app runs), the app's quit and reattach cross no new
// connection, and the request is pending once after it.
async function permanentAcrossReattach(s: Scratch, run: Run, attach: () => Promise<Run>, runs: Run[], o: { host: number; daemon: number; id: AppSessionId; connectors: boolean; away?: () => Promise<string[]>; said: string[] }): Promise<Run> {
  value(await invoke(run.page, 'session.send', { appSessionId: o.id, content: PROMPT }));
  await expect.poll(async () => (await pendingPermissions(run.page, o.id)).length, { timeout: 30_000, message: 'the request, held' }).toBe(1);
  const connects = connectsFrom(s.log(), o.daemon);
  const last = (s.log().match(new RegExp(`client connected: appPid ${o.daemon} .*`, 'g')) ?? []).at(-1) ?? '';
  expect(last, 'mawsd’s connection to the host of this build declares the attachment').toContain('host.attachment');
  // P5 O4 M4 (acceptance 3, D10): to the host that replaced the kept one both ends list host.connectors, so its connector
  // operations and dataset refreshes key on mawsd's connection and complete with no app
  if (o.connectors) {
    expect(last, `mawsd’s hello to the host of this build lists ${CONNECTORS_CAPABILITY}`).toContain(CONNECTORS_CAPABILITY);
    expect(welcomedWith(s.daemonLog(), o.host), `mawsd’s log: the host of this build’s welcome lists ${CONNECTORS_CAPABILITY}`).toContain(CONNECTORS_CAPABILITY);
    o.said.push(`  ${CONNECTORS_CAPABILITY} (acceptance 3): supervisor pid ${o.host} of this build and mawsd pid ${o.daemon} both list it, so its refreshes key on mawsd's connection`);
  }
  await s.quit(run);
  if (o.away) o.said.push(...(await o.away())); // P5 O4 M4: the host of this build serving, no app
  const next = await attach();
  runs.push(next);
  await s.ready(next.page, (st) => st.supervisor!.pid === o.host && st.daemon?.pid === o.daemon);
  expect(connectsFrom(s.log(), o.daemon), 'the permanent client: no new connection across the quit and the reattach').toBe(connects);
  expect(s.daemonLog(), 'the host of this build hears each attachment').not.toMatch(/host\.attachment \{attached: (true|false)\} failed/);
  await expect.poll(async () => (await pendingPermissions(next.page, o.id)).length, { message: 'the request, pending once after the reattach' }).toBe(1);
  o.said.push(`  permanent (acceptance 9): supervisor pid ${o.host} of this build kept mawsd pid ${o.daemon}’s one connection across a quit and a reattach (${connects} connections from it in the log)`);
  return next;
}

// P5 O4 M4 (acceptance 3's old-host rule at app level, D10): an agent's refresh of a dataset's query while no app runs,
// asked as `session` through the serving engine host's dashboard seam (MAWS_DASHBOARD_E2E, a seam every peer from E3 on
// has), the session's own board written first. A host keyed on the app's attachment (O3-D's rule: it serves
// host.attachment and lists no host.connectors) settles it `noClient` at once, in the tool's own words. A host keyed on
// its client's connection (this build's, which lists host.connectors, or an O2-era one, whose client is `mawsd`'s
// reconnected link) hands the request to `mawsd`, whose connectors answer it with no app: the board's query names a
// server no route reaches, so nothing is published, in the connectors' words rather than an ending of the host's.
const NO_CLIENT = 'MAWS is not open; the dataset cannot be refreshed';
const ENDED_BY_HOST = /MAWS is not open|MAWS did not answer in time|the request was withdrawn/;
async function refreshWithNoApp(agent: AgentSeam, session: string, host: string, noClient: boolean): Promise<string[]> {
  const artifact = await writeBoard(agent, session);
  await readDataset(agent, session, artifact); // the session's last read: `baseRevision: 'last'` is its revision
  const answer = await agent.call(session, 'artifact_dataset', { artifact, id: DATASET, refresh: true, baseRevision: 'last' }, { timeoutMs: 200_000 });
  expect(answer.isError, `nothing is published: no route reaches ${SOURCE.server} (${answer.text || JSON.stringify(answer.result)})`).toBe(true);
  if (noClient) expect(answer.text, `${host}, keyed on the app's attachment: the refresh settles noClient`).toContain(NO_CLIENT);
  else expect(answer.text, `${host}, keyed on mawsd's connection: mawsd answers the refresh`).not.toMatch(ENDED_BY_HOST);
  return [`  refresh with no app (acceptance 3), ${host}: ${noClient ? 'settled noClient' : 'answered by mawsd'}: ${answer.text}`];
}

// P5 O5 M2: whether a build's `mawsd` serves the artifact endpoint (its manifest's capabilities, the union its peers list)
const servesArtifacts = (build: Build) => build.manifest.capabilities.includes('machine.artifacts');
// P5 O5 M2: an html artifact made in the attached engine host, its page loaded through the app's scheme; the endpoint's
// load in `mawsd`'s log when the app's own `mawsd` serves the endpoint
async function artifactPage(s: Scratch, run: Run, label: string, endpoint: boolean): Promise<string> {
  const MARK = 'CROSS_BUILD_PAGE';
  const created = (await run.page.evaluate(
    (html) => window.maws.invoke('artifacts.create' as never, { kind: 'html', title: 'Cross-build page', content: { bytes: new TextEncoder().encode(html), name: 'index.html' } } as never),
    `<!doctype html><html><head><title>x</title></head><body><p>${MARK}</p></body></html>`,
  )) as { ok: true; value: { artifact: { id: string } } } | { ok: false; error: { message: string } };
  if (!created.ok) throw new Error(`artifacts.create on the kept engine host failed: ${created.error.message}`);
  const url = `maws-artifact://${created.value.artifact.id}/live/index.html`;
  const page = await run.maws.app.evaluate(async ({ session }, target) => {
    const response = await session.defaultSession.fetch(target);
    return { status: response.status, text: await response.text() };
  }, url);
  expect(page.status, `${label}'s app loads the page`).toBe(200);
  expect(page.text).toContain(MARK);
  expect(page.text).toContain('data-maws-bridge');
  const throughEndpoint = s.daemonLog().includes('[artifacts] the artifact endpoint’s handler loaded at its first use');
  expect(throughEndpoint, `mawsd's log: the page came ${endpoint ? 'through' : 'not through'} its artifact endpoint`).toBe(endpoint);
  return `  artifact page: ${url} loaded with the bridge script, ${throughEndpoint ? "through this build's mawsd's artifact endpoint, resolved by the kept engine host" : "by main's own handler (the app's mawsd lists no machine.artifacts)"}`;
}

const record = (lines: string[]) => {
  test.info().annotations.push({ type: 'cross-build', description: lines.join('\n') });
  for (const line of lines) console.log(`[cross-build] ${line}`);
};

// ---- P5 O4 M4: a grant as a pre-O4 build kept it, and the Connectors sheet that lists the saved ones --------------------

// U7 (Interfaces §B): this build's app seals a placeholder grant's version 1 record with its own safeStorage, as a pre-O4
// build's Electron sealer did (format 1), once main is shown to run on the mock keychain with this scratch profile. The
// file is written after that app quits, so the next launch of this build adopts it at its machine host's first streaming.
async function sealLegacyGrant(run: Run, s: Scratch): Promise<{ id: string; sealed: string }> {
  await expectMockCustody(run.maws.app, s.userData);
  const id = randomUUID();
  return { id, sealed: await sealWithAppSafeStorage(run.maws.app, placeholderGrantText(id)) };
}
const oauthDirOf = (userData: string) => join(userData, 'connectors', 'oauth');
// The format line of `<profile>/connectors/oauth/<id>.sealed` (1: safeStorage's, 2: the machine's key), null when absent
function sealedFormat(userData: string, id: string): 1 | 2 | null {
  const path = join(oauthDirOf(userData), `${id}.sealed`);
  if (!existsSync(path)) return null;
  const read = readSealedText(readFileSync(path, 'utf8'));
  return read.ok ? read.format : null;
}
// This build's adoption at a launch: the file re-sealed in place under the machine's key, and main's count
async function expectAdopted(run: Run, s: Scratch, id: string): Promise<void> {
  await expect.poll(() => sealedFormat(s.userData, id), { timeout: 30_000, message: 'the grant adopted in place: format 2 under its id' }).toBe(2);
  await expect.poll(() => run.output(), { timeout: 10_000, message: 'main said the adoption' }).toMatch(/\[connectors\] adopted 1 of 1 legacy grants\n/);
}

// A page that declares one tool, so its header offers the owner's Connectors sheet (whose rows list every saved
// connection the store cannot read, whatever the page names); its space links no directory.
const GRANTS_PAGE = 'Cross-build grants';
const GRANTS_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>${GRANTS_PAGE}</title></head>
<body>
<p id="declared">declaring</p>
<script>
mawsConnectors.declare([{ server: 'xb-page', tool: 'read' }]).then((d) => { document.getElementById('declared').textContent = d.ok ? 'declared' : d.state + ':' + d.reason; });
</script>
</body></html>
`;
async function createGrantsPage(page: Page): Promise<string> {
  const spaceId = value(await invoke(page, 'spaces.create', { name: 'Cross-build' })).space.id;
  const created = await page.evaluate(
    ([html, title, space]) => window.maws.invoke('artifacts.create', { kind: 'html', title, spaceId: space, content: { bytes: new TextEncoder().encode(html), name: 'index.html' } }),
    [GRANTS_PAGE_HTML, GRANTS_PAGE, spaceId] as const,
  );
  return value(created as CommandResult<'artifacts.create'>).artifact.id;
}
// The page's Connectors sheet: the page from its tab the layout restored (`restored`: the caller saved one), else from
// the library, then the header's action. `missing`: null once the sheet shows, else the step that did not.
const sheetSelector = '[data-connectors-sheet]';
const unreadableRowsShown = (page: Page) => page.locator(`${sheetSelector} [data-connector-server][data-kind="unreadable"]`);
type Step = [string, () => Promise<unknown>];
async function openGrantsSheet(page: Page, artifactId: string, restored = false): Promise<{ from: 'its restored tab' | 'the library'; missing: string | null }> {
  const tab = page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`);
  const shows = (act: () => Promise<unknown>) => act().then(() => true, () => false);
  const fromTab = restored && (await shows(() => expect(tab.locator('[data-artifact-frame="html"]')).toBeVisible({ timeout: 10_000 })));
  const fromLibrary: Step[] = [
    ['the sidebar’s Artifacts', () => page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click({ timeout: 10_000 })],
    ['the page’s row in the library', () => page.locator('[data-library]').getByRole('article', { name: GRANTS_PAGE, exact: true }).click({ timeout: 15_000 })],
  ];
  const steps: Step[] = [
    ...(fromTab ? [] : fromLibrary),
    ['the page’s declaration', () => expect(tab.frameLocator('[data-artifact-frame="html"]').locator('#declared')).not.toHaveText('declaring', { timeout: 20_000 })],
    ['the header’s Connectors', () => page.locator('[data-region="main"]').getByRole('button', { name: 'Connectors' }).click({ timeout: 10_000 })],
    ['the sheet', () => expect(page.locator(sheetSelector)).toBeVisible({ timeout: 10_000 })],
  ];
  const from = fromTab ? 'its restored tab' : 'the library';
  for (const [step, act] of steps) if (!(await shows(act))) return { from, missing: step };
  return { from, missing: null };
}
// The ids of the unreadable rows `connectors.servers` (the command the sheet reads) answers for the page, or its refusal
async function unreadableRows(page: Page, artifactId: string): Promise<string[] | string> {
  const answer = await invoke(page, 'connectors.servers', { artifactId, tools: [] });
  if (!answer.ok) return `${answer.error.code}: ${answer.error.message}`;
  return answer.value.servers.flatMap((row) => (row.kind === 'unreadable' ? [row.connectionId] : []));
}

test.beforeEach(() => test.setTimeout(240_000));

test('(update) the older build’s app keeps a session; the newer build’s app attaches across the minor, is served, launches, meets what the older lacks, and moves to its own supervisor', async () => {
  const { older, newer } = builds();
  await withScratch('xb-update', async (s) => record(await crossing(s, older, newer, { newer, older })));
});

test('(downgrade) the newer build’s app keeps a session; the older build’s app attaches across the minor, is served, launches, and moves to its own supervisor', async () => {
  const { older, newer } = builds();
  await withScratch('xb-downgrade', async (s) => record(await crossing(s, newer, older, null)));
});

// P5 O4 M4 (acceptance 3's old-host rule at app level, acceptance 10): besides which engine host lists host.connectors
// (quitAndReattach, permanentAcrossReattach), an agent's refresh with no app at each of the two quits (refreshWithNoApp):
// `noClient` from the kept older host when it keys on the app's attachment, answered by mawsd from the host of this build
// that replaced it. The hosts' dashboard seam is on (MAWS_DASHBOARD_E2E) for every launch of the scene.
test('(update, daemon) the peer’s app keeps a session on its own supervisor; this build’s app attaches on the daemon shape, its mawsd relays the peer’s engine host across the minor until idle, then starts its own', async () => {
  test.setTimeout(600_000); // P5 O3-D M6: acceptance 9's two quits and reattaches; P5 O4 M4: a refresh at each, 200 s at most
  const { here, peer, newer, older } = builds();
  const gap = here === newer ? { newer, older } : null;
  await withScratch('xb-daemon-update', async (s) => {
    const agent = new AgentSeam(join(s.userData, 'dashboard-e2e'));
    const said = await crossing(s, peer, here, gap, { keeper: 'detached', attacher: 'daemon' }, {
      env: { MAWS_DASHBOARD_E2E: '1' },
      awayOnKept: () => refreshWithNoApp(agent, 'xb-agent-kept', `${peer.label}'s kept engine host`, hostsAttachment(peer) && !hostsConnectors(peer)),
      awayOnOwn: () => refreshWithNoApp(agent, 'xb-agent-own', `${here.label}'s engine host`, false),
    });
    record(said);
  });
});

// P5 O4 M4 (D11's downgrade residual): before the crossing, a launch of this build seals a grant as a pre-O4 build kept it
// (format 1), and the machine it started is ended, so the keeper's launch starts it afresh under its own environment
// (the paced replay); the keeper's launch adopts the grant (format 2). At the end the peer, on a supervisor of its own
// build, lists it in its Connectors sheet: an unreadable row when the peer is from before O4 (format 2 is not its
// store's; it can Forget it, then Connect again), a readable one, so no unreadable row, when the peer knows format 2.
test('(downgrade, daemon) this build’s app keeps a session under its mawsd; the peer’s app ends mawsd (or, before O2, takes the engine host from it), attaches that engine host, is served as another build, and moves to its own supervisor', async () => {
  test.setTimeout(300_000); // the sealing launch before the crossing
  const { here, peer, newer, older } = builds();
  const gap = peer === newer ? { newer, older } : null;
  await withScratch('xb-daemon-downgrade', async (s) => {
    const sealing = await s.launch({ MAWS_HOST_MODE: 'daemon' });
    await s.ready(sealing.page, onShape('daemon'));
    const grant = await sealLegacyGrant(sealing, s);
    await s.quit(sealing);
    await endProfileProcesses(s.userData);
    writeLegacySealed(oauthDirOf(s.userData), grant.id, grant.sealed);
    const unreadableToPeer = !appObeysConnectors(peer);
    const said = await crossing(s, here, peer, gap, { keeper: 'daemon', attacher: 'detached' }, {
      keeperReady: async (run) => {
        await expectAdopted(run, s, grant.id);
        return [`  grant ${grant.id}: planted in format 1, adopted by ${here.label}'s mawsd at the keeper's launch (format 2)`];
      },
      attacherMoved: async (run) => {
        const artifactId = await createGrantsPage(run.page);
        expect(await unreadableRows(run.page, artifactId), `${peer.label}'s connectors.servers: the adopted grant ${unreadableToPeer ? 'is an unreadable row (format 2 is not its store’s)' : 'is readable'}`).toEqual(unreadableToPeer ? [grant.id] : []);
        expect((await openGrantsSheet(run.page, artifactId)).missing, `${peer.label}'s Connectors sheet opens from the page’s header (null: it did; else the step that did not show)`).toBeNull();
        await expect(unreadableRowsShown(run.page), `${peer.label}'s sheet shows ${unreadableToPeer ? 'the one unreadable row' : 'no unreadable row'}`).toHaveCount(unreadableToPeer ? 1 : 0, { timeout: 20_000 });
        expect(sealedFormat(s.userData, grant.id), `${peer.label} left the adopted file as it was`).toBe(2);
        return [`  grant ${grant.id}: ${peer.label}'s Connectors sheet lists it ${unreadableToPeer ? 'as an unreadable row (Forget, then Connect again: the downgrade’s residual, D11)' : 'as readable: it knows the machine’s format'}`];
      },
    });
    record(said);
  });
});

// The upgrade's restart of `mawsd` (2026-10-31: after an upgrade New chat stayed disabled until the app was reopened). The
// older peer's app on the daemon shape leaves its private `mawsd` running; this build's app attaches to it, finds another
// build and asks it to restart (src/main/hosts/daemon.ts, the build check), and its own `mawsd` serves on. The page's
// first reads may fall in that window; whether they do or not, once this build's `mawsd` serves, the sidebar's New chat
// is enabled (src/renderer/src/app/launch-mode.ts asks again when the machine is heard), and a session tab the layout
// restored is kept and saved (a failed local snapshot is unknown, not empty: src/renderer/src/ipc/events.ts).
test('(update, mawsd restart) this build’s app meets the older peer’s mawsd, has it restart onto this build, and New chat is enabled and a restored session tab kept once it serves', async () => {
  const { here, peer, newer } = builds();
  test.skip(here !== newer || !peer.manifest.capabilities.includes('machine.spine'), `the peer (wire ${wireOf(peer)}) is not an older build whose mawsd runs the spine`);
  await withScratch('xb-mawsd-restart', async (s) => {
    const old = await s.launch({ MAWS_HOST_MODE: 'daemon' }, peer.root);
    const theirs = (await s.ready(old.page, onShape('daemon'))).daemon!;
    const id = await s.record(old.page); // the seeded session, in the index both builds' spines open
    await s.quit(old);
    expect(isAlive(theirs.pid), 'the peer’s mawsd outlives its app').toBe(true);
    // its tab in the layout this build's app restores (a version-1 value, which hydration writes back filed: so whole)
    const layoutFile = join(s.userData, 'layout.json');
    const layout = existsSync(layoutFile) ? (JSON.parse(readFileSync(layoutFile, 'utf8')) as Record<string, unknown>) : {};
    const tab = { id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false };
    writeFileSync(layoutFile, JSON.stringify({ ...layout, 'main.tabs': { version: 1, panes: [{ tabs: [tab], activeTabId: tab.id }], focusedPane: 0, splitRatio: 0.5, closedTabs: [] } }));
    const run = await s.launch({ MAWS_HOST_MODE: 'daemon' });
    const ours = (await s.ready(run.page, (st) => st.daemon !== null && st.daemon.pid !== theirs.pid, 60_000)).daemon!;
    expect(run.output(), 'this build’s main asks the peer’s mawsd to restart').toContain(`[hosts] mawsd pid ${theirs.pid} runs build ${theirs.build.buildId}, this app's is ${ours.build.buildId}; asking it to restart`);
    await expect(run.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'New chat', exact: true }), 'New chat, once this build’s mawsd serves').toBeEnabled({ timeout: 30_000 });
    const saved = async () => {
      const tabs = value(await invoke(run.page, 'layout.get', { key: 'main.tabs' })).value as { version?: number } | null;
      return { version: tabs?.version ?? null, keeps: JSON.stringify(tabs).includes(id) };
    };
    await expect.poll(saved, { timeout: 30_000, message: 'the restored session tab, written back filed and whole' }).toEqual({ version: 3, keeps: true });
    record([`${peer.label}'s mawsd pid ${theirs.pid} (build ${theirs.build.buildId}) restarted onto ${here.label}'s, pid ${ours.pid} (build ${ours.build.buildId}); New chat enabled, the restored tab of ${id} kept`]);
  });
});

// P5 O3-D M6, acceptance 11's second half (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §L; the
// architect's rulings D29 and D32). This build's app on the daemon shape leaves its private `mawsd` running the spine
// over a post-D profile (the index at 14, the settings split); an O2-era app (the peer, before O3-A: it takes no
// spine.lock and lists no `machine.spine`) is then launched on the daemon shape over it. What the scene asserts, each
// with the ruling it rests on:
//   1. the relay's refusal (§L; D32): `mawsd` answers the old app's engine-host.sock hello `refuse wire` on its own
//      account, with its own identity, and the old app's main reads the refusal;
//   2. the yield (§L; D32): the old app holds no spine.lock, so `mawsd` yields its spine to that pid, releasing it
//      within REFUSAL_TO_RELEASE_MS of the refusal (a late or missing release fails as a §L ordering failure);
//   3. the old app's index unavailable (acceptance 11's wording; D32): its own main opens the index `mawsd` migrated to
//      14 and finds it newer than it knows (13), so leaves it unopened for its run (which keeps index.sqlite out of the
//      two writers' overlap below);
//   4. the post-D `mawsd` writes no spine file after the refusal (D32; the architect's ruling, fix round 1 item 5), per
//      process, since the old app's main runs a spine of its own on the same files from its launch (before O3-A the
//      spine is main's) and a file's bytes cannot say which process wrote them:
//      (a) from the refusal to `[spine] released` its only spine writes are its stores closing (the index's WAL
//          checkpointed, -wal and -shm removed): src/mawsd/process-yield.test.ts pins it on the built `mawsd`;
//      (b) at the release and at the window's end it holds no spine file open (lsof), or it is gone;
//      (c) no writer at idle: every spine file (SPINE_PATHS, test/support/spine-files.ts) byte-identical over 10 s
//          after the release while the old app idles.
//      The overlap is bounded and recorded: the refusal-to-release and the old app's launch-to-release times are
//      annotated, with the first spine file change seen after the old app's launch.
// What follows is O2's downgrade, which D29 keeps: the old app's `watchDaemon` asks `daemon.restart` of a private daemon
// of another build, so the post-D `mawsd` exits 75 and the old app's own build of `mawsd` (which runs no spine) serves
// it, its main running its spine alone with the index unavailable to it. The scene records what it sees of that end
// state and asserts none of it: the window between the refusal and the restart is a race of the old app's two sockets.
test('(pre-O3 app, daemon) an O2-era app on a profile whose mawsd runs the spine is refused at the relay, the spine yields to it, its index is unavailable, and no spine file changes while it idles', async () => {
  const { here, peer } = builds();
  test.skip(takesSpineLock(peer) || peer.manifest.minor < DAEMON_SHAPE_MINOR, `the peer (wire ${wireOf(peer)}) is not an O2-era build: it takes spine.lock, or knows no daemon shape; this scene runs with --peer <O2-era master sha>`);
  await withScratch('xb-pre-o3', async (s) => {
    const said: string[] = [`${here.label} (wire ${wireOf(here)}) on the daemon shape runs the spine in its mawsd; ${peer.label} (wire ${wireOf(peer)}), from before O3-A, launches on the daemon shape over it`];
    // this build's app makes the profile post-D (its mawsd's spine loads: spine.lock, the split, the index at 14), then quits
    const first = await s.launch({ MAWS_HOST_MODE: 'daemon' });
    const own = await s.ready(first.page, onShape('daemon'));
    await s.record(first.page); // the seeded session in the spine's index: the spine is loaded
    const daemon = own.daemon!.pid;
    await s.quit(first);
    expect(isAlive(daemon), 'this build’s mawsd outlives its app').toBe(true);
    expect(spineLockOf(s.userData)?.pid, 'mawsd holds spine.lock').toBe(daemon);
    const reached = await reachMachine(daemonPaths(s.userData), { build: 'e2e-cross-build' });
    if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
    const status = await reached.link.request('daemon.status', undefined);
    reached.link.close();
    expect(status, 'mawsd runs the spine, loaded').toMatchObject({ ok: true, value: { pid: daemon, spine: { state: 'loaded' } } });
    const logFrom = s.daemonLog().length; // what this build's mawsd says from here

    // the O2-era app, on the daemon shape over the same profile. Its own main runs a spine from its start (before O3-A
    // the spine is main's), so the first change to a spine file after its launch is sampled, for the order's record
    const beforeOld = spineFiles(s.userData);
    const launchedAt = Date.now();
    let firstSpineChange: { at: number; path: string } | null = null;
    const sampler = setInterval(() => {
      if (firstSpineChange !== null) return;
      const now = spineFiles(s.userData);
      const path = [...new Set([...beforeOld.keys(), ...now.keys()])].find((key) => beforeOld.get(key) !== now.get(key));
      if (path !== undefined) firstSpineChange = { at: Date.now(), path };
    }, 100);
    sampler.unref(); // a failure before its clearInterval leaves it holding nothing (it stops sampling at its first change)
    const old = await s.launch({ MAWS_HOST_MODE: 'daemon' }, peer.root).catch((error: unknown) => {
      clearInterval(sampler);
      throw error;
    });
    const oldPid = old.child.pid!;
    const daemonSaid = () => s.daemonLog().slice(logFrom);
    // The race §L leaves between the old app's two sockets (fix round 1, item 4): its main connects machine.sock and
    // engine-host.sock at once (host-supervisor.ts's start), and O2's `watchDaemon` checks the build and asks
    // `daemon.restart` on machine.sock's readiness alone. Each competing event in the order mawsd logged it, so a
    // restart that came before the refusal fails here naming the order, not on a generic wait.
    const refusedLine = `engine-host.sock: refuse wire to appPid ${oldPid} (build `;
    const competing = () => {
      const log = daemonSaid();
      const at = (needle: string) => log.indexOf(needle);
      return ([['relay refusal', at(refusedLine)], ['daemon.restart received', at('restart asked')], ['yield', at(`[spine] yielding to pid ${oldPid}`)], ['exit', at('exiting (')]] as const)
        .filter(([, index]) => index >= 0)
        .sort((a, b) => a[1] - b[1])
        .map(([name]) => name);
    };
    // each event's time from the old app's launch, by its log line's own stamp (the supervisor log's ISO prefix)
    const timed = () => {
      const lines = daemonSaid().split('\n');
      const when = (needle: string) => {
        const line = lines.find((l) => l.includes(needle));
        return line === undefined ? null : Date.parse(line.slice(0, 24)) - launchedAt;
      };
      const change = firstSpineChange as { at: number; path: string } | null;
      return [
        `relay refusal +${when(refusedLine)} ms`, `daemon.restart received +${when('restart asked')} ms`, `yield +${when(`[spine] yielding to pid ${oldPid}`)} ms`,
        `released +${when('[spine] released')} ms`, `exit +${when('exiting (')} ms`,
        `first spine file change ${change === null ? 'none seen' : `+${change.at - launchedAt} ms (${change.path})`}`,
      ].join('; ');
    };
    await expect.poll(() => competing().some((name) => name === 'relay refusal' || name === 'daemon.restart received') || !isAlive(daemon), { timeout: 30_000, message: 'mawsd hears the old app: its hello at the relay, or its restart' }).toBe(true);
    const order = competing();
    said.push(`  order in mawsd's log: ${order.join(' → ') || 'nothing'}; the old app: ${old.output().split('\n').filter((line) => line.includes('asking it to restart') || /speaks wire \S+ with |is incompatible \(wire\)/.test(line)).map((line) => line.trim()).join(' | ') || 'nothing yet'}`);
    if (!order.includes('relay refusal') || order.indexOf('daemon.restart received') >= 0 && order.indexOf('daemon.restart received') < order.indexOf('relay refusal')) {
      clearInterval(sampler);
      said.push(`  times from the old app's launch: ${timed()}`);
      await test.info().attach('pre-o3-order', { body: `${said.join('\n')}\n\n--- mawsd.log since the old app's launch\n${daemonSaid()}\n--- the old app's output\n${old.output()}`, contentType: 'text/plain' });
      throw new Error(`§L ordering: the old app's daemon.restart reached mawsd before its relay hello was refused (D29); order: ${order.join(' → ') || 'nothing'}`);
    }
    // 1. the relay's refusal: mawsd's own `refuse wire`, and the old app's main reading it
    expect(daemonSaid(), 'mawsd refuses the old app’s hello at the relay').toContain(refusedLine);
    expect(daemonSaid(), 'its hello lists no machine.spine, and it holds no spine.lock').toMatch(new RegExp(`refuse wire to appPid ${oldPid} \\(build [^)]+\\): its hello lists no machine\\.spine, so it runs a spine of its own\n`));
    // P5 O4 M4 (D45): the refusal says at least one live session, so the old app's main waits on it (its banner) rather
    // than replacing mawsd in a loop
    await expect.poll(() => old.output(), { timeout: 30_000, message: 'the old app’s main reads the refusal of its wire and waits on it' }).toMatch(/is incompatible \(wire\) and runs [1-9]\d* sessions; waiting/);
    // 2. the yield: to the old app's pid, the loaded spine released within the yield's own bound of the refusal
    expect(daemonSaid(), 'mawsd yields its spine to the old app').toContain(`[spine] yielding to pid ${oldPid}, an app that runs its own spine`);
    const releasedSaid = () => daemonSaid().slice(daemonSaid().indexOf('[spine] yielding to pid')).includes('[spine] released');
    for (const until = Date.now() + REFUSAL_TO_RELEASE_MS + 5_000; !releasedSaid() && isAlive(daemon) && Date.now() < until; ) await old.page.waitForTimeout(250);
    const stamp = (needle: string) => {
      const line = daemonSaid().split('\n').find((l) => l.includes(needle));
      return line === undefined ? null : Date.parse(line.slice(0, 24));
    };
    if (!releasedSaid()) {
      clearInterval(sampler);
      said.push(`  times from the old app's launch: ${timed()}`);
      await test.info().attach('pre-o3-order', { body: `${said.join('\n')}\n\n--- mawsd.log since the old app's launch\n${daemonSaid()}\n--- the old app's output\n${old.output()}`, contentType: 'text/plain' });
      throw new Error(`§L ordering: the spine yielded to pid ${oldPid} was not released ${isAlive(daemon) ? `within ${REFUSAL_TO_RELEASE_MS + 5_000} ms` : 'before mawsd ended'}; order: ${competing().join(' → ')}`);
    }
    const refusalToReleaseMs = stamp('[spine] released')! - stamp(refusedLine)!;
    test.info().annotations.push({ type: 'pre-O3 overlap', description: `refusal → released ${refusalToReleaseMs} ms; the old app's launch → released ${stamp('[spine] released')! - launchedAt} ms` });
    expect(refusalToReleaseMs, '§L ordering: the yielded spine released within the yield’s own bound of the refusal').toBeLessThanOrEqual(REFUSAL_TO_RELEASE_MS);
    // 4(b) at the release: the post-D mawsd holds no spine file open, or is gone
    expect(isAlive(daemon) ? spineFilesOpen(daemon, s.userData) : [], 'released: the post-D mawsd holds no spine file open').toEqual([]);
    // 3. the old app's index unavailable: the version mawsd migrated it to is newer than the old build knows
    await expect.poll(() => old.output(), { timeout: 30_000, message: 'the old app finds the index unavailable' }).toMatch(/user_version 14 is newer than this app knows \(13\); the index is unavailable this run/);
    // 4(c) no writer at idle: no spine file changes over 10 s after the release while the old app idles; 4(b) again at the
    // window's end. 4(a), the release's own writes, is src/mawsd/process-yield.test.ts's
    clearInterval(sampler);
    said.push(`  times from the old app's launch: ${timed()}`);
    const afterYield = spineFiles(s.userData);
    await old.page.waitForTimeout(10_000);
    expect(spineFiles(s.userData), 'no writer at idle: every spine file byte-identical over 10 s after the release, and none new').toEqual(afterYield);
    expect(isAlive(daemon) ? spineFilesOpen(daemon, s.userData) : [], 'the window’s end: the post-D mawsd holds no spine file open').toEqual([]);
    said.push(`  refused: ${daemonSaid().split('\n').find((line) => line.includes(`refuse wire to appPid ${oldPid}`))?.trim()}`);
    said.push(`  yielded: ${daemonSaid().split('\n').filter((line) => line.includes('[spine] ')).map((line) => line.trim()).join(' | ')}`);
    said.push(`  the old app's index: ${old.output().split('\n').find((line) => line.includes('is newer than this app knows'))?.trim()}`);
    said.push(`  no writer at idle: spine files unchanged over 10 s after the release (${afterYield.size} entries); the post-D mawsd held none open at the release and at the end`);
    // O2's downgrade (D29), recorded, not asserted
    const lock = s.daemonLock();
    said.push(`  then (O2's downgrade, D29; recorded only): mawsd pid ${daemon} ${isAlive(daemon) ? 'still runs' : `exited${s.daemonLog().includes('exited (restart, code 75)') ? ' 75 at the old app’s daemon.restart' : ''}`}; the profile’s mawsd lock names ${lock === null ? 'nothing' : `pid ${lock.pid}`}; spine.lock ${spineLockOf(s.userData) === null ? 'absent' : `names pid ${spineLockOf(s.userData)!.pid}`}`);
    record(said);
  });
});

// P5 O4 M4, acceptance 10's refusal (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D11, D31, D37, D45). This
// build's app on the daemon shape leaves its private `mawsd` running the connectors, over a grant it adopted (sealed as a
// pre-O4 build kept it, format 1, adopted to format 2 at a launch), with a short idle time and nothing live. The peer's
// app, from O3-D to before O4 (its hello lists `machine.spine` and no `machine.connectors`), is then launched on the
// daemon shape over it. Asserted:
//   1. the refusal on the three sockets the app says hello on: `mawsd`'s own `refuse wire` line on engine-host.sock,
//      machine.sock and pty-host.sock, naming `machine.connectors`;
//   2. the update banner: the refusal says at least one live session (D45), so the old app's main waits on it, and its
//      window says so;
//   3. the banner's promise: `mawsd` exits, by the restart if the old app's build check asked one, else by itself once
//      idle with only the refused app asking (a refused hello is no client on its idle clock); and a `mawsd` of this
//      build that a restart re-executed exits by its idle clock too.
// Recorded, not asserted: the old app's build check (src/main/hosts/daemon.ts asks a private daemon of another build
// `daemon.restart` at the machine host's first ready), D11's residual (what the refused app's `connectors.servers`
// answers, and whether its Connectors sheet, with a Forget that would unlink a file, can be reached, from the page's tab
// this build's app left open, else from the library), and what follows the idle exit: which build's `mawsd` the profile
// runs next, and whether the old app's next hello gets through. Skipped for an O2-era peer (the (pre-O3 app, daemon)
// scene's) and for a peer that lists `machine.connectors` (an app from O4 on: no refusal to show), so the scene stays
// right once O4 lands on master.
const BUILD_CHECK_WINDOW_MS = 10_000; // the refused app watched this long after its banner, for its build check
const PRE_O4_IDLE_MS = 90_000; // mawsd's idle time here (MAWS_E2E_SUPERVISOR_IDLE_MS): past the scene's reads of the refused app
const AFTER_EXIT_MS = 30_000; // what follows the idle exit, watched this long (the old app asks again every 5 s)
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('(pre-O4 app, daemon) an app from before O4 over this build’s mawsd is refused on its three sockets, naming machine.connectors, shows the update banner, and mawsd still exits once idle; its build check, its reach to a Connectors sheet and what follows the exit are recorded', async () => {
  test.setTimeout(480_000);
  const { here, peer } = builds();
  const spineReader = peer.manifest.capabilities.includes(MACHINE_SPINE_CAPABILITY);
  test.skip(!appObeysConnectors(here) || !spineReader || appObeysConnectors(peer), `the peer (wire ${wireOf(peer)}) is not an app from O3-D to before O4: it lists ${spineReader ? CONNECTORS_CLIENT_CAPABILITY : `no ${MACHINE_SPINE_CAPABILITY} (the (pre-O3 app, daemon) scene's peer)`}`);
  await withScratch('xb-pre-o4', async (s) => {
    const said = [`${here.label} (wire ${wireOf(here)}) on the daemon shape runs the connectors in its mawsd; ${peer.label} (wire ${wireOf(peer)}), from before O4, launches on the daemon shape over it`];
    const env = { MAWS_HOST_MODE: 'daemon', MAWS_E2E_SUPERVISOR_IDLE_MS: String(PRE_O4_IDLE_MS) }; // mawsd's idle time, through its spine's host.configure
    // this build's app: a grant sealed as a pre-O4 build kept it, and a page whose header offers the Connectors sheet,
    // its tab left open; the grant's file is written after the quit, so the next launch adopts it
    const first = await s.launch(env);
    await s.ready(first.page, onShape('daemon'));
    const grant = await sealLegacyGrant(first, s);
    const artifactId = await createGrantsPage(first.page);
    expect((await openGrantsSheet(first.page, artifactId)).missing, 'this build’s Connectors sheet opens from the page’s header').toBeNull();
    await s.quit(first);
    writeLegacySealed(oauthDirOf(s.userData), grant.id, grant.sealed);
    const second = await s.launch(env);
    const served = await s.ready(second.page, onShape('daemon'));
    const daemon = served.daemon!.pid;
    const ours = served.daemon!.build.buildId;
    await expectAdopted(second, s, grant.id);
    await s.quit(second);
    const quitAt = Date.now();
    expect(isAlive(daemon), 'this build’s mawsd outlives its app').toBe(true);
    said.push(`  this build's mawsd pid ${daemon} (build ${ours}) runs, idle time ${PRE_O4_IDLE_MS / 1000} s, nothing live; grant ${grant.id} adopted (format 2)`);
    const logFrom = s.daemonLog().length; // what this build's mawsd says from here

    // the pre-O4 app, on the daemon shape over it
    const old = await s.launch({ MAWS_HOST_MODE: 'daemon' }, peer.root);
    const oldPid = old.child.pid!;
    const daemonSaid = () => s.daemonLog().slice(logFrom);
    const sockets = ['engine-host.sock', 'machine.sock', 'pty-host.sock'] as const;
    const refusal = (socket: string) => new RegExp(`${literally(socket)}: refuse wire to appPid ${oldPid} \\(build [^)]+\\): its hello lists no ${literally(CONNECTORS_CLIENT_CAPABILITY)}`);
    const updateBanner = banner(old.page, 'MAWS was updated and cannot talk to the previous supervisor');
    const evidence = (label: string) => test.info().attach(label, { body: `${said.join('\n')}\n\n--- mawsd.log since the old app's launch\n${daemonSaid()}\n--- the old app's output\n${old.output()}`, contentType: 'text/plain' });
    try {
      // 1. the refusal on the three sockets
      for (const socket of sockets) await expect.poll(daemonSaid, { timeout: 30_000, message: `mawsd refuses the old app’s hello on ${socket}, naming ${CONNECTORS_CLIENT_CAPABILITY}` }).toMatch(refusal(socket));
      // 2. the update banner: the refusal says a session is live (D45), so the old app's main waits on it
      await expect.poll(() => old.output(), { timeout: 30_000, message: 'the old app’s main reads the refusal of its wire and waits on it' }).toMatch(/is incompatible \(wire\) and runs [1-9]\d* sessions; waiting/);
      await expect(updateBanner, 'the old app’s update banner').toBeVisible({ timeout: 30_000 });
    } catch (error) {
      await evidence('pre-o4-refusal');
      throw error;
    }
    said.push(`  refused: ${sockets.map((socket) => daemonSaid().split('\n').find((line) => refusal(socket).test(line))?.trim()).join(' | ')}`);
    said.push(`  the old app: ${old.output().split('\n').find((line) => /is incompatible \(wire\)/.test(line))?.trim()}; its banner: ${(await updateBanner.textContent())?.trim()}`);
    said.push(`  the spine: ${daemonSaid().includes(`[spine] yielding to pid ${oldPid}`) ? `yielded to pid ${oldPid}` : 'not yielded to the refused app'}`);

    // recorded: the old app's build check
    await old.page.waitForTimeout(BUILD_CHECK_WINDOW_MS);
    const checked = daemonSaid();
    const asked = checked.indexOf('restart asked');
    said.push(`  the build check (recorded): ${asked < 0 ? `no daemon.restart from the old app within ${BUILD_CHECK_WINDOW_MS / 1000} s of its banner` : `the old app asked daemon.restart; mawsd pid ${daemon} ${isAlive(daemon) ? 'still runs' : 'exited'}`}`);

    // recorded: D11's residual, what the refused app can still reach of the sealed store
    const listed = await unreadableRows(old.page, artifactId);
    const reach = await openGrantsSheet(old.page, artifactId, true);
    const shown = reach.missing === null ? await unreadableRowsShown(old.page).count() : 0;
    said.push(
      `  D11's residual (recorded, ${Math.round((Date.now() - quitAt) / 1000)} s after this build's app quit, mawsd ${isAlive(daemon) ? 'still up' : 'gone'}): the refused app's connectors.servers ${typeof listed === 'string' ? `answers ${listed}` : `lists ${listed.length} unreadable rows${listed.includes(grant.id) ? ', the adopted grant among them' : ''}`}; its Connectors sheet, sought from ${reach.from}, ${reach.missing === null ? `opens, with ${shown} unreadable rows, each with a Forget that would unlink its file` : `is not reachable: ${reach.missing} did not show`}`,
    );
    expect(sealedFormat(s.userData, grant.id), 'the adopted grant is as this build left it').toBe(2);

    // 3. the banner's promise: mawsd exits, by the restart the build check asked or, the refused app its only asker, by
    // its idle clock (the restart is read again at the exit: one asked after the window above is still the old app's)
    let restarted = asked >= 0;
    try {
      await expect.poll(() => isAlive(daemon), { timeout: PRE_O4_IDLE_MS + 60_000, message: restarted ? 'mawsd exits at the restart the old app asked' : 'mawsd exits once idle, with only the refused app asking' }).toBe(false);
      restarted = daemonSaid().includes('restart asked');
      expect(daemonSaid(), restarted ? 'its exit by the restart' : 'its idle exit').toMatch(restarted ? /restart asked\n(?:.*\n)*?.*exiting \(restart\)/ : /no client, both hosts parked and no hold for the idle time\n(?:.*\n)*?.*exiting \(idle\)/);
    } catch (error) {
      await evidence('pre-o4-exit');
      throw error;
    }
    const exitedAt = Date.now();
    const exitLogAt = s.daemonLog().length;
    const oldFrom = old.output().length;
    said.push(`  the exit: mawsd pid ${daemon} gone ${Math.round((exitedAt - quitAt) / 1000)} s after this build's app quit, ${restarted ? 'by the restart the old app asked' : 'by its idle clock'}`);

    // recorded: what follows the exit, as the old app asks again
    await old.page.waitForTimeout(AFTER_EXIT_MS);
    const lock = s.daemonLock();
    const oldBuild = await invoke(old.page, 'host.status', undefined).then((answer) => (answer.ok ? answer.value.appBuildId : null), () => null);
    const whose = lock === null ? 'none' : lock.buildId === ours ? 'this build’s' : lock.buildId === oldBuild ? 'the old app’s build' : 'another build';
    const connected = old.output().slice(oldFrom).split('\n').filter((line) => line.includes('connected to supervisor pid')).map((line) => line.trim());
    said.push(
      `  after the exit (recorded, ${AFTER_EXIT_MS / 1000} s): the profile's mawsd ${lock === null ? 'is none' : `is pid ${lock.pid} build ${lock.buildId} (${whose}), ${isAlive(lock.pid) ? 'running' : 'gone'}`}; the old app ${connected.length > 0 ? `got through: ${connected.join(' | ')}` : 'got no welcome'}; its banner ${(await updateBanner.count()) > 0 ? 'still shows' : 'is gone'}`,
    );

    // 3, after a restart: a mawsd of this build that it re-executed keeps the banner's promise too, exiting by its idle
    // clock with only the refused app asking (no app of this build configures it: its idle time is the default's)
    if (restarted && lock !== null && lock.pid !== daemon && lock.buildId === ours) {
      test.setTimeout(test.info().timeout + DEFAULT_IDLE_EXIT_MS + 120_000);
      const replacementSaid = () => s.daemonLog().slice(exitLogAt);
      try {
        await expect.poll(() => isAlive(lock.pid), { timeout: DEFAULT_IDLE_EXIT_MS + 60_000, message: `the replacement mawsd pid ${lock.pid} of this build exits once idle, with only the refused app asking` }).toBe(false);
        expect(replacementSaid(), 'the replacement’s idle exit').toMatch(/no client, both hosts parked and no hold for the idle time\n(?:.*\n)*?.*exiting \(idle\)/);
      } catch (error) {
        await evidence('pre-o4-replacement-exit');
        throw error;
      }
      said.push(`  the replacement: mawsd pid ${lock.pid} of this build, re-executed by the restart, exited by its idle clock`);
    }
    record(said);
  });
});

// ---- P5 O5 M4: the render service across builds, on a unit `mawsd` of the other build (acceptance 10) ------------------

const rendersOn = (build: Build) => build.manifest.capabilities.includes('machine.render');
const UNIT_SKIP = process.platform !== 'darwin' ? 'a unit mawsd is a LaunchAgent: macOS alone' : ciRefusal(process.env);
// The unit's environment beside its own: the e2e mark (its seams, daemon.e2eRender), the scratch engine store and usage
// directory, as a launch gives a private daemon (./support/scratch-env.ts)
const unitEnv = (userData: string): Record<string, string> => ({ MAWS_E2E: '1', CLAUDE_CONFIG_DIR: join(userData, 'claude-config'), MAWS_CLAUDE_USAGE_DIR: join(userData, 'claude-usage'), MAWS_MACHINE_ROLE: 'laptop' });
const RENDER_PAGE = '<!doctype html><html><head><title>Render</title></head><body style="margin:0;background:#2a6"><p>CROSS_BUILD_RENDER</p></body></html>';

async function withUnit(s: Scratch, build: Build, name: string, body: (unit: UnitDaemon) => Promise<void>): Promise<void> {
  const unit = await installUnitDaemon({ root: build.root ?? REPO_ROOT, userData: s.userData, label: e2eLabel(runIdOf(process.env), name), env: unitEnv(s.userData) });
  s.daemons.add(unit.pid);
  try {
    await body(unit);
  } finally {
    unit.remove(); // before the scratch's cleanup ends its processes: KeepAlive would restart a killed unit
  }
}

async function createPage(run: Run): Promise<{ id: string; revision: number }> {
  const created = (await run.page.evaluate(
    (html) => window.maws.invoke('artifacts.create' as never, { kind: 'html', title: 'Cross-build render', content: { bytes: new TextEncoder().encode(html), name: 'index.html' } } as never),
    RENDER_PAGE,
  )) as { ok: true; value: { artifact: { id: string; revision: number } } } | { ok: false; error: { message: string } };
  if (!created.ok) throw new Error(`artifacts.create failed: ${created.error.message}`);
  return created.value.artifact;
}
const exported = async (run: Run, input: Record<string, unknown>) => {
  const answer = (await run.page.evaluate((i) => window.maws.invoke('artifacts.export' as never, i as never), input)) as { ok: true; value: { path: string; revision: number } } | { ok: false; error: { code: string; message: string } };
  if (!answer.ok) throw new Error(`artifacts.export ${JSON.stringify(input)}: ${answer.error.code} ${answer.error.message}`);
  return answer.value;
};
const machineWelcome = (output: string, daemonPid: number) => output.split('\n').filter((line) => line.includes(`connected to supervisor pid ${daemonPid} build `)).at(-1) ?? '';

test('(update, render) this build’s app on the peer’s unit mawsd, which lists no machine.render: main keeps its capture and export services; the library’s Export and Send to’s are answered in main', async () => {
  const { here, peer, newer } = builds();
  test.skip(here !== newer || rendersOn(peer) || !rendersOn(here) || !peer.manifest.capabilities.includes('machine.spine'), `the peer (wire ${wireOf(peer)}) is not an older build of the daemon shape before the render service`);
  test.skip(UNIT_SKIP !== null, UNIT_SKIP ?? '');
  await withScratch('xb-render-update', async (s) => {
    await withUnit(s, peer, 'xb-render-update', async (unit) => {
      const said = [`${here.label} (wire ${wireOf(here)}) on ${peer.label}'s unit mawsd (wire ${wireOf(peer)}), pid ${unit.pid}`];
      const run = await s.launch({ MAWS_HOST_MODE: 'daemon' });
      await s.ready(run.page, (st) => st.daemon?.pid === unit.pid, 60_000);
      expect(run.output(), 'the build check leaves a unit of another bundle as it is').toContain(`mawsd pid ${unit.pid} runs build `);
      expect(run.output()).toContain('its unit runs another bundle, so it is left as it is');
      const welcome = machineWelcome(run.output(), unit.pid);
      expect(welcome, "main's log: the unit mawsd's welcome").not.toBe('');
      expect(welcome, 'the peer’s mawsd lists no machine.render').not.toContain('machine.render');

      const { id, revision } = await createPage(run);
      const page = await run.maws.app.evaluate(async ({ session }, url) => {
        const response = await session.defaultSession.fetch(url);
        return { status: response.status, text: await response.text() };
      }, `maws-artifact://${id}/live/index.html`);
      expect(page.status, 'the page loads through main’s handler').toBe(200);
      expect(page.text).toContain('CROSS_BUILD_RENDER');
      // main's capture service, composed as today: the capture seam runs it in main (__maws_captures)
      const captured = (await run.maws.app.evaluate(
        (_electron, request) => (globalThis as unknown as { __maws_captures: { capture(r: unknown): Promise<{ ok: boolean; width?: number; error?: string }> } }).__maws_captures.capture(request),
        { appSessionId: 'xb-render', requestId: 'xb-render-1', artifactId: id, revision, width: 640, height: 480 },
      )) as { ok: boolean; width?: number; error?: string };
      expect(captured, JSON.stringify(captured).slice(0, 300)).toMatchObject({ ok: true, width: 640 });
      // artifacts.export, machine-owned: the router answers it in main while the daemon lists no machine.render
      const pdf = await exported(run, { artifactId: id, format: 'pdf' });
      expect(pdf.path.startsWith(join(s.userData, 'artifacts', id, 'exports'))).toBe(true);
      expect(readFileSync(pdf.path).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const sendTo = await exported(run, { artifactId: id, format: 'png', width: 640, height: 480, dialect: 'notion' }); // Send to's export, its dialect on the wire
      expect(readFileSync(sendTo.path).subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(s.daemonLog(), 'the peer’s mawsd rendered nothing').not.toMatch(/\[render\]|\[render-host\]/);
      said.push(`  welcome: ${welcome.trim()}`, `  page, capture (640x480), library Export (${pdf.path}) and Send to's export (${sendTo.path}) answered in main`);
      await s.quit(run);
      record(said);
    });
  });
});

test('(downgrade, render) the peer’s app on this build’s unit mawsd: its library Export stays its main’s, and the unit’s render seam renders beside it', async () => {
  const { here, peer } = builds();
  test.skip(rendersOn(peer) || !rendersOn(here) || !peer.manifest.capabilities.includes('machine.spine'), `the peer (wire ${wireOf(peer)}) is not a build of the daemon shape before the render service`);
  // P5 O4 (D11): this build's mawsd refuses an app from O3-D to before O4, which every peer before the render service is;
  // the (pre-O4 app, daemon) scene holds that refusal, so the pair is not staged here
  test.skip(appObeysConnectors(here) && !appObeysConnectors(peer), `this build’s mawsd refuses the peer’s app (wire ${wireOf(peer)}), which lists no ${CONNECTORS_CLIENT_CAPABILITY}: the (pre-O4 app, daemon) scene's`);
  test.skip(UNIT_SKIP !== null, UNIT_SKIP ?? '');
  await withScratch('xb-render-downgrade', async (s) => {
    await withUnit(s, here, 'xb-render-downgrade', async (unit) => {
      const said = [`${peer.label} (wire ${wireOf(peer)}) on ${here.label}'s unit mawsd (wire ${wireOf(here)}), pid ${unit.pid}`];
      const run = await s.launch({ MAWS_HOST_MODE: 'daemon' }, peer.root);
      await s.ready(run.page, (st) => st.daemon?.pid === unit.pid, 60_000);
      expect(machineWelcome(run.output(), unit.pid), 'this build’s mawsd lists machine.render, which the peer’s main does not read').toContain('machine.render');
      const { id, revision } = await createPage(run);
      const pdf = await exported(run, { artifactId: id, format: 'pdf' }); // the peer's registry keeps artifacts.export main's
      expect(readFileSync(pdf.path).subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(s.daemonLog(), 'the peer’s library Export is its main’s: no render host').not.toContain('[render] starting the render host');

      const windows = () => run.maws.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
      const before = await windows();
      const to = join(s.root, 'render-downgrade.png');
      await unit.request('daemon.e2eRender', { artifactId: id, revision, width: 640, height: 480, to }, 120_000);
      const png = readFileSync(to);
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([640, 480]);
      expect(s.daemonLog(), 'the unit’s mawsd started its render host for the capture').toContain('[render] starting the render host for artifact_screenshot');
      expect((await unit.status()).render, 'daemon.status.render').toMatchObject({ state: 'ready', starts: 1 });
      expect(await windows(), 'no capture window in the peer’s main').toBe(before);
      said.push(`  the peer's library Export in its main (${pdf.path}); the unit's render seam captured ${id} at 640x480 beside it`);
      await s.quit(run);
      record(said);
    });
  });
});
