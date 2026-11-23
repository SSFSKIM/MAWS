// The owner channel's launch decision (the P2-C document, Design §2 and §3; X6): run in main immediately before
// `session.launch` for every MAWS-owned launch (an intent's new session, fork and side thread, and a record's resume),
// never for the trust bootstrap. It decides three things:
// 1. the desired state: `off` when the session's lane is off; else, P4-R7z (the P4 spec's Decision Log 92), by whether
//    the to-human plugin registers its message tool under the style the launch selects (the resolver's `messageTool`):
//    `external-style-plus-supplement` when it does, and `off` when it does not, MAWS having no message tool or full
//    contract of its own (no to-human plugin, no to-human lane);
// 2. the recorded state: what the engine will reuse, read from the transcript being resumed or forked (./prompt-state.ts);
// 3. the flags: the supplement is appended whenever it is desired (a no-op under a snapshot, effective at the next
//    compaction), and `--system-prompt-snapshot off` is passed while the recorded state differs from the one the desired
//    state records, only where the binary declares the flag; `applied` is what is in effect after the launch. So a
//    session recorded under an earlier contract, supplement or P4-R7y's alias renders anew at its next launch.
// While the lane is on and its style carries the tool the launch also advertises MAWS_NATIVE_TO_HUMAN (the contract
// version, 8: MAWS offers no message tool), on which the plugin registers its tool in MAWS's headless launch and its
// other hooks defer to MAWS. The decision is recorded in the index when the host answers `launching`, and the engine's
// own report of its output style at that launch's first `session.init` is compared with the resolver's reading of the
// settings (the mismatch check): a mismatch makes the next decisions resolve by the engine's name until a launch's init
// agrees with the resolver's own reading again. Each record is published as the session's owner channel state
// (`ownerChannel.changed`), which the report and the mods library read again on.
//
// The UX wave, U2b (docs/doperpowers/plans/2026-11-15-ux-wave-U2b-to-human-view.md, Interfaces §A and §M; decisions 1 to
// 4 and 26): the advertisement follows who will draw the view: 9 where every applicable installation of the mod declares
// it draws MAWS's view (its declaration read at each install path), 8 where MAWS draws it, nothing with the lane off. The
// decision's last act reserves it in the index before the launch is sent; a 9 that cannot be reserved goes as 8. The
// record at `launching` binds the reservation to the host's launch id. The summaries' switch is read once here, and a
// launch decided while it is off carries TO_HUMAN_FOLD_SUMMARIES=off.
//
// Board ticket 421 (docs/doperpowers/plans/2026-11-23-tool-choice.md, Interfaces §F, D12): the supplement names the
// session's question tool, supplement 3 for MAWS's ask and 4 for the engine's own, read off the set the launch serves
// (`spec.mawsTools`); a session's question tool never changes, so the recorded state never differs on that alone.
import { homedir } from 'node:os';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { TO_HUMAN_MOD_ROUTE, TO_HUMAN_SUPPLEMENT_ENGINE_VERSION, TO_HUMAN_SUPPLEMENT_VERSION } from '@shared/owner/contract';
import type { MawsToolSet } from '@shared/maws/tool-set'; // board ticket 421
import { advertisementFor, type Advertisement } from '@shared/owner/draws';
import type { ContractSource, LaneOverride } from '@shared/owner/state';
import { claudeConfigDir } from '@shared/engine/config-dir';
import type { SessionStore } from '../index/sessions';
import type { HostDispatch } from '@shared/host/host-supervisor';
import { hostCall, transcriptPathOf } from '../sessions/context';
import { withOwnerChannel, type AppendedText } from '../sessions/launch-mapping';
import { readDeclaration } from './declaration';
import { recordedState, type RecordedState } from './prompt-state';
import { lookupStyle, resolveStyle, type ResolvedStyle, type StyleContext } from './resolve-style';
import type { OwnerChannelStore } from './store';

export interface LaunchDecision {
  appSessionId: AppSessionId;
  kind: 'new' | 'fork' | 'resume';
  laneOn: boolean; // the lane's switch (the override, else the app's); P4-R7z: a style without the plugin's tool leaves it `desired` off
  override: LaneOverride;
  desired: ContractSource;
  recorded: RecordedState;
  appended: boolean; // --append-system-prompt passed (the desired state's text: the contract, or the supplement)
  snapshotOff: boolean; // --system-prompt-snapshot off passed
  offUnavailable: boolean; // "off" was wanted and the binary does not declare it: the change waits for a compaction
  applied: ContractSource;
  style: string; // the resolver's style name, read from the settings: the mismatch check compares the engine's with it
  decidedBy: string; // the style name the desired state was decided by: the resolver's, or the engine's while a mismatch stands
  styleUnresolved: string | null; // why the deciding style could not be found, when it could not
  advertised: Advertisement; // U2b: what MAWS_NATIVE_TO_HUMAN carries: 9, 8, or nothing
  plugin: boolean; // U2b: an applicable, enabled installation of the mod whose hooks load was found
  reserved: boolean; // U2b: the reservation was written before the send (the record at `launching` binds it)
  summariesOff: boolean; // U2b: the summaries' switch was off, so the launch carries TO_HUMAN_FOLD_SUMMARIES=off
}

