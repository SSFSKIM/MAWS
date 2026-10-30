// One enrolled machine's name, as the hub counts its connections: the one generation counter of the name, the
// revocation fence of its credentials, and the address its projects reach the machine by. DX2's stream, which this
// object held until desk phase 1's routes left the hub (P5 O14 M5b), is gone; a machine connects over RL1 alone, and
// its RL1 sockets are held by another object of this class, addressed by the machine's ref (relay.ts).
//
// An RL1 connection draws its generation here (`claimGeneration`), which ends an older RL1 connection under another ref.
// The machine's projects reach it through this object (`send`, `close`), and a revocation arrives here (`revoke`): each
// goes on to the ref's object while an RL1 connection holds the newest generation (`kv` `rl1`). A supersession or a
// revocation is a fence the ref's object must hold, so it is kept here (`kv` `rl1-owed`) and sent again, by the alarm,
// until that object takes it. The org state's notices reach the ref's object from the Registry.
//
// A revocation is a fence: the revoked credential's client id is kept, and a request carrying it is refused here, so
// one the Worker admitted before the revocation and delivered after it opens nothing, and the name enrolled again (a
// new credential) is served.
import { DurableObject } from 'cloudflare:workers';
import { CLIENT_HEADER, heartbeatMs, type Env } from '../env';
import { LEASE_PERIODS, type DownFrame } from '../protocol/machine';
import { described } from './project';
import { Relay, relayObjectName } from './relay';
import { lacksMethod, RETRY_ATTEMPTS, RETRY_BASE_MS, RETRY_CAP_MS, retryDelay } from './retry';

/** How often an RL1 connection's heartbeat goes, how long a renewal keeps the machine online, and how long a closed
 * connection's lease holds the machine online for its next connection to take over. */
export type Timing = { heartbeatMs: number; leaseMs: number; graceMs: number };

const json = (status: number, body: unknown) => Response.json(body, { status });

const revokedKey = (clientId: string) => `revoked:${clientId}`;

/** The RL1 connection that holds the machine's newest generation: its ref's object, its name as this object knows it,
 * and the credential it opened with. */
type Rl1Claim = { org: string; name: string; ref: string; generation: number; client: string };
const RL1_KEY = 'rl1';
/** Each credential's newest RL1 claim, by its client id: a revocation fences the revoked credential's connections in
 * their ref's object even while another credential holds the newest claim, which it leaves alone. */
const RL1_CLAIMS_KEY = 'rl1-claims';

/** What a write to the machine became: a session-plane frame for an RL1 connection is `not-on-rl1` (relay.ts). */
export type Sent = 'written' | 'offline' | 'not-on-rl1';

/** A fence owed to a ref's object, sent until it is taken: `due` is the next try, a minute ahead while one is in flight. */
type Owed = { op: 'supersede' | 'revoke'; org: string; ref: string; name: string; generation: number; attempts: number; due: number };
const OWED_KEY = 'rl1-owed';
const sameOwed = (a: Owed, b: Owed) => a.op === b.op && a.ref === b.ref && a.name === b.name && a.generation === b.generation;

/** One log line of a connection's fences (`wrangler tail`, or the Worker's logs once observability is on). */
function note(line: Record<string, unknown>): void {
  console.log(JSON.stringify({ desk: 'machine-stream', ...line }));
}

export class Machine extends DurableObject<Env> {
  private relayInstance: Relay | undefined;

  /** The RL1 sockets, in the object addressed by the machine's ref; made on first use, so a name's object never makes
   * it. */
  private get relay(): Relay {
    return (this.relayInstance ??= new Relay(this.ctx, this.env, () => this.timing()));
  }

