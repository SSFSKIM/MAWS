// A request's session, read from its input by its offer row's target rule (O10 M5; Interfaces §G): `appSessionId` for
// lane B, mapped to the engine session that keys its record (P5 O7 M2: the spine's record first, `session.get`, else the
// engine host's `session.status`, below); `session`
// for lane A, the engine session id itself (`args.session` in an action, as DX6 has it); none for the machine's own.
// An action that names a session (`action.session`) must name the one its input does, so a decision is never about
// one session and an effect about another (`malformed`).
//
// P5 O7 M4: `checkout`, git's reads of a lane B session's checkout. They name a directory or a repository, never their
// session, and the git service answers for the whole repository that holds the directory, so the call's own `session`
// (RL2's `call.session`) names the session, placed as an `appSessionId` is, and once the caller is known to view it the
// input's path must lie in the session's checkout (`withinCheckout`): one of its record's roots (`directory`,
// `additionalDirectories`, `worktree.path`) or the repository a root belongs to, or under one. The boundary a remote
// reader gets is so the repository, with its worktrees, not the root alone: a session opened on a subfolder of a
// repository reads that repository's status and diff, as its transcript already spans it. The checkout feed filters
// git's changes by the same bounds (plane-feeds.ts). 2026-11-06: a root or a repository at the machine's home or above
// it bounds nothing (`CheckoutBounds`, the home-root rule).
//
// P5 O7 M6: `each-session`, a machine-wide read whose answer is per session (`attention.list`, `session.search`): it names
// no target (the machine), and its answer is cut per session against each one's placement by its record alone
// (`recordedPlacement`), with no read of the engine host, which would wake a parked one for every session listed.
//
// P5 O12 M11 (docs/doperpowers/plans/2026-10-27-p5-o12-sminos-owners.md, M11's Decisions): a lane B session's placement
// also answers who spawned it, the `launchedBy` of the spine record it read, beside the target and never inside it, so the
// decision's bridge (authorize.ts) rests on the read that placed it.
//
// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The `artifact` target rule"): `artifact`. An
// artifact names no session; its links to sessions are the store's rows, which `library.entry` answers with the artifact
// in one read (on the asker's behalf). The rule reads the artifact from the input (`artifactKey`): its `artifactId`
// (`copyAsset`'s `to`, the write; P5 O7 M5b: an `http` read open's, from its URL), or, for a listing that names a session (`artifacts.list {filter: {appSessionId}}`),
// that session, placed as the `appSessionId` rule places it; `artifacts.create` (no id yet) and a `pruneVersions` naming
// no artifact (every one's) take the orphan form, which only the machine's owners hold. Each linked session is placed
// through `laneB` and nothing else, its target with the record's `launchedBy` (O12 M11's bridge keys on the app session);
// one that places `unknown`, or on an engine session the host no longer runs, is left out; a spine or an engine host
// that can't answer leaves the artifact `unavailable`, as it leaves every lane B session (the machine's condition, not
// the artifact's). An artifact `library.entry` answers null for is `unknown` (`grade`, as an unknown session). The
// member's standing on it is artifacts.ts' (`holdsArtifact`), cached per channel there (`ArtifactRanks`).
//
// P5 O7 M5c (M5 "O4's surfaces: the grade"): a page's lease and a Send to's run name their artifact only once: the lease
// at `connectors.open {artifactId}`, the run at `delivery.send {runId, artifactId}`. The asking channel's own table
// (`HeldNames`, leases.ts) reads the rest: a lease command by its `leaseId`, a lease the channel doesn't hold being
// `unknown` (`grade`, as an artifact or a session nobody can be told of); `delivery.cancel` by its `runId`, a run the
// channel didn't send being `no-target` (M5c review 1: a send it sent that is still being decided places its cancel on
// the artifact the send names, and the cancel waits on it, actions.ts).
//
// P5 O7 M8 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M8 "The offer audit and its contract"): `task-list`,
// a task list's read (`fs.tasks`). A list names no session, so the call names it too (`appSessionId`), placed as the
// `appSessionId` rule places it, and once the caller is known to view it the `listId` must be that session's own list
// (`ownTaskList`), else `no-target`: a member who views one session reads no other session's list by its id.
//
// P5 O8 M6b (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M6b and Interfaces §Q): `record`, a session's record
// act (`record.*`). Its args name exactly one target beside the change: `session`, a lane A engine session id, placed as
// the `session` rule places one; or `appSessionId`, a lane B app session, placed through RL10's members join on the member
// that keys sminos's record (`RecordMembers`), the spine's recorded engine session telling two joined members apart. A
// lane B session the join doesn't place yet is placed as the spine records it, so its standing is read as any lane B
// session's is (the spawner's bridge included), and the record path refuses it `no-session` to a caller who stands on it,
// sending nothing (rl10/link.ts); anyone else hears `grade`, as for a session that doesn't exist. Neither read wakes the
// engine host: a record act runs against sminos's record, never a live engine session. The act carries no `session`,
// `context` or `requestDigest` (`malformed`).
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, sep } from 'node:path';
import type { Action, SessionRef } from 'org-protocol';
import { parseArtifactUrl } from '@shared/artifacts/scheme';
import { sanitiseListId } from '@shared/engine/task-list';
import type { LaunchedBy, SessionRecord } from '@shared/graph/session';
import { coversHome, machineHomes } from '@shared/machine/machine-home';
import { workingFolder } from '@shared/sessions/working-folder';
import type { TargetRule } from './offers';
import type { EndpointServices } from './services';
import type { SessionTarget } from './sources';

