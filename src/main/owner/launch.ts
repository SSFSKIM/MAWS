// The owner channel's launch decision (the P2-C document, Design §2 and §3; X6): run in main immediately before
// `session.launch` for every MAWS-owned launch (an intent's new session, fork and side thread, and a record's resume),
// never for the trust bootstrap. It decides three things:
// 1. the desired state: `off` when the session's lane is off; else `external-compatible-style` when the launch's settings
//    select a style declaring a compatible contract, and `maws-contract` otherwise (an unresolvable style included);
// 2. the recorded state: what the engine will reuse, read from the transcript being resumed or forked (./prompt-state.ts);
// 3. the flags: the contract is appended whenever it is desired (a no-op under a snapshot, effective at the next
//    compaction), and `--system-prompt-snapshot off` is passed while the recorded state differs from the desired one,
//    only where the binary declares the flag; `applied` is what is in effect after the launch.
// While the lane is on the launch also advertises MAWS_NATIVE_TO_HUMAN (the contract version) in its settings env, so a
// plugin drawing its own to-human view can defer. The decision is recorded in the index when the host answers
// `launching`, and the engine's own report of its output style at that launch's first `session.init` is compared with
// the resolver's reading of the settings (the mismatch check): a mismatch makes the next decisions resolve by the engine's
// name until a launch's init agrees with the resolver's own reading again.
import { homedir } from 'node:os';
import type { LaunchSpec } from '@shared/engine/launch-spec';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { TO_HUMAN_CONTRACT_VERSION } from '@shared/owner/contract';
import type { ContractSource, LaneOverride } from '@shared/owner/state';
import { claudeConfigDir } from '../history/prompt-history';
import type { SessionStore } from '../index/sessions';
import type { HostDispatch } from '../ipc/router';
import { hostCall, transcriptPathOf } from '../sessions/context';
import { withOwnerChannel } from '../sessions/launch-mapping';
import { recordedState, type RecordedState } from './prompt-state';
import { lookupStyle, resolveStyle, type ResolvedStyle, type StyleContext } from './resolve-style';
import type { OwnerChannelStore } from './store';

export interface LaunchDecision {
  appSessionId: AppSessionId;
  kind: 'new' | 'fork' | 'resume';
  laneOn: boolean;
  override: LaneOverride;
  desired: ContractSource;
  recorded: RecordedState;
  appended: boolean; // --append-system-prompt passed
  snapshotOff: boolean; // --system-prompt-snapshot off passed
  offUnavailable: boolean; // "off" was wanted and the binary does not declare it: the change waits for a compaction
  applied: ContractSource;
  style: string; // the resolver's style name, read from the settings: the mismatch check compares the engine's with it
  decidedBy: string; // the style name the desired state was decided by: the resolver's, or the engine's while a mismatch stands
  styleUnresolved: string | null; // why the deciding style could not be found, when it could not
}

// The lane's effective value: the session's override when set, else the app's switch.
export const laneOn = (appEnabled: boolean, override: LaneOverride): boolean => (override === 'inherit' ? appEnabled : override === 'on');

const CURRENT: RecordedState = `contract:${TO_HUMAN_CONTRACT_VERSION}`;

// The decision table (Design §2).
export function decideFlags(desired: ContractSource, recorded: RecordedState, declares: boolean): { append: boolean; off: boolean; offUnavailable: boolean; applied: ContractSource } {
  const wanted = recorded !== 'unrecorded' && (desired === 'maws-contract' ? recorded !== CURRENT : recorded.startsWith('contract:'));
  const off = wanted && declares;
  // what the snapshot keeps when it is reused: a recorded contract stays in force; none leaves the desired state, except
  // that a contract wanted over none is missing until the prompt renders again
  const kept: ContractSource = recorded.startsWith('contract:') ? 'maws-contract' : desired === 'maws-contract' ? 'off' : desired;
  return { append: desired === 'maws-contract', off, offUnavailable: wanted && !declares, applied: off || recorded === 'unrecorded' ? desired : kept };
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
  managedSettingsPath?: string; // the tests' seam
  log: (message: string) => void;
  // the engine host's event batches, subscribed to at the first decided launch (nothing is due before one)
  subscribe?: (listener: (appSessionId: AppSessionId, events: readonly SessionEvent[]) => void) => void;
}

// The decided launches' bookkeeping: the record at `launching`, and the mismatch check at the launch's first init.
export class OwnerChannelLaunches {
  private readonly awaitingInit = new Map<AppSessionId, string>(); // the resolver's style of a launch whose init is due
  private subscribed = false;

  constructor(readonly deps: OwnerChannelLaunchDeps) {}

  launched(decision: LaunchDecision, launch: { launchId: string; at: string }): void {
    if (!this.subscribed && this.deps.subscribe) {
      this.subscribed = true;
      this.deps.subscribe((appSessionId, events) => this.observe(appSessionId, events));
    }
    this.awaitingInit.set(decision.appSessionId, decision.style);
    try {
      this.deps.store.recordLaunch(decision.appSessionId, {
        launchId: launch.launchId, at: launch.at, laneOn: decision.laneOn, desired: decision.desired, recorded: decision.recorded,
        appended: decision.appended, snapshotOff: decision.snapshotOff, offUnavailable: decision.offUnavailable, applied: decision.applied, style: decision.style,
      });
    } catch (error) {
      this.deps.log(`the owner channel could not record the launch of ${decision.appSessionId}: ${messageOf(error)}`);
    }
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
    }
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
  const styleContext: StyleContext = {
    configHome: claudeConfigDir(s.env, s.env.HOME || homedir()),
    cwd: spec.cwd,
    flagSettings: spec.extraSettings,
    managedSettingsPath: owner.deps.managedSettingsPath,
  };
  // the settings' reading is always taken (the mismatch check compares the engine's with it); while the last observation
  // contradicted it, the engine's name decides instead
  const resolved = await resolveStyle(styleContext);
  const style: ResolvedStyle = row?.styleMismatch && row.observedStyle !== null ? await lookupStyle(row.observedStyle, styleContext) : resolved;
  const desired: ContractSource = !on ? 'off' : style.compatible ? 'external-compatible-style' : 'maws-contract';
  const recorded = await recordedOf(s, spec, ctx);
  let flags = decideFlags(desired, recorded, true);
  if (flags.off) flags = decideFlags(desired, recorded, await declaresSnapshotFlag(s)); // the binary is asked only when "off" is wanted
  if (on && style.unresolved !== null) s.log(`${appSessionId}: ${style.unresolved}; the to-human contract is appended`);
  const record: LaunchDecision = {
    appSessionId, kind: ctx.kind, laneOn: on, override, desired, recorded, appended: flags.append, snapshotOff: flags.off,
    offUnavailable: flags.offUnavailable, applied: flags.applied, style: resolved.name, decidedBy: style.name, styleUnresolved: style.unresolved,
  };
  return { spec: withOwnerChannel(spec, { laneOn: on, append: flags.append, snapshotOff: flags.off }), record };
}

// The host answered `launching` for a decided launch (nothing to record for an undecided one).
export function ownerChannelLaunched(s: Pick<OwnerLaunchSetup, 'owner'>, record: LaunchDecision | null, launch: { launchId: string; at: string }): void {
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