// The lane's effective value: the session's override when set, else the app's switch.
export const laneOn = (appEnabled: boolean, override: LaneOverride): boolean => (override === 'inherit' ? appEnabled : override === 'on');

// The desired state of a launch whose lane is `on` under `style` (P2-C2: the shape rule, Decision Log 31). P4-R7z: only
// a style under which the plugin registers its message tool carries the lane, with MAWS's supplement beside it.
export const desiredSource = (on: boolean, style: { messageTool: boolean }): ContractSource =>
  on && style.messageTool ? 'external-style-plus-supplement' : 'off';

// The text a desired state appends and the recorded state it leaves in a snapshot; a state without one records none.
// Board ticket 421 (Interfaces §F, D12): the supplement names the session's question tool, MAWS's ask (3) or the engine's
// own (4); a session's question tool never changes, so the table has no row for one recorded under the other's.
type Question = MawsToolSet['question'];
const APPENDS: Partial<Record<ContractSource, Record<Question, { text: AppendedText; records: RecordedState }>>> = {
  'external-style-plus-supplement': {
    maws: { text: 'supplement', records: `supplement:${TO_HUMAN_SUPPLEMENT_VERSION}` }, // P2-C2
    engine: { text: 'supplement-engine', records: `supplement:${TO_HUMAN_SUPPLEMENT_ENGINE_VERSION}` }, // board ticket 421
  },
};

// The decision table (Design §2; P2-C2 adds the supplement's row and column). P4-R7z: a recorded state no desired state
// records now (an earlier contract or supplement, P4-R7y's `alias`) differs from every one, so its prompt renders anew.
// Board ticket 421: `question`, the question tool of the set the launch serves (absent from the spec: MAWS's).
export function decideFlags(desired: ContractSource, recorded: RecordedState, declares: boolean, question: Question = 'maws'): { append: AppendedText | null; off: boolean; offUnavailable: boolean; applied: ContractSource } {
  const appends = APPENDS[desired]?.[question] ?? null;
  const wanted = recorded !== 'unrecorded' && recorded !== (appends?.records ?? 'none');
  const off = wanted && declares;
  // what the snapshot keeps when it is reused: a recorded text stays in force (the contract, or the supplement beside its
  // style); none, or the alias alone (none of MAWS's texts), leaves the desired state less the text it would append,
  // missing until the prompt renders again
  const kept: ContractSource = recorded.startsWith('contract:')
    ? 'maws-contract'
    : recorded.startsWith('supplement:')
      ? 'external-style-plus-supplement'
      : desired === 'external-style-plus-supplement'
        ? 'external-compatible-style'
        : desired;
  return { append: appends?.text ?? null, off, offUnavailable: wanted && !declares, applied: off || recorded === 'unrecorded' ? desired : kept };
}

// What the decision reads beside the spec: the session service's setup (`Setup` satisfies it), whose `env` is the
// engine's environment, the one the resolver and the transcript reader take their config home from.
export interface OwnerLaunchSetup {
  env: NodeJS.ProcessEnv;
  dispatch: HostDispatch;
  sessions: Pick<SessionStore, 'get'>;
  log: (message: string) => void;
  owner: OwnerChannelLaunches | null; // null: no owner channel (no index); the launch goes as it is
}

export interface OwnerChannelLaunchDeps {
  store: OwnerChannelStore;
  appEnabled: () => boolean; // settings' mods.toHuman.enabled
  systemRoot?: string; // the tests' seam: the file-system root the machine's managed settings are read beneath
  log: (message: string) => void;
  // the engine host's event batches, subscribed to at the first decided launch (nothing is due before one)
  subscribe?: (listener: (appSessionId: AppSessionId, events: readonly SessionEvent[]) => void) => void;
  // the session's owner channel changed (a launch recorded, a style observed): its state is published again
  changed?: (appSessionId: AppSessionId) => void;
  // U2b: a decided launch was bound to the host's launch id (who draws follows that launch from here)
  bound?: (appSessionId: AppSessionId, launchId: string, launchedAt: string | null) => void; // launchedAt: the host's start time, null when none was given
  modRoute?: boolean; // U2b, the tests' seam: the cutover's switch (TO_HUMAN_MOD_ROUTE)
  readDeclaration?: (installPath: string) => Promise<boolean>; // U2b, the tests' seam: ./declaration.ts
  now?: () => string; // U2b, the tests' seam: the reservation's time
}

