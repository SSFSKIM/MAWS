// Routing facts (C11 execution document, Interfaces "Gateway", *Routing facts*): which route a session takes, whose
// account the relay counts it against and why, and which switch the usage popover's footer offers. Pure: the footer
// and Session info read it. §5.4 as amended: these facts live in the status line's popover and in Session info, never
// around the composer frame. Also the footer's pace line (M4 refresh task "the popover footer as C7 asked").
import type { EngineSessionStatus } from '@shared/engine/status';
import type { SessionRecord } from '@shared/graph/session';
import type { Settings } from '@shared/ipc/schema';
import type { SetupIntent } from '@shared/sessions/intent';
import type { UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { PACE, ROUTE, type Route } from './copy';

export type DirectLogin = { login: string; email: string | null; organization: string | null };

export interface RoutingFacts {
  route: Route | 'unknown';
  line: string;
  note: string | null; // a second sentence (a direct session's: no gateway models, windows from the engine)
  account: { email: string; why: 'pinned' | 'routing' } | null;
  targets: Route[]; // the switches offered, in order; both for a session whose route was never recorded
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
  if (status) {
    route = status.gateway.mode;
    if (route === 'gateway') {
      line = ROUTE.routed;
      const snapshot = usage?.available ? usage : null;
      const pinned = record.engineSessionId === null ? undefined : snapshot?.pinsFor[record.engineSessionId];
      const pinnedAccount = pinned === undefined ? undefined : snapshot?.accounts.find((a) => a.uuid === pinned);
      const drain = snapshot?.accounts.find((a) => a.uuid === snapshot.drainTarget);
      if (pinnedAccount) account = { email: pinnedAccount.email, why: 'pinned' };
      else if (drain) account = { email: drain.email, why: 'routing' };
    } else {
      line = directLogin ? ROUTE.directLogin(directLogin.login) : ROUTE.direct;
      note = ROUTE.directNote;
    }
  } else if (record.gateway.routed === null) {
    route = 'unknown';
    line = ROUTE.notRecorded(settings.gateway.defaultRoute);
  } else {
    route = record.gateway.routed ? 'gateway' : 'direct';
    line = record.gateway.routed ? ROUTE.lastRouted : ROUTE.lastDirect;
  }

  const refusal = switchRefusal(record);
  // D-19: the relay is the default, so `Switch to gateway…` is always offered; `offerDirect` hides only the other.
  const offered: Route[] = route === 'gateway' ? ['direct'] : route === 'direct' ? ['gateway'] : ['gateway', 'direct'];
  const targets = refusal !== null ? [] : offered.filter((t) => t === 'gateway' || settings.gateway.offerDirect);
  return { route, line, note, account, targets, canSwitch: targets.length > 0, switchLabel: targets.length > 0 ? ROUTE.switchTo[targets[0]] : '', refusal };
}

// ---- an unstarted session ------------------------------------------------------------------------------------------------

// D-19's per-session Direct before the first send (the architect's ruling, Decision Log 2026-09-29, from C10's review):
// the route is the setup intent's `gateway`, chosen with `session.intent.patch`, so nothing restarts. The Direct choice
// follows `offerDirect` as the switch does; an intent already direct (the default route, or a choice made here) is
// always offered the way back.
export interface UnstartedRoute {
  route: Route;
  line: string;
  choices: Route[]; // the segment's options, in order; empty when there is nothing to choose
}

export function unstartedRoute(intent: Pick<SetupIntent, 'gateway'>, settings: Settings): UnstartedRoute {
  const choices: Route[] = settings.gateway.offerDirect || intent.gateway === 'direct' ? ['gateway', 'direct'] : [];
  return { route: intent.gateway, line: ROUTE.starts[intent.gateway], choices };
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

export function paceLine(window: UsageWindow | null, kind: PaceKind, now: number): string | null {
  const at = paceRunsOutAt(window, kind, now);
  if (at === null) return null;
  const date = new Date(at);
  if (kind === 'fiveHour') return PACE.fiveHour(spaced(date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })));
  return PACE.weekly(`${date.toLocaleDateString('en-US', { weekday: 'short' })} ${spaced(date.toLocaleTimeString('en-US', { hour: 'numeric' }))}`);
}
