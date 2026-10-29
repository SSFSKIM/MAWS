// DX5 to DX4 (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, Interfaces §B): one bridge subscription's
// events reshaped into the session-plane messages sminos's own plane makes of them (doperpowers
// `sminos/skills/sminos/scripts/sminos_plane.py`, `Sub.event`), so the renderer reads one lane A vocabulary whether the
// session is here or on another machine. Locally the transcript's rows come from MAWS's disk tail, so a snapshot carries
// only what the disk lacks: the streaming blocks and the usage, and the jobs main derives from that disk (./jobs.ts),
// which also go out as a `subagents` message whenever they change.
//
// Each subscription tracks its loops' open model requests by `(turnId, agentId, step)`, seeded from its snapshot's
// `streaming` (a watch opened mid-reply knows the step it never saw start): `step end` closes one, and `turn complete`
// closes every one of that turn still open, as the plane does, so an aborted turn leaves no streaming block behind.
//
// The envelope is DX4's. There is no sminos project locally (`project` is empty), `machine` is this machine's ref and
// `sub` the watch's id; the session-wide kinds (`raised`, `settled`, `op`, `compact`) carry `sub` and `n` null.
import type { Job } from 'desk-hub/protocol';
import type { LaneARaised, LaneASettled, PlaneMessage } from '@shared/ipc/schema/lane-a';

export interface PlaneContext {
  machine: string;
  session: string; // the engine session id
  sub: string; // the watch's id
}

type Event = Record<string, unknown>;
type Step = { turnId: unknown; agentId: unknown; step: unknown };

const stepKey = (s: Step) => JSON.stringify([s.turnId, s.agentId ?? null, s.step]);
const without = (e: Event, ...keys: string[]): Event => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k)));
const OP_OF: Record<string, 'command' | 'btw'> = { run: 'command', btw: 'btw' };

// DX5 `raised` (an event or a snapshot's pending entry) as DX4's: `session` set, the window's deadline as ISO-8601, no
// `agentId` for the main loop; `t`, the bridge's stamp, kept.
export function raisedOf(e: Event, session: string): LaneARaised {
  const { agentId, deadline } = e;
  return {
    ...without(e, 'type', 'n', 'agentId', 'deadline'),
    session,
    ...(typeof agentId === 'string' && agentId !== '' && { agentId }),
    ...(typeof deadline === 'number' && Number.isFinite(deadline) && { deadline: new Date(deadline).toISOString() }),
  } as LaneARaised;
}

export function settledOf(e: Event, session: string): LaneASettled {
  return { ...without(e, 'type', 'n'), session } as LaneASettled;
}

export class Reshaper {
  private readonly open = new Map<string, Step>();
  private n = 0;

  constructor(private readonly ctx: PlaneContext) {}

  // The subscription's snapshot line: one `snapshot` (n 0) carrying the session's jobs, then a `raised` per pending
  // request.
  snapshot(snap: Event, jobs: readonly Job[] = []): PlaneMessage[] {
    this.open.clear();
    this.n = 0;
    const streaming = Array.isArray(snap.streaming) ? (snap.streaming as Event[]) : [];
    for (const entry of streaming) this.open.set(stepKey(entry as Step), { turnId: entry.turnId, agentId: entry.agentId ?? null, step: entry.step });
    const pending = Array.isArray(snap.pending) ? (snap.pending as Event[]) : [];
    return [
      this.envelope('snapshot', { streaming, usage: snap.usage ?? null, jobs }, 0),
      ...pending.filter((p) => typeof p.request === 'string').map((p) => this.wide('raised', raisedOf(p, this.ctx.session))),
    ];
  }

  // One later event: its messages, or `discontinuity` when the bridge's stream lost events (the watch resubscribes).
  event(e: Event): PlaneMessage[] | 'discontinuity' {
    const { type, phase } = e;
    switch (type) {
      case 'chunk':
        this.opened(e);
        return [this.sub('chunk', { turnId: e.turnId, agentId: e.agentId ?? null, step: e.step, chunkIndex: e.chunkIndex, chunk: e.chunk, ...(typeof e.t === 'number' && { t: e.t }) })];
      case 'block-row':
        return [this.sub('block-row', { uuid: e.uuid, turnId: e.turnId, agentId: e.agentId ?? null, step: e.step, index: e.index })];
      case 'step':
        if (phase === 'start') this.opened(e);
        if (phase !== 'end') return [];
        this.open.delete(stepKey(e as Step));
        return [this.sub('step-end', { turnId: e.turnId, agentId: e.agentId ?? null, step: e.step })];
      case 'turn': {
        if (phase !== 'complete') return [];
        const cut = [...this.open.entries()].filter(([, s]) => s.turnId === e.turnId);
        for (const [key] of cut) this.open.delete(key);
        return cut.map(([, s]) => this.sub('step-end', { turnId: s.turnId, agentId: s.agentId ?? null, step: s.step }));
      }
      case 'usage':
        return [this.sub('usage', { context: e.context, cost: e.cost ?? null })];
      case 'catalog':
        return [this.sub('catalog', Object.fromEntries(['fingerprint', 'commands', 'skills', 'models', 'measured'].filter((k) => k in e).map((k) => [k, e[k]])))];
      case 'raised':
        return typeof e.request === 'string' ? [this.wide('raised', raisedOf(e, this.ctx.session))] : [];
      case 'settled':
        return typeof e.request === 'string' ? [this.wide('settled', settledOf(e, this.ctx.session))] : [];
      case 'run':
      case 'btw':
        return [this.wide('op', { ...without(e, 'type', 'n', 'rpc', 'child'), rpc: e.id ?? null, op: OP_OF[type], phase, id: e.id })];
      case 'media':
        return [this.wide('op', { ...without(e, 'type', 'n', 'rpc'), rpc: e.upload ?? null, op: 'media', phase, id: e.upload })];
      case 'compact':
        return [this.wide('compact', { rpc: e.id ?? null, phase, ...Object.fromEntries(['tokensBefore', 'tokensAfter', 'skip', 'error'].filter((k) => k in e).map((k) => [k, e[k]])) })];
      case 'gap':
      case 'resync':
      case 'snapshot':
        return 'discontinuity';
      default:
        return []; // model, delivered, heartbeat, agent, kept, result, command, session, row-seen: the state's or nobody's
    }
  }

  // The session's jobs, changed since this subscription last carried them: DX4's `subagents` body, with no agents and no
  // MCP servers (locally those are read from MAWS's own sources).
  jobs(jobs: readonly Job[]): PlaneMessage {
    return this.sub('subagents', { subagents: [], jobs, mcp: [] });
  }

  private opened(e: Event): void {
    const key = stepKey(e as Step);
    if (!this.open.has(key)) this.open.set(key, { turnId: e.turnId, agentId: e.agentId ?? null, step: e.step });
  }

  private envelope(kind: string, body: unknown, n: number | null, sub: string | null = this.ctx.sub): PlaneMessage {
    return { project: '', machine: this.ctx.machine, session: this.ctx.session, kind, sub, n, body };
  }

  private sub(kind: string, body: unknown): PlaneMessage {
    this.n += 1;
    return this.envelope(kind, body, this.n);
  }

  private wide(kind: string, body: unknown): PlaneMessage {
    return this.envelope(kind, body, null, null);
  }
}
