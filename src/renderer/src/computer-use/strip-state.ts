// The computer-use strip's state (the UX wave's U12a, Interfaces §E): what the line at the top of a session draws, from
// the session's computer-use calls (`reading.ts`) and the evidence that a withdrawn call's cell is over.
//
// | state       | drawn                                                   | entered                                         |
// | `absent`    | nothing                                                 | at mount; when `running` or `lingering` leaves  |
// | `running`   | a pulsing dot, "Computer use running", Stop             | a `js` call of the running turn in flight for   |
// |             |                                                         | COMPUTER_USE_SETTLE_MS without a break          |
// | `lingering` | a still dot, "Computer use may still be finishing a     | from `running`, when no `js` call is in flight  |
// |             | step", Dismiss                                          | and a call it showed was withdrawn              |
//
// `running` leaves to `absent` when the running turn ends or stops running, when no `js` call has been in flight for
// COMPUTER_USE_PAUSE_MS, or when a call of the turn waits for permission and none is in flight. `lingering` has no
// timer: the plugin never stops a cancelled cell, and a call's `timeout_ms` is a budget it suspends around approvals and
// a helper's start (and a queued call's starts later than its row), so the window cannot count when the cell ends. It
// leaves on evidence: a computer-use call that started after the withdrawn one has an ordinary result (the plugin runs
// calls one after another), the session's process is known gone, the session's status lists no connected computer-use
// server; or at Dismiss. Both timers are counted on this window's clock from what this window saw, never from a row's
// timestamp. What the strip remembers lives with the mounted pane: a pane mounted mid-call starts from what it sees.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BROWSER_AGENT_IDLE_MS } from '@shared/browser/tab';
import { waitsOnAnswer } from '@shared/attention/kinds';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import { useSessionControls } from '../session/controls/controls-for';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';
import { ticks, useTranscriptStore } from '../stores/transcript';
import type { TurnId } from '../transcript/model/rows';
import { readComputerUse, type ComputerUseReading } from './reading';

export const COMPUTER_USE_SETTLE_MS = 250; // a call that asks for permission first never flashes the line
export const COMPUTER_USE_PAUSE_MS = BROWSER_AGENT_IDLE_MS; // 10 s, the Browser's "Agent is browsing" interval

export type StripState = { kind: 'absent' } | { kind: 'running'; turnId: TurnId } | { kind: 'lingering'; toolUseId: ToolUseId };

export interface StripFacts {
  appSessionId: AppSessionId;
  reading: ComputerUseReading;
  processGone: boolean; // the transcript store says the session's process is not live
  serverGone: boolean; // the session's status lists no connected computer-use server
}

const ABSENT: StripState = { kind: 'absent' };
const same = (a: StripState, b: StripState) =>
  a.kind === b.kind && (a.kind !== 'running' || a.turnId === (b as typeof a).turnId) && (a.kind !== 'lingering' || a.toolUseId === (b as typeof a).toolUseId);

// The withdrawn call the line lingers for, and the turn it was read in.
interface Unresolved {
  toolUseId: ToolUseId;
  turn: TurnId | null;
}

/** The strip's state for one mounted pane, told each change of what it reads (`observe`) and re-read at its own timers. */
export class StripTracker {
  private state: StripState = ABSENT;
  private facts: StripFacts | null = null;
  private flightSince = new Map<ToolUseId, number>(); // when this window first saw each `js` call in flight, unbroken
  private quietSince: number | null = null; // when this window first saw no `js` call in flight while running
  private shown = new Set<ToolUseId>(); // the `js` calls in flight while the line read running
  private settled = new Set<ToolUseId>(); // withdrawn calls resolved, superseded or dismissed
  private unresolved: Unresolved | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  observe(facts: StripFacts): void {
    if (this.facts !== null && this.facts.appSessionId !== facts.appSessionId) this.forget();
    this.facts = facts;
    this.evaluate();
  }

  dismiss = (): void => {
    if (this.unresolved === null) return;
    this.settled.add(this.unresolved.toolUseId);
    this.unresolved = null;
    this.evaluate();
  };

  snapshot = (): StripState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Clears the timer; the next `observe` arms it again. */
  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private forget() {
    this.stop();
    this.flightSince = new Map();
    this.quietSince = null;
    this.shown = new Set();
    this.settled = new Set();
    this.unresolved = null;
    this.set(ABSENT);
  }