export type Resolved =
  /**
   * `unavailable` (P5 O7 M4, fix wave 1): placed by its record's engine session, but the request can't run against it
   * now (the engine host runs another engine session for it). The refusal is the caller's only once
   * they are known to stand on the recorded engine session, so a caller below the floor hears `grade` for a session
   * that lags as for one that doesn't exist.
   */
  | { kind: 'session'; target: SessionTarget; unavailable?: true; launchedBy?: Spawner }
  /** A session the input names that this machine can't place: no record can be found for it, so nobody holds a rank. */
  | { kind: 'unknown' }
  | { kind: 'machine' }
  /**
   * P5 O7 M5a: an artifact and its linked sessions, each placed through `laneB` (unplaceable ones left out); `artifactId`
   * null and `orphan` for the orphan form (`artifacts.create`, a machine-wide `pruneVersions`). `orphan`: no link at all,
   * so the machine's owners' alone. `linked`: every app session the store links it to, placed or not (what a change of
   * one of them makes stale: artifacts.ts).
   */
  | { kind: 'artifact'; artifactId: string | null; sessions: PlacedSession[]; orphan: boolean; linked: string[] }
  | { kind: 'refused'; reason: 'no-target' | 'malformed' | 'unavailable' };

/** A lane B session as `laneB` placed it: the target and the spawner its record names (O12 M11). */
export type PlacedSession = { target: Extract<SessionTarget, { lane: 'B' }>; launchedBy?: Spawner };

/** The orphan form: an artifact with no link, or none yet (`artifacts.create`). */
export const ORPHAN: Extract<Resolved, { kind: 'artifact' }> = { kind: 'artifact', artifactId: null, sessions: [], orphan: true, linked: [] };

/**
 * What the `artifact` rule reads of a command's input: the artifact, the session a listing names, or the orphan form.
 * Null: nothing it can read (`no-target`).
 */
export type ArtifactKey = { artifactId: string } | { appSessionId: string } | { orphan: true } | { unknown: true };

/**
 * P5 O7 M5c: the artifact of a lease or a run the asking channel holds (leases.ts), a run reserved or its send still
 * pending; null for one it doesn't.
 */
export type HeldNames = { lease(leaseId: string): string | null; run(runId: string): string | null };

/** P5 O7 M5c: the page lease's commands that name their lease, not their artifact (`connectors.open` names the artifact). */
export const LEASE_COMMANDS: ReadonlySet<string> = new Set(['connectors.declare', 'connectors.call', 'connectors.watch', 'connectors.unwatch', 'connectors.refresh', 'connectors.visibility', 'connectors.close']);

/** P5 O12 M11: the spine record's `launchedBy`, as far as the bridge reads it: the member who spawned the session. */
export type Spawner = Pick<LaunchedBy, 'member'>;

/**
 * How a lane B session is placed: the machine as the request reads it (on behalf of its asker), the log a spine's failure
 * is said to, and whether the engine session placed is checked here against the live row (P5 O7 M2). `live: false` only
 * where the executor checks it itself, against the status it reads anyway (an engine host act's context, actions.ts);
 * the live row is read either way, so an engine host that can't answer meets every request alike (P5 O7 M4, fix wave 2).
 * P5 O7 M5a: `artifact`, how the `artifact` rule places an artifact by its id (the asking channel's cache, artifacts.ts);
 * absent, `placeArtifact` reads it afresh.
 */
// UX wave U9 (M1): `byRecord`, a lane B session with a recorded engine session is placed by its record alone, no status
// read: a completion's act (a pane's answer), which a handover's drain must not hold for the successor (actions.ts).
export type Placing = { dispatch: EndpointServices['dispatch']; log(line: string): void; live?: boolean; byRecord?: boolean; artifact?(artifactId: string): Promise<Resolved>; held?: HeldNames; members?: RecordMembers };

/**
 * P5 O8 M6b: the member a lane B app session's record acts go to, as RL10's members join places it (rl10/members.ts'
 * `recordMember`; `preferred`, the engine session the spine records for it); null when the join places none, or can't tell
 * two apart.
 */
export type RecordMembers = { recordMember(appSessionId: string, preferred?: string): string | null };

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;
const field = (input: unknown, name: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined);

/**
 * The target `rule` reads from `input` (an action's `args`, or a call's input), or from the call's `session` (`checkout`);
 * `name`, the command's (the `artifact` rule reads its input by it).
 */
export async function resolveTarget(rule: TargetRule, input: unknown, action: Action | undefined, placing: Placing, session?: SessionRef, name?: string): Promise<Resolved> {
  if (rule === 'machine' || rule === 'each-session') return action?.session === undefined ? { kind: 'machine' } : { kind: 'refused', reason: 'malformed' };
  if (rule === 'artifact') {
    // An artifact act names no session (the third act shape): one that does is about something else.
    if (action?.session !== undefined) return { kind: 'refused', reason: 'malformed' };
    const key = artifactKey(name ?? '', input, placing.held);
    if (key === null) return { kind: 'refused', reason: 'no-target' };
    if ('orphan' in key) return ORPHAN;
    if ('unknown' in key) return { kind: 'unknown' };
    if ('appSessionId' in key) return laneB(key.appSessionId, placing);
    return (placing.artifact ?? ((id) => placeArtifact(id, placing)))(key.artifactId);
  }
  // A checkout is a lane B session's, named by the call (its rows are calls); lane A's checkouts are sminos's.
  if (rule === 'checkout') return action === undefined && session?.lane === 'B' && isId(session.id) ? laneB(session.id, placing) : { kind: 'refused', reason: 'no-target' };
  if (rule === 'record') return recordTarget(input, action, placing);
  // P5 O7 M8: a task list's read names its session as an `appSessionId` (its list is checked after the rank: `ownTaskList`).
  const id = field(input, rule === 'task-list' ? 'appSessionId' : rule);
  if (!isId(id)) return { kind: 'refused', reason: 'no-target' };
  if (action?.session !== undefined && action.session !== id) return { kind: 'refused', reason: 'malformed' };
  return rule === 'session' ? { kind: 'session', target: { lane: 'A', session: id } } : laneB(id, placing);
}

