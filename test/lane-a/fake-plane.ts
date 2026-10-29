// sminos's session plane and RPC ledger on RL10, for remote lane A's suite (P5 O9 M9): over O10's fake sminos connection
// (test/endpoint/rl10/fake-sminos.ts), the side of sminos the endpoint talks to, answering on its own:
//   - each upstream `subscribe` with its session's snapshot at n 0, numbering what it sends on it from 1 (`emit`);
//     session-wide messages (`wide`, `raise`, `settle`) go outside any subscription;
//   - `rows`, `read`, `diff` and `output` on the subscription that asked;
//   - `query` and `tombstone` from its ledger by opId, and each `rpc` once per opId: a copy of an op it holds is answered
//     from the ledger under the copy's nonce, never run again (`runs` holds the effects).
// Handlers are scripted per RPC name and may be held (`hold`). A session's bridge steps (`step`) go through the fake
// machine's own DX4 producer (desk-hub's `SessionDepth`), so its snapshots' `streaming` and its step-ends are sminos's.
import { toWire, type SessionMessage } from 'desk-hub/protocol';
import type { Step } from '../../apps/desk-hub/fake-machine/recording';
import { SessionDepth } from '../../apps/desk-hub/fake-machine/session';
import { LINE_LIMIT } from '../../src/endpoint/rl10/server';
import { CHECKOUT, plane, PROJECT } from '../endpoint/sub-harness';
import type { FakeSminos, Frame } from '../endpoint/rl10/fake-sminos';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Outcome ={ state: 'done'; result: unknown } | { state: 'failed'; error: { code: string; message?: string } } | { state: 'refused'; reason: string };
type Entry = { rpc: string; state: 'in-progress' | 'done'; outcome?: Outcome; member: string; device: string; fingerprint: string; nonce: string; session: string };
export type Rpc = { rpc: string; opId: string; nonce: string; args: Record<string, unknown>; context?: unknown; member: string; device: string; fingerprint: string };

export const CONTROLS = Object.fromEntries(
  ['read.usage', 'read.config', 'read.settings', 'read.mcp', 'btw', 'compact', 'model', 'mcp.enable', 'mcp.disable', 'mcp.reconnect', 'decide', 'decide.scope', 'decide.interrupt', 'decide.addDirectory', 'stop-agent', 'tell', 'media', 'forget', 'rewind-files', 'elicitation.answer'].map((key) => [
    key,
    ['decide.interrupt', 'forget', 'rewind-files', 'elicitation.answer'].includes(key) ? { available: false, reason: `${key} is the terminal’s` } : { available: true },
  ]),
);
export const CAPABILITIES = {
  sminos: '1.27.12',
  protocol: 1,
  engine: '2.1.312',
  ops: ['deliver', 'interrupt', 'model', 'command', 'btw', 'compact', 'stop-agent', 'tell', 'read', 'stop', 'media'],
  reads: ['status', 'mcp', 'usage', 'config', 'settings'],
  routes: { measured: '2.1.300' },
  controls: CONTROLS,
};
export const STATUS_READ = { version: { version: '2.1.312' }, model: 'claude-opus-4-5', cwd: CHECKOUT, root: CHECKOUT, repo: null, surfaces: [], override: { model: null, effort: 'high' } };

export class FakePlane {
  readonly rpcs: Rpc[] = [];
  readonly runs: Rpc[] = [];
  readonly frames: Frame[] = [];
  readonly presence = new Map<string, Record<string, unknown>>();
  readonly catalog = { fingerprint: 'cat-1', commands: [{ name: 'rename', route: { class: 'run' } }], models: { options: [{ value: 'opus' }, { value: 'haiku' }] } };
  readonly #ledger = new Map<string, Entry>();
  readonly #tombstoned = new Set<string>();
  readonly #upstream = new Map<string, { session: string; n: number }>();
  readonly #depths = new Map<string, SessionDepth>();
  readonly #handlers = new Map<string, (rpc: Rpc) => Outcome | Promise<Outcome>>();
  readonly #held = new Map<string, Array<() => void>>();
  readonly #holding = new Set<string>();
  #seen = 0;
  #timer: ReturnType<typeof setInterval>;