  async fetch(request: Request): Promise<Response> {
    if (this.ctx.storage.kv.get(revokedKey(request.headers.get(CLIENT_HEADER) ?? ''))) {
      return json(403, { error: 'not-enrolled', message: 'this credential was revoked' });
    }
    const url = new URL(request.url);
    if (url.pathname === '/socket' && request.method === 'GET') return this.relay.endpoint(request);
    if (url.pathname === '/app' && request.method === 'GET') return this.relay.app(request);
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.relay.message(ws, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.relay.closed(ws, code, reason);
  }

  /** A failed socket has no close to answer. */
  async webSocketError(ws: WebSocket): Promise<void> {
    this.relay.closed(ws);
  }

  /** Writes a frame to the machine's RL1 connection when it holds the newest generation; "offline" when none does, or
   * when `generation` names an older one (a project's frame for a connection the machine has since replaced). */
  async send(frame: DownFrame, generation?: number): Promise<Sent> {
    const rl1 = this.rl1();
    if (rl1 && (generation === undefined || generation === rl1.generation)) return this.relayOf(rl1).relaySend(rl1.name, rl1.generation, frame);
    return 'offline';
  }

  // ---- RL1: the generation and the fence for the ref's object (relay.ts) ----------------------------------------

  /** An RL1 connection of the machine opens: the next generation, which ends any older RL1 connection; refused for a
   * revoked credential. */
  async claimGeneration(org: string, name: string, ref: string, client: string): Promise<{ generation: number } | { refused: 'revoked' }> {
    if (this.ctx.storage.kv.get(revokedKey(client))) return { refused: 'revoked' };
    const generation = (this.ctx.storage.kv.get<number>('generation') ?? 0) + 1;
    this.ctx.storage.kv.put('generation', generation);
    const before = this.rl1();
    const claim: Rl1Claim = { org, name, ref, generation, client };
    this.ctx.storage.kv.put(RL1_KEY, claim);
    this.ctx.storage.kv.put(RL1_CLAIMS_KEY, { ...this.claims(), [client]: claim });
    // A connection under another ref (the machine enrolled again with a new one) ends; the same ref's object ends its
    // own older connection as it installs the new one.
    if (before && before.ref !== ref) void this.owe('supersede', before, generation);
    note({ event: 'claim', ref, generation });
    return { generation };
  }

  /** Whether the RL1 connection of `generation` still holds the machine's newest generation (`current`), was replaced
   * by a newer connection, or carries a revoked credential: its object asks at each heartbeat, so a
   * replacement or a revocation it was not told of ends it within one. */
  rl1Check(ref: string, generation: number, client: string): 'current' | 'replaced' | 'revoked' {
    if (this.ctx.storage.kv.get(revokedKey(client))) return 'revoked';
    const rl1 = this.rl1();
    return rl1?.ref === ref && rl1.generation === generation ? 'current' : 'replaced';
  }

  private rl1(): Rl1Claim | undefined {
    return this.ctx.storage.kv.get<Rl1Claim>(RL1_KEY);
  }

  private claims(): Record<string, Rl1Claim> {
    return this.ctx.storage.kv.get<Record<string, Rl1Claim>>(RL1_CLAIMS_KEY) ?? {};
  }

  private relayOf(claim: { org: string; ref: string }): DurableObjectStub<Machine> {
    return this.env.MACHINE.get(this.env.MACHINE.idFromName(relayObjectName(claim.org, claim.ref)));
  }

  /**
   * Fences the RL1 connections of `claim`'s name up to `generation` in its ref's object: superseded (a newer generation
   * was taken) or revoked. Kept until that object takes it, and tried now; a try that fails is tried again by the
   * alarm, its wait growing as retry.ts's does, up to a minute, for as long as it takes: a fence the ref's object never
   * holds leaves a connection carrying channels, or a claim granted before it installing after it.
   */
  private async owe(op: Owed['op'], claim: Rl1Claim, generation: number): Promise<void> {
    const owed: Owed = { op, org: claim.org, ref: claim.ref, name: claim.name, generation, attempts: 0, due: Date.now() + RETRY_CAP_MS };
    this.ctx.storage.kv.put(OWED_KEY, [...this.owed().filter((o) => !sameOwed(o, owed)), owed]);
    await this.scheduleOwed();
    await this.deliver(owed);
  }

  private owed(): Owed[] {
    return this.ctx.storage.kv.get<Owed[]>(OWED_KEY) ?? [];
  }

  private async deliver(owed: Owed): Promise<void> {
    const method = owed.op === 'revoke' ? 'relayRevoke' : 'relaySupersede';
    let failure: { error: unknown } | null = null;
    try {
      await this.relayOf(owed)[method](owed.name, owed.generation);
    } catch (error) {
      // A ref's object on the code before the fence holds no RL1 socket the fence could reach.
      if (!lacksMethod(error, method)) failure = { error };
    }
    const rest = this.owed().filter((o) => !sameOwed(o, owed));
    if (failure === null) {
      this.ctx.storage.kv.put(OWED_KEY, rest);
      return;
    }
    const attempts = (this.owed().find((o) => sameOwed(o, owed))?.attempts ?? owed.attempts) + 1;
    const wait = retryDelay(Math.min(attempts, RETRY_ATTEMPTS), RETRY_BASE_MS, failure.error);
    note({ event: 'fence-failed', op: owed.op, ref: owed.ref, generation: owed.generation, attempt: attempts, error: described(failure.error), retry_ms: Math.round(wait) });
    this.ctx.storage.kv.put(OWED_KEY, [...rest, { ...owed, attempts, due: Date.now() + wait }]);
    await this.scheduleOwed();
  }

  /** The alarm at the soonest owed fence's time, or none. */
  private async scheduleOwed(): Promise<void> {
    const owed = this.owed();
    if (owed.length === 0) return;
    const at = Math.min(...owed.map((o) => o.due));
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current <= Date.now()) await this.ctx.storage.setAlarm(at);
  }

