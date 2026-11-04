// Routing facts (C11 execution document, Interfaces "Gateway", *Routing facts*): which route a session takes, whose
// account the relay counts it against and why, and which switch to offer. Pure: Session info reads it. §5.4 as amended
// 2026-10-01 (W2): these facts live in Session info, whose Route row carries the switch, and the model selector's Route
// segment, never around the composer frame. Also the pace line (M4 refresh task "the popover footer as C7 asked"),
// Session info's Pace row since the status line's usage popover went.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { Settings } from '@shared/ipc/schema';
import type { SetupIntent } from '@shared/sessions/intent';
import type { UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { formatClock, formatWeekdayHour } from '@shared/app/date-format';
import type { Route as AnyRoute } from '@shared/engine/route';
import { readRoute } from '@shared/engine/route';
import { MACHINE_ROUTE, PACE, ROUTE, type Route, type SwitchTarget } from './copy';
import { machineReached, machineRouteLine, observedOf, routeChosen, throughClaudeUsage } from './observed-route'; // P5 O7 M9

export type DirectLogin = { login: string; email: string | null; organization: string | null };

export interface RoutingFacts {
  route: Route | 'unknown'; // P5 O7 M9: on the machine's own route, the one it was observed reaching (ClaudeUsage: gateway)
  machine: boolean; // P5 O7 M9: launched on the machine's own route
  line: string;
  note: string | null; // a second sentence (a direct session's: no gateway models, windows from the engine)
  account: { email: string; why: 'pinned' | 'routing' } | null;
  targets: SwitchTarget[]; // the switches offered, in order; every route for a session whose route was never recorded (P5 O7 M9: the machine's own among them)
  canSwitch: boolean;
  switchLabel: string; // the first target's label ('' without one)
  refusal: string | null; // why no switch is offered, when a reason is worth saying (held elsewhere, archived)
}

// Why a session's route cannot be switched from here (held elsewhere, archived); null when it can.
export function switchRefusal(record: SessionRecord): string | null {
  if (record.archived) return ROUTE.archived;
  if (record.holder.kind === 'terminal' || record.holder.kind === 'background_job') return ROUTE.held(ROUTE.holders[record.holder.kind]);
  return null;
}

// `directLogin`: the `Login`, `Organization` and `Email` rows of a direct session's last `get_status` (the gateway store).
export function routingFacts(record: SessionRecord, status: EngineSessionStatus | null, usage: UsageSnapshot | null, settings: Settings, directLogin: DirectLogin | null): RoutingFacts {
  let route: RoutingFacts['route'];
  let line: string;
  let note: string | null = null;
  let account: RoutingFacts['account'] = null;
  // P5 O7 M9: the machine's own route says what the machine reached (never a mismatch), and ClaudeUsage's account goes
  // with the observation, not with the route chosen
  const machine = routeChosen(status, record) === 'machine';
  if (status) {
    route = throughClaudeUsage(status, null) ? 'gateway' : 'direct';
    if (route === 'gateway') {
      line = machine ? machineRouteLine(observedOf(status, null)) : ROUTE.routed;
      const snapshot = usage?.available ? usage : null;
      const pinned = record.engineSessionId === null ? undefined : snapshot?.pinsFor[record.engineSessionId];
      const pinnedAccount = pinned === undefined ? undefined : snapshot?.accounts.find((a) => a.uuid === pinned);
      const drain = snapshot?.accounts.find((a) => a.uuid === snapshot.drainTarget);
      if (pinnedAccount) account = { email: pinnedAccount.email, why: 'pinned' };
      else if (drain) account = { email: drain.email, why: 'routing' };
    } else {
      line = machine ? machineRouteLine(observedOf(status, null)) : directLogin ? ROUTE.directLogin(directLogin.login) : ROUTE.direct;
      note = ROUTE.directNote;
    }
  } else if (machine) {
    const via = throughClaudeUsage(null, record);
    route = via === null ? 'unknown' : via ? 'gateway' : 'direct';
    line = MACHINE_ROUTE.lastRan(machineReached(observedOf(null, record)));
  } else if (record.gateway.routed === null) {
    route = 'unknown';
    line = ROUTE.notRecorded;
  } else {
    route = record.gateway.routed ? 'gateway' : 'direct';
    line = record.gateway.routed ? ROUTE.lastRouted : ROUTE.lastDirect;
  }

  const refusal = switchRefusal(record);
  // D-19: `Switch to gateway…` is always offered; `offerDirect` hides only Direct. P5 O7 M9 (the architect's ruling): the
  // machine's own route is every session's default and the other two are per-session choices, so the switch reaches all
  // three: every route but the one the session was launched on, the machine's own last ("Back to the machine’s own…").
  const chosen = machine ? 'machine' : route;
  const offered: SwitchTarget[] = chosen === 'machine' ? ['gateway', 'direct'] : chosen === 'gateway' ? ['direct', 'machine'] : chosen === 'direct' ? ['gateway', 'machine'] : ['gateway', 'direct', 'machine'];
  const targets = refusal !== null ? [] : offered.filter((t) => t !== 'direct' || settings.gateway.offerDirect);
  return { route, machine, line, note, account, targets, canSwitch: targets.length > 0, switchLabel: targets.length > 0 ? ROUTE.switchTo[targets[0]] : '', refusal };
}

// ---- an unstarted session ------------------------------------------------------------------------------------------------

// D-19's per-session Direct before the first send (the architect's ruling, Decision Log 2026-09-29, from C10's review):
// the route is the setup intent's `gateway`, chosen with `session.intent.patch`, so nothing restarts. The Direct choice
// follows `offerDirect` as the switch does; an intent already direct (the default route, or a choice made here) is
// always offered the way back.
// P5 O7 M9: the intent's `route` before its legacy field, and the machine's own route (every machine's default) always
// one of the choices, so an intent moved to Gateway or Direct can always go back to it; Direct follows `offerDirect`
// except as the way back from it.
export interface UnstartedRoute {
  route: AnyRoute;
  line: string;
  choices: AnyRoute[]; // the segment's options, in order
}

export function unstartedRoute(intent: Pick<SetupIntent, 'gateway' | 'route'>, settings: Settings): UnstartedRoute {
  const route = readRoute(intent);
  const choices: AnyRoute[] = settings.gateway.offerDirect || route === 'direct' ? ['machine', 'gateway', 'direct'] : ['machine', 'gateway'];
  return { route, line: route === 'machine' ? MACHINE_ROUTE.starts : ROUTE.starts[route], choices };
}

// ---- the pace line ------------------------------------------------------------------------------------------------------

const WINDOW_MS = { weekly: 7 * 86_400_000, fiveHour: 5 * 3_600_000 } as const;
export type PaceKind = keyof typeof WINDOW_MS;

// When the window reaches 100 % at the rate it has filled so far, when that falls before its reset; else null.
export function paceRunsOutAt(window: UsageWindow | null, kind: PaceKind, now: number): number | null {
  if (!window || !(window.percent > 0) || window.percent >= 100) return null;
  const resetsAt = Date.parse(window.resetsAt);
  const elapsed = WINDOW_MS[kind] - (resetsAt - now);
  if (!(elapsed > 0) || !(resetsAt > now)) return null;
  const runsOut = now + ((100 - window.percent) * elapsed) / window.percent;
  return runsOut < resetsAt ? runsOut : null;
}

const spaced = (s: string) => s.replace(/\s/g, ' '); // ICU writes a narrow no-break space before AM/PM

// The time in the display locale (`@shared/app/date-format`): "2:05 PM", "Tue 2 PM".
export function paceLine(window: UsageWindow | null, kind: PaceKind, now: number): string | null {
  const at = paceRunsOutAt(window, kind, now);
  if (at === null) return null;
  if (kind === 'fiveHour') return PACE.fiveHour(spaced(formatClock(at)));
  return PACE.weekly(spaced(formatWeekdayHour(at)));
}
