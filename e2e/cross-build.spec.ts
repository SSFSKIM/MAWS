// The two-build cross-minor check (P5 OX1: O1's execution document, M6 and its residue 11; docs/tech-debt-tracker.md's
// row "No real two-build check exists"; O6's residue 38): this checkout's built app against another build's supervisor
// on one profile, and the other build's app against this one's. The other build is the peer the gate checked out and
// built beside this checkout (MAWS_E2E_PEER_ROOT: its root, with its own out/ and node_modules; gate.yml's PEER_E2E and
// the `Peer:` trailer scripts/ci-gate.sh writes, the merge base with master unless `--peer` names another). Without a
// peer the group runs nothing. Of the two builds the older is the one of the lower WIRE_MINOR (on a tie, the peer).
//   (update)    the older app starts a kept session and quits with keep; the newer app attaches to its supervisor;
//   (downgrade) the newer app keeps the session; the older one attaches.
// P5 O15 M1 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md): both apps run on the daemon shape there, the
// crossing every swap makes: the attaching app meets the keeper's private `mawsd`, of the other build, and its build
// check has it restart onto the attacher's (src/main/hosts/daemon.ts, watchDaemon), the kept engine host running on
// under the new `mawsd`. A peer this build's `mawsd` refuses (one before O4, whose app lists no `machine.connectors`:
// D11) skips both, saying so; the scenes below that pin the peer to its embedded shape cover it, where the peer still
// has that shape.
// In each, the attaching app's hello crosses the minor (host.log names the app's wire, the app's main the supervisor's),
// the app is served as another build (`matches: 'build'`, the update banner, exit-when-idle armed), the kept session's
// tail reaches its main (the auto-mode denial journaled while no app ran raises the Needs-you item only main's live
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
// `mawsd` is the engine host's client, the peer on the embedded shape's detached supervisor, which every build from
// E10 to O15 M2 has and a build before O2 is limited to. A peer from after O15 M2 has no embedded shape (its app runs on
// `mawsd` whatever MAWS_HOST_MODE says), so both skip for it, saying so: (update) and (downgrade) cross such a peer.
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
//   (downgrade, render) retired at O5's landing 2: the pair it staged, a pre-render peer's app on this build's unit
//                       `mawsd`, is one this build's `mawsd` refuses (D11: every peer before the render service predates
//                       O4), and every later peer renders, so it could only skip. The (pre-O4 app, daemon) scene holds
//                       the refusal; the unit's render seam is held by e2e:daemon-unit and daemon-render.test.ts.
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
// UX wave U7a: (sidebar, both ways), a layout key one build stores and the other does not know, read across the two
// builds in both directions; its block is at the end of this file, and its row is in U13a's UC-14 coverage table.
// UX wave U7b: (destinations, both ways), the pages' key and the four retired tab kinds, the same way; its block follows
// (sidebar, both ways), and its rows are in the same table.
// Run by `pnpm e2e:cross-build` (MAWS_CROSS_BUILD_E2E=1), which the gate adds to a run whose tree and peer differ in
// WIRE_MINOR (.github/scripts/gate-plan.mjs).
import { execFileSync } from 'node:child_process'; // UX wave U8c-2: git and the index, read as a person would
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { HostStatus } from '@shared/ipc/schema/host';
import type { CommandInput, CommandResult } from '@shared/ipc/schema';
import { classifyWireChange, type WireManifest } from '@shared/ipc/wire';
import { daemonPaths } from '@shared/daemon/files';
import { RELAY_URL } from '../src/engine-host/launch'; // P5 O7 M9
import { slugOf } from '../src/engine-host/fs/paths'; // UX wave U8c-2: the engine's project folder of a path
import { isolatedGitEnv } from '../test/support/git-env'; // UX wave U8c-2
import { CONNECTORS_CAPABILITY, CONNECTORS_CLIENT_CAPABILITY, HOLDER_CAPABILITY, MACHINE_SPINE_CAPABILITY } from '@shared/host/socket-protocol';
import { DEFAULT_IDLE_EXIT_MS } from '../src/mawsd/clocks';
import { reachMachine } from '../src/mawsd/machine-client';
import { answered, ENGINE_HOST_BROWSER_WORK, SCREENCAST, startPages as startHeadlessPages } from './support/headless-browser'; // P5 O17 M8; M7: the pre-O17 app's cell
import { connectorControl, writeCuaEngine, type ConnectorControl } from '../test/support/cua-engine'; // P5 O17 M7
import { invoke, replaySpec, turnsJournal, value } from './support/c7-replay';
import { AgentSeam } from './support/dashboards';
import { DATASET, readDataset, SOURCE, writeBoard } from './support/live-data';
import { readSealedText } from './support/connector-direct-checks';
import { expectMockCustody } from './support/connector-direct-oauth';
import { placeholderGrantText, sealWithAppSafeStorage, writeLegacySealed } from './support/connector-oauth';
import { ciRefusal, e2eLabel, runIdOf } from './support/daemon-unit-guard.mjs';
import { installUnitDaemon, type UnitDaemon } from './support/unit-daemon';
import { REPO_ROOT } from './support/launch';
import { addressed } from './support/address'; // U13a
import { menu } from './support/menu'; // U13a: Settings and the split
import { activeMainTab, mainTabById, mainTabs, moveSideTab, openArtifactInPanel, openSurface, pageRegion, pinSurfaceForSessions, sessionCard, sessionCards, sideColumn, sideGroup, sideTab, sideTabNames, settingsDialog, surfaceRow, unfoldSessionCard } from './support/shell'; // U13a; UX wave U8b: the side column's groups and tabs; UX wave U7b: the page and the dialog; U8c-2: unfoldSessionCard
import { sidebarOf, sidebarRow } from './support/sidebar'; // U13a; UX wave U7a: sidebarOf
import { answerOf, fitTo, refusedSample, sampleOf, samplesFor, type ProbeAnswer } from './support/cross-build-samples';
import { endProfileProcesses, isAlive } from './support/processes';
import { spineFiles, spineFilesOpen } from '../test/support/spine-files';
import { adoptedOf, attentionOf, eventsOf, isRequestRow, isTailItemRow, pendingPermissions, PERMISSION, PROMPT, statusOf, suffix, TAIL_ITEM, tailFixture, withScratch, type JournalRow, type Run, type Scratch } from './support/supervisor-scratch';
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
// P5 O15 M1: (update) and (downgrade) run both builds on the daemon shape
const ON_MAWSD: Shapes = { keeper: 'daemon', attacher: 'daemon' };
const onShape = (shape: Shape) => (st: HostStatus) => shape === 'detached' || st.daemon !== null; // the daemon shape's main also knows its mawsd
// P5 O15 M1: and the attacher's on its own `mawsd`, not the keeper's it met first and had restart (`keeperDaemon`)
const onOwnShape = (shape: Shape, keeperDaemon: number | null) => (st: HostStatus) => onShape(shape)(st) && (shape === 'detached' || st.daemon!.pid !== keeperDaemon);
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
// P5 O15 M1: what an app's build check logs as it asks a private `mawsd` of another build to restart (src/main/hosts/daemon.ts,
// watchDaemon; the same words at the merge-base peer)
const restartAsked = (daemonPid: number) => new RegExp(`\\[hosts\\] mawsd pid ${daemonPid} runs build \\S+, this app's is \\S+; asking it to restart`);
const recyclesTo = (daemonLog: string, hostPid: number) => daemonLog.split('\n').filter((l) => l.includes(`recycling the connection to pid ${hostPid}`)).length;

// P5 O4 M4: what a scene adds to a crossing, each answering the lines it records: `keeperReady`, once the keeper's app
// is on its own supervisor, before its session; `attacherMoved`, at the end, the attacher on a supervisor of its build;
// on the daemon attacher's two reattaches (acceptance 9), while no app runs: `awayOnKept`, the kept older engine host
// serving, `awayOnOwn`, the engine host of the attacher's build serving. `env`, added to every launch's.
interface CrossingSteps {
  env?: Record<string, string>;
  keeperReady?(run: Run): Promise<string[]>;
  awayOnKept?(id: AppSessionId): Promise<string[]>; // P5 O17 M8: the kept session's id
  awayOnOwn?(id: AppSessionId): Promise<string[]>;
  attacherMoved?(run: Run): Promise<string[]>;
}

