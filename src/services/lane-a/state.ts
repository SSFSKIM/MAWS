// A bridged session's state (P5 O9 M2, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, "State" and Interfaces §A):
// what its bridge can do, from `GET /status`, and what the session is doing, folded from its state stream (the snapshot,
// then the events). Only `live` drives controls.
import type { LaneACatalog, LaneAMode, LaneARaised, LaneASettled, LaneAState } from '@shared/ipc/schema/lane-a';
import { controlsMissingReason } from '@shared/lane-a/bridge';
import { modeOf, sameMode } from '@shared/lane-a/mode';
import { raisedOf, settledOf } from './reshape';

type Event = Record<string, unknown>;
export type BridgeState = Pick<LaneAState, 'bridge' | 'reason'>;

const OBSERVER_REASON = 'MAWS controls this session'; // the bridge's own word for an observer's refusal
const UNRESOLVED_REASON = 'the bridge is still deciding whether MAWS controls this session';
const SETTLED_KEPT = 100;

const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

// The bridge observes for a MAWS lane B session until its lane verdict is `mismatch` (`sminos_bridge.py` `observing`); a
// foreign holder is never MAWS's lane B, but the state guards it anyway. An `unresolved` verdict is still being decided:
// the bridge retries it (`settle_lane`) and a resolved one reaches its subscribers as a resync, so it is `starting`, its
// state stream held open, until then. A sminos older than 1.11.0 (MW1) says no `controls`, so nothing it would do can be
// drawn from its capabilities.
export function classify(status: Record<string, unknown>): BridgeState {
  if (status.lane === 'unresolved') return { bridge: 'starting', reason: UNRESOLVED_REASON };
  if (typeof status.lane === 'string' && status.lane !== 'mismatch') return { bridge: 'observer', reason: OBSERVER_REASON };
  if (status.ready !== true) return { bridge: 'starting', reason: 'the session’s bridge is starting' };
  const capabilities = record(status.capabilities);
  if (!record(capabilities?.controls)) return { bridge: 'none', reason: controlsMissingReason(capabilities?.sminos) };
  return { bridge: 'live', reason: null };
}

export type FoldView = Pick<LaneAState, 'turn' | 'model' | 'effort' | 'override' | 'mode' | 'catalog' | 'pending' | 'settled'>;
// The main loop's latest tool call of its running turn (P5 O9 M6: the digest's activity): `running` until its result.
export type MainTool = { tool: string; input: unknown; running: boolean };

export class SessionFold {
  private mainTurns = new Set<string>();
  private unknown = false;
  private model: string | null = null; // the session's as it started (the snapshot's `sessionInfo`, a session's start)
  // What the main loop's latest request ran on (its `step start`, the bridge's override applied): the only word of a
  // `/model` or `/effort` typed in the terminal, which no event of its own reports. Kept across a fresh stream's
  // snapshot, whose `sessionInfo` the bridge read when it loaded.
  private ran: { model: string; effort: string | null } | null = null;
  private override: LaneAState['override'] = null;
  // The mode the session last reported, as the latest heartbeat says it (sminos 1.27.14): kept across a fresh stream's
  // snapshot, which carries none, until the next heartbeat (5 s) says it again or says none.
  private mode: LaneAMode | null = null;
  private catalog: LaneACatalog | null = null;
  private pending = new Map<string, LaneARaised>();
  private settled = new Map<string, LaneASettled>();
  private tool: (MainTool & { toolUseId: unknown }) | null = null;

  constructor(private readonly session: string) {}

  snapshot(snap: Event): void {
    this.mainTurns = new Set(((snap.turns as Event[] | undefined) ?? []).filter((t) => (t.agentId ?? null) === null).map((t) => String(t.turnId)));
    const info = record(snap.sessionInfo);
    if (typeof info?.model === 'string') this.model = info.model;
    this.override = overrideOf(snap.override);
    this.tool = null;
    const catalog = record(snap.catalog);
    this.catalog = catalog && typeof catalog.fingerprint === 'string' ? (catalog as LaneACatalog) : null;
    this.pending = new Map(((snap.pending as Event[] | undefined) ?? []).filter((p) => typeof p.request === 'string').map((p) => [String(p.request), raisedOf(p, this.session)]));
    this.settled = new Map();
    for (const s of (snap.settled as Event[] | undefined) ?? []) if (typeof s.request === 'string') this.remember(settledOf(s, this.session));
  }