  constructor(readonly s: FakeSminos) {
    this.#timer = setInterval(() => this.#pump(), 2);
  }

  close(): void {
    clearInterval(this.#timer);
  }

  presenceOf(session: string): Record<string, unknown> {
    return this.presence.get(session) ?? { record: { status: 'idle' }, bridge: true, capabilities: CAPABILITIES, launch: ({ 'la-b': 'LB', 'la-v': 'LV' } as Record<string, string>)[session] ?? 'L1' };
  }

  /** The upstream subscriptions open on `session`: their epochs. */
  upstreams(session = 'la-1'): string[] {
    return [...this.#upstream.entries()].filter(([, u]) => u.session === session).map(([epoch]) => epoch);
  }

  /** A message on every upstream subscription of `session`, numbered; returns the numbers it took. */
  emit(kind: string, body: unknown, session = 'la-1'): number[] {
    return [...this.#upstream].filter(([, u]) => u.session === session).map(([sub, u]) => this.#numbered(sub, u, kind, body));
  }

  /** One step of the session's bridge stream, played through the fake machine's `SessionDepth` (desk-hub's DX4 producer):
   * what it sends each subscription goes up that upstream, so a step-end carries its `t` and what that subscription knew
   * of the step's start (its model and effort seen live, else the snapshot entry's model alone), as sminos's plane does. */
  step(step: DistributiveOmit<Step, 'at'>, session = 'la-1'): void {
    this.#depth(session).apply({ at: 0, ...step } as Step);
  }

  #depth(session: string): SessionDepth {
    let depth = this.#depths.get(session);
    if (depth === undefined) {
      depth = new SessionDepth(session, null, (m) => this.#fromDepth(m), { project: PROJECT, machine: 'mini' });
      this.#depths.set(session, depth);
    }
    return depth;
  }

  /** The depth's message to one subscription: its snapshot lends the streaming entries to this fake's own; anything else
   * goes up that upstream while it is open, numbered with the rest. */
  #fromDepth(m: SessionMessage): void {
    if (m.sub === null) return;
    const u = this.#upstream.get(m.sub);
    if (u === undefined || m.kind === 'end') return;
    if (m.kind === 'snapshot') {
      this.s.send(plane('snapshot', { rows: [{ uuid: 'r1' }], more: true, subagents: [], presence: this.presenceOf(u.session), streaming: m.body.streaming, catalog: this.catalog }, { session: u.session, sub: m.sub, n: 0 }));
      return;
    }
    this.#numbered(m.sub, u, m.kind, m.body);
  }

  #numbered(sub: string, u: { session: string; n: number }, kind: string, body: unknown): number {
    u.n += 1;
    // A frame past RL10's line limit goes as parts, as sminos's uplink sends it.
    for (const line of toWire(plane(kind, body, { session: u.session, sub, n: u.n }), LINE_LIMIT)) this.s.send(JSON.parse(line) as object);
    return u.n;
  }

  /** A session-wide message (outside any subscription). */
  wide(kind: string, body: unknown, session = 'la-1'): void {
    this.s.send(plane(kind, body, { session, sub: null, n: null }));
  }

  raise(raised: Record<string, unknown>, session = 'la-1'): void {
    this.wide('raised', { session, mac: 'm', ...raised }, session);
  }

  settle(request: string, winner: 'terminal' | 'web' | 'other', outcome: string, session = 'la-1'): void {
    this.wide('settled', { request, winner, outcome, by: winner === 'terminal' ? 'terminal' : 'm', mac: 'm' }, session);
  }

  /** sminos ends an upstream subscription (the session ended, a discontinuity). */
  end(sub: string, reason: string): void {
    const u = this.#upstream.get(sub);
    if (u === undefined) return;
    this.#upstream.delete(sub);
    this.#depths.get(u.session)?.end(sub, 'session-ended');
    this.s.send(plane('end', { reason }, { session: u.session, sub, n: u.n + 1 }));
  }

  handle(rpc: string, handler: (rpc: Rpc) => Outcome | Promise<Outcome>): void {
    this.#handlers.set(rpc, handler);
  }

  /** Holds every `rpc`'s result until `release(rpc)`. */
  hold(rpc: string): void {
    this.#holding.add(rpc);
  }

  release(rpc: string): void {
    this.#holding.delete(rpc);
    for (const go of this.#held.get(rpc) ?? []) go();
    this.#held.delete(rpc);
  }

  of(rpc: string): Rpc[] {
    return this.rpcs.filter((r) => r.rpc === rpc);
  }

  #pump(): void {
    while (this.#seen < this.s.received.length) {
      const frame = this.s.received[this.#seen++];
      this.frames.push(frame);
      void this.#frame(frame);
    }
  }

  async #frame(f: Frame): Promise<void> {
    const sub = typeof f.sub === 'string' ? f.sub : '';
    const session = typeof f.session === 'string' ? f.session : '';
    switch (f.t) {
      case 'subscribe':
        this.#upstream.set(sub, { session, n: 0 });
        return this.#depth(session).subscribe(sub, null); // its snapshot, then its live part (#fromDepth)
      case 'unsubscribe': {
        const u = this.#upstream.get(sub);
        this.#upstream.delete(sub);
        if (u !== undefined) this.#depths.get(u.session)?.end(sub, 'unsubscribed');
        return;
      }
      case 'rows':
        return this.#on(sub, 'rows', { rows: [{ uuid: `older-${String(f.before)}` }], before: f.before, more: false });
      case 'diff':
        return this.#on(sub, 'diff', { base: 'main', text: '' });
      case 'output':
        return this.#on(sub, 'output', { taskId: f.taskId, result: 'unknown-task' });
      case 'read':
        return this.#on(sub, 'read', f.what === 'status' ? { id: f.id, what: f.what, result: STATUS_READ } : { id: f.id, what: f.what, result: { servers: [{ name: 'github', status: 'connected' }] } });
      case 'query': {
        const held = this.#ledger.get(String(f.opId));
        if (held === undefined) return this.s.send({ t: 'queried', opId: f.opId, state: 'not-received' });
        return this.s.send({ t: 'queried', opId: f.opId, state: held.state, ...(held.outcome === undefined ? {} : { outcome: held.outcome }), member: held.member, device: held.device, fingerprint: held.fingerprint, target: { kind: 'session', session: held.session } });
      }
      case 'tombstone':
        this.#tombstoned.add(String(f.opId));
        return this.s.send({ t: 'tombstoned', opId: f.opId, ok: true });
      case 'rpc':
        return this.#rpc(f.rpc as Rpc & { project: string });
      default:
        return;
    }
  }

  #on(sub: string, kind: string, body: unknown): void {
    const u = this.#upstream.get(sub);
    if (u === undefined) return;
    u.n += 1;
    this.s.send(plane(kind, body, { session: u.session, sub, n: u.n }));
  }

