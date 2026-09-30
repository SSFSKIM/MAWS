// The Accounts tab's view model (C11 execution document, Interfaces "Accounts tab"; M5 decisions): ClaudeUsage's accounts
// as C7's reader carries them, in ClaudeUsage's panel order and geometry, with the routing account marked and the reason
// stated only when MAWS can verify it. Pure: the view re-runs it on every snapshot and on its 30 s clock.
import type { RelayHealth } from '@shared/engine/relay-health';
import type { AccountUsage, UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { ago } from '../statusline/format';
import { RELAY } from './copy';

export type RoutingWhy = 'manual' | 'weekly_resets_soonest' | 'relay_choice';

// One limit row as ClaudeUsage's LimitBarView lays it out: label, bar, percent, reset countdown.
export interface LimitView {
  key: string; // 'session' | 'weekly_all' | 'weekly_scoped#<Model>', ClaudeUsage's limit key
  name: string; // '5h', 'Weekly', the model's name
  meter: string; // the meter's accessible name
  percent: number; // what the bar shows: 0 once the window's reset has passed (no reading since)
  resetInMs: number | null; // null once the reset has passed
  reset: boolean; // the window reset and ClaudeUsage has not recorded the new one yet
  full: boolean; // at or over 100 %
}

export interface AccountRow {
  uuid: string;
  email: string;
  displayName: string;
  planLabel: string | null;
  rateLimitTier: string | null;
  role: 'routing' | 'other'; // routing: uuid === drainTarget
  routingWhy: RoutingWhy | null; // set on the routing row only
  state: 'ready' | 'needs_reauth' | 'no_readings';
  windows: AccountUsage['windows'];
  limits: LimitView[];
  pinnedSessionCount: number;
  lastSeenActive: string | null;
}

export interface AccountsViewModel {
  rows: AccountRow[];
  columns: 1 | 2; // ClaudeUsage's grid: two columns at three or more accounts (the view falls back to one when narrow)
  updatedAt: string; // the newest reading ClaudeUsage recorded, else when MAWS read its files
  relayLine: string;
}

const shown = (window: UsageWindow, now: number) => {
  const resetInMs = Date.parse(window.resetsAt) - now;
  return resetInMs > 0 ? { percent: window.percent, resetInMs, reset: false } : { percent: 0, resetInMs: null, reset: true };
};

function limitsOf(windows: AccountUsage['windows'], now: number): LimitView[] {
  const rows: LimitView[] = [];
  const add = (key: string, name: string, meter: string, window: UsageWindow | null) => {
    if (!window) return; // a missing window is not synthesised (LimitReading.swift:99–127)
    const s = shown(window, now);
    rows.push({ key, name, meter, ...s, full: s.percent >= 100 });
  };
  add('session', '5h', 'Five-hour usage', windows.fiveHour);
  add('weekly_all', 'Weekly', 'Weekly usage', windows.sevenDay);
  for (const { model, window } of windows.scoped) add(`weekly_scoped#${model}`, model, `${model} weekly usage`, window);
  return rows;
}

// The relay's automatic election (Router.swift:279–320, `consumeFirst`; QuotaLedger.swift:380–395), re-run over what the
// files show: accounts that need reauthentication are ineligible, an account with a 5-hour or weekly window at 100 %
// is rejected (QuotaLedger.swift:346), the rest are ordered by the earliest future weekly reset (unknown last, and a
// reset that has passed is unknown), then the lower 5-hour utilisation (0 when never observed or reset), then uuid; the
// incumbent drain target keeps the election when its weekly reset ties the best. Threshold rules, holds and pins are
// invisible here, which is why the result only ever confirms the relay and never contradicts it.
export function automaticChoice(accounts: readonly AccountUsage[], drainTarget: string | null, now: number): string | null {
  const scored = accounts.flatMap((account) => {
    if (account.needsReauthentication) return [];
    const five = account.windows.fiveHour ? shown(account.windows.fiveHour, now) : null;
    const week = account.windows.sevenDay ? shown(account.windows.sevenDay, now) : null;
    if ((five?.percent ?? 0) >= 100 || (week?.percent ?? 0) >= 100) return [];
    const weeklyReset = week && !week.reset ? Date.parse(account.windows.sevenDay!.resetsAt) : null;
    return [{ uuid: account.uuid, weeklyReset, fiveHour: five?.percent ?? 0 }];
  });
  type Scored = (typeof scored)[number];
  const before = (a: Scored, b: Scored): number => {
    if (a.weeklyReset !== null && b.weeklyReset !== null && a.weeklyReset !== b.weeklyReset) return a.weeklyReset - b.weeklyReset;
    if (a.weeklyReset !== null && b.weeklyReset === null) return -1;
    if (a.weeklyReset === null && b.weeklyReset !== null) return 1;
    if (a.fiveHour !== b.fiveHour) return a.fiveHour - b.fiveHour;
    return a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0;
  };
  const best = [...scored].sort(before)[0];
  if (!best) return null;
  const incumbent = scored.find((s) => s.uuid === drainTarget);
  return incumbent && incumbent.weeklyReset === best.weeklyReset ? incumbent.uuid : best.uuid;
}

const highestShown = (limits: LimitView[]) => limits.reduce((max, l) => Math.max(max, l.percent), 0);

function newestRecorded(accounts: readonly AccountUsage[]): string | null {
  let newest: string | null = null;
  for (const { windows } of accounts) {
    for (const w of [windows.fiveHour, windows.sevenDay, ...windows.scoped.map((s) => s.window)]) {
      if (w && (newest === null || w.recordedAt > newest)) newest = w.recordedAt;
    }
  }
  return newest;
}

export function relayLine(relay: RelayHealth | null, now: number): string {
  if (relay === null) return RELAY.unchecked;
  if (!relay.ok) return RELAY.down(relay.error);
  let hostPort = relay.url;
  try {
    hostPort = new URL(relay.url).host;
  } catch {
    // not a URL: shown as it came
  }
  return RELAY.listening(hostPort, ago(Math.max(0, now - Date.parse(relay.checkedAt))), relay.latencyMs);
}

export function accountsViewModel(snapshot: UsageSnapshot, relay: RelayHealth | null, now: number): AccountsViewModel {
  const accounts = snapshot.available ? snapshot.accounts : [];
  const drain = snapshot.drainTarget;
  const routingWhy: RoutingWhy = snapshot.drainTargetIsManual ? 'manual' : automaticChoice(accounts, drain, now) === drain ? 'weekly_resets_soonest' : 'relay_choice';
  const rows = accounts.map((account): AccountRow => {
    const limits = limitsOf(account.windows, now);
    const routing = account.uuid === drain;
    return {
      uuid: account.uuid,
      email: account.email,
      displayName: account.displayName,
      planLabel: account.planLabel,
      rateLimitTier: account.rateLimitTier,
      role: routing ? 'routing' : 'other',
      routingWhy: routing ? routingWhy : null,
      state: account.needsReauthentication ? 'needs_reauth' : limits.length === 0 ? 'no_readings' : 'ready',
      windows: account.windows,
      limits,
      pinnedSessionCount: account.pinnedSessionCount,
      lastSeenActive: account.lastSeenActive,
    };
  });
  // ClaudeUsage sorts its signed-in account first; MAWS has no signed-in account and puts the routing one there. Then
  // the accounts that need reauthentication last, the rest by their highest shown window, then email.
  const rank = (row: AccountRow) => (row.role === 'routing' ? 0 : row.state === 'needs_reauth' ? 2 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || highestShown(b.limits) - highestShown(a.limits) || a.email.localeCompare(b.email));
  return {
    rows,
    columns: rows.length >= 3 ? 2 : 1,
    updatedAt: newestRecorded(accounts) ?? snapshot.readAt,
    relayLine: relayLine(relay, now),
  };
}