// The host's `launching` answer for a decided launch: its id, when it was recorded, and (U2b) the host's own start time
// of it (`EngineSessionStatus.launchedAt`), which the tracker of who draws orders launches by (§A, C3).
export interface LaunchAnswered {
  launchId: string;
  at: string;
  launchedAt?: string;
}

// The decided launches' bookkeeping: the record at `launching`, and the mismatch check at the launch's first init.
export class OwnerChannelLaunches {
  private readonly awaitingInit = new Map<AppSessionId, string>(); // the resolver's style of a launch whose init is due
  private subscribed = false;

  constructor(readonly deps: OwnerChannelLaunchDeps) {}

  launched(decision: LaunchDecision, launch: LaunchAnswered): void {
    if (!this.subscribed && this.deps.subscribe) {
      this.subscribed = true;
      this.deps.subscribe((appSessionId, events) => this.observe(appSessionId, events));
    }
    this.awaitingInit.set(decision.appSessionId, decision.style);
    try {
      this.deps.store.recordLaunch(decision.appSessionId, {
        launchId: launch.launchId, at: launch.at, laneOn: decision.laneOn, desired: decision.desired, recorded: decision.recorded,
        appended: decision.appended, snapshotOff: decision.snapshotOff, offUnavailable: decision.offUnavailable, applied: decision.applied, style: decision.style,
        reserved: decision.reserved,
      });
    } catch (error) {
      this.deps.log(`the owner channel could not record the launch of ${decision.appSessionId}: ${messageOf(error)}`);
      return;
    }
    this.deps.bound?.(decision.appSessionId, launch.launchId, launch.launchedAt ?? null);
    this.deps.changed?.(decision.appSessionId);
  }

  // A session's events from the engine host: the first live `session.init` after a decided launch carries the style the
  // engine put in effect (null reads as the default). A backfill's or replay's init (`seq` null) is no observation. It is
  // compared with the resolver's own reading of the settings, never with a name the launch took from an earlier
  // observation, so a persistent misreading stays a mismatch and only a fresh agreement clears it.
  observe(appSessionId: AppSessionId, events: readonly SessionEvent[]): void {
    const resolved = this.awaitingInit.get(appSessionId);
    if (resolved === undefined) return;
    const init = events.find((event) => event.kind === 'session.init' && event.seq !== null);
    if (init === undefined || init.kind !== 'session.init') return;
    this.awaitingInit.delete(appSessionId);
    const observed = init.outputStyle ?? 'default';
    try {
      this.deps.store.recordObserved(appSessionId, observed, observed !== resolved);
    } catch (error) {
      this.deps.log(`the owner channel could not record the style of ${appSessionId}: ${messageOf(error)}`);
      return;
    }
    this.deps.changed?.(appSessionId);
  }
}