async function crossing(s: Scratch, keeper: Build, attacher: Build, gap: { newer: Build; older: Build } | null, shapes: Shapes, steps: CrossingSteps = {}): Promise<string[]> {
  if (holds(keeper) && holds(attacher)) return handedOverCrossing(s, keeper, attacher, shapes, steps); // P5 O16 M3c
  const shapeOf = (shape: Shape) => (shape === 'daemon' ? ' on the daemon shape' : '');
  const said: string[] = [`${keeper.label} (wire ${wireOf(keeper)})${shapeOf(shapes.keeper)} keeps a session; ${attacher.label} (wire ${wireOf(attacher)})${shapeOf(shapes.attacher)} attaches`];

  // the keeper: a paced replay kept across a quit, its auto-mode denial and its request still ahead
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
  expect(atQuit.filter((r) => isTailItemRow(r) || isRequestRow(r)), 'the denial and the request come after the app has exited').toEqual([]);
  await expect.poll(() => s.journal(id).some(isRequestRow), { timeout: 30_000, message: 'the request reaches the journal while no app runs' }).toBe(true);

  // the other build's app attaches, and is served as another build until the kept sessions are idle
  const idleMs = shapes.attacher === 'daemon' ? REATTACH_IDLE_MS : IDLE_MS;
  // P5 O7 M9: the journal the service's legacy launch on the older host plays (its replay seam hands it to that start)
  const legacyRoute = routesMachine(attacher) && !routesMachine(keeper) ? turnsJournal(s.root, 'machine-legacy', 1) : null;
  const attach = () => s.launch({ MAWS_HOST_MODE: shapes.attacher, MAWS_E2E_SUPERVISOR_IDLE_MS: String(idleMs), ...(legacyRoute !== null && { MAWS_E2E_REPLAY_FIXTURES: legacyRoute }), ...steps.env }, attacher.root);
  let second = await attach();
  const attacherRuns: Run[] = [second]; // P5 O3-D M6: the attacher's launches (acceptance 9 quits and reattaches it)
  const served = await s.ready(second.page, (st) => st.supervisor!.exitWhenIdle && onOwnShape(shapes.attacher, keeperDaemon)(st));
  expect(served, `${attacher.label} served by ${keeper.label}'s supervisor`).toMatchObject({ matches: 'build', supervisor: { pid: kept.pid, buildId: kept.buildId, liveSessions: 1, exitWhenIdle: true } });
  const build = served.appBuildId;
  expect(build, 'two builds').not.toBe(kept.buildId);
  await expect(banner(second.page, 'MAWS was updated.')).toContainText('1 session is still running');
  // UX wave U1a (§F): the signal that keeps a plan's mode away under an engine host of another build, as the window
  // holds it: attached, the engine host's wire fingerprint is the kept build's and not this app's, wherever the two
  // builds' registries differ; once the app has moved to a supervisor of its own build, the two are equal (below)
  const registriesDiffer = !isDeepStrictEqual(keeper.manifest.entries, attacher.manifest.entries);
  if (registriesDiffer) expect(served.supervisor!.wire, "attached: the kept engine host's wire fingerprint, not the app's").not.toBe(served.appWire);
  said.push(`  plan-mode gate: supervisor.wire ${served.supervisor!.wire === served.appWire ? 'equals' : 'differs from'} appWire while attached${registriesDiffer ? '' : ' (the registries are equal)'}`);
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
    // How the keeper's `mawsd` goes depends on the attacher's build and shape. On the daemon shape (P5 O15 M1) its build
    // check asks that `mawsd`, of another build, to restart, and its own serves the kept engine host. One that knows the
    // daemon shape (P5 O2, wire minor 5) launched embedded leaves it on purpose: on a profile with a `mawsd`, it ends that
    // `mawsd` before its own hosts start (src/main/hosts/daemon.ts, prepareShape and leaveDaemonShape), and the kept
    // engine host runs on. One from before O2 takes the engine host from the `mawsd`, which stops reaching it and exits 0
    // (residue 38).
    const leaves = attacher.manifest.minor >= DAEMON_SHAPE_MINOR;
    await expect.poll(() => isAlive(keeperDaemon), { timeout: 15_000, message: 'the keeper’s mawsd exits once the engine host is taken' }).toBe(false);
    if (shapes.attacher === 'daemon') {
      expect(second.output(), `${attacher.label}'s main asks the keeper's mawsd, of another build, to restart`).toMatch(restartAsked(keeperDaemon));
      said.push(`  mawsd pid ${keeperDaemon} exited: ${attacher.label}'s app had it restart onto its own build, pid ${attacherDaemon}`);
    } else if (leaves) {
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
  const denial = atAttach.find((e) => e.kind === 'tool.result' && e.denial === 'automode-unavailable');
  expect(denial && seqOf(denial), 'the denial was journaled after the keeper had exited').toBeGreaterThan(seqAtQuit);
  // P5 O3-D M6 (the architect's ruling; O3 Decision Log 5(1)): on a pre-A attacher after this build's mawsd held the
  // stream, the denial's item is the one gap of the downgrade. mawsd, the engine host's permanent client while no app
  // ran, took the tail (the host's connect burst sends only what no client has received, src/engine-host/session-stream.ts
  // `republish`) and its spine derived the item into the index at 14, which a pre-A app cannot read (its 13): so neither
  // the item nor the events reach the old app. Every other check of the scene runs. Without the daemon no client takes
  // the tail while away, and the burst brings it to the old app, which derives the item live.
  const derivedUnreadable = shapes.keeper === 'daemon' && !takesSpineLock(attacher);
  if (derivedUnreadable) {
    test.info().annotations.push({ type: 'skipped check', description: `the denial's Needs-you item, derived from the tail: ${attacher.label} (wire ${wireOf(attacher)}) is from before O3-A; this build's mawsd took the tail while away and derived the item into the index at 14, which it cannot read (O3 DL 5(1))` });
    said.push(`  tail: the denial's Needs-you item not checked: ${attacher.label} is from before O3-A and cannot read the index at 14 where mawsd derived it (O3 DL 5(1))`);
  } else {
    await expect.poll(async () => (await attentionOf(second.page, id, 'auto_mode_unavailable')).map((i) => i.summary), { message: 'the denial’s Needs-you item, derived from the tail' }).toEqual([TAIL_ITEM]);
  }
  await expect.poll(async () => (await pendingPermissions(second.page, id)).length, { message: 'the request raised while away' }).toBe(1);
  said.push(`  tail: ${atAttach.filter((e) => seqOf(e) > seqAtQuit).length} events journaled after the keeper's quit; ${derivedUnreadable ? "the request's item" : "the denial's item and the request's"} reached main`);

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
  if (legacyRoute !== null) said.push(...(await machineRouteOnOlderHost(s, second.page, keeper))); // P5 O7 M9

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
  expect(moved.supervisor!.wire, "moved (U1a §F): the engine host's wire fingerprint is the app's").toBe(moved.appWire);
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

  // the keeper: a paced stub launch kept across a quit, its auto-mode denial and its request still ahead
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
  const served = await s.ready(second.page, (st) => st.supervisor!.pid !== kept.pid && onOwnShape(shapes.attacher, keeperDaemon)(st), 90_000);
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
    if (shapes.attacher === 'daemon') expect(second.output(), `${attacher.label}'s main asks the keeper's mawsd, of another build, to restart`).toMatch(restartAsked(keeperDaemon)); // P5 O15 M1
    else expect(second.output(), `${attacher.label}'s main ends the profile's mawsd as it leaves the daemon shape`).toContain(`[hosts] ending mawsd, pid ${keeperDaemon}, as the profile leaves the daemon shape`);
  }
  await expect.poll(() => adoptedOf(second.page, id), { timeout: 60_000, message: 'the kept session adopted' }).toBe(true);
  expect((await statusOf(second.page, id)).pid, 'the same engine process').toBe(engine);
  said.push(`  hello: ${hello}…`, `  handed over: supervisor pid ${kept.pid} (build ${kept.buildId}) exited by the handover; pid ${served.supervisor!.pid} (build ${build}) adopted the session (engine pid ${engine})`);

  // the tail: what was journaled while no app ran reaches this main, its live derivation included
  const atAttach = await eventsOf(second.page, id);
  const seqOf = (e: SessionEvent) => Number(suffix(e.id).split(':')[0]);
  expect(atAttach.filter((e) => seqOf(e) > seqAtQuit).length, 'events from rows journaled after the keeper had exited').toBeGreaterThan(0);
  await expect.poll(async () => (await attentionOf(second.page, id, 'auto_mode_unavailable')).map((i) => i.summary), { message: 'the denial’s Needs-you item, derived from the tail' }).toEqual([TAIL_ITEM]);
  await expect.poll(async () => (await pendingPermissions(second.page, id)).length, { message: 'the request raised while away, once' }).toBe(1);
  if (attacherDaemon !== null) said.push(await artifactPage(s, second, attacher.label, servesArtifacts(attacher)));
  said.push('  gap: not probed: the older supervisor never served this app (its session was handed over at the attach)');
  // P5 O7 M9: likewise the machine route on an older engine host (machineRouteOnOlderHost), which a peer from before
  // host.holder reaches
  if (routesMachine(attacher) && !routesMachine(keeper)) said.push(`  machine route on ${keeper.label}'s engine host: not driven, it never served this app (a peer before host.holder drives it)`);

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
// cursor), and the session's auto-mode denial is still one Needs-you item.
// Fix round 1 (the architect's ruling): M3's unit tests prove the outstanding-at-quit items (a bridge request, a hold, a
// remote subscription) against a fake older host; this scene ties that fake to the real one, each end in its own words.
// `mawsd`'s log: the kept host's welcome it chose its path from (no host.attachment listed), its recycles at the
// departure and at the reattach, and no host.attachment sent. The older host's log: its client leaving at the quit
// (`client disconnected`, which O2-era and current hosts both print) and a fresh one coming.
async function quitAndReattach(s: Scratch, run: Run, attach: () => Promise<Run>, runs: Run[], o: { kept: { pid: number }; daemon: number; id: AppSessionId; capable: boolean; connectors: boolean; away?: (id: AppSessionId) => Promise<string[]>; said: string[] }): Promise<Run> {
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
  if (o.away) o.said.push(...(await o.away(o.id))); // P5 O4 M4: the kept older host serving, no app
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
  // host: the spine heard no event while no app ran there); the refold adds no second item for the denial folded before
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
  expect((await attentionOf(next.page, o.id, 'auto_mode_unavailable')).map((i) => i.summary), 'the auto-mode denial is still one Needs-you item').toEqual([TAIL_ITEM]);
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
async function permanentAcrossReattach(s: Scratch, run: Run, attach: () => Promise<Run>, runs: Run[], o: { host: number; daemon: number; id: AppSessionId; connectors: boolean; away?: (id: AppSessionId) => Promise<string[]>; said: string[] }): Promise<Run> {
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
  if (o.away) o.said.push(...(await o.away(o.id))); // P5 O4 M4: the host of this build serving, no app
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

// P5 O7 M9 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M9 "The route"; its Proves, "an older engine host
// given the legacy route"): the machine's own route started by the attacher's session service (this build's) on the kept
// engine host of a build before M9, whose welcome lists no engine.route-machine. The machine's user settings (the
// profile's config home, which the service resolves the base URL over) are set per case and put back after:
// - none of the gateway keys and no base URL: the start goes, and the older host launches the legacy direct route (its
//   spawn row's settings blank the base URL), sent no `route`; the record keeps the route chosen, `machine`;
// - another host's base URL, or a token the machine sets with none: refused `route-unsupported`, nothing launched;
// - the relay's own URL with the relay down: refused with ROUTE_RELAY_UNSUPPORTED, Start anyway included (the older host
//   checks the relay on the legacy gateway route, so nothing could start past it).
// m9-2's service tests hold the same rules against a fake host (src/services/sessions/service.test.ts, "a host that
// predates the machine route"); this holds them against a real older engine host and this build's real wiring of its
// welcome. It runs where the older host serves the attacher, which a peer from before host.holder gives (--peer 95050efd1):
// a holder peer hands over at the attach, so the older host never serves this build's app.
const ROUTE_MACHINE_CAPABILITY = 'engine.route-machine';
const routesMachine = (build: Build) => build.manifest.capabilities.includes(ROUTE_MACHINE_CAPABILITY);
const ROUTE_UNSUPPORTED = "This machine's engine host predates the machine route; restart MAWS there, or choose gateway or direct for this session.";
const ROUTE_RELAY_UNSUPPORTED =
  "ClaudeUsage's relay isn't answering, and this machine's engine host predates the machine route, so it can't start past the relay check; wait for the relay, restart MAWS there, or choose direct for this session.";
async function machineRouteOnOlderHost(s: Scratch, page: Page, older: Build): Promise<string[]> {
  const said: string[] = [];
  const settings = join(s.userData, 'claude-config', 'settings.json');
  const before = existsSync(settings) ? readFileSync(settings, 'utf8') : null;
  const userEnv = (env: Record<string, string> | null) => writeFileSync(settings, JSON.stringify({ ...(before === null ? {} : (JSON.parse(before) as Record<string, unknown>)), ...(env !== null && { env }) }));
  const create = async () => value(await invoke(page, 'session.create', { projectId: null, location: { kind: 'directory', path: s.repo } })).appSessionId;
  const start = async (id: AppSessionId, options: { startAnyway?: true } = {}) => value(await invoke(page, 'session.start', { appSessionId: id, message: null, options: { route: 'machine', trust: 'declined', ...options } }));
  const refused = (id: AppSessionId, message: string) => ({ status: 'invalid', appSessionId: id, field: 'route', message });
  try {
    userEnv(null);
    const legacy = await create();
    expect(await start(legacy), 'no base URL and no gateway key: the start goes').toMatchObject({ status: 'starting' });
    await expect.poll(async () => { const st = await invoke(page, 'session.status', { appSessionId: legacy }); return st.ok ? st.value.process : null; }, { timeout: 60_000, message: `${older.label}'s engine host launches it` }).toBe('ready');
    const spawn = s.journal(legacy).find((r) => r.direction === 'meta' && r.frame.event === 'spawn')?.frame as { args?: string[] } | undefined;
    const args = spawn?.args ?? [];
    const blanked = (JSON.parse(args[args.indexOf('--settings') + 1] ?? '{}') as { env?: Record<string, string> }).env;
    expect(blanked?.ANTHROPIC_BASE_URL, `${older.label}'s engine host launched the legacy direct route (its spawn row: ${JSON.stringify(args)})`).toBe('');
    const status = await statusOf(page, legacy);
    expect(status.gateway.mode, 'the older host verified the legacy direct route').toBe('direct');
    expect(status.gateway, 'which carries no route of its own').not.toHaveProperty('route');
    expect(value(await invoke(page, 'session.get', { appSessionId: legacy }))?.gateway.route, 'the record keeps the route chosen').toBe('machine');
    value(await invoke(page, 'session.stop', { appSessionId: legacy, reason: 'stop' }));
    await expect.poll(async () => { const st = await invoke(page, 'session.status', { appSessionId: legacy }); return st.ok ? st.value.process : 'released'; }, { timeout: 60_000 }).not.toBe('ready');
    said.push(`  machine route on ${older.label}'s engine host (no engine.route-machine): no base URL and no gateway key launched the legacy direct route, no route sent`);

    for (const [what, env] of [['another host’s base URL', { ANTHROPIC_BASE_URL: 'https://inference.example.invalid' }], ['a token the machine sets, with no base URL', { ANTHROPIC_AUTH_TOKEN: 'machine-token' }]] as const) {
      userEnv(env);
      const id = await create();
      expect(await start(id), `${what}: route-unsupported`).toEqual(refused(id, ROUTE_UNSUPPORTED));
      expect(s.journal(id), `${what}: nothing launched`).toEqual([]);
      said.push(`  machine route, ${what}: refused route-unsupported, nothing launched`);
    }

    userEnv({ ANTHROPIC_BASE_URL: RELAY_URL });
    const relay = value(await invoke(page, 'engine.relayHealth', { force: true }));
    if (relay.ok) {
      test.info().annotations.push({ type: 'skipped check', description: `the dead relay's refusal: a relay answers at ${relay.url} on this runner` });
      said.push(`  machine route at the relay: not checked, a relay answers at ${relay.url}`);
    } else {
      const id = await create();
      expect(await start(id), 'the relay down: refused, with no sheet').toEqual(refused(id, ROUTE_RELAY_UNSUPPORTED));
      expect(await start(id, { startAnyway: true }), 'and Start anyway cannot pass it').toEqual(refused(id, ROUTE_RELAY_UNSUPPORTED));
      expect(s.journal(id)).toEqual([]);
      said.push(`  machine route at the relay, the relay down (${relay.url}): refused ROUTE_RELAY_UNSUPPORTED, Start anyway too`);
    }
  } finally {
    if (before === null) rmSync(settings, { force: true });
    else writeFileSync(settings, before);
  }
  return said;
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

// P5 O17 M8 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §A's cells with no app): whether a build's
// engine host lists `host.browserWork` in its welcome (its socket-protocol.ts's PEER_CAPABILITIES.engineHost line: the
// wire manifest's union lists the capability from O17 M3 on, before any engine host serves it), and the kept session's
// browser reading from this build's mawsd while no app runs: the headless route's screencast when the serving engine
// host lists it (macOS), else the old-host reason; on Linux the Linux reason whatever serves
function hostsBrowserWork(build: Build): boolean {
  if (build.root === undefined) return ENGINE_HOST_BROWSER_WORK;
  const path = join(build.root, 'src', 'shared', 'host', 'socket-protocol.ts');
  const line = existsSync(path) ? readFileSync(path, 'utf8').split('\n').find((l) => /^\s*engineHost:\s*\[/.test(l)) : undefined;
  return line !== undefined && /HOST_BROWSER_WORK_CAPABILITY|'host\.browserWork'/.test(line.slice(0, line.indexOf(']')));
}
async function browserWithNoApp(s: Scratch, id: AppSessionId, host: string, listsWork: boolean): Promise<string[]> {
  const expected = process.platform === 'linux' ? { available: false, reason: expect.stringMatching(/^cua's host cannot check its peers on Linux yet/) } : listsWork ? SCREENCAST : { available: false, reason: expect.stringMatching(/^the engine host on .+ predates browser work holds; it is replaced when idle$/) };
  const reached = await reachMachine(daemonPaths(s.userData), { build: 'e2e-cross-build-browser' });
  if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
  let reading: unknown = null;
  try {
    await expect.poll(async () => {
      const answer = await reached.link.request('session.capabilities', { appSessionId: id });
      reading = answer.ok ? (answer.value as { browser?: unknown }).browser ?? null : answer.error;
      return reading;
    }, { timeout: 30_000, message: `the kept session's browser with no app, ${host} serving` }).toMatchObject(expected);
  } finally {
    reached.link.close();
  }
  return [`  browser with no app (O17 §A), ${host}: ${JSON.stringify(reading)}`];
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

// P5 O15 M1: a peer whose app lists no `machine.connectors` (before O4) is refused by this build's `mawsd` on each of
// its sockets (D11), so it cannot run on the daemon shape beside this build: (pre-O4 app, daemon) holds that refusal,
// and (update, daemon) and (downgrade, daemon) cross with it on its embedded shape
// P5 O15 M2b (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, Decision Log 35): a peer with no embedded shape
// (after O15 M2) runs on `mawsd` whatever MAWS_HOST_MODE says, so the two scenes that pin the peer to the embedded shape
// skip for it; this pair crosses it
const embeddedPeer = (peer: Build): [boolean, string] => [runsEmbedded(peer), `the peer (wire ${wireOf(peer)}) has no embedded shape (its src/main/hosts/mode.ts has no hostModeFromEnv): its app runs on mawsd whatever MAWS_HOST_MODE says, so it is crossed by (update) and (downgrade), not on the embedded shape`];
const crossesOnMawsd = (peer: Build) => [appObeysConnectors(peer), `the peer (wire ${wireOf(peer)}) lists no ${CONNECTORS_CLIENT_CAPABILITY}: this build's mawsd refuses its app (D11), so it cannot cross on the daemon shape; (pre-O4 app, daemon) holds the refusal`] as const;

test('(update) the older build’s app keeps a session; the newer build’s app attaches across the minor, is served, launches, meets what the older lacks, and moves to its own supervisor', async () => {
  const { older, newer, peer } = builds();
  const [crosses, why] = crossesOnMawsd(peer);
  test.skip(!crosses, why);
  await withScratch('xb-update', async (s) => record(await crossing(s, older, newer, { newer, older }, ON_MAWSD)));
});

test('(downgrade) the newer build’s app keeps a session; the older build’s app attaches across the minor, is served, launches, and moves to its own supervisor', async () => {
  const { older, newer, peer } = builds();
  const [crosses, why] = crossesOnMawsd(peer);
  test.skip(!crosses, why);
  await withScratch('xb-downgrade', async (s) => record(await crossing(s, newer, older, null, ON_MAWSD)));
});

// P5 O4 M4 (acceptance 3's old-host rule at app level, acceptance 10): besides which engine host lists host.connectors
// (quitAndReattach, permanentAcrossReattach), an agent's refresh with no app at each of the two quits (refreshWithNoApp):
// `noClient` from the kept older host when it keys on the app's attachment, answered by mawsd from the host of this build
// that replaced it. The hosts' dashboard seam is on (MAWS_DASHBOARD_E2E) for every launch of the scene.
test('(update, daemon) the peer’s app keeps a session on its own supervisor; this build’s app attaches on the daemon shape, its mawsd relays the peer’s engine host across the minor until idle, then starts its own', async () => {
  test.setTimeout(600_000); // P5 O3-D M6: acceptance 9's two quits and reattaches; P5 O4 M4: a refresh at each, 200 s at most
  const { here, peer, newer, older } = builds();
  const [embedded, notEmbedded] = embeddedPeer(peer);
  test.skip(!embedded, notEmbedded);
  const gap = here === newer ? { newer, older } : null;
  // a short root: the browser reading with no app (O17 §A) needs the daemon's cua socket for the session to fit 103 bytes
  await withScratch('xb-daemon-update', async (s) => {
    const agent = new AgentSeam(join(s.userData, 'dashboard-e2e'));
    const said = await crossing(s, peer, here, gap, { keeper: 'detached', attacher: 'daemon' }, {
      env: { MAWS_DASHBOARD_E2E: '1' },
      awayOnKept: async (id) => [
        ...(await refreshWithNoApp(agent, 'xb-agent-kept', `${peer.label}'s kept engine host`, hostsAttachment(peer) && !hostsConnectors(peer))),
        ...(await browserWithNoApp(s, id, `${peer.label}'s kept engine host`, hostsBrowserWork(peer))), // P5 O17 M8
      ],
      awayOnOwn: async (id) => [
        ...(await refreshWithNoApp(agent, 'xb-agent-own', `${here.label}'s engine host`, false)),
        ...(await browserWithNoApp(s, id, `${here.label}'s engine host`, hostsBrowserWork(here))), // P5 O17 M8
      ],
    });
    record(said);
  }, { shortRoot: true });
});

// P5 O4 M4 (D11's downgrade residual): before the crossing, a launch of this build seals a grant as a pre-O4 build kept it
// (format 1), and the machine it started is ended, so the keeper's launch starts it afresh under its own environment
// (the paced replay); the keeper's launch adopts the grant (format 2). At the end the peer, on a supervisor of its own
// build, lists it in its Connectors sheet: an unreadable row when the peer is from before O4 (format 2 is not its
// store's; it can Forget it, then Connect again), a readable one, so no unreadable row, when the peer knows format 2.
test('(downgrade, daemon) this build’s app keeps a session under its mawsd; the peer’s app ends mawsd (or, before O2, takes the engine host from it), attaches that engine host, is served as another build, and moves to its own supervisor', async () => {
  test.setTimeout(300_000); // the sealing launch before the crossing
  const { here, peer, newer, older } = builds();
  const [embedded, notEmbedded] = embeddedPeer(peer);
  test.skip(!embedded, notEmbedded);
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

// P5 O15 M2 (docs/doperpowers/plans/2026-11-10-p5-o15-recomposition.md, acceptance 3, Interfaces §C "Acceptance 3's
// data"; Decision Log 14): nothing lost. The peer, a real build that still has the embedded shape (its main composes the
// spine and holds spine.lock), makes on one profile a session (a turn played to its end), an artifact, a draft and a
// layout of more than one tab (the library's tab and the artifact's, opened as a person opens them), and quits; this
// build, which has no embedded shape, opens that profile on `mawsd`. After the library's first successful reconciliation,
// and again after a relaunch of this build on a fresh `mawsd` (whose own first reconciliation runs again): the session is
// listed, the artifact is in the library and its page loads, the draft is back, the layout holds the same tabs, and
// `mawsd.log` says the spine loaded with no line of the index's rebuild (the database moved aside as unusable,
// src/services/index/db.ts) or of its refusal as newer than the build knows. A peer with no embedded shape skips, saying so.
// Fix wave 3: `library.list` reads the index at once, so the artifact's presence proves no reconciliation; what does is a
// canary, a library row whose artifact the engine host no longer holds (deleted while the library's refreshes were held,
// the e2e seam `__maws_library.holdRefreshes`, MAWS_E2E=1 only: the library misses that change until the next host
// connection). Only a reconciliation that read the host's snapshot and applied it removes that row
// (src/services/library/sync.ts `reconcile` → store.ts `reconcile`, which deletes every row the snapshot lists not; a
// snapshot that fails keeps the last state), so each pass waits for its canary to leave the library first.
const runsEmbedded = (build: Build) => {
  const mode = join(build.root ?? REPO_ROOT, 'src/main/hosts/mode.ts');
  return existsSync(mode) && readFileSync(mode, 'utf8').includes('export function hostModeFromEnv');
};
const INDEX_REBUILT = /\[index\] \S+ is not a usable database \(.*\); moved aside as /; // db.ts: the index moved aside and made anew
const INDEX_REFUSED = /\[index\] \S+: user_version \d+ is newer than this app knows/; // db.ts: the index left unopened
const DATA_ARTIFACT = 'Acceptance 3 page';
const DATA_MARK = 'ACCEPTANCE_3_PAGE';
const DATA_DRAFT = 'the draft the embedded shape kept';
// Every tab id in a `main.tabs` value, whatever its version: the ids of each `tabs` list's entries, sorted
function tabIdsOf(value: unknown): string[] {
  const ids: string[] = [];
  const walk = (node: unknown, key: string | null) => {
    if (Array.isArray(node)) {
      for (const item of node) {
        if (key === 'tabs' && item !== null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string') ids.push((item as { id: string }).id);
        walk(item, null);
      }
    } else if (node !== null && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (k !== 'closedTabs') walk(v, k);
  };
  walk(value, null);
  return ids.sort();
}
const mainTabsOf = async (page: Page) => value(await invoke(page, 'layout.get', { key: 'main.tabs' })).value;
const inLibrary = async (page: Page, artifactId: string) => value(await invoke(page, 'library.list', {})).rows.some((row) => row.id === artifactId);
const createHtmlArtifact = async (page: Page, title: string, body: string) =>
  value(
    (await page.evaluate(
      ([html, t]) => window.maws.invoke('artifacts.create' as never, { kind: 'html', title: t, content: { bytes: new TextEncoder().encode(html), name: 'index.html' } } as never),
      [`<!doctype html><html><head><title>x</title></head><body><p>${body}</p></body></html>`, title] as const,
    )) as CommandResult<'artifacts.create'>,
  ).artifact.id;
// A canary: an artifact the library lists while the engine host holds it no more, deleted once the library holds its
// refreshes (main's seam, which on this build's daemon shape relays to `mawsd`'s library)
async function plantCanary(run: Run, title: string): Promise<string> {
  const id = await createHtmlArtifact(run.page, title, 'canary');
  await expect.poll(() => inLibrary(run.page, id), { timeout: 20_000, message: `the canary ${title} in the library` }).toBe(true);
  await run.maws.app.evaluate(() => (globalThis as unknown as { __maws_library: { holdRefreshes(): Promise<void> } }).__maws_library.holdRefreshes());
  value(await invoke(run.page, 'artifacts.delete', { artifactId: id }));
  expect(await inLibrary(run.page, id), `the canary ${title} still listed: the library missed its deletion`).toBe(true);
  return id;
}

test('(embedded profile, mawsd) a profile the peer made on its embedded shape opens on this build’s mawsd with its session, artifact, draft and layout, after the library’s first reconciliation and after a relaunch onto a fresh mawsd, and no index rebuild', async () => {
  test.setTimeout(300_000);
  const { here, peer } = builds();
  test.skip(!runsEmbedded(peer), `the peer (wire ${wireOf(peer)}) has no embedded shape (its src/main/hosts/mode.ts has no hostModeFromEnv): acceptance 3's data needs a build that still composes the spine in its app; M5 files this scene's retirement`);
  await withScratch('xb-embedded-data', async (s) => {
    const said: string[] = [`${peer.label} (wire ${wireOf(peer)}) on its embedded shape makes the data; ${here.label} (wire ${wireOf(here)}) opens the profile on mawsd`];
    // the peer, embedded: its main holds spine.lock and composes the spine
    const old = await s.launch({ MAWS_HOST_MODE: 'detached', MAWS_E2E_QUIT_ANSWER: 'quit' }, peer.root);
    const theirs = await s.ready(old.page, (st) => st.transport !== 'daemon');
    expect(theirs.daemon, `${peer.label} runs no mawsd on its embedded shape`).toBeNull();
    expect(spineLockOf(s.userData)?.pid, `${peer.label}'s main holds spine.lock`).toBe(old.child.pid);
    // a session: the seeded record, with a turn played to its end. Fix wave 4: the journal's turn is a human one, which
    // the replay plays only once its `out` row is sent (`turn 1`), as crossing's launch does
    const id = await s.record(old.page);
    await launchOn(peer, old.page, id, turnsJournal(s.root, 'acceptance-3', 1), s);
    value(await invoke(old.page, 'session.send', { appSessionId: id, content: 'turn 1' }));
    await turnEnded(old.page, id);
    // an artifact, in the peer's engine host's store
    const artifactId = await createHtmlArtifact(old.page, DATA_ARTIFACT, DATA_MARK);
    // a draft, as the composer keeps one (src/renderer/src/composer/editor/controller.ts), for a session with no tab open
    const doc = { type: 'doc', attrs: { attachments: [] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: DATA_DRAFT }] }] };
    value(await invoke(old.page, 'session.drafts.set', { appSessionId: id, draft: { doc, attachments: [], updatedAt: new Date().toISOString() } }));
    // a layout of more than one tab: the library's, then the artifact's from its row, as a person opens them
    await old.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click({ timeout: 15_000 });
    await old.page.locator('[data-library]').getByRole('article', { name: DATA_ARTIFACT, exact: true }).click({ timeout: 20_000 });
    await expect(old.page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`), `${peer.label} opened the artifact's tab`).toBeVisible({ timeout: 20_000 });
    let tabs: string[] = [];
    await expect
      .poll(async () => (tabs = tabIdsOf(await mainTabsOf(old.page))), { timeout: 20_000, message: `${peer.label} saved its layout: the library's tab and the artifact's among more than one` })
      .toEqual(expect.arrayContaining(['artifacts', expect.stringContaining(artifactId)]));
    expect(tabs.length, 'more than one tab').toBeGreaterThan(1);
    // the first pass's canary, planted last: from here the peer's library follows no change
    let canary = await plantCanary(old, 'Acceptance 3 canary (the peer’s)');
    expect(old.maws.consoleErrors()).toEqual([]);
    await s.quit(old);
    await endProfileProcesses(s.userData); // the embedded shape's detached supervisor: this build's mawsd starts afresh
    said.push(`  made: session ${id} (a turn to its end), artifact ${artifactId}, a draft, the tabs ${tabs.join(', ')}`);

    // this build on mawsd, twice: after its library's first reconciliation, and after a relaunch on a fresh mawsd
    const passes = ['after the library’s first reconciliation', 'after a relaunch, on a fresh mawsd, after its reconciliation'];
    for (const [n, pass] of passes.entries()) {
      const run = await s.launch();
      const ours = await s.ready(run.page, (st) => st.daemon !== null, 60_000);
      await expect.poll(() => spineLockOf(s.userData)?.pid ?? null, { timeout: 30_000, message: `${pass}: ${here.label}'s mawsd holds spine.lock` }).toBe(ours.daemon!.pid);
      await expect.poll(() => inLibrary(run.page, canary), { timeout: 60_000, message: `${pass}: the canary gone, so a reconciliation read the host's snapshot and applied it` }).toBe(false);
      expect(await inLibrary(run.page, artifactId), `${pass}: the artifact in the library`).toBe(true);
      expect(value(await invoke(run.page, 'session.list', {})).sessions.map((row) => row.appId), `${pass}: the session listed`).toContain(id);
      const page = await run.maws.app.evaluate(async ({ session }, target) => {
        const response = await session.defaultSession.fetch(target);
        return { status: response.status, text: await response.text() };
      }, `maws-artifact://${artifactId}/live/index.html`);
      expect(page.status, `${pass}: the artifact's page loads`).toBe(200);
      expect(page.text).toContain(DATA_MARK);
      expect(JSON.stringify(value(await invoke(run.page, 'session.drafts.get', { appSessionId: id }))), `${pass}: the draft`).toContain(DATA_DRAFT);
      // UX wave U7b (O-40): the peer's library tab is a retired kind here, dropped at read from the strip and from what this
      // build writes back; every other id is kept
      const kept = tabs.filter((tab) => tab !== 'artifacts');
      await expect
        .poll(async () => {
          const stored = tabIdsOf(await mainTabsOf(run.page));
          const strip = await stripIds(run.page);
          return [stored.includes('artifacts') || strip.includes('artifacts'), kept.every((tab) => stored.includes(tab))];
        }, { timeout: 20_000, message: `${pass}: the layout's tabs, the library's dropped` })
        .toEqual([false, true]);
      await expect.poll(() => s.daemonLog(), { timeout: 30_000, message: `${pass}: mawsd's spine loaded` }).toMatch(/\[spine\] loaded in \d+ ms/);
      expect(s.daemonLog(), `${pass}: no index rebuild in mawsd.log`).not.toMatch(INDEX_REBUILT);
      expect(s.daemonLog(), `${pass}: the index opened, not refused`).not.toMatch(INDEX_REFUSED);
      said.push(`  ${pass}: on ${here.label}'s mawsd pid ${ours.daemon!.pid}, the canary ${canary} reconciled away, all four present, no rebuild`);
      if (n === 0) canary = await plantCanary(run, 'Acceptance 3 canary (this build’s)'); // the relaunch's, before mawsd ends
      await s.quit(run);
      if (n === 0) await endProfileProcesses(s.userData); // the relaunch starts a fresh mawsd, whose library reconciles again
    }
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

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, §J; A18 and UC-14): the folder of the last
// export, main's own layout key `library.exportFolder`, which a build that does not name the key loads with the file and
// writes back whole with its own keys. This build exports once into a scratch folder; the peer launches on the profile,
// changes a tab and quits; this build launches again and its export dialog opens in that folder. Skipped unless the
// peer's LayoutKeySchema lacks the key: a skipped scene is not evidence. The dialog's default path is read from
// Electron's `dialog.showSaveDialog`, replaced in main as e2e/widgets.spec.ts does; MAWS_E2E_SAVE_PATH stays unset, since
// it skips the calculation under test.
const EXPORT_FOLDER_KEY = 'library.exportFolder';
const namesExportFolder = (build: Build) => readFileSync(join(build.root ?? REPO_ROOT, 'src/shared/ipc/schema/layout.ts'), 'utf8').includes(`'${EXPORT_FOLDER_KEY}'`);
// The save dialog replaced in `run`'s main: it records each default path it is opened at and answers `filePath`, or a
// cancel when null.
async function replaceSaveDialog(run: Run, filePath: string | null): Promise<void> {
  await run.maws.app.evaluate(({ dialog }, answer) => {
    const opened: string[] = [];
    (globalThis as unknown as { __u5aSaveDialog: string[] }).__u5aSaveDialog = opened;
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      opened.push((args.at(-1) as { defaultPath?: string }).defaultPath ?? '');
      return answer === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: answer };
    }) as typeof dialog.showSaveDialog;
  }, filePath);
}
const saveDialogOpenedAt = (run: Run) => run.maws.app.evaluate(() => (globalThis as unknown as { __u5aSaveDialog: string[] }).__u5aSaveDialog);
// The save seam's variable, which skips the dialog's folder under test: neither build may inherit it from the runner
const SAVE_SEAM = 'MAWS_E2E_SAVE_PATH';
const seamOf = (run: Run) => run.maws.app.evaluate((_electron, name) => process.env[name] ?? null, SAVE_SEAM);
const storedExportFolder = (userData: string): unknown => (JSON.parse(readFileSync(join(userData, 'layout.json'), 'utf8')) as Record<string, unknown>)[EXPORT_FOLDER_KEY];

test('(export folder) the last export’s folder, kept as main’s layout key, survives the peer’s launch on the profile, which does not name the key, and opens this build’s next export dialog there', async () => {
  const { here, peer } = builds();
  test.skip(namesExportFolder(peer), `the peer (wire ${wireOf(peer)}) names ${EXPORT_FOLDER_KEY} in its LayoutKeySchema: there is no build that lacks the key to cross`);
  // the launcher passes the runner's environment on (e2e/support/scratch-env.ts), so the runner's seam goes for the scene
  const inherited = process.env[SAVE_SEAM];
  delete process.env[SAVE_SEAM];
  try {
    await withScratch('xb-export-folder', async (s) => {
      const folder = join(s.root, 'exports');
      mkdirSync(folder, { recursive: true });
      // this build: one export saved into the scratch folder, through the dialog
      const first = await s.launch();
      await s.ready(first.page);
      expect(await seamOf(first), `${here.label} runs without ${SAVE_SEAM}`).toBeNull();
      const artifactId = await createHtmlArtifact(first.page, 'Export folder report', 'The quarter in one page.');
      const target = join(folder, 'Export folder report.html');
      await replaceSaveDialog(first, target);
      expect(value(await invoke(first.page, 'library.saveAs', { artifactId, source: { content: {} } })), `${here.label}'s export, saved where the dialog answered`).toEqual({ saved: true, path: target });
      expect(storedExportFolder(s.userData), `${here.label} kept the export's folder`).toEqual({ path: folder });
      await s.quit(first);

      // the peer on the same profile: a tab opened, so its layout store writes the file whole, then a quit
      const old = await s.launch({}, peer.root);
      await s.ready(old.page);
      expect(await seamOf(old), `${peer.label} runs without ${SAVE_SEAM}`).toBeNull();
      await old.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click({ timeout: 15_000 });
      await expect.poll(async () => tabIdsOf(await mainTabsOf(old.page)), { timeout: 20_000, message: `${peer.label} saved its layout with the library's tab` }).toContain('artifacts');
      await s.quit(old);
      expect(tabIdsOf((JSON.parse(readFileSync(join(s.userData, 'layout.json'), 'utf8')) as Record<string, unknown>)['main.tabs']), `${peer.label} wrote layout.json`).toContain('artifacts');
      expect(storedExportFolder(s.userData), `${peer.label} wrote the file back with the key it does not name`).toEqual({ path: folder });

      // this build again: the export dialog opens in the folder of the last export
      const again = await s.launch();
      await s.ready(again.page);
      expect(await seamOf(again), `${here.label} runs without ${SAVE_SEAM}`).toBeNull();
      await replaceSaveDialog(again, null);
      expect(value(await invoke(again.page, 'library.saveAs', { artifactId, source: { content: {} } })), 'the dialog cancelled').toEqual({ saved: false });
      const opened = await saveDialogOpenedAt(again);
      expect(opened, 'one dialog').toHaveLength(1);
      expect(dirname(opened[0]!), `${here.label}'s dialog after ${peer.label}'s launch`).toBe(folder);
      record([`${EXPORT_FOLDER_KEY}: ${here.label} (wire ${wireOf(here)}) kept ${folder}; ${peer.label} (wire ${wireOf(peer)}) wrote layout.json with it kept; ${here.label}'s next dialog opened at ${opened[0]}`]);
    });
  } finally {
    if (inherited !== undefined) process.env[SAVE_SEAM] = inherited;
  }
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

async function withUnit(s: Scratch, build: Build, name: string, body: (unit: UnitDaemon) => Promise<void>, env: Record<string, string> = {} /* P5 O17 M7: the scene's own */): Promise<void> {
  const unit = await installUnitDaemon({ root: build.root ?? REPO_ROOT, userData: s.userData, label: e2eLabel(runIdOf(process.env), name), env: { ...unitEnv(s.userData), ...env } });
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

// P5 O17 M7 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §A's "any app" cell, R5): an app from before
// O17 (the peer) over this build's `mawsd`. A private `mawsd` of another build would be restarted by the app's build
// check, so this build's runs as the profile's unit, as in (update, render). The session starts through the ordinary
// start path on the cua engine stub (test/support/cua-engine.ts), whose connector dials `mawsd`'s socket for it: with the
// app attached `mawsd` relays it to the app's own socket (O5 M5), the app makes the tab, the render host starts nothing,
// and the engine host holds no browser work for it (an app's tabs are never browser work: they keep today's release). At
// the app's quit the session reads this build's headless route. The app's cua sockets (`<profile>/browser/cua`, with no
// fallback directory) fit sun_path only under a short root, so the scratch is a short one under /tmp (removed with it). Run on the crossing the
// landing's gate stages (the peer at O16's merge, both listing host.holder): the handover crossing calls no `awayOnKept`,
// so this cell stands on its own rather than in it.
test('(pre-O17 app, unit mawsd) the peer’s app over this build’s unit mawsd: the agent’s browser relayed to the app’s own tabs, which hold no browser work; at the app’s quit the session reads this build’s headless route', async () => {
  const { here, peer } = builds();
  test.skip(hostsBrowserWork(peer) || !hostsBrowserWork(here) || !appObeysConnectors(peer) || !('commands.machine.client' in peer.manifest.entries), `the peer (wire ${wireOf(peer)}) is not an app from O5 M5 to before O17 that this build's mawsd serves`);
  test.skip(UNIT_SKIP !== null, UNIT_SKIP ?? '');
  test.setTimeout(300_000);
  const pages = await startHeadlessPages();
  try {
    await withScratch('xb-o17-app', async (s) => {
      const bin = writeCuaEngine(join(s.root, 'cua-engine'), { ready: true, retry: true, control: true, lifeMs: 600_000 });
      await withUnit(s, here, 'xb-o17-app', async (unit) => {
        const said = [`${peer.label}'s app (wire ${wireOf(peer)}) on ${here.label}'s unit mawsd (wire ${wireOf(here)}), pid ${unit.pid}`];
        const run = await s.launch({ MAWS_HOST_MODE: 'daemon' }, peer.root);
        await s.ready(run.page, (st) => st.daemon?.pid === unit.pid, 60_000);
        expect(run.output(), 'the peer’s build check leaves a unit of another bundle as it is').toContain('its unit runs another bundle, so it is left as it is');
        // the engine store the unit's engine host reads (unitEnv): the repository trusted, the user's mode `default`
        const configDir = join(s.userData, 'claude-config');
        writeFileSync(join(configDir, '.claude.json'), `${JSON.stringify({ projects: { [s.repo]: { hasTrustDialogAccepted: true } } })}\n`);
        writeFileSync(join(configDir, 'settings.json'), `${JSON.stringify({ permissions: { defaultMode: 'default' } })}\n`);
        const reached = await reachMachine(daemonPaths(s.userData), { build: 'e2e-cross-build-o17-app' });
        if (!reached.ok) throw new Error(`machine.sock: ${reached.state}: ${reached.why}`);
        const link = reached.link;
        try {
          const ask = async <T,>(name: string, input?: unknown): Promise<T> => {
            const answer = await link.request(name, input, 30_000);
            if (!answer.ok) throw new Error(`${name}: ${answer.error.code}: ${answer.error.message}`);
            return answer.value as T;
          };
          const browserOf = async (id: AppSessionId) => (await ask<{ browser?: unknown }>('session.capabilities', { appSessionId: id })).browser;
          const holdOf = async (id: AppSessionId) => (await ask<{ work?: { holds?: { browser?: string } } }>('session.status', { appSessionId: id })).work?.holds?.browser;
          const project = await ask<{ id: string }>('session.projects.add', { directory: s.repo });
          const { appSessionId: id } = await ask<{ appSessionId: AppSessionId }>('session.create', { projectId: project.id, location: { kind: 'directory', path: s.repo } });
          expect(await ask('session.start', { appSessionId: id, message: { content: 'o17 pre-O17 app', display: 'o17 pre-O17 app' }, options: { gateway: 'direct' } })).toMatchObject({ status: 'starting' });
          await expect.poll(async () => { const st = await ask<{ process: string; turn: unknown; pid: number | null }>('session.status', { appSessionId: id }).catch(() => null); return st !== null && st.process === 'ready' && st.turn === null && st.pid !== null; }, { timeout: 60_000, message: 'the session’s engine ready, its first turn ended' }).toBe(true); // prettier-ignore
          await expect.poll(() => browserOf(id), { timeout: 30_000, message: 'relayed to the attached pre-O17 app (O5 M5)' }).toEqual({ available: true, viewed: 'local' });

          let cua: ConnectorControl | null = null;
          await expect.poll(async () => (cua = await connectorControl(s.repo).catch(() => null)) !== null, { timeout: 30_000, message: 'the session’s connector listens on its control socket' }).toBe(true);
          const agent = cua!;
          try {
            await expect.poll(async () => { const answer = await agent.call('tabs.query'); return answer.ok; }, { timeout: 30_000, message: 'cua served through the relay' }).toBe(true); // prettier-ignore
            await answered('tabs.create in the app', agent.call('tabs.create', { url: pages.url('/') }));
            expect(await answered('tabs.query', agent.call<unknown[]>('tabs.query')), 'the app holds the agent’s tab').toHaveLength(1);
            expect(await holdOf(id), 'an app’s tab is no browser work (R5)').toBeUndefined();
            expect((await ask<{ render: { starts: number } }>('daemon.status')).render.starts, 'the render host started nothing').toBe(0);
            expect(s.daemonLog(), 'every snapshot this build’s engine host was told, taken').not.toMatch(/\[browser\] host\.browserWork .* failed/);
            said.push(`  relayed: ${JSON.stringify(await browserOf(id))}; the app's tab holds no browser work; the render host started nothing`);

            await s.quit(run);
            await expect.poll(() => browserOf(id), { timeout: 30_000, message: 'with the app gone, this build’s headless route' }).toEqual(SCREENCAST);
            expect(await holdOf(id), 'nothing held once the app’s tab went with it').toBeUndefined();
            said.push(`  after the app's quit: ${JSON.stringify(await browserOf(id))}, nothing held`);
          } finally {
            agent.close();
          }
          expect(await ask('session.stop', { appSessionId: id, reason: 'stop' })).toMatchObject({ exited: true });
        } finally {
          link.close();
        }
        record(said);
      }, { MAWS_E2E_ENGINE_BIN: bin });
    }, { shortRoot: true });
  } finally {
    await pages.close();
  }
});

// ---- U13a: what the wave stores, build F reads (UC-14) ---------------------------------------------------------------
// The UX wave's U13a (docs/doperpowers/plans/2026-11-12-ux-wave-U13a-one-strip.md, M5; the section's "The round trip with
// build F") stores one strip as `main.tabs` version 3 with the one set `none`, which build F (`f1852de3a`) reads with its
// strict reader and files into its per-project sets again. Three scenes prove it both ways, each by what the reading
// build draws or by what it writes after an act, never by reading back a key that build has not written (F writes
// `main.tabs` at its launch only when its reader rewrote the value, learnt a title, dropped a fold or replayed a change,
// else at its next change of the tabs). Each runs only with a peer that still keeps a tab set per project (its
// `stores/layout-model.ts` has `switchSet`); a skipped scene is not evidence, and the run of record is the one whose
// peer is F (`--peer-exact f1852de3a`), counted only with all three run.
//   (layout, from the peer)  the peer files tabs under two sets, pins a tab and a tool, and quits; this build opens every
//                            tab of every set in one strip, once each, with the pin, the tab in front and the notice,
//                            writes the one set, keeps the pinned tool and remembers the side column's session under
//                            `none` alone; a relaunch shows no notice.
//   (layout, to the peer)    this build stores a split strip with a pinned tab, a side surface, a pinned tool and a
//                            sidebar width; the peer draws them, says nothing of an invalid value, acts, and writes every
//                            tab back with the pin; this build reads what the peer wrote: every tab, the pin, the tool
//                            unpinned and the sidebar folded.
//   (settings, both ways)    one field of each settings file changed through Settings, read by the other build, changed
//                            there and read back here, with no `[settings] invalid` or `cannot read` line on either side.
// UC-14's coverage for U13a: for each stored thing this landing changes or relies on, the scene that asserts F reads what
// this build wrote and writes it on, and the scene that asserts this build reads what F wrote. A later landing that
// stores something new adds its row here and extends a scene (U8's `cards.open` and `panelTools.widths`, U7b's
// `destination` and the retired tab kinds, U6's open files, any new tab kind, any field a landing adds
// to a settings file).
//   | stored                                        | F reads this build's value, and writes on             | this build reads F's value                         |
//   |-----------------------------------------------|-------------------------------------------------------|----------------------------------------------------|
//   | `main.tabs`: which tabs                       | (layout, to the peer): the tab in front drawn; every   | (layout, from the peer); the return of (layout, to |
//   |                                               | id in what F writes after its act                     | the peer)                                          |
//   | `main.tabs`: pins                             | (layout, to the peer): the pin drawn; `pinned: true`  | both, as above                                     |
//   |                                               | in what F writes                                      |                                                    |
//   | `main.tabs`: order, the split, the floating   | not asserted: F rebuilds them by its own rules        | the showing set's order and split, by M1's unit    |
//   | card                                          | (the plan's Interfaces §H)                            | tests                                              |
//   | `panelTools.surfaces`, not its default        | (layout, to the peer): the pinned tool drawn; F's      | both layout scenes: the pinned tools kept,         |
//   |                                               | written value keeps `none` beside its own entries     | `contexts` back to `none` alone                    |
//   | `regions`                                     | (layout, to the peer): the width drawn; version 5 in  | the return of (layout, to the peer): the sidebar   |
//   |                                               | what F writes                                         | folded                                             |
//   | `sidebar.hidden` (U7a)                        | (sidebar, both ways): F draws the session it does not | the return of (sidebar, both ways): the row under  |
//   |                                               | know to be hidden, and the key is in the file F wrote | Hidden. F never writes the key                     |
//   |                                               | after its act                                         |                                                    |
//   | `destination` (U7b)                           | (destinations, both ways): F draws its tabs and keeps | the return: not restored after F wrote `main.tabs`,|
//   |                                               | the key through its write                             | and deleted. F never writes the key                |
//   | tabs of the four kinds (U7b): Settings,       | not written by this build                             | (destinations, both ways): dropped, the page of the|
//   | Customize, Projects, the library              |                                                       | one in front opened; and "(embedded profile,       |
//   |                                               |                                                       | mawsd) …"                                          |
//   | `settings.json`, `machine-settings.json`      | (settings, both ways)                                 | (settings, both ways)                              |
//   | `machine-route.json`                          | not covered: written only when the machine's default  | not covered                                        |
//   |                                               | route is set, which neither this landing nor a scene   |                                                    |
//   |                                               | does                                                  |                                                    |
//   | the index: `sessions.launch_folder`,          | (moved, from this build): F shows the session where   | (moved, from this build): this build shows what F  |
//   | `sessions.agent_folder` (UX wave U8c-2)       | its directory says, finds its transcript there (its   | shows for a session F filed last, and the facts    |
//   |                                               | resume's recorded state) and files on                 | again after the session's next row                 |
const keepsSets = (build: Build) => {
  const model = join(build.root ?? REPO_ROOT, 'src/renderer/src/stores/layout-model.ts');
  return existsSync(model) && readFileSync(model, 'utf8').includes('export function switchSet');
};
const keepsSetsWhy = (peer: Build) => `the peer (wire ${wireOf(peer)}) keeps no tab set per project (its stores/layout-model.ts has no switchSet): UC-14's round trip is with build F, --peer-exact f1852de3a`;
const ONE_STRIP_NOTICE = 'Tabs from every project are now in one strip'; // src/renderer/src/ipc/events.ts
const PINNED_TOOL = 'Session info'; // a tool outside the icon row's first four, listed only when pinned or open
const PINNED_TOOL_ID = 'session-info';
const LAYOUT_PAGE = 'Cross-build layout page';
type StoredSets = { version: number; current: string; sets: Record<string, { panes: { tabs: { id: string; pinned: boolean }[]; activeTabId: string }[]; focusedPane: number }> };
type StoredSurfaces = { pinnedTools: string[]; contexts: Record<string, string>; stacks: Record<string, string[]> };
type StoredRegions = { version: number; sidebar: { width: number; collapsed: boolean } };
const layoutOf = async <T>(page: Page, key: 'main.tabs' | 'panelTools.surfaces' | 'regions') => value(await invoke(page, 'layout.get', { key })).value as T | null;
// The strip's tabs as mounted: under a page this build's strip is invisible, and a role query of it would find none.
const stripIds = (page: Page) => mainTabs(page).locator('[role="tab"]').evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-tab-id') ?? ''));
const pinnedIn = (stored: StoredSets | null) => Object.values(stored?.sets ?? {}).flatMap((set) => set.panes.flatMap((pane) => pane.tabs.filter((tab) => tab.pinned).map((tab) => tab.id)));
const notice = (page: Page) => page.locator('[data-toast-viewport]').getByText(ONE_STRIP_NOTICE);
// Every console message the page gave, of every type (Playwright keeps them from the first load: e2e/support/launch.ts)
const consoleSaid = async (page: Page) => (await page.consoleMessages({ filter: 'all' })).map((message) => `${message.type()}: ${message.text()}`);
const INVALID_LAYOUT = /\[layout\] \S+ is not a valid value/; // stores/layout.ts in both builds, a warning
const SETTINGS_REFUSED = /\[settings\] (?:invalid|cannot read) /; // src/shared/settings/file-store.ts in both builds
// A tool brought into view from the icon row as a person brings it, in either build: its icon, or its item in "More
// surfaces" where the row folds it, unless its body is already drawn. Both builds mark that body `[data-surface]` named by
// the tool's title (build F's stacked section, this build's group body); this build's ./support/shell.ts helpers speak
// its own side column alone, so a step on the peer's page goes through these.
const toolBody = (page: Page, name: string) => page.locator(`[data-region="panel"]:not([inert]) [data-surface][aria-label=${JSON.stringify(name)}]`);
async function chooseTool(page: Page, name: string): Promise<void> {
  const icon = surfaceRow(page).getByRole('button', { name, exact: true });
  if (await icon.count()) await icon.click();
  else {
    await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
}
async function showTool(page: Page, name: string): Promise<void> {
  if (!await toolBody(page, name).count()) await chooseTool(page, name);
  await expect(toolBody(page, name)).toBeVisible();
}
// Build F's side column (f1852de3a: panel/PanelHost.tsx, PanelHeader.tsx): at most two stacked surfaces, each a section
// named by its tool, its header's "Close surface" taking it out of the stack (its tab stays in the session's list)
const peerSurface = (page: Page, name: string) => page.locator(`[data-region="panel"]:not([inert]) [data-surface-stack] > section[data-surface][aria-label=${JSON.stringify(name)}]`);
const peerStack = (page: Page) => page.locator('[data-region="panel"]:not([inert]) [data-surface-stack] > section[data-surface]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
async function closeOnPeer(page: Page, name: string): Promise<void> {
  const shown = peerSurface(page, name);
  if (!await shown.count()) return;
  await shown.getByRole('button', { name: 'Close surface', exact: true }).click();
  await expect(shown).toHaveCount(0);
}
// A tool's own menu, as a person reaches it at any width: from its icon in the row, or, where a narrow row folds the
// tool into "More surfaces" (the row's icons past its room, pinned and open ones among them), from its item there by
// Shift+F10, as e2e/support/shell.ts's pinSurfaceForSessions does; the same in both builds (panel/SurfaceRow.tsx).
// UX wave U8c-2 (M6 decision 5): opened until it is open. `item` is the menu item the caller uses next (a string, or a
// pattern where the caller accepts either of two); a menu whose item does not show (the open lost to a click or a
// re-render, as U8b's "(side column, from the peer)" lost one) is closed and opened again.
async function openToolMenu(page: Page, name: string, item: string | RegExp): Promise<void> {
  await expect(async () => {
    if (await page.getByRole('menu').count()) await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 1_000 });
    const icon = surfaceRow(page).getByRole('button', { name, exact: true });
    if (await icon.count()) await icon.click({ button: 'right' });
    else {
      await surfaceRow(page).getByRole('button', { name: 'More surfaces', exact: true }).click();
      const entry = page.getByRole('menuitem', { name, exact: true });
      await entry.focus();
      await entry.press('Shift+F10');
    }
    await expect(page.getByRole('menuitem', { name: item, exact: typeof item === 'string' })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
async function closeMenus(page: Page): Promise<void> {
  await expect(async () => {
    if (await page.getByRole('menu').count()) await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}
// A tool pinned to, or unpinned from, the icon row through its menu; opened first for the pin (a tool past the first
// four is listed only when pinned or open)
async function pinToToolbar(page: Page, name: string, pin: boolean): Promise<void> {
  if (pin) await showTool(page, name);
  await openToolMenu(page, name, pin ? 'Pin to toolbar' : 'Unpin from toolbar');
  await page.getByRole('menuitem', { name: pin ? 'Pin to toolbar' : 'Unpin from toolbar', exact: true }).click();
  await closeMenus(page);
}
// Whether the tool is pinned as a person sees it at any width: its menu offers to unpin it, or to pin it
async function expectToolPinned(page: Page, name: string, pinned: boolean, message: string): Promise<void> {
  await openToolMenu(page, name, /^(?:Pin to|Unpin from) toolbar$/);
  await expect(page.getByRole('menuitem', { name: pinned ? 'Unpin from toolbar' : 'Pin to toolbar', exact: true }), message).toBeVisible();
  await closeMenus(page);
}
// The library's tab and an artifact's, opened as a person opens them (the sidebar's Artifacts, then the page's row)
async function openLibraryAndPage(page: Page, artifactId: string): Promise<string> {
  await page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click({ timeout: 15_000 });
  await page.locator('[data-library]').getByRole('article', { name: LAYOUT_PAGE, exact: true }).click({ timeout: 20_000 });
  await expect(page.locator(`[data-region="main"] [data-artifact-tab="${artifactId}"]`), 'the artifact’s tab').toBeVisible({ timeout: 20_000 });
  let tab: string | undefined;
  await expect.poll(async () => (tab = (await stripIds(page)).find((id) => id.includes(artifactId))), { message: 'the artifact’s tab in the strip' }).toBeDefined();
  return tab!;
}
async function pinTab(page: Page, id: string): Promise<void> {
  await mainTabById(page, id).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin tab', exact: true }).click();
  await expect(mainTabById(page, id).getByRole('img', { name: 'Pinned' })).toBeVisible();
}

test('(layout, from the peer) a layout the peer filed under two tab sets opens whole in this build’s one strip, with its pin, its tab in front and the notice once; the pinned tool kept and the side column’s session under none alone', async () => {
  const { here, peer } = builds();
  test.skip(!keepsSets(peer), keepsSetsWhy(peer));
  await withScratch('xb-layout-from', async (s) => {
    const said: string[] = [`${peer.label} (wire ${wireOf(peer)}) files the tabs under two sets; ${here.label} (wire ${wireOf(here)}) reads them as one strip`];
    // the peer: the library's tab and an artifact's while no project shows, then the seeded session from its sidebar row,
    // which the peer files in its row's set and shows; that tab pinned, and a tool pinned to the icon row
    const old = await s.launch({}, peer.root);
    await s.ready(old.page);
    const id = await s.record(old.page);
    const artifactId = await createHtmlArtifact(old.page, LAYOUT_PAGE, 'XB_LAYOUT_PAGE');
    await openLibraryAndPage(old.page, artifactId);
    await (await sidebarRow(old.page, { appSessionId: id })).click({ modifiers: ['Meta'] });
    let front = '';
    await expect.poll(async () => (front = (await activeMainTab(old.page).getAttribute('data-tab-id')) ?? ''), { timeout: 20_000, message: `${peer.label} shows the session’s tab` }).toMatch(/^session:/);
    await pinTab(old.page, front);
    await pinToToolbar(old.page, PINNED_TOOL, true);
    await closeOnPeer(old.page, PINNED_TOOL); // the peer's own "Close surface": its stack drops the tool, its tab stays
    let theirs: StoredSets | null = null;
    await expect
      .poll(async () => {
        theirs = await layoutOf<StoredSets>(old.page, 'main.tabs');
        return [Object.keys(theirs?.sets ?? {}).length >= 2, pinnedIn(theirs), (await layoutOf<StoredSurfaces>(old.page, 'panelTools.surfaces'))?.pinnedTools.includes(PINNED_TOOL_ID)];
      }, { timeout: 20_000, message: `${peer.label} wrote two sets, the pin and the pinned tool` })
      .toEqual([true, [front], true]);
    // UX wave U7b (O-40): the library is a page in this build, so the peer's library tab is a retired kind, dropped at
    // read; the session's tab was in front, so no page opens. Every other tab is expected as before
    const peerTabs = tabIdsOf(theirs);
    expect(peerTabs, `${peer.label} stored its library’s tab`).toContain('artifacts');
    const tabs = peerTabs.filter((tab) => tab !== 'artifacts');
    const keys = Object.keys(theirs!.sets);
    expect(old.maws.consoleErrors()).toEqual([]);
    await s.quit(old);
    await endProfileProcesses(s.userData); // this build's own mawsd from here
    said.push(`  ${peer.label} wrote ${keys.length} sets (${keys.map((key) => (key === 'none' ? 'none' : 'a row')).join(', ')}), ${peerTabs.length} tabs, in front ${front}, pinned ${front}`);

    // this build: every tab of every set in the strip once but the library's, the pin, the tab in front, the notice, and
    // no page; written as one set
    const run = await s.launch();
    await expect(notice(run.page), 'the notice that the sets became one strip (shown for 6 s, so looked for first)').toBeVisible({ timeout: 30_000 });
    await s.ready(run.page);
    await expect.poll(async () => (await stripIds(run.page)).sort(), { timeout: 20_000, message: 'every tab of every set in the strip, the library’s dropped' }).toEqual(tabs);
    expect(new Set(await stripIds(run.page)).size, 'each once').toBe(tabs.length);
    await expect(mainTabById(run.page, front).getByRole('img', { name: 'Pinned' }), 'the pin').toBeVisible();
    await expect(activeMainTab(run.page), 'the tab that was in front').toHaveAttribute('data-tab-id', front);
    await expect(pageRegion(run.page), 'no page opens: the session’s tab was in front').toHaveCount(0);
    await expectToolPinned(run.page, PINNED_TOOL, true, 'the pinned tool kept in the icon row');
    await expect
      .poll(async () => {
        const ours = await layoutOf<StoredSets>(run.page, 'main.tabs');
        return [ours?.version, ours?.current, Object.keys(ours?.sets ?? {}), pinnedIn(ours)];
      }, { timeout: 20_000, message: 'written back as the one set' })
      .toEqual([3, 'none', ['none'], [front]]);
    const surfaces = (await layoutOf<StoredSurfaces>(run.page, 'panelTools.surfaces'))!;
    expect(surfaces.pinnedTools, 'the pinned tool kept').toContain(PINNED_TOOL_ID);
    expect(Object.keys(surfaces.contexts).filter((key) => key !== 'none'), 'the side column’s session remembered under none alone').toEqual([]);
    expect(run.maws.consoleErrors()).toEqual([]);
    said.push(`  ${here.label}: ${tabs.length} tabs in one strip (the library’s dropped, no page), the pin and the tab in front kept, the notice shown; contexts ${JSON.stringify(Object.keys(surfaces.contexts))}`);
    await s.quit(run);

    // a relaunch of this build reads the one set it wrote: no notice. A notice lasts 6 s and the launch helper hands the
    // page over only once the host is ready, by when the relaunch's own hydration may be over. The notice follows only
    // `merged`, which the reader computes from the stored value alone, so: the relaunch's read is held to have written
    // nothing (the stored `main.tabs` the same before it and after it), and the window is then reloaded under an init
    // script on the app's context (run before the page's own scripts at each load) that records every appearance of the
    // notice; that reload reads the very value the relaunch read, so it stands for the relaunch
    const storedTabs = () => (JSON.parse(readFileSync(join(s.userData, 'layout.json'), 'utf8')) as Record<string, unknown>)['main.tabs'];
    const beforeRelaunch = storedTabs();
    const again = await s.launch();
    await s.ready(again.page);
    await expect.poll(async () => (await stripIds(again.page)).sort(), { timeout: 20_000, message: 'the relaunch shows the same strip' }).toEqual(tabs);
    await again.page.waitForTimeout(1_000); // past the layout's write-back delay: whatever the relaunch's read writes is written
    expect(storedTabs(), 'the relaunch’s own read wrote nothing to main.tabs').toEqual(beforeRelaunch);
    await again.maws.app.context().addInitScript((text) => {
      const seen: number[] = [];
      (window as unknown as { __u13aNotices: number[] }).__u13aNotices = seen;
      const look = () => {
        if (document.querySelector('[data-toast-viewport]')?.textContent?.includes(text)) seen.push(Math.round(performance.now()));
      };
      new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
    }, ONE_STRIP_NOTICE);
    await again.page.reload();
    await expect.poll(async () => (await stripIds(again.page)).sort(), { timeout: 20_000, message: 'the strip back after the reload' }).toEqual(tabs);
    await again.page.waitForTimeout(2_000); // past hydration, where the notice would show
    expect(await again.page.evaluate(() => (window as unknown as { __u13aNotices?: number[] }).__u13aNotices ?? null), 'no notice from the page’s start: nothing was merged').toEqual([]);
    await s.quit(again);
    said.push('  a relaunch of this build: the same strip, no notice');
    record(said);
  });
});

test('(layout, to the peer) a split strip this build stored, with a pin, a side surface, a pinned tool and a sidebar width, is drawn by the peer, written on by it after its acts, and read back here whole', async () => {
  const { here, peer } = builds();
  test.skip(!keepsSets(peer), keepsSetsWhy(peer));
  await withScratch('xb-layout-to', async (s) => {
    const said: string[] = [`${here.label} (wire ${wireOf(here)}) stores one strip; ${peer.label} (wire ${wireOf(peer)}) reads it, acts and writes it on`];
    // this build: the seeded session's tab and an artifact's (opened from the library, a page here: UX wave U7b); the
    // artifact's pinned; the session split into the other pane, Files open beside it and a tool pinned to the icon row;
    // then Diagnostics' tab, a tab of no session the peer knows, in front, and the sidebar 40 px wider than its default
    const run = await s.launch();
    await s.ready(run.page);
    const id = await s.record(run.page);
    await (await sidebarRow(run.page, { appSessionId: id })).click();
    const session = `session:${await addressed(run.page, id)}`;
    await expect(activeMainTab(run.page)).toHaveAttribute('data-tab-id', session, { timeout: 20_000 });
    const artifactId = await createHtmlArtifact(run.page, LAYOUT_PAGE, 'XB_LAYOUT_PAGE');
    const artifact = await openLibraryAndPage(run.page, artifactId);
    await pinTab(run.page, artifact);
    await mainTabById(run.page, session).click();
    await menu(run.maws.app, 'pane.split');
    await expect.poll(() => run.page.getByRole('tablist', { name: 'Right pane tabs' }).getByRole('tab').evaluateAll((t) => t.map((e) => e.getAttribute('data-tab-id'))), { message: 'the split' }).toEqual([session]);
    await openSurface(run.page, 'Files');
    await pinToToolbar(run.page, PINNED_TOOL, true);
    await openSurface(run.page, 'Files'); // UX wave U8b: Files back in view, the pinned tool a tab beside it (opening it took Files' place)
    await menu(run.maws.app, 'diagnostics.open');
    await expect(activeMainTab(run.page)).toHaveAttribute('data-tab-id', 'diagnostics');
    const resizer = run.page.locator('[data-region="sidebar"]').getByRole('separator', { name: 'Resize sidebar' });
    await resizer.focus();
    for (let i = 0; i < 5; i++) await run.page.keyboard.press('ArrowRight');
    await expect(resizer).toHaveAttribute('aria-valuenow', '280');
    let ours: StoredSets | null = null;
    let contextNone: string | undefined; // the side column's session this build remembers under `none`
    await expect
      .poll(async () => {
        ours = await layoutOf<StoredSets>(run.page, 'main.tabs');
        const surfaces = await layoutOf<StoredSurfaces>(run.page, 'panelTools.surfaces');
        const regions = await layoutOf<StoredRegions>(run.page, 'regions');
        contextNone = surfaces?.contexts.none;
        return [Object.keys(ours?.sets ?? {}), ours?.sets.none?.panes.length, pinnedIn(ours), surfaces?.pinnedTools.includes(PINNED_TOOL_ID), contextNone !== undefined, regions?.sidebar.width];
      }, { timeout: 20_000, message: `${here.label} wrote the strip, the surfaces and the width` })
      .toEqual([['none'], 2, [artifact], true, true, 280]);
    const tabs = tabIdsOf(ours);
    expect(tabs).toEqual([artifact, 'diagnostics', session].sort());
    expect(run.maws.consoleErrors()).toEqual([]);
    await s.quit(run);
    await endProfileProcesses(s.userData);
    said.push(`  ${here.label} wrote ${tabs.join(', ')}: ${artifact} pinned, a split, Files open, ${PINNED_TOOL} pinned, the sidebar at 280`);

    // the peer: what it draws, and no word of an invalid value. Each wait on the peer, failing, names what the peer
    // drew and stored: its strip's tab ids, and its `main.tabs` sets by key with their tab ids
    const old = await s.launch({}, peer.root);
    await s.ready(old.page);
    const onPeer = async (what: string, act: () => Promise<unknown>) => {
      try {
        await act();
      } catch (error) {
        const strip = await stripIds(old.page).catch(() => ['(unread)']);
        const stored = await layoutOf<StoredSets>(old.page, 'main.tabs').catch(() => null);
        const sets = Object.fromEntries(Object.entries(stored?.sets ?? {}).map(([key, set]) => [key, set.panes.map((pane) => pane.tabs.map((tab) => tab.id))]));
        throw new Error(`${peer.label}: ${what}; its strip ${JSON.stringify(strip)}; its main.tabs sets ${JSON.stringify(sets)}`, { cause: error });
      }
    };
    await onPeer('draws the tab that was in front, selected', () => expect(mainTabById(old.page, 'diagnostics')).toHaveAttribute('aria-selected', 'true', { timeout: 20_000 }));
    await onPeer('draws the pin', () => expect(mainTabById(old.page, artifact).getByRole('img', { name: 'Pinned' })).toBeVisible());
    await onPeer('draws the sidebar at the width written', () => expect(old.page.locator('[data-region="sidebar"]').getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '280'));
    expect((await consoleSaid(old.page)).filter((line) => INVALID_LAYOUT.test(line)), `${peer.label} took every layout value as valid`).toEqual([]);
    // a tool's menu opens only while a session is in view (the icon row disables a session tool's icon and its folded
    // item otherwise), so the pin is read, and undone, with the session's tab in front: the peer filed it in its row's
    // set, so it is reached from its sidebar row, and the strip shows that set from here
    await onPeer('shows the session’s tab from its sidebar row', async () => {
      await (await sidebarRow(old.page, { appSessionId: id })).click();
      await expect(activeMainTab(old.page)).toHaveAttribute('data-tab-id', session, { timeout: 20_000 });
    });
    await onPeer('reads the pinned tool', () => expectToolPinned(old.page, PINNED_TOOL, true, `${peer.label} reads the pinned tool`));
    await onPeer('unpins the tool', () => pinToToolbar(old.page, PINNED_TOOL, false));
    // then the page's tab brought to the front of that set, as the peer does it: a tab of no session belongs to the set
    // shown, so the sidebar's Artifacts opens the peer's library as a tab in the project's set, and the page's row in
    // the library moves the page's tab there too (with its pin) and selects it (its stores/layout-model.ts, `openTab`;
    // its library/Row.tsx, the row's click). That selection, saved as the shown set's tab in front, is a write only the
    // peer makes. Then the sidebar folded. UX wave U7b: the peer's library tab is one more tab in what it writes, and a
    // retired kind for this build, which drops it at read
    await onPeer('opens its library', () => old.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Artifacts', exact: true }).click({ timeout: 15_000 }));
    await onPeer('opens the page from its library row', () => old.page.locator(`[data-library] [data-artifact-row="${artifactId}"]`).click({ timeout: 15_000 }));
    await onPeer('shows the page’s tab in front, with its pin', async () => {
      await expect(activeMainTab(old.page)).toHaveAttribute('data-tab-id', artifact, { timeout: 15_000 });
      await expect(mainTabById(old.page, artifact).getByRole('img', { name: 'Pinned' })).toBeVisible();
    });
    await onPeer('folds the sidebar', () => old.page.getByRole('banner').getByRole('button', { name: 'Toggle sidebar' }).click());
    let theirs: StoredSets | null = null;
    let surfaces: StoredSurfaces | null = null;
    let regions: StoredRegions | null = null;
    await onPeer('writes its tab in front, every tab, the pin, the unpinned tool with none kept, and the folded sidebar', () =>
      expect
        .poll(async () => {
          theirs = await layoutOf<StoredSets>(old.page, 'main.tabs');
          surfaces = await layoutOf<StoredSurfaces>(old.page, 'panelTools.surfaces');
          regions = await layoutOf<StoredRegions>(old.page, 'regions');
          // the peer's own write first: the project's set shown, the page's tab its saved tab in front (this build left
          // Diagnostics' tab in front of `none`), so what follows is read from a value the peer wrote; every tab is
          // collected over every set, its own library tab among them, and `contexts.none` stays as this build wrote it
          const shown = theirs?.sets[theirs.current];
          return [theirs?.current !== 'none', shown?.panes[shown.focusedPane]?.activeTabId, theirs?.version, tabIdsOf(theirs), pinnedIn(theirs), surfaces?.pinnedTools.includes(PINNED_TOOL_ID), surfaces?.contexts.none, regions?.version, regions?.sidebar.collapsed];
        }, { timeout: 20_000 })
        .toEqual([true, artifact, 3, [...tabs, 'artifacts'].sort(), [artifact], false, contextNone, 5, true]),
    );
    expect(old.maws.consoleErrors()).toEqual([]);
    said.push(`  ${peer.label}: drew the tab in front, the pin, the tool and the width; wrote ${Object.keys(theirs!.sets).length} sets, contexts ${JSON.stringify(Object.keys(surfaces!.contexts))}`);
    await s.quit(old);
    await endProfileProcesses(s.userData);

    // this build again: every tab once, the peer's library tab dropped and no page (the page's tab was in front), the pin,
    // the tool unpinned (read with the session in front), the sidebar folded
    const back = await s.launch();
    await s.ready(back.page);
    await expect.poll(async () => (await stripIds(back.page)).sort(), { timeout: 20_000, message: 'every tab back in the strip, the peer’s library tab dropped' }).toEqual(tabs);
    await expect(pageRegion(back.page), 'no page: the page’s tab was in front').toHaveCount(0);
    expect(new Set(await stripIds(back.page)).size, 'each once').toBe(tabs.length);
    await expect(mainTabById(back.page, artifact).getByRole('img', { name: 'Pinned' }), 'the pin').toBeVisible();
    await mainTabById(back.page, session).click(); // a tool's menu opens only while a session is in view
    await expect(activeMainTab(back.page)).toHaveAttribute('data-tab-id', session);
    await expectToolPinned(back.page, PINNED_TOOL, false, 'the tool unpinned');
    expect((await layoutOf<StoredSurfaces>(back.page, 'panelTools.surfaces'))?.pinnedTools ?? []).not.toContain(PINNED_TOOL_ID);
    await expect(back.page.getByRole('banner').getByRole('button', { name: 'Toggle sidebar' }), 'the sidebar folded').toHaveAttribute('aria-pressed', 'false');
    expect(back.maws.consoleErrors()).toEqual([]);
    await s.quit(back);
    said.push(`  ${here.label} again: ${tabs.length} tabs, the pin, the tool unpinned, the sidebar folded`);
    record(said);
  });
});

// The theme lives in `<profile>/settings.json` (the client's half, main's), the engine host's idle time in
// `<profile>/machine-settings.json` (the machine's half, `mawsd`'s); one act cannot reach both, so each is changed.
// UX wave U7b (O-40): Settings is read by build. This build draws it as a dialog over the window; the peer, a build that
// keeps tab sets (build F), as a tab, read through the main pane's tab panel.
type SettingsBuild = 'here' | 'peer';
const THEME = (page: Page, build: SettingsBuild, name: 'Light' | 'Dark' | 'System') => settingsPanel(page, build).getByRole('region', { name: 'Appearance' }).getByRole('radio', { name, exact: true });
const IDLE = (page: Page, build: SettingsBuild) => settingsPanel(page, build).getByRole('textbox', { name: 'Minutes before the supervisor exits when idle' });
const settingsPanel = (page: Page, build: SettingsBuild) => (build === 'here' ? settingsDialog(page) : page.locator('[data-region="main"]').getByRole('tabpanel'));
const settingsFile = (s: Scratch, name: 'settings.json' | 'machine-settings.json') => {
  const path = join(s.userData, name);
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { theme?: string; supervisor?: { idleExitMinutes: number | null } }) : null;
};
async function changeSettings(run: Run, build: SettingsBuild, theme: 'Dark' | 'System', minutes: string): Promise<void> {
  await menu(run.maws.app, 'settings.open');
  await THEME(run.page, build, theme).check();
  await IDLE(run.page, build).fill(minutes);
  await IDLE(run.page, build).press('Enter');
  await expect(IDLE(run.page, build)).toHaveValue(minutes);
}
async function expectSettings(run: Run, build: SettingsBuild, theme: 'Dark' | 'System', minutes: string): Promise<void> {
  await menu(run.maws.app, 'settings.open');
  await expect(THEME(run.page, build, theme), `the theme ${theme} read`).toBeChecked({ timeout: 20_000 });
  await expect(IDLE(run.page, build), `the idle time ${minutes} read`).toHaveValue(minutes, { timeout: 20_000 });
}
const refusals = (run: Run, s: Scratch) => [...run.output().split('\n'), ...s.daemonLog().split('\n')].filter((line) => SETTINGS_REFUSED.test(line));

test('(settings, both ways) a theme and an idle time changed through this build’s Settings are read by the peer, changed there and read back here, and neither build refuses either file', async () => {
  const { here, peer } = builds();
  test.skip(!keepsSets(peer), keepsSetsWhy(peer));
  await withScratch('xb-settings', async (s) => {
    const said: string[] = [`${here.label} (wire ${wireOf(here)}) and ${peer.label} (wire ${wireOf(peer)}) take turns on both settings files`];
    const run = await s.launch();
    await s.ready(run.page);
    await changeSettings(run, 'here', 'Dark', '25');
    await expect(run.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => [settingsFile(s, 'settings.json')?.theme, settingsFile(s, 'machine-settings.json')?.supervisor?.idleExitMinutes], { message: `${here.label} wrote both files` }).toEqual(['dark', 25]);
    expect(refusals(run, s)).toEqual([]);
    await s.quit(run);
    await endProfileProcesses(s.userData); // the peer's own mawsd reads the machine's file
    said.push(`  ${here.label} wrote the theme dark and the idle time 25`);

    const old = await s.launch({}, peer.root);
    await s.ready(old.page);
    await expect(old.page.locator('html'), `${peer.label} draws the theme`).toHaveAttribute('data-theme', 'dark', { timeout: 20_000 });
    await expectSettings(old, 'peer', 'Dark', '25');
    await changeSettings(old, 'peer', 'System', '40');
    await expect.poll(() => [settingsFile(s, 'settings.json')?.theme, settingsFile(s, 'machine-settings.json')?.supervisor?.idleExitMinutes], { message: `${peer.label} wrote both files` }).toEqual(['system', 40]);
    expect(refusals(old, s), `${peer.label} and its mawsd refused neither file`).toEqual([]);
    await s.quit(old);
    await endProfileProcesses(s.userData);
    said.push(`  ${peer.label} read both, then wrote the theme system and the idle time 40`);

    const back = await s.launch();
    await s.ready(back.page);
    await expectSettings(back, 'here', 'System', '40');
    expect(refusals(back, s), `${here.label} and its mawsd refused neither file`).toEqual([]);
    await s.quit(back);
    said.push(`  ${here.label} read both of the peer's values`);
    record(said);
  });
});

// ---- UX wave U7a: the sidebar's hidden sessions, a layout key the peer does not know ----------------------------------

// UX wave U7a (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M4 and Interfaces §G; the
// wave's root, UC-14): a hidden session is stored under a layout key of its own, `sidebar.hidden`, which a build from
// before U7a (build F on the owner's machines) never asks for: it is outside that build's LayoutKeySchema, and that
// build's main keeps every top-level key of layout.json and writes the whole file back with each write of its own. Its
// row is in UC-14's coverage table above (U13a's block).
//   (sidebar, both ways) this build hides the seeded session from its row's menu and quits. The peer opens the profile:
//                        it draws the session's row in its project, logs no "[layout] … is not a valid value", and folds
//                        its sidebar, after which layout.json still holds `sidebar.hidden` with the same entry. This
//                        build opens the profile again: the sidebar is folded as the peer left it, and the row stands
//                        under its project's "Hidden · 1". Skipped for a peer whose layout schema names the key.
const layoutSchemaNames = (build: Build, key: string) => readFileSync(join(build.root ?? REPO_ROOT, 'src/shared/ipc/schema/layout.ts'), 'utf8').includes(`'${key}'`);
const storedLayout = (userData: string) => JSON.parse(readFileSync(join(userData, 'layout.json'), 'utf8')) as Record<string, unknown>;
const sidebarFolded = (userData: string) => (storedLayout(userData).regions as { sidebar?: { collapsed?: boolean } } | undefined)?.sidebar?.collapsed ?? null;
const WIDE = { x: 72, y: 48, width: 1360, height: 860 }; // wide enough that the sidebar folds in place, not as an overlay

test('(sidebar, both ways) this build hides a session and quits; the peer, which knows no sidebar.hidden, draws the session, refuses no layout value, folds its sidebar and keeps the key; this build reads the session back hidden, the sidebar folded', async () => {
  const { here, peer } = builds();
  test.skip(layoutSchemaNames(peer, 'sidebar.hidden'), `the peer (wire ${wireOf(peer)}) names sidebar.hidden in its layout schema: a build from U7a on, not one that has never heard of the key`);
  await withScratch('xb-sidebar', async (s) => {
    const said: string[] = [`${here.label} (wire ${wireOf(here)}) hides a session; ${peer.label} (wire ${wireOf(peer)}) opens the profile; ${here.label} opens it again`];
    const wide = (run: Run) => run.maws.app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), WIDE);

    // this build: the seeded session hidden from its row's menu, and the key written
    const ours = await s.launch();
    await s.ready(ours.page, (st) => st.daemon !== null, 60_000);
    const id = await s.record(ours.page);
    const address = await addressed(ours.page, id);
    await wide(ours);
    const row = await sidebarRow(ours.page, { appSessionId: id });
    await row.click({ button: 'right' });
    await ours.page.getByRole('menuitem', { name: 'Hide', exact: true }).click();
    await expect(row, 'the row leaves its project’s list').toHaveCount(0);
    await expect(sidebarOf(ours.page).locator('[data-kind="hidden"]')).toHaveText('Hidden · 1');
    type Hidden = { version: 1; hidden: Record<string, { at: string; armedAt: string | null }> };
    let entry: Hidden['hidden'][string] | null = null;
    await expect
      .poll(async () => (entry = ((value(await invoke(ours.page, 'layout.get', { key: 'sidebar.hidden' })).value as Hidden | null)?.hidden[address] ?? null)), { message: 'this build stored the hide' })
      .not.toBeNull();
    expect(ours.maws.consoleErrors()).toEqual([]);
    await s.quit(ours);
    await endProfileProcesses(s.userData); // the peer's app starts a mawsd of its own build
    const stored = storedLayout(s.userData)['sidebar.hidden'];
    expect(stored, 'layout.json holds the hide as this build quit').toEqual({ version: 1, hidden: { [address]: entry } });
    said.push(`  hidden: ${address}, stored ${JSON.stringify(entry)}`);

    // the peer: the session drawn, no layout value refused, its fold written with the key kept
    const theirs = await s.launch({}, peer.root);
    const messages: string[] = [];
    theirs.page.on('console', (message) => messages.push(message.text()));
    messages.push(...(await theirs.page.consoleMessages({ filter: 'all' })).map((message) => message.text()));
    await s.ready(theirs.page, () => true, 60_000);
    await wide(theirs);
    await expect(await sidebarRow(theirs.page, { appSessionId: id }), `${peer.label} draws the session in its project`).toBeVisible({ timeout: 20_000 });
    expect(sidebarFolded(s.userData), 'the sidebar not folded before the peer folds it').not.toBe(true);
    await menu(theirs.maws.app, 'sidebar.toggle');
    await expect.poll(() => sidebarFolded(s.userData), { timeout: 10_000, message: `${peer.label} wrote its fold to layout.json` }).toBe(true);
    expect(storedLayout(s.userData)['sidebar.hidden'], `the key is in the file ${peer.label} wrote after its act, its entry the same`).toEqual(stored);
    expect(messages.filter((text) => INVALID_LAYOUT.test(text)), `${peer.label} refuses no stored layout value`).toEqual([]);
    expect(theirs.maws.consoleErrors()).toEqual([]);
    await s.quit(theirs);
    await endProfileProcesses(s.userData);
    expect(storedLayout(s.userData)['sidebar.hidden'], `the key as ${peer.label} quit`).toEqual(stored);
    said.push(`  ${peer.label}: the row drawn, nothing refused, the sidebar folded, sidebar.hidden kept`);

    // this build again: the fold the peer left, and the row under Hidden
    const again = await s.launch();
    await s.ready(again.page, (st) => st.daemon !== null, 60_000);
    const sidebar = sidebarOf(again.page);
    await expect(sidebar, 'the sidebar folded as the peer left it').toHaveJSProperty('inert', true, { timeout: 20_000 });
    expect(((value(await invoke(again.page, 'layout.get', { key: 'regions' })).value) as { sidebar: { collapsed: boolean } }).sidebar.collapsed).toBe(true);
    await wide(again);
    await menu(again.maws.app, 'sidebar.toggle');
    await expect(sidebar).toHaveJSProperty('inert', false);
    const back = await sidebarRow(again.page, { appSessionId: id });
    const hiddenRow = sidebar.locator('[data-kind="hidden"]');
    await expect(hiddenRow, 'the session is still hidden: its project ends in Hidden · 1').toHaveText('Hidden · 1', { timeout: 20_000 });
    await expect(back, 'out of its project’s list').toHaveCount(0);
    await hiddenRow.click();
    await expect(back, 'under the Hidden row').toHaveAttribute('data-indented', 'true');
    expect(again.maws.consoleErrors()).toEqual([]);
    await s.quit(again);
    said.push(`  ${here.label} again: the sidebar folded, the row under Hidden · 1`);
    record(said);
  });
});

// ---- UX wave U7b: the pages and the retired tab kinds, read across the two builds ---------------------------------------

// UX wave U7b (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M8 and Interfaces §F "At
// hydration" and §G; the wave's root, UC-14): Settings, Customize, Projects and the library are no tabs here, and an open
// page is stored under a layout key of its own, `destination`, which build F never asks for and its main keeps in the
// file. A tab of the four kinds stored by F is dropped at read, and where one of Customize, Projects or the library was
// in front its page opens. Its rows are in UC-14's coverage table above (U13a's block).
//   (destinations, both ways) the peer opens the seeded session, then Settings and Customize as tabs, leaves Customize in
//                             front and quits. This build opens the profile: neither tab is in the strip, every other
//                             tab is, the Customize page is open and no dialog. It opens Projects as a page and quits.
//                             The peer opens the profile: it draws its tabs, logs no "[layout] … is not a valid value",
//                             and after it selects the session's tab, which it files under the session's project,
//                             layout.json still holds `destination`. This build opens the profile again: no page is open
//                             (the peer wrote its sets, so the stored strip is no longer this build's form) and the key is
//                             gone. Skipped for a peer whose layout schema names `destination` (a build from U7b on, which
//                             has no such tabs to leave) and for a peer that keeps no tab set per project (the return's
//                             last step rests on the peer writing its sets).
type StoredDestination = { version: number; destination: { kind: string } };
const RETIRED = ['settings', 'customize', 'projects', 'artifacts'];
test('(destinations, both ways) the peer leaves Settings and Customize as tabs, Customize in front; this build drops both and opens the Customize page, then leaves Projects open; the peer keeps the key through its write; this build restores no page over the peer’s sets and deletes the key', async () => {
  const { here, peer } = builds();
  test.skip(layoutSchemaNames(peer, 'destination'), `the peer (wire ${wireOf(peer)}) names destination in its layout schema: a build from U7b on, which has no tabs of the four kinds to leave`);
  test.skip(!keepsSets(peer), keepsSetsWhy(peer));
  await withScratch('xb-destinations', async (s) => {
    const said: string[] = [`${peer.label} (wire ${wireOf(peer)}) leaves Settings and Customize as tabs; ${here.label} (wire ${wireOf(here)}) opens the profile; then each once more`];
    const wide = (run: Run) => run.maws.app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), WIDE);
    const frontOfStored = (stored: StoredSets | null) => {
      const set = stored?.sets[stored.current];
      return set?.panes[set.focusedPane]?.activeTabId ?? null;
    };

    // the peer: the seeded session's tab, then Settings and Customize as tabs, Customize in front
    const old = await s.launch({}, peer.root);
    await s.ready(old.page, () => true, 60_000);
    await wide(old);
    const id = await s.record(old.page);
    await (await sidebarRow(old.page, { appSessionId: id })).click();
    let session = '';
    await expect.poll(async () => (session = (await activeMainTab(old.page).getAttribute('data-tab-id')) ?? ''), { timeout: 20_000, message: `${peer.label} shows the session’s tab` }).toMatch(/^session:/);
    await menu(old.maws.app, 'settings.open');
    await expect(mainTabById(old.page, 'settings'), `${peer.label} opens Settings as a tab`).toBeVisible({ timeout: 15_000 });
    await old.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Customize', exact: true }).click();
    await expect(mainTabById(old.page, 'customize'), `${peer.label} opens Customize as a tab, in front`).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    let theirs: StoredSets | null = null;
    await expect
      .poll(async () => {
        theirs = await layoutOf<StoredSets>(old.page, 'main.tabs');
        const ids = tabIdsOf(theirs);
        return [ids.includes('settings'), ids.includes('customize'), ids.includes(session), frontOfStored(theirs)];
      }, { timeout: 20_000, message: `${peer.label} wrote both tabs, Customize in front` })
      .toEqual([true, true, true, 'customize']);
    const kept = tabIdsOf(theirs).filter((tab) => !RETIRED.includes(tab));
    expect(old.maws.consoleErrors()).toEqual([]);
    await s.quit(old);
    await endProfileProcesses(s.userData); // this build's own mawsd from here
    said.push(`  ${peer.label} wrote ${tabIdsOf(theirs).join(', ')}, customize in front`);

    // this build: neither tab, every other tab, the Customize page and no dialog; then Projects as a page
    const run = await s.launch();
    await s.ready(run.page, (st) => st.daemon !== null, 60_000);
    await wide(run);
    await expect(pageRegion(run.page), 'the page of the tab that was in front').toHaveAttribute('data-destination', 'customize', { timeout: 20_000 });
    await expect(settingsDialog(run.page), 'a Settings tab opens no dialog').toHaveCount(0);
    await expect.poll(async () => (await stripIds(run.page)).sort(), { timeout: 20_000, message: 'every tab but the two retired ones' }).toEqual(kept);
    await expect
      .poll(() => {
        const stored = storedLayout(s.userData);
        return [tabIdsOf(stored['main.tabs']).some((tab) => RETIRED.includes(tab)), (stored.destination as StoredDestination | undefined)?.destination.kind ?? null];
      }, { timeout: 20_000, message: 'written back without the two tabs, the page stored' })
      .toEqual([false, 'customize']);
    await run.page.locator('[data-region="sidebar"]').getByRole('button', { name: 'Projects', exact: true }).click();
    await expect(pageRegion(run.page)).toHaveAttribute('data-destination', 'projects');
    await expect.poll(() => (storedLayout(s.userData).destination as StoredDestination | undefined)?.destination.kind ?? null, { timeout: 10_000, message: 'the Projects page stored' }).toBe('projects');
    expect(run.maws.consoleErrors()).toEqual([]);
    await s.quit(run);
    await endProfileProcesses(s.userData);
    const ours = storedLayout(s.userData).destination;
    expect(ours, 'the page stored as this build quit').toEqual({ version: 1, destination: { kind: 'projects' } });
    said.push(`  ${here.label}: ${kept.length} tabs, the two dropped, the Customize page opened, no dialog; quit on Projects`);

    // the peer: its tabs drawn, no layout value refused, the session's tab filed under its project, the key kept
    const back = await s.launch({}, peer.root);
    const messages: string[] = [];
    back.page.on('console', (message) => messages.push(message.text()));
    messages.push(...(await back.page.consoleMessages({ filter: 'all' })).map((message) => message.text()));
    await s.ready(back.page, () => true, 60_000);
    await wide(back);
    await expect.poll(async () => (await stripIds(back.page)).sort(), { timeout: 20_000, message: `${peer.label} draws its tabs` }).toEqual(kept);
    await (await sidebarRow(back.page, { appSessionId: id })).click();
    await expect(activeMainTab(back.page)).toHaveAttribute('data-tab-id', session, { timeout: 20_000 });
    await expect
      .poll(() => (storedLayout(s.userData)['main.tabs'] as StoredSets | undefined)?.current ?? 'none', { timeout: 20_000, message: `${peer.label} filed the session’s tab under its project and wrote its sets` })
      .not.toBe('none');
    expect(storedLayout(s.userData).destination, `the key is in the file ${peer.label} wrote after its act`).toEqual(ours);
    expect(messages.filter((text) => INVALID_LAYOUT.test(text)), `${peer.label} refuses no stored layout value`).toEqual([]);
    expect(back.maws.consoleErrors()).toEqual([]);
    await s.quit(back);
    await endProfileProcesses(s.userData);
    said.push(`  ${peer.label}: its tabs drawn, nothing refused, its sets written, destination kept`);

    // this build again: the stored strip is the peer's sets, so no page is restored, and the key is deleted
    const again = await s.launch();
    await s.ready(again.page, (st) => st.daemon !== null, 60_000);
    await expect(activeMainTab(again.page), 'the tabs show').toHaveAttribute('data-tab-id', session, { timeout: 20_000 });
    await expect(pageRegion(again.page), 'no page over the peer’s sets').toHaveCount(0);
    await expect.poll(() => 'destination' in storedLayout(s.userData), { timeout: 20_000, message: 'the key deleted' }).toBe(false);
    expect(again.maws.consoleErrors()).toEqual([]);
    await s.quit(again);
    said.push(`  ${here.label} again: no page, destination deleted`);
    record(said);
  });
});

// ---- UX wave U8b: the side column's tabs and groups, build F reads (UC-14) --------------------------------------------
// U8b (docs/doperpowers/plans/2026-11-12-ux-wave-U8b-column-and-tabs.md: Interfaces §A and §G, M9's decision 3) stores the
// side column as tabs in one or two groups. The keys build F knows keep their shapes: `panel.<session>` and `panel.pinned`
// are the strip, `panelTools.surfaces.stacks` the tabs in view (none while the column is hidden), `regions.panel.width`
// the last width dragged (380 at a reset); three keys are new, which F never reads and its main keeps in the file
// (`panelTools.groups`, `panelTools.widths`, `cards.open`). Two scenes prove it both ways, each by what the reading build
// draws or by what it writes after an act; a key the peer never writes is read only after a write of the peer's own is
// seen, to show that the peer kept it. Each runs only with a peer older than this landing (its
// src/shared/ipc/schema/layout.ts names no `panelTools.groups`), whose side column is F's: two stacked surfaces, "Close
// surface", 380 the automatic width, driven here by locators of its own UI (above: chooseTool, showTool, peerSurface,
// peerStack, closeOnPeer). The run of record is the one whose peer is F (`--peer-exact f1852de3a`).
//   (side column, from the peer)  the peer stacks Files and Session info, then Review in the lower place, keeps a
//                                 terminal for every session, shows it with no session shown and drags the column;
//                                 this build shows that pin selected with no session shown, then the session's two
//                                 groups, Files above and Review below, the pinned terminal in the strip and no Session
//                                 info tab (the first read's prune), at the peer's width as its wide width, and writes
//                                 the three keys; Session info opened again stays a tab across one more launch.
//   (side column, to the peer)    this build opens Review, keeps two terminals for every session and selects the
//                                 second with no session shown, opens an artifact beside the session, drags the
//                                 narrow width to exactly 380, moves Review below, drags the bar, resets the wide width,
//                                 hides the column and folds Environment; its relaunch shows the hidden column, then both
//                                 groups on one click, and hides it again; the peer draws its cards, then on a click its
//                                 surface at its automatic width, its sidebar and tab in front as left, the artifact's
//                                 record, says nothing of an invalid value, and writes its two surfaces; with no session
//                                 shown it draws both pins as its terminal's tabs, the second selected; the three keys
//                                 are as they were; this build shows those two as two groups, the wide width automatic
//                                 and the narrow one 380.
// UC-14's coverage for U8b (the rows of the U13a table above that this landing changes or adds):
//   | stored                                      | F reads this build's value, and writes on      | this build reads F's value                      |
//   |---------------------------------------------|------------------------------------------------|-------------------------------------------------|
//   | `panel.<session>`: the strip                | (to the peer): Review and the artifact drawn   | (from the peer): the tabs in view kept, Session |
//   |                                             | from it on a click                             | info dropped; the return of (to the peer)       |
//   | `panel.pinned`                              | (to the peer): two pinned terminals drawn as   | (from the peer): the pinned terminal            |
//   |                                             | its terminal's tabs with no session shown      |                                                 |
//   | `panelTools.activeNoSession`                | (to the peer): the second pin, not the first,  | (from the peer): the pin selected, no session   |
//   |                                             | the tab it selects with no session shown       |                                                 |
//   | `panelTools.surfaces`: `stacks`             | (to the peer): the hidden column's empty entry | (from the peer): two ids as two groups, one as  |
//   |                                             | drawn as F's cards; F's own two-surface write  | one; the return of (to the peer)                |
//   | `panelTools.params`                         | (to the peer): the artifact tab on its record  | the return of (to the peer): the record below   |
//   | `regions.panel.width`                       | (to the peer): 380 drawn as F's automatic one  | (from the peer): F's width as the wide one      |
//   | `panelTools.groups`, `panelTools.widths`,   | (to the peer): kept by F through its own write | (from the peer): written at the first read;     |
//   | `cards.open`                                |                                                | the return: the groups and both widths as left  |
const storesGroups = (build: Build) => {
  const schema = join(build.root ?? REPO_ROOT, 'src/shared/ipc/schema/layout.ts');
  return existsSync(schema) && readFileSync(schema, 'utf8').includes('panelTools.groups');
};
const storesGroupsWhy = (peer: Build) => `the peer (wire ${wireOf(peer)}) names panelTools.groups in its src/shared/ipc/schema/layout.ts: it has this landing's side column, which these scenes do not drive as the peer's; UC-14's round trip is with build F, --peer-exact f1852de3a`;
const F_AUTOMATIC_WIDTH = 380; // build F's automatic width (its app/shell-geometry.ts), which a reset here writes to `regions`
const NO_SESSION_SCOPE = '@none'; // the `stacks` key of the column while no session is shown, in both builds (schema/layout.ts)
const NARROW_AUTOMATIC_WIDTH = 360; // this build's automatic width of a column with no reading tool in view (app/shell-geometry.ts)
type PanelRef = { id: string; toolId: string; pinned: boolean };
// The side column's keys as main last wrote layout.json (whole, through a rename: a read never sees half a file), for one
// session: its scope in `stacks` is its address, as its `panel.<session>` key is
function sideOf(s: Scratch, address: string) {
  const path = join(s.userData, 'layout.json');
  const file = (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}) as Record<string, unknown>;
  const pinned = Array.isArray(file['panel.pinned']) ? (file['panel.pinned'] as PanelRef[]) : [];
  const own = (file[`panel.${address}`] as { tabs?: PanelRef[]; activeTabId?: string | null } | undefined)?.tabs ?? [];
  const toolOf = (id: string) => [...pinned, ...own].find((tab) => tab.id === id)?.toolId ?? `(no tab ${id})`;
  const stacks = (file['panelTools.surfaces'] as StoredSurfaces | undefined)?.stacks ?? {};
  const noSession = (file['panelTools.activeNoSession'] as { activeTabId?: string | null } | undefined)?.activeTabId ?? null;
  const lower = (file['panelTools.groups'] as { lower?: Record<string, { tabs: string[]; share: number }> } | undefined)?.lower?.[address];
  return {
    pinned: pinned.map((tab) => tab.toolId),
    pinnedIds: pinned.map((tab) => tab.id),
    noSession,
    stackNoSession: stacks[NO_SESSION_SCOPE] ?? null,
    own: own.map((tab) => tab.toolId),
    tabOf: (toolId: string) => own.find((tab) => tab.toolId === toolId)?.id,
    // the tools in view by the stored stack, and with no session shown by F's own rule (its active pin while no stack)
    inView: (stacks[address] ?? []).map(toolOf),
    inViewNoSession: (stacks[NO_SESSION_SCOPE] ?? (noSession === null ? [] : [noSession])).map(toolOf),
    lower: lower === undefined ? null : { tabs: lower.tabs.map(toolOf), share: lower.share },
    params: (file['panelTools.params'] as { params?: Record<string, unknown> } | undefined)?.params ?? {},
    width: (file.regions as { panel?: { width?: number } } | undefined)?.panel?.width,
    added: { 'panelTools.groups': file['panelTools.groups'], 'panelTools.widths': file['panelTools.widths'], 'cards.open': file['cards.open'] },
  };
}
const panelResizer = (page: Page) => page.locator('[data-region="panel"]').getByRole('separator', { name: 'Resize right panel', exact: true });
const widthOf = async (page: Page) => Number(await panelResizer(page).getAttribute('aria-valuenow'));
// A group's tabs by their tools' titles, in strip order (a tab's name is its title, then ` · ` and its suffix if any)
const titlesIn = async (page: Page, group: 'upper' | 'lower') => (await sideTabNames(page, group)).map((name) => name.split(' · ')[0].trim());
const sortedTitlesIn = async (page: Page, group: 'upper' | 'lower') => (await titlesIn(page, group)).sort();
// A pointer drag of a resizer by whole pixels from where it is grabbed (each build's app/Resizer.tsx follows the pointer)
async function dragBy(page: Page, handle: Locator, dx: number, dy = 0): Promise<void> {
  const box = (await handle.boundingBox())!;
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}
async function showSession(page: Page, id: AppSessionId, session: string): Promise<void> {
  await (await sidebarRow(page, { appSessionId: id })).click();
  await expect(activeMainTab(page), 'the session’s tab in front').toHaveAttribute('data-tab-id', session, { timeout: 20_000 });
}

test('(side column, from the peer) two surfaces the peer stacked open as two groups, its pinned terminal in the strip and selected with no session shown, a tool it had hidden no tab, its width the wide one; the three keys written, and a tool opened again kept as a tab', async () => {
  const { here, peer } = builds();
  test.skip(storesGroups(peer), storesGroupsWhy(peer));
  await withScratch('xb-side-from', async (s) => {
    const said: string[] = [`${peer.label} (wire ${wireOf(peer)}) stacks surfaces; ${here.label} (wire ${wireOf(here)}) reads them as tabs in groups`];
    // the peer: the seeded session from its sidebar row; Files, Session info below it, then Review in Session info's
    // place; a terminal, which takes the lower place in its turn, kept for every session; Review shown below again
    const old = await s.launch({}, peer.root);
    await s.ready(old.page);
    const id = await s.record(old.page);
    const address = await addressed(old.page, id);
    const session = `session:${address}`;
    await showSession(old.page, id, session);
    await showTool(old.page, 'Files');
    await showTool(old.page, PINNED_TOOL);
    await expect.poll(() => peerStack(old.page), { message: `${peer.label} stacks ${PINNED_TOOL} below Files` }).toEqual(['Files', PINNED_TOOL]);
    await showTool(old.page, 'Review');
    await expect.poll(() => peerStack(old.page), { message: 'Review takes the lower place' }).toEqual(['Files', 'Review']);
    await showTool(old.page, 'Terminal');
    await expect.poll(() => peerStack(old.page), { message: 'the terminal takes the lower place' }).toEqual(['Files', 'Terminal']);
    await openToolMenu(old.page, 'Terminal', 'Keep open for every session');
    await old.page.getByRole('menuitem', { name: 'Keep open for every session', exact: true }).click();
    await closeMenus(old.page);
    await showTool(old.page, 'Review');
    await expect.poll(() => peerStack(old.page), { message: 'Review below Files again' }).toEqual(['Files', 'Review']);
    // no session shown (its tab closed): the pin brought into view, and the column dragged 64 px wider
    await mainTabById(old.page, session).getByRole('button', { name: /^Close / }).click();
    await expect(mainTabById(old.page, session), 'the session’s tab closed').toHaveCount(0);
    await showTool(old.page, 'Terminal');
    await expect.poll(() => peerStack(old.page), { message: 'the pin alone with no session shown' }).toEqual(['Terminal']);
    const start = await widthOf(old.page);
    await dragBy(old.page, panelResizer(old.page), -64);
    const dragged = start + 64;
    await expect(panelResizer(old.page), `${peer.label}’s column dragged`).toHaveAttribute('aria-valuenow', String(dragged));
    expect(dragged, 'a width the peer does not take for its automatic one').not.toBe(F_AUTOMATIC_WIDTH);
    await expect
      .poll(() => {
        const side = sideOf(s, address);
        return [side.pinned, [...side.own].sort(), side.inView, side.inViewNoSession, side.width, side.added['panelTools.groups'] ?? null];
      }, { timeout: 20_000, message: `${peer.label} wrote the pin, the session's tabs, both stacks and the width` })
      .toEqual([['terminal'], ['files', 'review', 'session-info'], ['files', 'review'], ['terminal'], dragged, null]);
    expect(old.maws.consoleErrors()).toEqual([]);
    await s.quit(old);
    await endProfileProcesses(s.userData); // this build's own mawsd from here
    said.push(`  ${peer.label}: Files and Review stacked (${PINNED_TOOL} hidden, its tab kept), the terminal pinned and shown with no session, the column at ${dragged}`);

    // this build: no session shown, the pin selected and alone at the narrow automatic width; the first read wrote the
    // three keys, the peer's one width the wide one
    const run = await s.launch();
    await s.ready(run.page);
    await expect(sideGroup(run.page, 'upper'), 'the pin in view with no session shown').toHaveAttribute('aria-label', 'Terminal', { timeout: 20_000 });
    await expect(sideGroup(run.page, 'lower')).toHaveCount(0);
    await expect(sideTab(sideGroup(run.page, 'upper'), /^Terminal/), 'the pin selected').toHaveAttribute('aria-selected', 'true');
    // a terminal is wide (UX wave U8b, Addendum 6): the pin in view draws the peer's dragged width, read as the wide one
    await expect(panelResizer(run.page), 'the pin, a terminal, at the wide width the peer dragged').toHaveAttribute('aria-valuenow', String(dragged));
    await expect
      .poll(() => {
        const { added } = sideOf(s, address);
        return [(added['panelTools.groups'] as { version?: number } | undefined)?.version, added['panelTools.widths'], added['cards.open']];
      }, { timeout: 20_000, message: 'the first read wrote the three keys' })
      .toEqual([1, { version: 1, wide: dragged, narrow: null }, { version: 1, open: ['environment'] }]);
    // the session: Files above and Review below in view, the pinned terminal in the strip, no Session info tab, at the
    // peer's width
    await showSession(run.page, id, session);
    await expect(sideGroup(run.page, 'upper'), 'Files above').toHaveAttribute('aria-label', 'Files', { timeout: 20_000 });
    await expect(sideGroup(run.page, 'lower'), 'Review below').toHaveAttribute('aria-label', 'Review');
    await expect.poll(() => titlesIn(run.page, 'upper'), { message: 'the pin first, then Files' }).toEqual(['Terminal', 'Files']);
    await expect.poll(() => titlesIn(run.page, 'lower')).toEqual(['Review']);
    await expect(sideTab(sideColumn(run.page), PINNED_TOOL), `no ${PINNED_TOOL} tab in either strip`).toHaveCount(0);
    await expect(panelResizer(run.page), 'the wide width at the peer’s').toHaveAttribute('aria-valuenow', String(dragged));
    // Session info opened again on purpose, then its group's other tab brought back into view: a tab not in view
    await openSurface(run.page, PINNED_TOOL);
    const holder = (await titlesIn(run.page, 'upper')).includes(PINNED_TOOL) ? 'upper' : 'lower';
    const other = holder === 'upper' ? 'Files' : 'Review';
    // a width dragged under the peer is not the narrow one (Addendum 8): with narrow tools alone in view, Session info in
    // one group and Background tasks brought into the other, the column is at the narrow automatic width; Background
    // tasks then closed, which gives its group's tab back to view
    const otherGroup = holder === 'upper' ? 'lower' : 'upper';
    await sideGroup(run.page, otherGroup).getByRole('button', { name: 'Add a tool', exact: true }).click();
    await run.page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click();
    await expect(sideGroup(run.page, otherGroup), 'Background tasks in the other group').toHaveAttribute('aria-label', 'Background tasks');
    await expect(sideGroup(run.page, holder), `${PINNED_TOOL} in view`).toHaveAttribute('aria-label', PINNED_TOOL);
    await expect(panelResizer(run.page), 'a width dragged under the peer is not the narrow one').toHaveAttribute('aria-valuenow', String(NARROW_AUTOMATIC_WIDTH));
    await sideGroup(run.page, otherGroup).getByRole('button', { name: 'Close Background tasks', exact: true }).click();
    await expect(sideTab(sideColumn(run.page), 'Background tasks'), 'Background tasks closed').toHaveCount(0);
    await sideTab(sideGroup(run.page, holder), other).click();
    await expect(sideGroup(run.page, holder)).toHaveAttribute('aria-label', other);
    await expect(sideTab(sideColumn(run.page), PINNED_TOOL), `${PINNED_TOOL} a tab`).toHaveCount(1);
    expect(run.maws.consoleErrors()).toEqual([]);
    await s.quit(run);
    said.push(`  ${here.label}: the pin with no session, a terminal, drawn at the wide ${dragged}; Files above, Review below, the terminal in the strip, no ${PINNED_TOOL}; wide ${dragged}; ${PINNED_TOOL} opened again, and with Background tasks beside it the column drawn at the narrow ${NARROW_AUTOMATIC_WIDTH}, then Background tasks closed`);

    // one more launch: no first read again, so the tab not in view stands
    const again = await s.launch();
    await s.ready(again.page);
    await showSession(again.page, id, session);
    await expect(sideTab(sideColumn(again.page), PINNED_TOOL), `${PINNED_TOOL} still a tab`).toHaveCount(1, { timeout: 20_000 });
    await expect(again.page.locator(`[data-surface="${PINNED_TOOL_ID}"]`), 'and not in view').toHaveCount(0);
    expect(again.maws.consoleErrors()).toEqual([]);
    await s.quit(again);
    said.push(`  ${here.label} again: ${PINNED_TOOL} still a tab`);
    record(said);
  });
});

test('(side column, to the peer) two groups, a hidden column, a folded card and the two widths this build stored are drawn by the peer as its cards and then its surfaces, kept through its own write, and read back here as two groups with the widths as left', async () => {
  const { here, peer } = builds();
  test.skip(storesGroups(peer), storesGroupsWhy(peer));
  await withScratch('xb-side-to', async (s) => {
    const said: string[] = [`${here.label} (wire ${wireOf(here)}) stores two groups and two widths; ${peer.label} (wire ${wireOf(peer)}) reads them, acts and writes on`];
    // this build: the session in front, the sidebar 40 px wider; Review, a terminal and an artifact beside it (the
    // artifact's tab holds its params), each in view in its turn
    const run = await s.launch();
    await s.ready(run.page);
    const id = await s.record(run.page);
    const address = await addressed(run.page, id);
    const session = `session:${address}`;
    await showSession(run.page, id, session);
    const sidebar = run.page.locator('[data-region="sidebar"]').getByRole('separator', { name: 'Resize sidebar' });
    await sidebar.focus();
    for (let i = 0; i < 5; i++) await run.page.keyboard.press('ArrowRight');
    await expect(sidebar).toHaveAttribute('aria-valuenow', '280');
    await openSurface(run.page, 'Review');
    await openSurface(run.page, 'Terminal');
    // two terminals kept for every session (`panel.pinned`): the one in view by its icon's menu, a second added by "+"
    // and pinned by its tab's glyph; with no session shown (the session's tab closed) the second is selected
    // (`panelTools.activeNoSession`), not the first, and the session is shown again
    await pinSurfaceForSessions(run.page, 'Terminal');
    await sideGroup(run.page, 'upper').getByRole('button', { name: 'Add a tool', exact: true }).click();
    await run.page.getByRole('menuitem', { name: 'Terminal', exact: true }).click();
    await sideGroup(run.page, 'upper').locator('[data-side-strip] [data-tab-id]:has([role="tab"][aria-selected="true"])').getByRole('button', { name: 'Pin Terminal', exact: true }).click();
    await expect.poll(() => sideOf(s, address).pinned, { timeout: 20_000, message: `${here.label} wrote two pinned terminals` }).toEqual(['terminal', 'terminal']);
    const [firstPin, secondPin] = sideOf(s, address).pinnedIds;
    await mainTabById(run.page, session).getByRole('button', { name: /^Close / }).click();
    await expect(mainTabById(run.page, session), 'the session’s tab closed: no session shown').toHaveCount(0);
    if (!await sideGroup(run.page, 'upper').count()) await chooseTool(run.page, 'Terminal');
    await sideColumn(run.page).locator(`[data-side-strip] [data-tab-id="${secondPin}"] [role="tab"]`).click();
    await expect(sideColumn(run.page).locator(`[data-side-strip] [data-tab-id="${secondPin}"] [role="tab"]`), 'the second pin in view').toHaveAttribute('aria-selected', 'true');
    // both readings of the no-session column name the second pin: the selection, and the tab in view (`stacks`), which
    // the peer draws by its own rule (it falls back to the selection only for a scope with no `stacks` entry)
    await expect
      .poll(() => [sideOf(s, address).noSession, sideOf(s, address).stackNoSession], { timeout: 20_000, message: `${here.label} wrote the second pin as the selection and the tab in view with no session shown` })
      .toEqual([secondPin, [secondPin]]);
    await showSession(run.page, id, session);
    const artifactId = await createHtmlArtifact(run.page, LAYOUT_PAGE, 'XB_SIDE_PAGE');
    await openArtifactInPanel(run.page, artifactId);
    await mainTabById(run.page, session).click();
    await expect(activeMainTab(run.page)).toHaveAttribute('data-tab-id', session);
    await expect(sideGroup(run.page, 'upper'), 'the artifact in view').toHaveAttribute('aria-label', 'Artifacts');
    await expect.poll(() => sortedTitlesIn(run.page, 'upper'), { message: 'one strip: the two pins and the session’s two tabs' }).toEqual(['Artifacts', 'Review', 'Terminal', 'Terminal']);
    // the narrow width (no reading tool in view) dragged to exactly 380, which the peer takes for its automatic width
    await expect(panelResizer(run.page), 'the narrow width automatic').toHaveAttribute('aria-valuenow', String(NARROW_AUTOMATIC_WIDTH));
    await dragBy(run.page, panelResizer(run.page), NARROW_AUTOMATIC_WIDTH - F_AUTOMATIC_WIDTH);
    await expect(panelResizer(run.page), 'the narrow width at 380').toHaveAttribute('aria-valuenow', String(F_AUTOMATIC_WIDTH));
    // Review below (the column wide from here), the bar dragged, the wide width dragged and then reset to automatic
    await moveSideTab(run.page, 'Review', 'below');
    await expect(sideGroup(run.page, 'lower'), 'Review below').toHaveAttribute('aria-label', 'Review');
    await expect(sideGroup(run.page, 'upper'), 'the artifact above').toHaveAttribute('aria-label', 'Artifacts');
    await expect(panelResizer(run.page), 'the wide width in use').not.toHaveAttribute('aria-valuenow', String(F_AUTOMATIC_WIDTH));
    const wide = await widthOf(run.page);
    const bar = sideColumn(run.page).getByRole('separator', { name: 'Resize groups', exact: true });
    const half = await bar.getAttribute('aria-valuenow');
    await dragBy(run.page, bar, 0, -48);
    await expect(bar, 'the bar dragged').not.toHaveAttribute('aria-valuenow', half ?? '');
    const share = await bar.getAttribute('aria-valuenow');
    await dragBy(run.page, panelResizer(run.page), 64);
    await expect(panelResizer(run.page), 'the wide width dragged').toHaveAttribute('aria-valuenow', String(wide - 64));
    await panelResizer(run.page).focus();
    await run.page.keyboard.press('Enter');
    await expect(panelResizer(run.page), 'the wide width automatic again').toHaveAttribute('aria-valuenow', String(wide));
    await expect
      .poll(() => {
        const side = sideOf(s, address);
        const artifactTab = side.tabOf('artifacts');
        return [side.added['panelTools.widths'], side.width, side.inView, side.lower?.tabs, side.lower !== null && side.lower.share !== 0.5, artifactTab !== undefined && artifactTab in side.params];
      }, { timeout: 20_000, message: `${here.label} wrote the widths, the two tabs in view, the lower group and the artifact's params` })
      .toEqual([{ version: 1, wide: null, narrow: F_AUTOMATIC_WIDTH }, F_AUTOMATIC_WIDTH, ['artifacts', 'review'], ['review'], true, true]);
    // the column hidden (the cards show), Environment folded
    await sideColumn(run.page).getByRole('button', { name: 'Hide side column', exact: true }).click();
    await expect(sessionCards(run.page), 'the cards in the hidden column’s place').toBeVisible();
    await expect(sideGroup(run.page, 'upper')).toHaveCount(0);
    const environment = sessionCard(run.page, 'Environment').getByRole('button', { name: /^Environment/ });
    await expect(environment, 'Environment open by default').toHaveAttribute('aria-expanded', 'true');
    await environment.click();
    await expect(environment).toHaveAttribute('aria-expanded', 'false');
    await expect
      .poll(() => {
        const side = sideOf(s, address);
        return [side.inView, side.lower?.tabs, side.added['cards.open']];
      }, { timeout: 20_000, message: `${here.label} wrote the hidden column and the fold` })
      .toEqual([[], ['review'], { version: 1, open: [] }]);
    expect(run.maws.consoleErrors()).toEqual([]);
    await s.quit(run);
    said.push(`  ${here.label}: the artifact and the terminal above, Review below, the bar at ${share} %, narrow 380, wide automatic (${wide}), the column hidden, Environment folded`);

    // this build again: the hidden column (the cards, Environment folded); one click on Review shows both groups with
    // their tabs as left and the bar where it was; hidden again
    const relaunch = await s.launch();
    await s.ready(relaunch.page);
    await showSession(relaunch.page, id, session);
    await expect(sessionCards(relaunch.page), 'the column still hidden').toBeVisible({ timeout: 20_000 });
    await expect(sideGroup(relaunch.page, 'upper')).toHaveCount(0);
    await expect(sessionCard(relaunch.page, 'Environment').getByRole('button', { name: /^Environment/ }), 'Environment still folded').toHaveAttribute('aria-expanded', 'false');
    await chooseTool(relaunch.page, 'Review');
    await expect(sideGroup(relaunch.page, 'upper'), 'the artifact above').toHaveAttribute('aria-label', 'Artifacts', { timeout: 20_000 });
    await expect(sideGroup(relaunch.page, 'lower'), 'Review below').toHaveAttribute('aria-label', 'Review');
    await expect.poll(() => sortedTitlesIn(relaunch.page, 'upper')).toEqual(['Artifacts', 'Terminal', 'Terminal']);
    await expect.poll(() => titlesIn(relaunch.page, 'lower')).toEqual(['Review']);
    await expect(sideColumn(relaunch.page).getByRole('separator', { name: 'Resize groups', exact: true }), 'the bar where it was').toHaveAttribute('aria-valuenow', share ?? '');
    await sideColumn(relaunch.page).getByRole('button', { name: 'Hide side column', exact: true }).click();
    await expect(sessionCards(relaunch.page)).toBeVisible();
    await expect.poll(() => sideOf(s, address).inView, { message: 'hidden again' }).toEqual([]);
    expect(relaunch.maws.consoleErrors()).toEqual([]);
    await s.quit(relaunch);
    await endProfileProcesses(s.userData);
    const left = sideOf(s, address).added;
    said.push(`  ${here.label} again: the hidden column, then both groups on one click, hidden again`);

    // the peer: its cards (the column was hidden), its sidebar and tab in front as left, no word of an invalid value;
    // then a click on Review draws it at the peer's automatic width (`regions` holds 380), and "Open saved artifact"
    // draws the artifact's tab on its record below it: two surfaces, which the peer writes
    const old = await s.launch({}, peer.root);
    await s.ready(old.page);
    await expect(activeMainTab(old.page), `${peer.label} shows the session’s tab in front`).toHaveAttribute('data-tab-id', session, { timeout: 20_000 });
    await expect(old.page.getByRole('complementary', { name: 'Session cards', exact: true }), `${peer.label} draws its cards`).toBeVisible({ timeout: 20_000 });
    expect(await peerStack(old.page), 'and no surface').toEqual([]);
    await expect(old.page.locator('[data-region="sidebar"]').getByRole('separator', { name: 'Resize sidebar' }), 'the sidebar at the width written').toHaveAttribute('aria-valuenow', '280');
    await chooseTool(old.page, 'Review');
    await expect.poll(() => peerStack(old.page), { message: `${peer.label} draws Review on a click` }).toEqual(['Review']);
    await expect(panelResizer(old.page), `${peer.label} reads 380 as its automatic width`).toHaveAttribute('aria-valuenow', String(wide));
    await surfaceRow(old.page).getByRole('button', { name: 'More surfaces', exact: true }).click();
    await old.page.getByRole('menuitem', { name: 'Open saved artifact', exact: true }).click();
    await expect.poll(() => peerStack(old.page), { message: `${peer.label} draws the artifact’s tab below Review` }).toEqual(['Review', 'Artifacts']);
    await expect(peerSurface(old.page, 'Artifacts').locator(`[data-artifact-record="${artifactId}"]`), 'the artifact’s tab on its record').toBeVisible({ timeout: 20_000 });
    await expect.poll(() => sideOf(s, address).inView, { timeout: 20_000, message: `${peer.label} writes its two surfaces` }).toEqual(['review', 'artifacts']);
    // with no session shown (its tab closed), the peer draws this build's pins as its terminal's tabs, the second one
    // selected, as this build left its no-session column
    await mainTabById(old.page, session).getByRole('button', { name: /^Close / }).click();
    await expect(mainTabById(old.page, session), `${peer.label} shows no session`).toHaveCount(0);
    await expect.poll(() => peerStack(old.page), { timeout: 20_000, message: `${peer.label} draws the pinned terminal with no session shown` }).toEqual(['Terminal']);
    const peerTerminal = peerSurface(old.page, 'Terminal');
    await expect(peerTerminal.locator(`[data-tab-id="${firstPin}"] [role="tab"]`), 'the first pin, a tab of its terminal').toHaveAttribute('aria-selected', 'false');
    await expect(peerTerminal.locator(`[data-tab-id="${secondPin}"] [role="tab"]`), 'the second pin, selected').toHaveAttribute('aria-selected', 'true');
    expect((await consoleSaid(old.page)).filter((line) => INVALID_LAYOUT.test(line)), `${peer.label} took every layout value as valid`).toEqual([]);
    expect(old.maws.consoleErrors()).toEqual([]);
    await s.quit(old);
    await endProfileProcesses(s.userData);
    expect(sideOf(s, address).added, `the three keys as ${here.label} left them, through ${peer.label}’s write`).toEqual(left);
    said.push(`  ${peer.label}: its cards, then Review at ${wide} and the artifact on its record; wrote its two surfaces; with no session shown, the two pins with the second selected; the three keys kept`);

    // this build: the peer's two surfaces as two groups, the wide width automatic, the narrow one 380 as stored and as
    // drawn (the terminal brought into view above, beside the artifact below, keeps the column wide: Addendum 6; a
    // narrow tool brought into view above draws it at 380: Addendum 8)
    const back = await s.launch();
    await s.ready(back.page);
    await showSession(back.page, id, session);
    await expect(sideGroup(back.page, 'upper'), 'Review above').toHaveAttribute('aria-label', 'Review', { timeout: 20_000 });
    await expect(sideGroup(back.page, 'lower'), 'the artifact below').toHaveAttribute('aria-label', 'Artifacts');
    await expect(sideGroup(back.page, 'lower').locator(`[data-artifact-record="${artifactId}"]`), 'on its record').toBeVisible({ timeout: 20_000 });
    await expect.poll(() => sortedTitlesIn(back.page, 'upper')).toEqual(['Review', 'Terminal', 'Terminal']);
    await expect.poll(() => titlesIn(back.page, 'lower')).toEqual(['Artifacts']);
    await expect(panelResizer(back.page), 'the wide width automatic').toHaveAttribute('aria-valuenow', String(wide));
    await sideTab(sideGroup(back.page, 'upper'), /^Terminal/).first().click();
    await expect(sideGroup(back.page, 'upper'), 'the terminal above').toHaveAttribute('aria-label', 'Terminal');
    await expect(panelResizer(back.page), 'a terminal in view keeps the column wide (UX wave U8b, Addendum 6)').toHaveAttribute('aria-valuenow', String(wide));
    expect(sideOf(s, address).added['panelTools.widths'], 'the narrow width still 380').toEqual({ version: 1, wide: null, narrow: F_AUTOMATIC_WIDTH });
    // drawn, not only stored (Addendum 8): a narrow tool in view above, beside the artifact below, and the column is 380
    await sideGroup(back.page, 'upper').getByRole('button', { name: 'Add a tool', exact: true }).click();
    await back.page.getByRole('menuitem', { name: 'Background tasks', exact: true }).click();
    await expect(sideGroup(back.page, 'upper'), 'Background tasks above').toHaveAttribute('aria-label', 'Background tasks');
    await expect(panelResizer(back.page), 'the column drawn at the stored narrow width').toHaveAttribute('aria-valuenow', String(F_AUTOMATIC_WIDTH));
    // the view put back: Background tasks closed, the terminal in view above and the column wide again
    await sideGroup(back.page, 'upper').getByRole('button', { name: 'Close Background tasks', exact: true }).click();
    await expect.poll(() => sortedTitlesIn(back.page, 'upper')).toEqual(['Review', 'Terminal', 'Terminal']);
    await sideTab(sideGroup(back.page, 'upper'), /^Terminal/).first().click();
    await expect(sideGroup(back.page, 'upper'), 'the terminal above again').toHaveAttribute('aria-label', 'Terminal');
    await expect(panelResizer(back.page), 'wide again').toHaveAttribute('aria-valuenow', String(wide));
    expect(back.maws.consoleErrors()).toEqual([]);
    await s.quit(back);
    said.push(`  ${here.label} again: Review above, the artifact below, wide automatic (${wide}), the terminal wide too; Background tasks above drawn at the stored narrow 380, then closed`);
    record(said);
  });
});

// ---- UX wave U8c-2: where a session's agent is, build F reads (UC-14) -------------------------------------------------
// U8c-2 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, §C and §L's scenes 4 and 5) stores where a
// session's agent is as two columns of the index, `sessions.launch_folder` and `sessions.agent_folder`, beside the
// columns build F knows, which keep F's rule: a move by the engine's worktree tool re-files the record under the
// worktree, a `cd` files nothing again. Its row is in U13a's table above. Both scenes run only with a peer older than
// this landing (its src/services/index/migrations.ts names no `agent_folder`); the run of record is the one whose peer
// is F (`--peer-exact f1852de3a`). No engine runs but the replay: a session is a transcript of invented rows in the
// scratch store over the scratch's repository, made a git repository with a worktree under `.claude/worktrees/`; a move
// by `cd` is rows with the worktree's `cwd`, a move by the tool the transcript and its folder renamed into the worktree's
// project folder (`slugOf` of its path, as the engine names it) with a `relocated` row and a row there.
//   (moved, from this build)     this build shows "moved from" for a session moved the tool's way, whose transcript holds
//                                a prompt snapshot. The peer, before any other row, lists it with its worktree mark, opens
//                                its transcript and resumes it on the replay: the launch decision it stores holds the
//                                snapshot's state (`none`), which build F's `recordedOf` (services/owner/launch.ts) finds
//                                only in the transcript at the path the record's directory gives (`unrecorded` where no
//                                file is). A row appended while the peer runs is filed by it. This build then shows the
//                                session with no "moved from" until one more row, and then shows it again.
//   (build F's app, unit mawsd)  §C's second table: this build's `mawsd` as the profile's unit and the peer's app over it,
//                                as (pre-O17 app, unit mawsd) stages it, for a session that reached the worktree by `cd`
//                                and one that entered it by the tool. In the peer's window the Source control panel draws
//                                its page with no error state, a Stage on a listed file draws M3 decision 8's sentence in
//                                its notice line, and `git status` reads the same in both checkouts before and after; for
//                                the first, Files draws the worktree among its roots. The panel's selectors are build
//                                F's at f1852de3a (tools/scm: ScmShell's header and failed state, FileRow's Stage,
//                                Notice's text; tools/files: a root's tree item).
const filesAgentFolder = (build: Build) => {
  const migrations = join(build.root ?? REPO_ROOT, 'src/services/index/migrations.ts');
  return existsSync(migrations) && readFileSync(migrations, 'utf8').includes('agent_folder');
};
const filesAgentFolderWhy = (peer: Build) => `the peer (wire ${wireOf(peer)}) names agent_folder in its src/services/index/migrations.ts: it files this landing's facts, not build F's record alone; UC-14's round trip is with build F, --peer-exact f1852de3a`;
const AWAY_SENTENCE = 'The session is working in another folder now, so nothing was changed'; // src/services/scm/service.ts, AWAY_DETAIL (M3 decision 8)
const gitAt = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: isolatedGitEnv(), encoding: 'utf8' });
const transcriptIn = (s: Scratch, folder: string, sid: string) => join(s.userData, 'claude-config', 'projects', slugOf(folder), `${sid}.jsonl`);

// The scratch's repository made a git repository (README.md and notes.txt committed on `main`) with the worktree `w1`
// under `.claude/worktrees/` on `worktree-w1`, which the repository's own status leaves out; answers its path.
function movingRepo(s: Scratch): string {
  writeFileSync(join(s.repo, 'README.md'), 'hello\n');
  writeFileSync(join(s.repo, 'notes.txt'), 'notes\n');
  gitAt(s.repo, 'init', '-q');
  mkdirSync(join(s.repo, '.git', 'info'), { recursive: true });
  writeFileSync(join(s.repo, '.git', 'info', 'exclude'), '.claude/\n');
  gitAt(s.repo, 'add', 'README.md', 'notes.txt');
  gitAt(s.repo, 'commit', '-q', '-m', 'first');
  gitAt(s.repo, 'worktree', 'add', '-q', '--no-track', '-b', 'worktree-w1', '.claude/worktrees/w1', 'HEAD');
  return join(s.repo, '.claude', 'worktrees', 'w1');
}
// The folders marked trusted in the scratch engine store, as a terminal's first trust dialog would
function trustIn(s: Scratch, folders: string[]): void {
  const path = join(s.userData, 'claude-config', '.claude.json');
  const state = (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}) as { projects?: Record<string, unknown> };
  writeFileSync(path, `${JSON.stringify({ ...state, projects: { ...state.projects, ...Object.fromEntries(folders.map((folder) => [folder, { hasTrustDialogAccepted: true }])) } }, null, 2)}\n`);
}
// One row appended to a transcript, chained to its last: a person's message (`text`), or the engine's prompt snapshot
function appendTurn(path: string, sid: string, cwd: string, gitBranch: string, text: string | { snapshot: string }): void {
  const rows = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { uuid?: unknown }) : [];
  const parentUuid = rows.filter((row) => typeof row.uuid === 'string').at(-1)?.uuid ?? null;
  const said = typeof text === 'string' ? { type: 'user', message: { role: 'user', content: text } } : { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: [text.snapshot] } };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ parentUuid, isSidechain: false, ...said, uuid: randomUUID(), timestamp: new Date().toISOString(), cwd, gitBranch, sessionId: sid, version: '2.1.283' })}\n`);
}
// The engine's worktree tool, as M1's test plays it: the transcript and its folder renamed into `to`'s project folder,
// then a `relocated` row and a row there; answers the transcript's new path
function moveByTool(s: Scratch, sid: string, from: string, to: string, gitBranch: string, text: string): string {
  const source = transcriptIn(s, from, sid);
  const target = transcriptIn(s, to, sid);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(source, target);
  if (existsSync(join(dirname(source), sid))) renameSync(join(dirname(source), sid), join(dirname(target), sid));
  appendFileSync(target, `${JSON.stringify({ type: 'relocated', relocatedCwd: to, sessionId: sid })}\n`);
  appendTurn(target, sid, to, gitBranch, text);
  return target;
}
// A journal of the replay as the seeded session's own: its recorded session id replaced by the scratch's engine id, so
// the record, its transcript and the resume keep one engine session id (Scratch.asOwnSession, for a written journal)
function ownJournal(s: Scratch, path: string): string {
  const text = readFileSync(path, 'utf8');
  const recorded = text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as JournalRow).find((row) => row.direction === 'in' && typeof row.frame.session_id === 'string')?.frame.session_id as string | undefined;
  const own = join(s.root, `own-${basename(path)}`);
  writeFileSync(own, recorded === undefined ? text : text.replaceAll(recorded, s.engineId));
  return own;
}
// One value of the profile's index as the build that wrote it left it (to-human-live's read of the launch decision)
function indexed(s: Scratch, sql: string): unknown {
  const out = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', join(s.userData, 'index.sqlite'), sql], { encoding: 'utf8' }).trim();
  const rows = (out === '' ? [] : JSON.parse(out)) as Record<string, unknown>[];
  return rows.length === 0 ? null : Object.values(rows[0]!)[0] ?? null;
}
// The app id of the session filed for an engine session id, once the index lists it
async function recordFor(page: Page, sid: string): Promise<AppSessionId> {
  let id = '';
  await expect
    .poll(async () => (id = value(await invoke(page, 'session.list', {})).sessions.find((r) => r.engineSessionId === sid)?.appId ?? ''), { timeout: 20_000, message: `the session ${sid} has a record` })
    .not.toBe('');
  return id as AppSessionId;
}
// This build's Environment card for the session in view, unfolded
async function environmentOf(page: Page, id: AppSessionId): Promise<Locator> {
  await (await sidebarRow(page, { appSessionId: id })).click();
  await unfoldSessionCard(page, 'Environment');
  return sessionCard(page, 'Environment');
}

test('(moved, from this build) a session moved the tool’s way here is listed by the peer with its mark, resumed over the transcript at its directory and filed on; this build then shows what the peer filed, and its facts again after the next row', async () => {
  const { here, peer } = builds();
  test.skip(filesAgentFolder(peer), filesAgentFolderWhy(peer));
  test.setTimeout(300_000);
  await withScratch('xb-moved', async (s) => {
    const said: string[] = [`${here.label} (wire ${wireOf(here)}) moves a session the tool's way; ${peer.label} (wire ${wireOf(peer)}) lists, resumes and files it; ${here.label} opens it again`];
    const worktree = movingRepo(s);
    trustIn(s, [s.repo, worktree]);
    appendTurn(transcriptIn(s, s.repo, s.engineId), s.engineId, s.repo, 'main', { snapshot: 'An invented system prompt for the cross-build scene.' });
    const moved = `moved from ${basename(s.repo)}`;

    // this build: the session at the repository, then moved the tool's way into the worktree
    const ours = await s.launch();
    await s.ready(ours.page, (st) => st.daemon !== null, 60_000);
    const id = await s.record(ours.page);
    let card = await environmentOf(ours.page, id);
    await expect(card.getByTestId('card-folder'), 'the card names the repository').toHaveText(s.repo, { timeout: 20_000 });
    await expect(card.getByTestId('moved-from')).toHaveCount(0);
    const transcript = moveByTool(s, s.engineId, s.repo, worktree, 'worktree-w1', 'Entered the worktree with the tool');
    await expect(card.getByTestId('card-folder'), 'the card names the worktree').toHaveText(worktree, { timeout: 20_000 });
    await expect(card.getByTestId('moved-from')).toHaveText(moved);
    expect(ours.maws.consoleErrors()).toEqual([]);
    await s.quit(ours);
    await endProfileProcesses(s.userData); // the peer's app starts a mawsd of its own build
    said.push(`  ${here.label}: the transcript moved into ${slugOf(worktree)}, the card's folder the worktree, "${moved}"`);

    // the peer, before any other row: listed with its mark, its transcript opened, resumed over the transcript there
    const journal = ownJournal(s, turnsJournal(s.root, 'xb-moved-resume', 1)); // one turn the resume never sends: it holds at the prompt
    const theirs = await s.launch({ MAWS_E2E_REPLAY_FIXTURES: journal }, peer.root);
    await s.ready(theirs.page, () => true, 60_000);
    const row = await sidebarRow(theirs.page, { appSessionId: id });
    await expect(row, `${peer.label} lists the session`).toBeVisible({ timeout: 20_000 });
    await expect(row.getByRole('img', { name: 'Worktree', exact: true }), 'with its worktree mark').toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(theirs.page.getByText('Entered the worktree with the tool', { exact: true }).first(), `${peer.label} opens its transcript`).toBeVisible({ timeout: 20_000 });
    expect(value(await invoke(theirs.page, 'session.start', { appSessionId: id, message: null, options: { gateway: 'direct', trust: 'accepted' } }))).toMatchObject({ status: 'starting' });
    const processOf = async () => { const st = await invoke(theirs.page, 'session.status', { appSessionId: id }); return st.ok ? st.value.process : 'released'; }; // prettier-ignore
    await expect.poll(processOf, { timeout: 60_000, message: `${peer.label} resumes it on the replay` }).toBe('ready');
    const decision = `select recorded from owner_channel_sessions where app_session_id = '${id}'`;
    await expect.poll(() => indexed(s, decision), { timeout: 30_000, message: `the launch decision ${peer.label} stored for the resume: the snapshot read at the record's directory` }).toBe('none');
    value(await invoke(theirs.page, 'session.stop', { appSessionId: id, reason: 'stop' }));
    await expect.poll(processOf, { timeout: 60_000 }).not.toBe('ready');
    appendTurn(transcript, s.engineId, worktree, 'worktree-w1', 'A row while the peer runs');
    await expect.poll(() => indexed(s, `select transcript_size from sessions where app_id = '${id}'`), { timeout: 30_000, message: `${peer.label} files the row` }).toBe(statSync(transcript).size);
    // Decision 7's own path is staged here (Decision Log 22): a session whose search text is behind its stored stamp is
    // summarised again at this build's next start, which writes the facts at once. The peer re-indexes a transcript's
    // text no sooner than 30 s after its last pass (SEARCH_REINDEX_DEBOUNCE_MS), so it quits only once its index holds
    // the text at the stamp it filed; then nothing is read again, and the record stays as the peer filed it.
    const textStamped = `select count(*) from session_text_state st join sessions s on s.app_id = st.app_id where st.app_id = '${id}' and st.status = 'ready' and st.size = s.transcript_size and st.mtime_ms = s.transcript_mtime_ms`;
    await expect.poll(() => indexed(s, textStamped), { timeout: 60_000, message: `${peer.label}'s search text for the session at the stamp it filed (its 30 s re-index debounce)` }).toBe(1);
    expect(theirs.maws.consoleErrors()).toEqual([]);
    await s.quit(theirs);
    await endProfileProcesses(s.userData);
    said.push(`  ${peer.label}: listed with its mark, resumed with the recorded state none, the next row filed (${statSync(transcript).size} bytes), its search text at that stamp before it quits`);

    // this build again: what the peer filed, then the facts after one more row
    const again = await s.launch();
    await s.ready(again.page, (st) => st.daemon !== null, 60_000);
    card = await environmentOf(again.page, id);
    await expect(card.getByTestId('card-folder'), 'the folder the peer filed').toHaveText(worktree, { timeout: 20_000 });
    await expect(card.getByTestId('moved-from'), 'no fact for a session the peer filed last').toHaveCount(0);
    appendTurn(transcript, s.engineId, worktree, 'worktree-w1', 'One more row under this build');
    await expect(card.getByTestId('moved-from'), 'the facts again after the session’s next row').toHaveText(moved, { timeout: 20_000 });
    await expect(card.getByTestId('card-folder')).toHaveText(worktree);
    expect(again.maws.consoleErrors()).toEqual([]);
    await s.quit(again);
    said.push(`  ${here.label} again: the worktree with no "moved from", then "${moved}" after one more row`);
    record(said);
  });
});

test('(build F’s app, unit mawsd) a session whose agent moved: the peer’s Source control draws its page, an act draws the away sentence and changes nothing, and Files lists the worktree; the same for a session moved the tool’s way', async () => {
  const { here, peer } = builds();
  test.skip(filesAgentFolder(peer), filesAgentFolderWhy(peer));
  test.skip(!appObeysConnectors(peer), `the peer (wire ${wireOf(peer)}) is an app from before O4, which this build's mawsd refuses`);
  test.skip(UNIT_SKIP !== null, UNIT_SKIP ?? '');
  test.setTimeout(300_000);
  await withScratch('xb-moved-unit', async (s) => {
    const worktree = movingRepo(s);
    writeFileSync(join(s.repo, 'README.md'), 'hello\nchanged in the repository\n');
    writeFileSync(join(worktree, 'notes.txt'), 'notes\nchanged in the worktree\n');
    trustIn(s, [s.repo, worktree]);
    // the session that reached the worktree by `cd`: the seeded transcript, its last row in the worktree
    appendTurn(transcriptIn(s, s.repo, s.engineId), s.engineId, worktree, 'main', 'Working in the worktree');
    // the session that entered it through the tool: its transcript under the worktree's project folder
    const toolSid = randomUUID();
    appendTurn(transcriptIn(s, s.repo, toolSid), toolSid, s.repo, 'main', 'Started in the repository');
    moveByTool(s, toolSid, s.repo, worktree, 'worktree-w1', 'Entered the worktree with the tool');
    const statuses = () => ({ repository: gitAt(s.repo, 'status', '--porcelain'), worktree: gitAt(worktree, 'status', '--porcelain') });

    await withUnit(s, here, 'xb-moved-unit', async (unit) => {
      const said = [`${peer.label}'s app (wire ${wireOf(peer)}) on ${here.label}'s unit mawsd (wire ${wireOf(here)}), pid ${unit.pid}`];
      const run = await s.launch({ MAWS_HOST_MODE: 'daemon' }, peer.root);
      await s.ready(run.page, (st) => st.daemon?.pid === unit.pid, 60_000);
      expect(run.output(), 'the peer’s build check leaves a unit of another bundle as it is').toContain('its unit runs another bundle, so it is left as it is');
      const page = run.page;
      const scm = toolBody(page, 'Source control');
      // The session selected, its Source control page drawn on `branch` with `listed` and not `other`, and a Stage on
      // `listed` answered with the sentence, both checkouts' status the same after it
      const actRefused = async (id: AppSessionId, branch: string, listed: string, other: string) => {
        await (await sidebarRow(page, { appSessionId: id })).click();
        await showTool(page, 'Source control');
        await expect(scm.locator('[data-scm-header]'), 'the page names the branch of the folder the record names').toContainText(`⎇ ${branch}`, { timeout: 20_000 });
        const row = scm.locator(`li[data-scm-row][data-path=${JSON.stringify(listed)}]`);
        await expect(row, `${listed} listed`).toBeVisible({ timeout: 20_000 });
        await expect(scm.locator(`li[data-scm-row][data-path=${JSON.stringify(other)}]`)).toHaveCount(0);
        await expect(scm.locator('[data-scm-status-failed]'), 'no error state').toHaveCount(0);
        const before = statuses();
        await row.hover();
        await row.getByRole('button', { name: `Stage ${listed}`, exact: true }).click();
        await expect(scm.locator('[data-scm-notice-text]'), 'the act answered in the notice line').toHaveText(AWAY_SENTENCE, { timeout: 20_000 });
        expect(statuses(), 'nothing changed in either checkout').toEqual(before);
      };

      const cd = await s.record(page);
      await actRefused(cd, 'main', 'README.md', 'notes.txt');
      await showTool(page, 'Files');
      await expect(toolBody(page, 'Files').locator(`[role="treeitem"][data-kind="root"][data-path=${JSON.stringify(worktree)}]`), 'Files lists the worktree among its roots').toBeVisible({ timeout: 20_000 });
      said.push(`  by cd: the page on main with README.md, Stage answered "${AWAY_SENTENCE}", nothing changed; Files lists the worktree`);

      const tool = await recordFor(page, toolSid);
      await actRefused(tool, 'worktree-w1', 'notes.txt', 'README.md');
      said.push(`  by the tool: the page on worktree-w1 with notes.txt, Stage answered the same sentence, nothing changed`);
      expect(run.maws.consoleErrors()).toEqual([]);
      await s.quit(run);
      record(said);
    });
  });
});