  async #rpc(rpc: Rpc & { project: string }): Promise<void> {
    this.rpcs.push(rpc);
    const result = (outcome: Outcome, nonce: string) => this.s.send({ t: 'rpc-result', project: PROJECT, opId: rpc.opId, nonce, outcome });
    if (this.#tombstoned.has(rpc.opId)) return result({ state: 'refused', reason: 'tombstoned' }, rpc.nonce);
    const held = this.#ledger.get(rpc.opId);
    if (held !== undefined) {
      held.nonce = rpc.nonce; // answered under the latest copy's nonce
      if (held.state === 'done') result(held.outcome!, rpc.nonce);
      return;
    }
    const entry: Entry = { rpc: rpc.rpc, state: 'in-progress', member: rpc.member, device: rpc.device, fingerprint: rpc.fingerprint, nonce: rpc.nonce, session: String(rpc.args.session) };
    this.#ledger.set(rpc.opId, entry);
    this.runs.push(rpc);
    const handler = this.#handlers.get(rpc.rpc) ?? ((r: Rpc) => (r.rpc === 'send' ? { state: 'done' as const, result: { entered: true, uuid: `row-${this.runs.length}` } } : { state: 'done' as const, result: {} }));
    if (this.#holding.has(rpc.rpc)) await new Promise<void>((resolve) => this.#held.set(rpc.rpc, [...(this.#held.get(rpc.rpc) ?? []), resolve]));
    const outcome = await handler(rpc);
    entry.state = 'done';
    entry.outcome = outcome;
    result(outcome, entry.nonce);
  }
}
