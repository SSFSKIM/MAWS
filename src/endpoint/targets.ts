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
// git's changes by the same bounds (plane-feeds.ts).
//
// P5 O7 M6: `each-session`, a machine-wide read whose answer is per session (`attention.list`, `session.search`): it names
// no target (the machine), and its answer is cut per session against each one's placement by its record alone
// (`recordedPlacement`), with no read of the engine host, which would wake a parked one for every session listed.
//
// P5 O12 M11 (docs/doperpowers/plans/2026-10-27-p5-o12-sminos-owners.md, M11's Decisions): a lane B session's placement
// also answers who spawned it, the `launchedBy` of the spine record it read, beside the target and never inside it, so the
// decision's bridge (authorize.ts) rests on the read that placed it.
import { realpath } from 'node:fs/promises';
import { isAbsolute, sep } from 'node:path';
import type { Action, SessionRef } from 'org-protocol';
import type { LaunchedBy } from '@shared/graph/session';
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
  | { kind: 'refused'; reason: 'no-target' | 'malformed' | 'unavailable' };

/** P5 O12 M11: the spine record's `launchedBy`, as far as the bridge reads it: the member who spawned the session. */
export type Spawner = Pick<LaunchedBy, 'member'>;

/**
 * How a lane B session is placed: the machine as the request reads it (on behalf of its asker), the log a spine's failure
 * is said to, and whether the engine session placed is checked here against the live row (P5 O7 M2). `live: false` only
 * where the executor checks it itself, against the status it reads anyway (an engine host act's context, actions.ts);
 * the live row is read either way, so an engine host that can't answer meets every request alike (P5 O7 M4, fix wave 2).
 */
export type Placing = { dispatch: EndpointServices['dispatch']; log(line: string): void; live?: boolean };

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;
const field = (input: unknown, name: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined);

/** The target `rule` reads from `input` (an action's `args`, or a call's input), or from the call's `session` (`checkout`). */
export async function resolveTarget(rule: TargetRule, input: unknown, action: Action | undefined, placing: Placing, session?: SessionRef): Promise<Resolved> {
  if (rule === 'machine' || rule === 'each-session') return action?.session === undefined ? { kind: 'machine' } : { kind: 'refused', reason: 'malformed' };
  // A checkout is a lane B session's, named by the call (its rows are calls); lane A's checkouts are sminos's.
  if (rule === 'checkout') return action === undefined && session?.lane === 'B' && isId(session.id) ? laneB(session.id, placing) : { kind: 'refused', reason: 'no-target' };
  const id = field(input, rule);
  if (!isId(id)) return { kind: 'refused', reason: 'no-target' };
  if (action?.session !== undefined && action.session !== id) return { kind: 'refused', reason: 'malformed' };
  return rule === 'session' ? { kind: 'session', target: { lane: 'A', session: id } } : laneB(id, placing);
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
async function laneB(appSessionId: string, { dispatch, log, live = true }: Placing): Promise<Resolved> {
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
  const status = await dispatch('engine-host', 'session.status', { appSessionId });
  if (!status.ok && (status.error.code === 'host_unavailable' || status.error.code === 'timeout')) return unavailable;
  const running = status.ok ? field(status.value, 'engineSessionId') : undefined;
  if (isId(recorded)) return live && status.ok && running !== recorded ? { ...placed(recorded), unavailable: true } : placed(recorded);
  return isId(running) ? placed(running) : { kind: 'unknown' };
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

/** How many sessions' checkout bounds are kept: one entry per distinct set of roots. */
export const CHECKOUT_BOUNDS_KEPT = 256;

/**
 * A lane B session's checkout bounds: the realpaths of its record's roots and of the repository each belongs to
 * (`git.status`'s `repoRoot`). A root that does not resolve is dropped; one in no repository bounds only itself.
 *
 * The roots are realpathed on every read (cheap), and the repositories are kept per set of canonical roots, so a root
 * that is a symlink retargeted since is read where it points now. A set is kept only when every root resolved and
 * every repository read answered (the spine away, a git timeout): a root that appears later, or a read that failed,
 * is read again next time (fix wave 1).
 */
export class CheckoutBounds {
  readonly #kept = new Map<string, readonly string[]>();

  /** The bounds of `record` (`session.get`'s answer), read on the machine through `dispatch`. */
  async of(record: unknown, dispatch: EndpointServices['dispatch']): Promise<readonly string[]> {
    const resolved = await Promise.all(rootsOf(record).map((root) => realpathOf(root)));
    const real = [...new Set(resolved.filter((root): root is string => root !== null))];
    const key = JSON.stringify(real);
    const kept = this.#kept.get(key);
    if (kept !== undefined) return kept;
    let answered = !resolved.includes(null);
    const repos = await Promise.all(
      real.map(async (root) => {
        const status = await dispatch('machine', 'git.status', { directory: root }).catch(() => null);
        if (status === null || (!status.ok && (status.error.code === 'host_unavailable' || status.error.code === 'timeout'))) answered = false;
        const repoRoot = status?.ok === true ? field(status.value, 'repoRoot') : undefined;
        return typeof repoRoot === 'string' ? realpathOf(repoRoot) : null;
      }),
    );
    const bounds = [...new Set([...real, ...repos.filter((repo): repo is string => repo !== null)])];
    if (answered) {
      if (this.#kept.size >= CHECKOUT_BOUNDS_KEPT) this.#kept.delete(this.#kept.keys().next().value!);
      this.#kept.set(key, bounds);
    }
    return bounds;
  }
}

/** Whether `real`, a realpath, is one of `bounds` or lies under one (at a segment boundary: `/repo2` is not under `/repo`). */
export function withinBounds(bounds: readonly string[], real: string): boolean {
  return bounds.some((bound) => real === bound || real.startsWith(bound.endsWith(sep) ? bound : bound + sep));
}

/**
 * Whether a `checkout` read's path lies in its session's checkout: the input's `directory`, else its `repoRoot`, an
 * absolute path whose realpath is within the bounds of the session's record (`session.get`, read on the asker's
 * behalf). No record, no path, or a path that does not resolve: not within.
 */
export async function withinCheckout(input: unknown, appSessionId: string, placing: Placing, bounds: CheckoutBounds): Promise<boolean> {
  const path = field(input, 'directory') ?? field(input, 'repoRoot');
  if (typeof path !== 'string' || !isAbsolute(path)) return false;
  const record = await placing.dispatch('machine', 'session.get', { appSessionId }).catch(() => null);
  if (record === null || !record.ok || record.value === null || typeof record.value !== 'object') return false;
  const [real, within] = await Promise.all([realpathOf(path), bounds.of(record.value, placing.dispatch)]);
  return real !== null && withinBounds(within, real);
}

/** A record's roots, as the files service reads them: its directory, its additional directories and its worktree. */
function rootsOf(record: unknown): string[] {
  const directory = field(record, 'directory');
  const additional = field(record, 'additionalDirectories');
  const worktree = field(field(record, 'worktree'), 'path');
  const roots = [directory, ...(Array.isArray(additional) ? additional : []), worktree];
  return roots.filter((root): root is string => typeof root === 'string' && isAbsolute(root));
}

const realpathOf = (path: string): Promise<string | null> => realpath(path).catch(() => null);
