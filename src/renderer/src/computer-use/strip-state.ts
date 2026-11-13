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
// leaves on evidence: a computer-use call that started after the withdrawn one has an ordinary result (`done`: the
// plugin runs calls one after another, and an error result may be its answer before it queued a cell), the session's
// process is known to have exited, the session's status lists no connected computer-use server; or at Dismiss. Where two
// readings are possible the line stays: every withdrawn call the line showed is kept until its own evidence comes, a
// later withdrawal settling none of them, and a later call's result is evidence only as it reads now (its marker can
// arrive after it and withdraw it), so it is read again at each look; only the exit, the server's absence and Dismiss
// settle a call for good. The line names the latest call still unresolved. Both timers are counted on this window's clock from what this window saw, never from a row's
// timestamp. What the strip remembers lives with the mounted pane: a pane mounted mid-call starts from what it sees.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BROWSER_AGENT_IDLE_MS } from '@shared/browser/tab';
import { waitsOnAnswer } from '@shared/attention/kinds';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionPhase } from '@shared/ipc/schema/session';
import { useSessionControls } from '../session/controls/controls-for';
import { selectPendingOf, useAttention } from '../stores/attention';
import { useSessions } from '../stores/sessions';
import { ticks, useTranscriptStore } from '../stores/transcript';
import type { TurnId } from '../transcript/model/rows';
import { readComputerUse, type ComputerUseCall, type ComputerUseReading } from './reading';

export const COMPUTER_USE_SETTLE_MS = 250; // a call that asks for permission first never flashes the line
export const COMPUTER_USE_PAUSE_MS = BROWSER_AGENT_IDLE_MS; // 10 s, the Browser's "Agent is browsing" interval

export type StripState = { kind: 'absent' } | { kind: 'running'; turnId: TurnId } | { kind: 'lingering'; toolUseId: ToolUseId };

export interface StripFacts {
  appSessionId: AppSessionId;
  reading: ComputerUseReading;
  processGone: boolean; // the session's process is known to have exited (`processGoneOf`)
  serverGone: boolean; // the session's status lists no connected computer-use server
}

const ABSENT: StripState = { kind: 'absent' };
const same = (a: StripState, b: StripState) =>
  a.kind === b.kind && (a.kind !== 'running' || a.turnId === (b as typeof a).turnId) && (a.kind !== 'lingering' || a.toolUseId === (b as typeof a).toolUseId);

// A withdrawn call the line showed, the turn it was read in, and the calls after it as last read (its evidence).
interface Unresolved {
  toolUseId: ToolUseId;
  turn: TurnId | null;
  later: Map<ToolUseId, ComputerUseCall['state']>;
}

/** The strip's state for one mounted pane, told each change of what it reads (`observe`) and re-read at its own timers. */
export class StripTracker {
  private state: StripState = ABSENT;
  private facts: StripFacts | null = null;
  private flightSince = new Map<ToolUseId, number>(); // when this window first saw each `js` call in flight, unbroken
  private quietSince: number | null = null; // when this window first saw no `js` call in flight while running
  private shown = new Set<ToolUseId>(); // the `js` calls in flight while the line read running
  private settled = new Set<ToolUseId>(); // withdrawn calls settled for good: dismissed, or the process or server gone
  private unresolved: Unresolved[] = []; // the withdrawn calls the line showed and nothing settled, in the order they started
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  observe(facts: StripFacts): void {
    if (this.facts !== null && this.facts.appSessionId !== facts.appSessionId) this.forget();
    this.facts = facts;
    this.evaluate();
  }

  dismiss = (): void => {
    if (this.unresolved.length === 0) return;
    this.settleAll();
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
    this.unresolved = [];
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

    // A call the line showed became withdrawn while the line was up: it is unresolved until its own evidence comes. A
    // later withdrawal settles none of the earlier ones; a later call's `done` resolves each, since it is later than each.
    if (this.state.kind !== 'absent') {
      const kept = new Set(this.unresolved.map((u) => u.toolUseId));
      for (const call of js) {
        if (call.state !== 'withdrawn' || !this.shown.has(call.toolUseId) || this.settled.has(call.toolUseId) || kept.has(call.toolUseId)) continue;
        this.unresolved.push({ toolUseId: call.toolUseId, turn: reading.turn, later: new Map() });
      }
    }
    if (facts.processGone || facts.serverGone) this.settleAll();
    for (const u of this.unresolved) for (const call of laterCalls(reading, u)) u.later.set(call.toolUseId, call.state);

    const next = this.next(now, reading, flying.length > 0, js.some((call) => call.state === 'waiting'));
    if (next.kind === 'running') for (const id of flyingIds) this.shown.add(id);
    this.quietSince = next.kind === 'running' && flying.length === 0 ? (this.quietSince ?? now) : null;
    this.set(next);
    this.arm(now);
  }

  private settleAll() {
    for (const u of this.unresolved) this.settled.add(u.toolUseId);
    this.unresolved = [];
  }

  // The latest unresolved call no evidence says is over (a later call read `done` is that evidence for as long as it reads
  // so), or null when none is left.
  private open(): Unresolved | null {
    return this.unresolved.findLast((u) => ![...u.later.values()].includes('done')) ?? null;
  }

  private next(now: number, reading: ComputerUseReading, flying: boolean, waiting: boolean): StripState {
    const open = this.open();
    const lingers: StripState = open === null ? ABSENT : { kind: 'lingering', toolUseId: open.toolUseId };
    if (this.state.kind === 'running') {
      if (flying && reading.turn !== null) return { kind: 'running', turnId: reading.turn };
      if (open !== null) return lingers;
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

// The computer-use calls of the reading that started after the unresolved one: later in its turn, or in a later turn.
function laterCalls(reading: ComputerUseReading, unresolved: Unresolved): readonly ComputerUseCall[] {
  const at = reading.calls.findIndex((call) => call.toolUseId === unresolved.toolUseId);
  return at >= 0 ? reading.calls.slice(at + 1) : reading.turn !== unresolved.turn ? reading.calls : [];
}

// The tool-use ids of the session's permission requests that wait on an answer (root UC-1's predicate).
const waitingOf = (pending: readonly AttentionItem[]): ReadonlySet<ToolUseId> =>
  new Set(pending.flatMap((item) => (item.kind === 'permission' && waitsOnAnswer(item) && item.request.toolUseId !== null ? [item.request.toolUseId] : [])));

// The session's process is known to have exited: its engine status says so (a crash and a release under the memory
// budget included, whose digests read `failed` and `idle`), or its digest's phase is `exited` (a route with no status).
// Not the transcript's liveness (`ticks`), which a failed turn also turns off while the engine and the plugin's server
// live on; nor `failed`, which says that as well as a crash, nor `foreign`.
export const processGoneOf = (status: EngineSessionStatus | undefined, phase: SessionPhase | undefined): boolean => status?.process === 'exited' || phase === 'exited';

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
  const processGone = useSessions((s) => processGoneOf(s.engine.get(appSessionId), s.digests.get(appSessionId)?.phase));
  const reading = useMemo(() => readComputerUse(transcript, waiting, ticking && !atRest), [transcript, waiting, ticking, atRest]);
  const [tracker] = useState(() => new StripTracker());
  useEffect(() => tracker.observe({ appSessionId, reading, processGone, serverGone }), [tracker, appSessionId, reading, processGone, serverGone]);
  useEffect(() => () => tracker.stop(), [tracker]);
  const state = useSyncExternalStore(tracker.subscribe, tracker.snapshot);
  return { state, dismiss: tracker.dismiss };
}
