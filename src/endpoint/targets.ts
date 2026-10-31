// A request's session, read from its input by its offer row's target rule (O10 M5; Interfaces §G): `appSessionId` for
// lane B, mapped to the engine session that keys its record (P5 O7 M2: the spine's record first, `session.get`, else the
// engine host's `session.status`, below); `session`
// for lane A, the engine session id itself (`args.session` in an action, as DX6 has it); none for the machine's own.
// An action that names a session (`action.session`) must name the one its input does, so a decision is never about
// one session and an effect about another (`malformed`).
import type { Action } from 'org-protocol';
import type { TargetRule } from './offers';
import type { EndpointServices } from './services';
import type { SessionTarget } from './sources';

export type Resolved =
  | { kind: 'session'; target: SessionTarget }
  /** A session the input names that this machine can't place: no record can be found for it, so nobody holds a rank. */
  | { kind: 'unknown' }
  | { kind: 'machine' }
  | { kind: 'refused'; reason: 'no-target' | 'malformed' | 'unavailable' };

/**
 * How a lane B session is placed: the machine as the request reads it (on behalf of its asker), the log a spine's failure
 * is said to, and whether the engine session placed is checked here against the live row (P5 O7 M2). `live: false` only
 * where the executor checks it itself, against the status it reads anyway (an engine host act's context, actions.ts).
 */
export type Placing = { dispatch: EndpointServices['dispatch']; log(line: string): void; live?: boolean };

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;
const field = (input: unknown, name: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined);

/** The target `rule` reads from `input` (an action's `args`, or a call's input). */
export async function resolveTarget(rule: TargetRule, input: unknown, action: Action | undefined, placing: Placing): Promise<Resolved> {
  if (rule === 'machine') return action?.session === undefined ? { kind: 'machine' } : { kind: 'refused', reason: 'malformed' };
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
 * index lags a change of engine session (a `/clear`) and the request is `unavailable` until it catches up, so a member's
 * rank on one engine session never reaches another. An engine host that can't answer is `unavailable` too, which a
 * caller may try again.
 */
async function laneB(appSessionId: string, { dispatch, log, live = true }: Placing): Promise<Resolved> {
  const unavailable: Resolved = { kind: 'refused', reason: 'unavailable' };
  const placed = (engine: string): Resolved => ({ kind: 'session', target: { lane: 'B', session: engine, appSessionId } });
  const record = await dispatch('machine', 'session.get', { appSessionId }).catch((error: unknown) => ({ ok: false as const, error: { code: 'internal', message: (error as Error).message } }));
  if (!record.ok) {
    log(`endpoint: lane B session ${appSessionId} not placed: the spine answered ${record.error.code} (${record.error.message})`);
    return unavailable;
  }
  const recorded = field(record.value, 'engineSessionId');
  const status = !isId(recorded) || live ? await dispatch('engine-host', 'session.status', { appSessionId }) : null;
  const hostAway = status !== null && !status.ok && (status.error.code === 'host_unavailable' || status.error.code === 'timeout');
  if (hostAway) return unavailable;
  const running = status?.ok === true ? field(status.value, 'engineSessionId') : undefined;
  if (isId(recorded)) return status === null || !status.ok || running === recorded ? placed(recorded) : unavailable;
  return isId(running) ? placed(running) : { kind: 'unknown' };
}