  private set(next: StripState) {
    if (same(this.state, next)) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private evaluate() {
    const facts = this.facts;
    if (facts === null) return;
    const now = Date.now();
    const { reading } = facts;
    const js = reading.calls.filter((call) => call.tool === 'js');
    const flying = reading.running ? js.filter((call) => call.state === 'flight') : [];
    const flyingIds = new Set(flying.map((call) => call.toolUseId));
    for (const id of this.flightSince.keys()) if (!flyingIds.has(id)) this.flightSince.delete(id);
    for (const id of flyingIds) if (!this.flightSince.has(id)) this.flightSince.set(id, now);

    // A call the line showed became withdrawn while the line was up: the latest such is unresolved, and it stands for
    // every earlier one (the plugin runs calls in order, so its cell ends after theirs).
    if (this.state.kind !== 'absent') {
      const withdrawn = js.filter((call) => call.state === 'withdrawn' && this.shown.has(call.toolUseId) && !this.settled.has(call.toolUseId));
      const latest = withdrawn.at(-1);
      if (latest !== undefined && latest.toolUseId !== this.unresolved?.toolUseId) {
        if (this.unresolved !== null) this.settled.add(this.unresolved.toolUseId);
        for (const call of withdrawn.slice(0, -1)) this.settled.add(call.toolUseId);
        this.unresolved = { toolUseId: latest.toolUseId, turn: reading.turn };
      }
    }
    if (this.unresolved !== null && (facts.processGone || facts.serverGone || laterResult(reading, this.unresolved))) {
      this.settled.add(this.unresolved.toolUseId);
      this.unresolved = null;
    }

    const next = this.next(now, reading, flying.length > 0, js.some((call) => call.state === 'waiting'));
    if (next.kind === 'running') for (const id of flyingIds) this.shown.add(id);
    this.quietSince = next.kind === 'running' && flying.length === 0 ? (this.quietSince ?? now) : null;
    this.set(next);
    this.arm(now);
  }

  private next(now: number, reading: ComputerUseReading, flying: boolean, waiting: boolean): StripState {
    const lingers: StripState = this.unresolved === null ? ABSENT : { kind: 'lingering', toolUseId: this.unresolved.toolUseId };
    if (this.state.kind === 'running') {
      if (flying && reading.turn !== null) return { kind: 'running', turnId: reading.turn };
      if (this.unresolved !== null) return lingers;
      if (!reading.running || reading.turn !== this.state.turnId || waiting) return ABSENT;
      if (this.quietSince !== null && now - this.quietSince >= COMPUTER_USE_PAUSE_MS) return ABSENT;
      return this.state;
    }
    const settledFlight = [...this.flightSince.values()].some((since) => now - since >= COMPUTER_USE_SETTLE_MS);
    if (settledFlight && reading.turn !== null) return { kind: 'running', turnId: reading.turn };
    return lingers;
  }

  // The next moment the state can change with nothing new read: a call's settling, or the end of the pause.
  private arm(now: number) {
    this.stop();
    let at: number | null = null;
    if (this.state.kind === 'running') {
      if (this.quietSince !== null) at = this.quietSince + COMPUTER_USE_PAUSE_MS;
    } else {
      for (const since of this.flightSince.values()) at = Math.min(at ?? Infinity, since + COMPUTER_USE_SETTLE_MS);
    }
    if (at !== null) this.timer = setTimeout(() => this.evaluate(), Math.max(0, at - now));
  }
}

// A computer-use call that started after the unresolved one has an ordinary result: later in its turn, or in a later turn.
function laterResult(reading: ComputerUseReading, unresolved: Unresolved): boolean {
  const at = reading.calls.findIndex((call) => call.toolUseId === unresolved.toolUseId);
  const later = at >= 0 ? reading.calls.slice(at + 1) : reading.turn !== unresolved.turn ? reading.calls : [];
  return later.some((call) => call.state === 'done');
}

// The tool-use ids of the session's permission requests that wait on an answer (root UC-1's predicate).
const waitingOf = (pending: readonly AttentionItem[]): ReadonlySet<ToolUseId> =>
  new Set(pending.flatMap((item) => (item.kind === 'permission' && waitsOnAnswer(item) && item.request.toolUseId !== null ? [item.request.toolUseId] : [])));

const COMPUTER_USE_SERVERS: readonly string[] = ['plugin:cua:cua_repl', 'cua_repl'];
// The session has a status, and it lists no connected computer-use server.
const serverGoneOf = (status: EngineSessionStatus | undefined): boolean =>
  status !== undefined && !status.mcpServers.some((server) => COMPUTER_USE_SERVERS.includes(server.name) && server.status === 'connected');

/** The strip's state for a session's full pane, and its Dismiss. */
export function useComputerUse(appSessionId: AppSessionId): { state: StripState; dismiss(): void } {
  const transcript = useTranscriptStore((s) => s.entries[appSessionId]?.state ?? null); // a session's main transcript is keyed by its id on every route
  const ticking = useTranscriptStore((s) => ticks(s, appSessionId));
  const atRest = useSessionControls(appSessionId)?.turn()?.running === false; // a terminal session's port says no turn runs
  const pending = useAttention((s) => selectPendingOf(s, appSessionId));
  const waiting = useMemo(() => waitingOf(pending), [pending]);
  const serverGone = useSessions((s) => serverGoneOf(s.engine.get(appSessionId)));
  const reading = useMemo(() => readComputerUse(transcript, waiting, ticking && !atRest), [transcript, waiting, ticking, atRest]);
  const [tracker] = useState(() => new StripTracker());
  useEffect(() => tracker.observe({ appSessionId, reading, processGone: !ticking, serverGone }), [tracker, appSessionId, reading, ticking, serverGone]);
  useEffect(() => () => tracker.stop(), [tracker]);
  const state = useSyncExternalStore(tracker.subscribe, tracker.snapshot);
  return { state, dismiss: tracker.dismiss };
}