/** P5 O8 M6b: the `record` rule (above). */
async function recordTarget(input: unknown, action: Action | undefined, placing: Placing): Promise<Resolved> {
  if (action === undefined || action.session !== undefined || action.context !== undefined || action.requestDigest !== undefined) return { kind: 'refused', reason: 'malformed' };
  const lane = field(input, 'session');
  const app = field(input, 'appSessionId');
  if ((lane === undefined) === (app === undefined)) return { kind: 'refused', reason: 'no-target' };
  if (lane !== undefined) return isId(lane) ? { kind: 'session', target: { lane: 'A', session: lane } } : { kind: 'refused', reason: 'no-target' };
  if (!isId(app)) return { kind: 'refused', reason: 'no-target' };
  const placed = await placeRecord(app, placing);
  if (placed.kind === 'unavailable') return { kind: 'refused', reason: 'unavailable' };
  if (placed.kind === 'unknown') return { kind: 'unknown' };
  return { kind: 'session', target: placed.target, ...(placed.launchedBy === undefined ? {} : { launchedBy: placed.launchedBy }) };
}

/** Where a lane B listing's record is (`placeRecord`): its target, the spawner the spine records; or why there is none. */
export type RecordPlacement = { kind: 'placed'; target: Extract<SessionTarget, { lane: 'B' }>; launchedBy?: Spawner } | { kind: 'unknown' } | { kind: 'unavailable' };

/**
 * P5 O8 M6b (the desk track's review 632, P2): the engine session a lane B listing's record is on, the one way both
 * `record.policy` reads it and the record acts change it, so a Share sheet never shows one record and edits another: the
 * member the join places the appSessionId on, in the order members.ts' `recordMember` takes (the engine session the spine
 * records for it, then the one a /clear didn't supersede, then a sole one), else the spine's recorded engine session (a
 * member yet to be joined, which `draw` refuses `no-session` to a caller who stands on it). `unknown` with neither; a
 * spine that fails is `unavailable`, logged.
 */
export async function placeRecord(appSessionId: string, placing: Pick<Placing, 'dispatch' | 'log' | 'members'>): Promise<RecordPlacement> {
  let recorded: Placement;
  try {
    recorded = await placeRecorded(appSessionId, placing.dispatch);
  } catch (error) {
    placing.log(`endpoint: lane B session ${appSessionId} not placed for its record: ${(error as Error).message}`);
    return { kind: 'unavailable' };
  }
  const engine = placing.members?.recordMember(appSessionId, recorded?.target.session) ?? recorded?.target.session;
  if (engine === undefined) return { kind: 'unknown' };
  return { kind: 'placed', target: { lane: 'B', session: engine, appSessionId }, ...(recorded?.launchedBy === undefined ? {} : { launchedBy: recorded.launchedBy }) };
}

/** A subscription's session (`{lane, id}`: lane A the engine session id, lane B the appSessionId). */
export function resolveSubscription(session: { lane: 'A' | 'B'; id: string }, placing: Placing): Promise<Resolved> | Resolved {
  if (!isId(session.id)) return { kind: 'refused', reason: 'no-target' };
  return session.lane === 'A' ? { kind: 'session', target: { lane: 'A', session: session.id } } : laneB(session.id, placing);
}

/**
 * A lane B session by its appSessionId (P5 O7 M2): the engine session its record in the machine's index names
 * (`session.get`), so a session the engine host holds no row for (released as idle, or any session after the host parked
 * and was started again: it knows only its own run's) is still placed. Without such a record (none: the index hasn't
 * discovered it; or one whose engine hasn't said its id yet) the engine session `session.status` reports, as before the
 * index existed, or `unknown` when the engine host holds none for it either. A spine that fails is `unavailable`, logged:
 * a fault there never quietly hands placement to the engine host.
 *
 * Whatever engine session a request is authorized against is the one it runs on, since the engine host runs it by
 * appSessionId: where the host holds a live row for the session, its engine session must be the recorded one, else the
 * index lags a change of engine session (a `/clear`), so a member's rank on one engine session never reaches another.
 *
 * P5 O7 M4 (fix waves 1 and 2): what placement answers before anyone's rank is read must be the same for every id,
 * so it says nothing of whether a session exists or lags:
 *   - A spine that fails, or an engine host that can't answer the live read (`host_unavailable`, `timeout`), is
 *     `unavailable` for every lane B id, recorded or not, on every path (an engine host act's too: the live row is read
 *     for it as for any request). Both are the machine's condition, not a session's; a caller may try again, and a held
 *     subscription's re-check retries rather than ending.
 *   - With the host answering, a session with a recorded engine session is placed on it whatever the live row runs. A
 *     live engine session that isn't the recorded one is the placement's `unavailable` flag, which authorization
 *     answers only to a caller who stands at the floor on the recorded engine session, until the index catches up; a
 *     caller who doesn't is `grade`, as for any session they hold nothing on, whichever engine session they own (the
 *     record is what the machine says the session is, and a caller below it learns nothing of a lag).
 *   - Without a recorded engine session the live row is the only placement, else `unknown` (`grade`).
 */
