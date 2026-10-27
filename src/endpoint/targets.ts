// A request's session, read from its input by its offer row's target rule (O10 M5; Interfaces §G): `appSessionId` for
// lane B, mapped to the engine session that keys its record through `session.status` (its `engineSessionId`); `session`
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

const isId = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= 512;
const field = (input: unknown, name: string): unknown => (typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[name] : undefined);

/** The target `rule` reads from `input` (an action's `args`, or a call's input). */
export async function resolveTarget(rule: TargetRule, input: unknown, action: Action | undefined, dispatch: EndpointServices['dispatch']): Promise<Resolved> {
  if (rule === 'machine') return action?.session === undefined ? { kind: 'machine' } : { kind: 'refused', reason: 'malformed' };
  const id = field(input, rule);
  if (!isId(id)) return { kind: 'refused', reason: 'no-target' };
  if (action?.session !== undefined && action.session !== id) return { kind: 'refused', reason: 'malformed' };
  return rule === 'session' ? { kind: 'session', target: { lane: 'A', session: id } } : laneB(id, dispatch);
}

/** A subscription's session (`{lane, id}`: lane A the engine session id, lane B the appSessionId). */
export function resolveSubscription(session: { lane: 'A' | 'B'; id: string }, dispatch: EndpointServices['dispatch']): Promise<Resolved> | Resolved {
  if (!isId(session.id)) return { kind: 'refused', reason: 'no-target' };
  return session.lane === 'A' ? { kind: 'session', target: { lane: 'A', session: session.id } } : laneB(session.id, dispatch);
}

/**
 * A lane B session by its appSessionId: the engine session `session.status` reports, or `unknown` when the engine host
 * holds none for it (or none yet: a launch whose engine hasn't said its id). An engine host that can't answer now is
 * `unavailable`, which a caller may try again.
 */
async function laneB(appSessionId: string, dispatch: EndpointServices['dispatch']): Promise<Resolved> {
  const response = await dispatch('engine-host', 'session.status', { appSessionId });
  if (!response.ok) return response.error.code === 'host_unavailable' || response.error.code === 'timeout' ? { kind: 'refused', reason: 'unavailable' } : { kind: 'unknown' };
  const engine = field(response.value, 'engineSessionId');
  return isId(engine) ? { kind: 'session', target: { lane: 'B', session: engine, appSessionId } } : { kind: 'unknown' };
}