  // One event; whether the state changed. A main-loop tool call or result moves only `mainTool()`, which the state leaves
  // out, so it answers false.
  event(e: Event): boolean {
    const { type, phase } = e;
    const main = (e.agentId ?? null) === null;
    if (type === 'turn' && main && phase === 'start') {
      this.mainTurns.add(String(e.turnId));
      this.unknown = false;
      this.tool = null;
      return true;
    }
    if (type === 'turn' && main && phase === 'complete') {
      this.mainTurns.delete(String(e.turnId));
      this.unknown = false;
      this.tool = null;
      return true;
    }
    if (type === 'tool' && main && typeof e.tool === 'string') {
      if (phase === 'call') this.tool = { toolUseId: e.toolUseId ?? null, tool: e.tool, input: e.input ?? null, running: true };
      else if (phase === 'result' && this.tool !== null && this.tool.toolUseId === (e.toolUseId ?? null)) this.tool = { ...this.tool, running: false };
      return false;
    }
    if (type === 'heartbeat') {
      const state = record(e.state);
      if (!state) return false;
      const running = typeof state.mainTurn === 'string';
      const unknown = state.isTurnUnknown === true;
      const mode = modeOf(state);
      const turn = running !== this.mainTurns.size > 0 || unknown !== this.unknown;
      if (!turn && sameMode(mode, this.mode)) return false;
      if (turn) {
        this.mainTurns = running ? new Set([String(state.mainTurn)]) : new Set();
        this.unknown = unknown;
      }
      this.mode = mode;
      return true;
    }
    if (type === 'raised' && typeof e.request === 'string') {
      this.pending.set(e.request, raisedOf(e, this.session));
      return true;
    }
    if (type === 'settled' && typeof e.request === 'string') {
      this.pending.delete(e.request);
      this.remember(settledOf(e, this.session));
      return true;
    }
    if (type === 'model') {
      this.override = overrideOf(e);
      return true;
    }
    if (type === 'catalog' && typeof e.fingerprint === 'string') {
      this.catalog = Object.fromEntries(['fingerprint', 'commands', 'skills', 'models', 'measured'].filter((k) => k in e).map((k) => [k, e[k]])) as LaneACatalog;
      return true;
    }
    if (type === 'step' && main && phase === 'start' && typeof e.model === 'string') {
      const effort = typeof e.effort === 'string' ? e.effort : null;
      if (this.ran?.model === e.model && this.ran.effort === effort) return false;
      this.ran = { model: e.model, effort };
      return true;
    }
    if (type === 'session' && phase === 'start' && typeof e.model === 'string') {
      this.model = e.model;
      this.ran = null;
      return true;
    }
    return false;
  }

  view(): FoldView {
    return {
      turn: { running: this.mainTurns.size > 0, unknown: this.unknown },
      model: this.ran?.model ?? this.model,
      effort: this.ran?.effort ?? null,
      override: this.override,
      mode: this.mode,
      catalog: this.catalog === null ? null : { fingerprint: this.catalog.fingerprint },
      pending: [...this.pending.values()],
      settled: [...this.settled.values()],
    };
  }

  mainTool(): MainTool | null {
    if (this.tool === null || this.mainTurns.size === 0) return null;
    const { tool, input, running } = this.tool;
    return { tool, input, running };
  }

  catalogBody(): LaneACatalog | null {
    return this.catalog;
  }

  raised(request: string): LaneARaised | null {
    return this.pending.get(request) ?? null;
  }

  settledOf(request: string): LaneASettled | null {
    return this.settled.get(request) ?? null;
  }

  private remember(s: LaneASettled): void {
    this.settled.delete(s.request);
    this.settled.set(s.request, s);
    while (this.settled.size > SETTLED_KEPT) this.settled.delete(this.settled.keys().next().value as string);
  }
}

function overrideOf(value: unknown): LaneAState['override'] {
  const o = record(value);
  if (!o) return null;
  const model = typeof o.model === 'string' ? o.model : null;
  const effort = typeof o.effort === 'string' ? o.effort : null;
  return model === null && effort === null ? null : { model, effort };
}
