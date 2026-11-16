// The bridge's agents (UX wave U8d M2, decision 3; docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-subagents.md):
// which subagents a terminal session's bridge holds, and whether each runs, folded from the state stream as sminos's
// bridge child folds them (doperpowers `sminos/skills/sminos/scripts/sminos_bridge.py`, its `agent` event and its
// snapshot's `agents`). The snapshot replaces the map; an `agent` event merges every key but `type`, `phase` and `n`
// into the agent's record, `running` until its stop. One key more is dropped here, the event's time `t` (the child keeps
// it, its mod drops it): a time that differs on every event would make every event a change. Past 200 agents the
// oldest that no longer run are let go, as the child does. The derivation reads it (./jobs.ts `derive`).
import type { BridgeAgent } from '@shared/lane-a/agents';

const DROPPED = ['type', 'phase', 'n', 't'];
const KEPT = 200; // the child's AGENTS_KEPT

const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const kept = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => !DROPPED.includes(k)));

export class BridgeAgents {
  private agents: Map<string, BridgeAgent> | null = null; // null before the first snapshot
  private changes = 0;

  /** Grows by one at each change of what is held, and by nothing else. */
  get version(): number {
    return this.changes;
  }

  /** The state stream's snapshot: its `agents` replace the map (anything but an array is none). */
  snapshot(agents: unknown): void {
    const next = new Map<string, BridgeAgent>();
    for (const a of Array.isArray(agents) ? agents : []) {
      const r = record(a);
      if (typeof r?.agentId === 'string') next.set(r.agentId, kept(r) as BridgeAgent);
    }
    if (this.agents !== null && JSON.stringify([...this.agents.values()]) === JSON.stringify([...next.values()])) return;
    this.agents = next;
    this.changes += 1;
  }

  /** An `agent` event: whether the map changed. */
  event(e: Record<string, unknown>): boolean {
    const id = e.agentId;
    if (this.agents === null || typeof id !== 'string') return false;
    const before = this.agents.get(id);
    const next = { ...(before ?? { agentId: id }), ...kept(e), running: e.phase !== 'stop' } as BridgeAgent;
    if (before !== undefined && JSON.stringify(before) === JSON.stringify(next)) return false;
    this.agents.set(id, next);
    if (this.agents.size > KEPT) {
      const done = [...this.agents.values()].filter((a) => !a.running).map((a) => a.agentId);
      for (const gone of done.slice(0, this.agents.size - KEPT)) this.agents.delete(gone);
    }
    this.changes += 1;
    return true;
  }

  list(): readonly BridgeAgent[] | null {
    return this.agents === null ? null : [...this.agents.values()];
  }

  /** The bridge is gone (its process is taken as gone): nothing is held until a stream's snapshot again. */
  clear(): void {
    if (this.agents === null) return;
    this.agents = null;
    this.changes += 1;
  }
}