export async function ownerChannelLaunch(
  s: OwnerLaunchSetup,
  spec: LaunchSpec,
  ctx: { kind: 'new' | 'fork' | 'resume'; transcriptOf: AppSessionId | null },
): Promise<{ spec: LaunchSpec; record: LaunchDecision | null }> {
  const owner = s.owner;
  if (owner === null) return { spec, record: null };
  const appSessionId = spec.appSessionId;
  let row = null;
  try {
    row = owner.deps.store.session(appSessionId);
  } catch (error) {
    s.log(`the owner channel could not read ${appSessionId}'s override: ${messageOf(error)}`); // the index unavailable: the app's switch decides
  }
  const override = row?.override ?? 'inherit';
  const on = laneOn(owner.deps.appEnabled(), override);
  // U2b: the summaries' switch, read once for this launch; a write while it is decided is the next launch's
  let summariesOff = false;
  try {
    summariesOff = !owner.deps.store.foldSummaries();
  } catch (error) {
    s.log(`the owner channel could not read the summaries' switch for ${appSessionId}: ${messageOf(error)}`); // absent reads as on
  }
  const styleContext: StyleContext = {
    configHome: claudeConfigDir(s.env, s.env.HOME || homedir()),
    cwd: spec.cwd,
    flagSettings: spec.extraSettings,
    systemRoot: owner.deps.systemRoot,
  };
  // the settings' reading is always taken (the mismatch check compares the engine's with it); while the last observation
  // contradicted it, the engine's name decides instead
  const resolved = await resolveStyle(styleContext);
  const style: ResolvedStyle = row?.styleMismatch && row.observedStyle !== null ? await lookupStyle(row.observedStyle, styleContext) : resolved;
  const desired = desiredSource(on, style);
  const recorded = await recordedOf(s, spec, ctx);
  const question = spec.mawsTools?.question ?? 'maws'; // board ticket 421: the set this attempt serves (D8), absent the full set
  let flags = decideFlags(desired, recorded, true, question);
  if (flags.off) flags = decideFlags(desired, recorded, await declaresSnapshotFlag(s), question); // the binary is asked only when "off" is wanted
  if (on && style.unresolved !== null) s.log(`${appSessionId}: ${style.unresolved}; the to-human lane is off`);
  // U2b: who will draw. P4-R7z: the advertisement goes only where the lane carries the plugin's tool; under any other
  // style the lane is off. The installations are the settings' (the resolver's own reading, whatever a mismatch decided)
  const installations = await declarationsOf(owner.deps, resolved.toHuman.paths);
  const plugin = resolved.toHuman.paths.length > 0 && resolved.toHuman.hooksLoad;
  let advertised = advertisementFor(desired !== 'off', installations, owner.deps.modRoute ?? TO_HUMAN_MOD_ROUTE);
  // the decision's last act: the reservation, before the send (R2). A 9 that cannot be reserved is never sent
  let reserved = true;
  try {
    owner.deps.store.reserveLaunch(appSessionId, { launchId: null, number: advertised, plugin, at: (owner.deps.now ?? nowIso)() });
  } catch (error) {
    reserved = false;
    s.log(`the owner channel could not reserve ${appSessionId}'s launch${advertised === 9 ? '; it advertises 8' : ''}: ${messageOf(error)}`);
    if (advertised === 9) advertised = 8;
  }
  const record: LaunchDecision = {
    appSessionId, kind: ctx.kind, laneOn: on, override, desired, recorded, appended: flags.append !== null, snapshotOff: flags.off,
    offUnavailable: flags.offUnavailable, applied: flags.applied, style: resolved.name, decidedBy: style.name, styleUnresolved: style.unresolved,
    advertised, plugin, reserved, summariesOff,
  };
  return { spec: withOwnerChannel(spec, { advertisement: advertised, append: flags.append, snapshotOff: flags.off, summariesOff }), record };
}

// U2b: each applicable installation's declaration, read at its install path
const declarationsOf = (deps: OwnerChannelLaunchDeps, paths: readonly string[]): Promise<{ declares: boolean }[]> =>
  Promise.all(paths.map(async (path) => ({ declares: await (deps.readDeclaration ?? readDeclaration)(path) })));
const nowIso = () => new Date().toISOString();

// The host answered `launching` for a decided launch (nothing to record for an undecided one).
export function ownerChannelLaunched(s: Pick<OwnerLaunchSetup, 'owner'>, record: LaunchDecision | null, launch: LaunchAnswered): void {
  if (record !== null) s.owner?.launched(record, launch);
}

// A fork or a side thread takes its parent's override when its record is created (Design §9).
export function inheritOwnerOverride(s: Pick<OwnerLaunchSetup, 'owner' | 'log'>, child: AppSessionId, parent: AppSessionId): void {
  try {
    s.owner?.deps.store.inheritOverride(child, parent);
  } catch (error) {
    s.log(`${child} could not take ${parent}'s to-human override: ${messageOf(error)}`);
  }
}

// The recorded state of the transcript the launch reuses: the session's own for a resume, the parent's for a fork, none
// for a new session (or a resume of a record that has no engine session yet).
async function recordedOf(s: OwnerLaunchSetup, spec: LaunchSpec, ctx: { kind: string; transcriptOf: AppSessionId | null }): Promise<RecordedState> {
  if (ctx.kind === 'new' || ctx.transcriptOf === null || spec.resume === null) return 'unrecorded';
  let directory: string;
  try {
    const record = s.sessions.get(ctx.transcriptOf);
    if (record === null) return 'unrecorded';
    directory = record.directory;
  } catch {
    return 'unrecorded'; // the index unavailable
  }
  return recordedState(await transcriptPathOf(s.env, directory, spec.resume.sessionId));
}

async function declaresSnapshotFlag(s: OwnerLaunchSetup): Promise<boolean> {
  try {
    return (await hostCall(s.dispatch, 'engine.binaryInfo', undefined)).declaresSystemPromptSnapshot === true;
  } catch {
    return false; // asked again at the next launch
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