async function laneB(appSessionId: string, { dispatch, log, live = true, byRecord = false }: Placing): Promise<Resolved> {
  const unavailable: Resolved = { kind: 'refused', reason: 'unavailable' };
  const record = await dispatch('machine', 'session.get', { appSessionId }).catch((error: unknown) => ({ ok: false as const, error: { code: 'internal', message: (error as Error).message } }));
  if (!record.ok) {
    log(`endpoint: lane B session ${appSessionId} not placed: the spine answered ${record.error.code} (${record.error.message})`);
    return unavailable;
  }
  const spawner = field(field(record.value, 'launchedBy'), 'member'); // P5 O12 M11
  const launchedBy = isId(spawner) ? { launchedBy: { member: spawner } } : {};
  const placed = (engine: string): Extract<Resolved, { kind: 'session' }> => ({ kind: 'session', target: { lane: 'B', session: engine, appSessionId }, ...launchedBy });
  const recorded = field(record.value, 'engineSessionId');
  if (byRecord && isId(recorded)) return placed(recorded);
  const status = await dispatch('engine-host', 'session.status', { appSessionId });
  if (!status.ok && (status.error.code === 'host_unavailable' || status.error.code === 'timeout')) return unavailable;
  const running = status.ok ? field(status.value, 'engineSessionId') : undefined;
  if (isId(recorded)) return live && status.ok && running !== recorded ? { ...placed(recorded), unavailable: true } : placed(recorded);
  return isId(running) ? placed(running) : { kind: 'unknown' };
}

/**
 * The `artifact` rule's reading of `name`'s input (P5 O7 M5a): `artifacts.list` names the session its listing is of (a
 * listing with none is `no-target`: `library.list` is the library's listing); `copyAsset` its `to` (the write; its `from`
 * is by-effect.ts'); `create` and a `pruneVersions` with no `artifactId` the orphan form; anything else its `artifactId`.
 */
export function artifactKey(name: string, input: unknown, held?: HeldNames): ArtifactKey | null {
  // P5 O7 M5c: a lease's or a run's artifact, as the asking channel's table holds it.
  if (LEASE_COMMANDS.has(name)) {
    const leaseId = field(input, 'leaseId');
    const artifactId = isId(leaseId) ? (held?.lease(leaseId) ?? null) : null;
    return artifactId === null ? { unknown: true } : { artifactId };
  }
  if (name === 'delivery.cancel') {
    const runId = field(input, 'runId');
    const artifactId = isId(runId) ? (held?.run(runId) ?? null) : null;
    return artifactId === null ? null : { artifactId };
  }
  // P5 O7 M5b: an `http` read open names its artifact by its URL (its fields already held to the scheme's shape).
  if (name === 'artifacts.fetch') {
    const url = field(input, 'url');
    const target = typeof url === 'string' ? parseArtifactUrl(url) : null;
    return target === null ? null : { artifactId: target.artifactId };
  }
  if (name === 'artifacts.list') {
    const id = field(field(input, 'filter'), 'appSessionId');
    return isId(id) ? { appSessionId: id } : null;
  }
  if (name === 'artifacts.create') return { orphan: true };
  const id = field(input, name === 'artifacts.copyAsset' ? 'to' : 'artifactId');
  if (isId(id)) return { artifactId: id };
  return name === 'artifacts.pruneVersions' && id === undefined ? { orphan: true } : null;
}

/**
 * The `artifact` rule for one of the machine's owners (P5 O7 M5a), who stands on every artifact: what the input names,
 * read before any link is placed, so a request costs no read of the store. Null for a listing by a session
 * (`artifacts.list {filter: {appSessionId}}`): that is the session's, placed and ranked as for anyone (the milestone
 * review: owning the machine is not viewing a member's private session, and an id is never a capability).
 */
export function artifactShortCut(name: string, input: unknown, action: Action | undefined, held?: HeldNames): Resolved | null {
  if (action?.session !== undefined) return { kind: 'refused', reason: 'malformed' };
  const key = artifactKey(name, input, held);
  if (key === null) return { kind: 'refused', reason: 'no-target' };
  if ('orphan' in key) return ORPHAN;
  if ('unknown' in key) return { kind: 'unknown' };
  if ('appSessionId' in key) return null;
  return { kind: 'artifact', artifactId: key.artifactId, sessions: [], orphan: false, linked: [] };
}

/**
 * An artifact and its links, read from the machine's store (`library.entry`, the engine host's, on the asker's behalf), each
 * linked session placed through `laneB` with `live: false` (the request runs against the artifact, never the session, so
 * a session whose live engine session lags its record is placed on its record, which is what the machine says it is).
 * A host that can't answer, or a spine or engine host that can't place a link, is `unavailable`; a null artifact
 * `unknown`; a link placed `unknown` is left out (no record and no live row: nobody holds a rank on it).
 */
