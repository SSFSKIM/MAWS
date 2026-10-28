// The endpoint's offer table (O10 M5; Interfaces §G; P5 Decision Log 45): the only names that cross from a remote caller.
// Each row names its executor, whether it is a `call` (a read, list or view) or an `act` (an RL4 action), and its
// target rule; a by-effect command's rule is its row in by-effect.ts. A name not here is `not-offered`, graded or not,
// so every command that crosses has had its input, its target and its effect read for remote use. O7, O8 and O9 add
// rows when they open remote surfaces, sharing and lane A control, each with its own tests.
//
// A registry command takes its grade from O1's declaration (`gradeOf`, `ungraded` when its namespace declares none) and
// its input is held to the registry's schema. Lane A's actions are sminos's RPC names, `sminos.<rpc>`, graded here
// (§G's table); the endpoint's own take no grade (`null`): the grant's or the state's own signatures are the authority.
import type { GradeSpec } from '@shared/ipc/grades';

/**
 * Where a request's session is read: `appSessionId` (lane B, mapped to the engine session through `session.status`),
 * `session` (lane A: the engine session id, `args.session` in an action, as DX6 has it), or none: the machine itself.
 */
export type TargetRule = 'appSessionId' | 'session' | 'machine';

/** Who runs an authorized request (M7 routes acts by it, M8 calls): a lane, the endpoint itself, or one of mawsd's hosts. */
export type OfferExecutor = 'engine-host' | 'sminos' | 'endpoint' | 'machine' | 'pty-host' | 'main';

export type OfferRow = {
  kind: 'call' | 'act';
  executor: OfferExecutor;
  target: TargetRule;
  /** The grade, for a name outside the registry; `null` for the endpoint's signed actions. Absent: the registry's. */
  grade?: GradeSpec | null;
};

/** The table, and the lanes a `sub` may name (M8: `full` or `cards` on either). */
export type Offers = { commands: Readonly<Record<string, OfferRow>>; subscriptions: readonly ('A' | 'B')[] };

const laneB = (kind: 'call' | 'act'): OfferRow => ({ kind, executor: 'engine-host', target: 'appSessionId' });
const laneA = (kind: 'call' | 'act', grade: GradeSpec): OfferRow => ({ kind, executor: 'sminos', target: 'session', grade });

export const OFFERS: Offers = {
  commands: {
    // Lane B's conversation, through the engine host's ledger (M7's `host.op`), and its reads (M8).
    'session.send': laneB('act'),
    'session.steer': laneB('act'),
    'session.interrupt': laneB('act'),
    'session.answer': laneB('act'),
    'session.queue.edit': laneB('act'),
    'session.queue.promote': laneB('act'),
    'session.queue.setPaused': laneB('act'),
    'session.status': laneB('call'),
    'session.events': laneB('call'),
    'session.pendingRequest': laneB('call'),
    'session.pendingItems': laneB('call'),
    'session.queue.list': laneB('call'),
    'session.catalog': laneB('call'),
    // Lane A's bridge-fenced RPCs and spawn, through RL10 (M6); `resume`, `retire` and `stop` run outside the bridge's
    // fence and are not offered.
    'sminos.steer': laneA('act', 'converse'),
    'sminos.interrupt': laneA('act', 'converse'),
    'sminos.answer': laneA('act', 'converse'),
    'sminos.model': laneA('act', 'converse'),
    'sminos.btw': laneA('act', 'converse'),
    'sminos.tell': laneA('act', 'converse'),
    'sminos.media': laneA('act', 'converse'),
    'sminos.stop-agent': laneA('act', 'converse'),
    'sminos.decide': laneA('act', 'approve'),
    'sminos.compact': laneA('act', 'manage'),
    'sminos.command': laneA('act', { floor: 'converse', byEffect: true }),
    'sminos.spawn': { kind: 'act', executor: 'sminos', target: 'machine', grade: 'spawn' },
    'sminos.rows': laneA('call', 'view'),
    'sminos.diff': laneA('call', 'view'),
    'sminos.output': laneA('call', 'view'),
    'sminos.read': laneA('call', 'view'),
    // The endpoint's own, and mawsd's content-free reads (O2 and O6 grade them `list`: `ungraded` until they land).
    'endpoint.grant': { kind: 'act', executor: 'endpoint', target: 'machine', grade: null },
    'endpoint.state': { kind: 'act', executor: 'endpoint', target: 'machine', grade: null },
    'endpoint.listings': { kind: 'call', executor: 'endpoint', target: 'machine', grade: 'list' },
    'daemon.status': { kind: 'call', executor: 'machine', target: 'machine' },
    'machine.identity': { kind: 'call', executor: 'machine', target: 'machine' },
  },
  subscriptions: ['A', 'B'],
};
