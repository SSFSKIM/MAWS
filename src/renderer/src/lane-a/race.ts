// The approval race on a terminal session's request (P5 O9 M6, docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md, "The
// race"; the owner's Q3, built as recommended): a request a session's sminos bridge raised is asked in the terminal too,
// and the first answer wins. A card reads here whether that is so (the bridge holds it pending, or settled it), who
// settled it and with what (`settled {winner, outcome, by}` on the state, or what a late answer of this page was told),
// and whether it is the terminal's alone to answer: a background subagent's request past its window, less 200 ms, or one
// the bridge refused as `terminalOnly`. Facts of the request, from its session's lane A state; never of the lane.
import { useEffect, useState } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { LaneAState } from '@shared/ipc/schema/lane-a';
import { useLaneA, type RequestSettlement } from '../stores/lane-a';

export const RACE = {
  asked: 'Also asked in the terminal: the first answer wins',
  terminal: 'Answer this in the terminal',
};

const WINDOW_MARGIN_MS = 200; // the bridge closes a background request's window a little before its deadline

export type RaceWinner = 'terminal' | 'maws' | 'elsewhere';
export interface Race {
  asked: boolean; // the terminal asks it too
  settled: { where: RaceWinner; outcome: string | null } | null;
  terminalOnly: boolean;
}

// Whether a background request's window has closed: the terminal alone answers it now.
export const pastWindow = (raised: { deadline?: string }, now: number): boolean => raised.deadline !== undefined && now >= Date.parse(raised.deadline) - WINDOW_MARGIN_MS;

export function raceOf(state: LaneAState | null, told: RequestSettlement | null, request: RequestId | string | null, now: number): Race {
  const raised = request === null ? undefined : state?.pending.find((p) => p.request === request);
  const fromState = request === null ? undefined : state?.settled.find((s) => s.request === request);
  const settlement: RequestSettlement | null = fromState ? { winner: fromState.winner, outcome: fromState.outcome, by: fromState.by } : told;
  const decided = settlement !== null && (settlement.winner !== null || settlement.by !== null);
  return {
    asked: raised !== undefined || decided,
    settled: decided ? { where: settlement.winner === 'terminal' || settlement.by === 'terminal' ? 'terminal' : settlement.by === 'maws' ? 'maws' : 'elsewhere', outcome: settlement.outcome } : null,
    terminalOnly: settlement?.terminalOnly === true || (raised !== undefined && pastWindow(raised, now)),
  };
}

const OUTCOME: Record<string, string> = { allow: 'Allowed', deny: 'Denied' };
const WHERE: Record<RaceWinner, string> = { terminal: 'Answered in the terminal', maws: 'Answered in MAWS', elsewhere: 'Answered elsewhere' };

// "Answered in the terminal: Allowed" (Q3); a question's answers are not carried by the settlement, so it says only where.
export function settledWords(settled: NonNullable<Race['settled']>): string {
  if (settled.outcome === 'withdrawn') return 'No longer asked';
  const outcome = settled.outcome === null ? undefined : OUTCOME[settled.outcome];
  return outcome ? `${WHERE[settled.where]}: ${outcome}` : WHERE[settled.where];
}

// The race of an item's request, following its session's lane A state and turning terminal-only when its window closes.
export function useRace(item: Pick<AttentionItem, 'appSessionId' | 'request'>): Race {
  const appSessionId = item.appSessionId as AppSessionId;
  const { requestId } = item.request;
  const state = useLaneA((s) => s.states.get(appSessionId) ?? null);
  const told = useLaneA((s) => (requestId === null ? null : (s.told.get(appSessionId)?.get(requestId) ?? null)));
  const [now, setNow] = useState(() => Date.now());
  const deadline = requestId === null ? undefined : state?.pending.find((p) => p.request === requestId)?.deadline;
  useEffect(() => {
    if (deadline === undefined) return;
    const wait = Date.parse(deadline) - WINDOW_MARGIN_MS - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [deadline]);
  return raceOf(state, told, requestId, now);
}

// P5 O9 M6 (the owner's Q3): a docked request its terminal (or another client) answered first stays docked SETTLED_MS,
// its card saying how the race ended, then leaves; one this app answered, or one another request replaces, leaves at
// once.
export const SETTLED_MS = 3_000;
export function useSettling(docked: AttentionItem | null): AttentionItem | null {
  const [shown, setShown] = useState<{ item: AttentionItem | null; settled: boolean }>({ item: docked, settled: false });
  const last = shown.item;
  const away = useLaneA((s) => {
    if (last === null) return false;
    const { appSessionId } = last;
    const { requestId } = last.request;
    const where = raceOf(s.states.get(appSessionId) ?? null, requestId === null ? null : (s.told.get(appSessionId)?.get(requestId) ?? null), requestId, 0).settled?.where;
    return where !== undefined && where !== 'maws';
  });
  if (docked !== null && (last !== docked || shown.settled)) setShown({ item: docked, settled: false });
  else if (docked === null && last !== null && !shown.settled) setShown({ item: away ? last : null, settled: away });
  useEffect(() => {
    if (!shown.settled) return;
    const timer = setTimeout(() => setShown({ item: null, settled: false }), SETTLED_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return docked ?? (shown.settled ? shown.item : null);
}