export async function placeArtifact(artifactId: string, placing: Placing): Promise<Resolved> {
  const entry = await placing.dispatch('engine-host', 'library.entry', { artifactId }).catch((error: unknown) => ({ ok: false as const, error: { code: 'internal', message: (error as Error).message } }));
  if (!entry.ok) {
    placing.log(`endpoint: artifact ${artifactId} not placed: the engine host answered ${entry.error.code} (${entry.error.message})`);
    return { kind: 'refused', reason: 'unavailable' };
  }
  if (field(entry.value, 'artifact') === null || field(entry.value, 'artifact') === undefined) return { kind: 'unknown' };
  const links = field(entry.value, 'links');
  const linked = [...new Set((Array.isArray(links) ? links : []).map((link) => field(link, 'appSessionId')).filter(isId))];
  const placed = await Promise.all(linked.map((id) => laneB(id, { dispatch: placing.dispatch, log: placing.log, live: false })));
  if (placed.some((p) => p.kind === 'refused')) return { kind: 'refused', reason: 'unavailable' };
  const sessions = placed.flatMap((p) => (p.kind === 'session' && p.target.lane === 'B' ? [{ target: p.target, ...(p.launchedBy === undefined ? {} : { launchedBy: p.launchedBy }) }] : []));
  return { kind: 'artifact', artifactId, sessions, orphan: linked.length === 0, linked };
}

/**
 * P5 O7 M6: a lane B session as its record in the machine's index places it (`session.get`'s or a `session.changed`'s
 * record): the engine session the record names, and its spawner (P5 O12 M11's bridge). Null when the record names no
 * engine session (none recorded, or none said yet): nobody holds a rank on it.
 */
export type Placement = { target: Extract<SessionTarget, { lane: 'B' }>; launchedBy?: Spawner } | null;

export function recordedPlacement(appSessionId: string, record: unknown): Placement {
  const engine = field(record, 'engineSessionId');
  if (!isId(engine)) return null;
  const spawner = field(field(record, 'launchedBy'), 'member');
  return { target: { lane: 'B', session: engine, appSessionId }, ...(isId(spawner) ? { launchedBy: { member: spawner } } : {}) };
}

/** The session's placement by its record, read from the spine through `dispatch`; throws when the spine can't answer. */
export async function placeRecorded(appSessionId: string, dispatch: EndpointServices['dispatch']): Promise<Placement> {
  const record = await dispatch('machine', 'session.get', { appSessionId });
  if (!record.ok) throw new Error(`the spine answered ${record.error.code} for ${appSessionId}`);
  return recordedPlacement(appSessionId, record.value);
}

/**
 * P5 O7 M8: whether a `task-list` read's `listId` is its session's own list, as the renderer's task panel derives it
 * (task-list.ts' `listIdFor`): the engine host's status's `taskListId` (null before the engine said its id: no list yet),
 * or, for a session the host holds no row for, the engine session its record places it on; sanitised as the engine names
 * the list's directory. Read only for a caller who views the session. The status must be of the engine session the
 * request was placed and ranked on: one the session moved to since (a `/clear` between the two reads) is `unavailable`,
 * as the placement says of a live row it lags, so a rank on one engine session never reads another's list.
 */
export async function ownTaskList(input: unknown, target: Extract<SessionTarget, { lane: 'B' }>, placing: Placing): Promise<'own' | 'no-target' | 'unavailable'> {
  const listId = field(input, 'listId');
  if (!isId(listId)) return 'no-target';
  const status = await placing.dispatch('engine-host', 'session.status', { appSessionId: target.appSessionId }).catch(() => null);
  if (status === null || (!status.ok && (status.error.code === 'host_unavailable' || status.error.code === 'timeout'))) return 'unavailable';
  if (status.ok && field(status.value, 'engineSessionId') !== target.session) return 'unavailable';
  const own = status.ok ? field(status.value, 'taskListId') : target.session;
  return typeof own === 'string' && sanitiseListId(own) === listId ? 'own' : 'no-target';
}

/** How many sessions' checkout bounds are kept: one entry per distinct set of roots. */
export const CHECKOUT_BOUNDS_KEPT = 256;

/**
 * A session's checkout bounds as a remote reader has them: git's (`within`: its roots and their repositories), its roots
 * a file may lie in (`roots`), the roots the home-root rule took out (`dropped`), and whether its checkout (the
 * worktree's path, else its directory: scm's) is a home's, by itself or its repository (`checkoutCovers`).
 */
export interface Bounds {
  readonly within: readonly string[];
  readonly roots: readonly string[];
  readonly dropped: readonly string[];
  readonly checkoutCovers: boolean;
}

/**
 * A lane B session's checkout bounds: the realpaths of its record's roots and of the repository each belongs to (its
 * own worktree's root, `repositoryOf`; round 2 of the desk track's review: rev-parse and the worktree list, never a
 * status, whose scan of a home kept in git times out). A root that does not resolve is dropped; one in no repository
 * bounds only itself; one whose repository git didn't answer bounds nothing of git's (fail closed, never kept).
 *
 * The roots are realpathed on every read (cheap), and the repositories are kept per set of canonical roots, so a root
 * that is a symlink retargeted since is read where it points now. A set is kept only when every root resolved and
 * every repository read answered (the spine away, a git timeout): a root that appears later, or a read that failed,
 * is read again next time (fix wave 1).
 *
 * 2026-11-06 (the home-root rule; the New chat's machine first, whose chat in a machine's home has the home as its
 * root): a root whose realpath is a home of the machine or an ancestor of one (`/`, `/Users`) is no root for a remote
 * reader, whoever they are, since it would reach every repository and file under the home (`dropped`). And git answers
 * for the repository a path is in, so a root whose repository is such (a home kept in git, a root inside it, or a
 * linked worktree whose main checkout is a home: git's worktree reads and scm resolve to the main checkout) bounds
 * nothing of git's either: every path within the bounds then has a repository below the home (the nearest repository of
 * a path under a root is the root's, or one nested deeper), which the `checkout` rule and the checkout feed's
 * `git.changed` read. Its files stay the session's (`roots`). The homes are src/shared/machine/machine-home.ts' (a home
 * spawn's directory is the first), a suite's fake one when given.
 */