  /** Sends again every owed fence whose time has come; one in flight waits a minute before it is sent again, unless its
   * answer says otherwise first. */
  async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.owed().filter((o) => o.due <= now);
    this.ctx.storage.kv.put(OWED_KEY, this.owed().map((o) => (o.due <= now ? { ...o, due: now + RETRY_CAP_MS } : o)));
    await this.scheduleOwed();
    await Promise.all(due.map((o) => this.deliver({ ...o, due: now + RETRY_CAP_MS })));
  }

  // ---- RL1: the ref's object's own calls, from the object above, and from the Registry ---------------------------

  relaySend(name: string, generation: number, frame: DownFrame): Sent {
    return this.relay.relaySend(name, generation, frame);
  }

  relayClose(name: string, generation: number): void {
    this.relay.relayClose(name, generation);
  }

  relaySupersede(name: string, generation: number): void {
    this.relay.relaySupersede(name, generation);
  }

  relayRevoke(name: string, generation: number): void {
    this.relay.relayRevoke(name, generation);
  }

  relayState(version: number, members: string[]): void {
    this.relay.relayState(version, members);
  }

  /** Ends the RL1 connection of this generation, if it is still the current one (a project could not deliver to it). */
  async close(generation: number): Promise<void> {
    const rl1 = this.rl1();
    if (rl1?.generation === generation) await this.relayOf(rl1).relayClose(rl1.name, generation);
  }

  /** The machine was revoked: a request with the revoked credential is refused from here on, one the Worker admitted
   * before the revocation included. Answers the newest generation it had drawn, which its projects stop counting it
   * through. */
  async revoke(clientId: string | null): Promise<number> {
    if (clientId) this.ctx.storage.kv.put(revokedKey(clientId), true);
    const rl1 = this.rl1();
    if (rl1 && (clientId === null || rl1.client === clientId)) this.ctx.storage.kv.delete(RL1_KEY);
    // The revoked credential's RL1 connections end, up to its newest claim, whether or not another credential's claim
    // followed it, and a claim of it still in flight is refused when it arrives; until the ref's object takes the fence,
    // its heartbeats find the credential revoked here too (`rl1Check`). A newer credential's claim stays above it.
    const claims = this.claims();
    const revoked = clientId === null ? Object.values(claims) : claims[clientId] ? [claims[clientId]] : [];
    if (revoked.length > 0) {
      this.ctx.storage.kv.put(RL1_CLAIMS_KEY, Object.fromEntries(Object.entries(claims).filter(([client]) => clientId !== null && client !== clientId)));
      await Promise.all(revoked.map((claim) => this.owe('revoke', claim, claim.generation)));
    }
    return this.ctx.storage.kv.get<number>('generation') ?? 0;
  }

  /** The configured heartbeat (15 s deployed; shorter under the local command), a lease of LEASE_PERIODS of it, and a
   * closed connection's grace of one heartbeat; the suites' Worker sets them per machine
   * (test/support/worker-under-test.ts). */
  protected timing(): Timing {
    const heartbeat = heartbeatMs(this.env);
    return { heartbeatMs: heartbeat, leaseMs: LEASE_PERIODS * heartbeat, graceMs: heartbeat };
  }
}