export class CheckoutBounds {
  readonly #kept = new Map<string, Bounds>();

  constructor(private readonly homes: () => readonly string[] = machineHomes) {}

  /**
   * Whether git, asked at `real` (a realpath within the bounds), answers for a repository below every home: its own
   * worktree's root and its main checkout's cover none, or git says it is in none. Any other answer is no (fail closed).
   * A remote git read's path, at its request: a project's root may hold a linked worktree of a home kept in git, which
   * git's worktree reads resolve to the home's checkout and its log reads the home's history of. One rev-parse and one
   * worktree list, no work-tree scan, never kept.
   */
  async reaches(real: string, dispatch: EndpointServices['dispatch']): Promise<boolean> {
    const repo = await repositoryOf(real, dispatch);
    if (repo === 'unknown') return false;
    const homes = this.homes();
    return repo === null || !(coversHome(repo.toplevel, homes) || coversHome(repo.main, homes));
  }

  /** Whether `real` (a realpath) is a home of the machine or above one. */
  coversAHome(real: string): boolean {
    return coversHome(real, this.homes());
  }

  /**
   * The bounds of `record` (`session.get`'s answer), read on the machine through `dispatch`: its own roots' (kept per set
   * of roots), then the launch folder and the working folder where one of the record's facts names them, each admitted
   * for this request alone (UX wave U8c-2, `admittedFacts`). An admitted folder is a root, bounds git's reads with its
   * work tree, and, as the working folder, is the checkout Source control's output is judged by; each under the home rule.
   */
  async of(record: unknown, dispatch: EndpointServices['dispatch']): Promise<Bounds> {
    const own = await this.#own(record, dispatch);
    const facts = await admittedFacts(record, dispatch);
    if (facts.length === 0) return own;
    const homes = this.homes();
    const roots = [...own.roots];
    const dropped = [...own.dropped];
    const within = new Set(own.within);
    let checkoutCovers = own.checkoutCovers;
    if (facts.some((fact) => fact.which === 'path')) checkoutCovers = true; // until the working folder is admitted below
    for (const fact of facts) {
      const covered = coversHome(fact.toplevel, homes) || coversHome(fact.main, homes); // a home's repository: a file root alone
      if (fact.which === 'path' && fact.real !== null) checkoutCovers = coversHome(fact.real, homes) || covered;
      if (fact.real === null) continue;
      if (coversHome(fact.real, homes)) {
        if (!dropped.includes(fact.real)) dropped.push(fact.real);
        continue;
      }
      if (!roots.includes(fact.real)) roots.push(fact.real);
      if (!covered) within.add(fact.real).add(fact.toplevel);
    }
    return { within: [...within], roots, dropped, checkoutCovers };
  }

  /** The bounds of the record's own roots: its directory, additional directories and worktree, kept per set of roots. */
  async #own(record: unknown, dispatch: EndpointServices['dispatch']): Promise<Bounds> {
    const homes = this.homes();
    const declared = rootsOf(record);
    const resolved = await Promise.all(declared.map((root) => realpathOf(root)));
    const all = [...new Set(resolved.filter((root): root is string => root !== null))];
    const roots = all.filter((root) => !coversHome(root, homes));
    const dropped = all.filter((root) => coversHome(root, homes));
    const checkout = resolved[declared.indexOf(checkoutOf(record) ?? '')] ?? null; // the scm checkout's realpath, when it is a root that resolved
    const key = JSON.stringify([roots, dropped, checkout]);
    const kept = this.#kept.get(key);
    if (kept !== undefined) return kept;
    let answered = !resolved.includes(null);
    const repos = await Promise.all(roots.map((root) => repositoryOf(root, dispatch)));
    if (repos.includes('unknown')) answered = false;
    const within = new Set<string>();
    let checkoutCovers = checkout === null || coversHome(checkout, homes);
    roots.forEach((root, i) => {
      const repo = repos[i];
      // a home's repository (its own worktree's root or its main checkout's) gives git the whole of it, and an answer
      // git didn't give says nothing of what it would give: either way, a file root alone
      if (repo === 'unknown' || (repo !== null && (coversHome(repo.toplevel, homes) || coversHome(repo.main, homes)))) {
        if (root === checkout) checkoutCovers = true;
        return;
      }
      within.add(root);
      if (repo !== null) within.add(repo.toplevel);
    });
    const bounds: Bounds = { within: [...within], roots, dropped, checkoutCovers };
    if (answered) {
      if (this.#kept.size >= CHECKOUT_BOUNDS_KEPT) this.#kept.delete(this.#kept.keys().next().value!);
      this.#kept.set(key, bounds);
    }
    return bounds;
  }
}

/**
 * UX wave U8c-2 (docs/doperpowers/plans/2026-11-12-ux-wave-U8c-live-working-folder.md, M3 decision 5, §G): the launch
 * folder and the working folder `record` names through one of its facts (the selector's `launch` and `path` where they
 * are not its directory or its worktree's path), each with whether it is admitted for this request: the work tree git
 * finds for its realpath (`git.worktree.list`'s `toplevel` there) is the path of one of the work trees the machine lists
 * at the record's directory, in the same common git directory: the directory a listed path names, found by its NFC
 * spelling (the service names paths as realpaths in NFC where that spelling is git's directory) and admitted by its
 * device and inode, so a sibling spelled in the other Unicode form is not the registered worktree. The files
 * service reads the same predicate from git's own files (src/services/files/allowlist.ts' `admittedFolder`); one table of
 * cases holds both. Nothing is kept: two calls of the machine per request while a record carries a fact, none otherwise.
 * `real` null: not admitted (gone, unanswered, not listed); its `toplevel` and `main` are then empty.
 */
async function admittedFacts(record: unknown, dispatch: EndpointServices['dispatch']): Promise<{ which: 'launch' | 'path'; real: string | null; toplevel: string; main: string }[]> {
  if (!folderReadable(record)) return [];
  const folder = workingFolder(record);
  const own = new Set([record.directory, ...(record.worktree ? [record.worktree.path] : [])]);
  const asked = (['launch', 'path'] as const).filter((which) => !own.has(folder[which]) && isAbsolute(folder[which]));
  if (asked.length === 0) return [];
  const anchor = await realpathOf(record.directory);
  const listed = anchor === null ? null : await worktreesAt(anchor, dispatch);
  return Promise.all(
    asked.map(async (which) => {
      const refused = { which, real: null, toplevel: '', main: '' };
      const real = await realpathOf(folder[which]);
      if (real === null || listed === null) return refused;
      const at = await worktreesAt(real, dispatch);
      if (at === null || at.commonDir !== listed.commonDir) return refused;
      const toplevel = ancestorsOf(real).find((path) => path.normalize('NFC') === at.toplevel.normalize('NFC'));
      if (toplevel === undefined) return refused;
      // the folded spelling finds a listed work tree; only the directory it names admits (a sibling spelled in the other
      // Unicode form, holding a copy of a registered worktree's pointer, is another directory: the branch review's P1)
      const candidates = listed.paths.filter((path) => path.normalize('NFC') === at.toplevel.normalize('NFC'));
      const member = (await Promise.all(candidates.map((path) => sameDirectory(path, toplevel)))).includes(true);
      return member ? { which, real, toplevel, main: at.main } : refused;
    }),
  );
}

/** What the machine's `git.worktree.list` answers at `real` (a realpath): its top level, main checkout, common dir and work trees (as the service names them), or null. */
async function worktreesAt(real: string, dispatch: EndpointServices['dispatch']): Promise<{ toplevel: string; main: string; commonDir: string; paths: string[] } | null> {
  const folded = real.normalize('NFC'); // the service answers for the NFC spelling (repositoryOf, round 4)
  if (folded !== real && !(await sameDirectory(real, folded))) return null;
  const answer = await dispatch('machine', 'git.worktree.list', { repoRoot: real }).catch(() => null);
  if (answer === null || !answer.ok) return null;
  const toplevel = field(answer.value, 'toplevel');
  const main = field(answer.value, 'repoRoot');
  const commonDir = field(answer.value, 'commonDir');
  const worktrees = field(answer.value, 'worktrees');
  if (typeof toplevel !== 'string' || !isAbsolute(toplevel) || typeof main !== 'string' || typeof commonDir !== 'string' || !Array.isArray(worktrees)) return null;
  const paths = worktrees.flatMap((entry) => {
    const path = field(entry, 'path');
    return typeof path === 'string' ? [path] : [];
  });
  return { toplevel, main, commonDir, paths };
}

/** The failure a git read of a directory in no repository answers (src/services/git/runner.ts' NotARepositoryError). */
const NOT_A_REPOSITORY = 'not a git repository';

/**
 * The repository `root` (a realpath) is in, as `git.worktree.list` answers it: rev-parse and the worktree list, no read of
 * the work tree (a home kept in git answers at once, where a status would scan the whole home past git's bound). Its top
 * level as git reads it there (the list's `toplevel`, `core.worktree` included; the final review), which must be the
 * root or one of its ancestors, taken in the root's own spelling (the service names its paths in NFC), and its main
 * checkout's root (the list's `repoRoot`, from the common dir, for a comparison with the homes alone); null when git says
 * it is in none; `unknown` for any other answer (the spine or git away, a timeout, a failure, a top level elsewhere or
 * none), which bounds nothing of git's and is never kept.
 */
async function repositoryOf(root: string, dispatch: EndpointServices['dispatch']): Promise<{ toplevel: string; main: string } | null | 'unknown'> {
  // round 4: the service folds the path to NFC before git runs (holders.ts' canonicalPath), so its answer is the NFC
  // spelling's, which is the root's only where the filesystem folds the forms too (the same directory: APFS); a
  // sibling of that spelling (ext4), or none, says nothing of the root
  const folded = root.normalize('NFC');
  if (folded !== root && !(await sameDirectory(root, folded))) return 'unknown';
  const listed = await dispatch('machine', 'git.worktree.list', { repoRoot: root }).catch(() => null);
  if (listed === null) return 'unknown';
  if (!listed.ok) return listed.error.code === 'internal' && listed.error.message === NOT_A_REPOSITORY ? null : 'unknown';
  const main = field(listed.value, 'repoRoot');
  const top = field(listed.value, 'toplevel');
  if (typeof main !== 'string' || !isAbsolute(main) || typeof top !== 'string' || !isAbsolute(top)) return 'unknown';
  const toplevel = ancestorsOf(root).find((path) => path.normalize('NFC') === top.normalize('NFC'));
  return toplevel === undefined ? 'unknown' : { toplevel, main };
}

/** Whether `a` and `b` name one directory (its device and inode); false when either doesn't stat. */
async function sameDirectory(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([stat(a, { bigint: true }).catch(() => null), stat(b, { bigint: true }).catch(() => null)]);
  return x !== null && y !== null && x.isDirectory() && x.dev === y.dev && x.ino === y.ino;
}

/** `path` and each directory above it, nearest first. */
function ancestorsOf(path: string): string[] {
  const out = [path];
  for (let at = path; dirname(at) !== at; ) out.push((at = dirname(at)));
  return out;
}

/** Whether `real`, a realpath, is one of `bounds` or lies under one (at a segment boundary: `/repo2` is not under `/repo`). */
export function withinBounds(bounds: readonly string[], real: string): boolean {
  return bounds.some((bound) => real === bound || real.startsWith(bound.endsWith(sep) ? bound : bound + sep));
}

/**
 * Whether a `checkout` read's path lies in its session's checkout: the input's `directory`, else its `repoRoot`, an
 * absolute path whose realpath is within the bounds of the session's record (`session.get`, read on the asker's
 * behalf). No record, no path, or a path that does not resolve: not within. 2026-11-06 (the desk track's round 3): and the
 * repository git would answer for at that path is no home's (`CheckoutBounds.reaches`), asked at each request, since a
 * root's own repository says nothing of a home's worktree checked out below it.
 */
export async function withinCheckout(input: unknown, appSessionId: string, placing: Placing, bounds: CheckoutBounds, name?: string): Promise<boolean> {
  const path = field(input, 'directory') ?? field(input, 'repoRoot');
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  // round 4: a worktree status's `path` names a place (the worktree whose state it reads), which is no home of the
  // machine nor above one, and resolves (git.diff's and git.log's `path` is a pathspec in the repository, bounded by it)
  if (name === 'git.worktree.status') {
    const place = field(input, 'path');
    const real = typeof place === 'string' && isAbsolute(place) ? await realpathOf(place) : null;
    if (real === null || bounds.coversAHome(real)) return false;
  }
  const record = await placing.dispatch('machine', 'session.get', { appSessionId }).catch(() => null);
  if (record === null || !record.ok || record.value === null || typeof record.value !== 'object') return false;
  const [real, within] = await Promise.all([realpathOf(path), bounds.of(record.value, placing.dispatch)]);
  return real !== null && withinBounds(within.within, real) && (await bounds.reaches(real, placing.dispatch));
}

/**
 * A record's scm checkout, as the scm service reads it: the session's working folder (`workingFolder`, UX wave U8), of
 * the same object, so the two agree by construction. A value the selector cannot read (its directory no string, its
 * worktree neither null, absent nor an object with a string path) names no checkout; no `SessionRecord` is such a value.
 */
function checkoutOf(record: unknown): string | null {
  if (!folderReadable(record)) return null;
  const checkout = workingFolder(record).path;
  return isAbsolute(checkout) ? checkout : null;
}

/**
 * Whether `value` holds the fields `workingFolder` reads, as a `SessionRecord` holds them. UX wave U8c-2: its launch
 * folder, when present, only as a string, and its agent's folder only as an object with a string checkout and cwd (the
 * two the selector reads); any other shape names no folder, as any value that is no record.
 */
function folderReadable(value: unknown): value is Pick<SessionRecord, 'directory' | 'worktree'> & Partial<Pick<SessionRecord, 'launchFolder' | 'agentFolder'>> {
  const worktree = field(value, 'worktree');
  const launch = field(value, 'launchFolder');
  const agent = field(value, 'agentFolder');
  return (
    typeof field(value, 'directory') === 'string' &&
    (worktree === null || worktree === undefined || (typeof worktree === 'object' && typeof field(worktree, 'path') === 'string')) &&
    (launch === undefined || typeof launch === 'string') &&
    (agent === undefined || (typeof agent === 'object' && agent !== null && typeof field(agent, 'checkout') === 'string' && typeof field(agent, 'cwd') === 'string'))
  );
}

/** A record's roots, as the files service reads them: its directory, its additional directories and its worktree. */
function rootsOf(record: unknown): string[] {
  const directory = field(record, 'directory');
  const additional = field(record, 'additionalDirectories');
  const worktree = field(field(record, 'worktree'), 'path');
  const roots = [directory, ...(Array.isArray(additional) ? additional : []), worktree];
  return roots.filter((root): root is string => typeof root === 'string' && isAbsolute(root));
}

// A path's realpath as the filesystem names it: the bounds hold, compare and dispatch on it, since a filesystem that tells
// Unicode forms apart (ext4 under a Linux `mawsd`) holds `café` composed and decomposed as two directories. Only a
// comparison with a home folds the forms (machine-home.ts' `coversHome`), where folding errs toward refusing.
const realpathOf = (path: string): Promise<string | null> => realpath(path).catch(() => null);
