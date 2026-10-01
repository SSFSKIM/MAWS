// The Accounts tab's view model (C11 execution document, Interfaces "Accounts tab"; M5 decisions): ClaudeUsage's accounts
// as C7's reader carries them, in ClaudeUsage's panel order and geometry, with the routing account marked and the reason
// stated only when MAWS can verify it. Pure: the view re-runs it on every snapshot and on its 30 s clock. W6 (E1): also
// the top bar's usage pill and the rest of the copy of ClaudeUsage's panel (severity, activity, Codex, health).
import type { RelayHealth } from '@shared/engine/relay-health';
import type { AccountActivity, AccountUsage, GatewayHealth, UsageGateway, UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { ago } from '../statusline/format';
import { HEALTH, RELAY } from './copy';

export type RoutingWhy = 'manual' | 'weekly_resets_soonest' | 'relay_choice';

// W6 start: the colour of a limit, its account's dot and the top bar's pill (ClaudeUsage's SeverityColor.swift: normal
// green, warning orange, critical red). ClaudeUsage takes a limit's severity from Anthropic's answer; its files keep
// only the percent, so MAWS applies ClaudeUsage's own rule for a reading that carries none (UsageDecoder.swift:136–139):
// 95 % and over is critical, 75 % and over a warning.
export type Severity = 'normal' | 'warning' | 'critical';
export const severityOf = (percent: number): Severity => (percent >= 95 ? 'critical' : percent >= 75 ? 'warning' : 'normal');
const RANK: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };
export const worstSeverity = (limits: readonly LimitView[]): Severity | null =>
  limits.reduce<Severity | null>((worst, l) => (worst === null || RANK[l.severity] > RANK[worst] ? l.severity : worst), null);
// W6 end

// One limit row as ClaudeUsage's LimitBarView lays it out: label, bar, percent, reset countdown.
export interface LimitView {
  key: string; // 'session' | 'weekly_all' | 'weekly_scoped#<Model>', ClaudeUsage's limit key
  name: string; // '5h', 'Weekly', the model's name
  meter: string; // the meter's accessible name
  percent: number; // what the bar shows: 0 once the window's reset has passed (no reading since)
  resetInMs: number | null; // null once the reset has passed
  reset: boolean; // the window reset and ClaudeUsage has not recorded the new one yet
  full: boolean; // at or over 100 %
  severity: Severity; // W6: of the percent shown
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
  // W6 start
  provider: 'claude' | 'codex'; // a Codex account (ClaudeUsage's Codex section) has no limits in the files
  severity: Severity | null; // the worst of its limits; null without any
  activity: AccountActivity | null; // what it served in the relay's last ten minutes
  latest: boolean; // it served the newest request of all (ClaudeUsage's filled bolt)
  // W6 end
}

export interface AccountsViewModel {
  rows: AccountRow[];
  columns: 1 | 2; // ClaudeUsage's grid: two columns at three or more accounts (the view falls back to one when narrow)
  updatedAt: string; // the newest reading ClaudeUsage recorded, else when MAWS read its files
  relayLine: string;
  // W6 start
  codex: AccountRow[] | null; // ClaudeUsage's Codex section; null without its file
  gateway: UsageGateway | null; // the routing toggle's state
  health: { line: string; degraded: boolean } | null; // the relay's last ten minutes; null when it served nothing
  // W6 end
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
    rows.push({ key, name, meter, ...s, full: s.percent >= 100, severity: severityOf(s.percent) });
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

// W6 start: the relay's last ten minutes in one sentence (PanelView.swift `GatewayHealthText.line`), null when it served
// nothing; degraded (shown in the warning colour) on any stall or failure.
const seconds = (value: number) => (value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`);
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
export function healthLine(health: GatewayHealth): { line: string; degraded: boolean } | null {
  if (health.requests === 0) return null;
  const parts = [plural(health.requests, 'request', 'requests')];
  if (health.firstByteP50 !== null && health.firstByteP95 !== null) parts.push(HEALTH.responseStart(seconds(health.firstByteP50), seconds(health.firstByteP95)));
  const trouble = [
    health.stalls > 0 ? plural(health.stalls, 'stall', 'stalls') : null,
    health.transportFailures > 0 ? plural(health.transportFailures, 'connection error', 'connection errors') : null,
    health.refused > 0 ? `${health.refused} refused` : null,
    health.unreachable > 0 ? `${health.unreachable} unreachable` : null,
    health.held > 0 ? `${health.held} held` : null,
  ].filter((t) => t !== null);
  parts.push(trouble.length === 0 ? HEALTH.noErrors : trouble.join(', '));
  return { line: HEALTH.line(parts.join(' · ')), degraded: health.stalls > 0 || health.transportFailures > 0 || health.refused > 0 || health.unreachable > 0 };
}

const NO_WINDOWS: AccountUsage['windows'] = { fiveHour: null, sevenDay: null, scoped: [] };
type ActivityOf = (id: string) => Pick<AccountRow, 'activity' | 'latest'>;

// ClaudeUsage's Codex section from its files: the accounts, the one its Codex routes drain, their saved sessions and
// activity. ClaudeUsage polls their limits and keeps them in memory, so a Codex row has none here.
function codexRows(snapshot: UsageSnapshot, activityOf: ActivityOf): AccountRow[] | null {
  const codex = snapshot.available ? snapshot.codex : null;
  if (!codex) return null;
  const rows = codex.accounts.map((account): AccountRow => {
    const routing = account.accountId === codex.drainTarget;
    return {
      uuid: account.accountId,
      email: account.email,
      displayName: '',
      planLabel: account.planLabel,
      rateLimitTier: null,
      role: routing ? 'routing' : 'other',
      routingWhy: routing ? (codex.drainTargetIsManual ? 'manual' : 'relay_choice') : null,
      state: account.needsReauthentication ? 'needs_reauth' : 'no_readings',
      windows: NO_WINDOWS,
      limits: [],
      pinnedSessionCount: account.pinnedSessionCount,
      lastSeenActive: null,
      provider: 'codex',
      severity: null,
      ...activityOf(account.accountId),
    };
  });
  const rank = (row: AccountRow) => (row.role === 'routing' ? 0 : row.state === 'needs_reauth' ? 2 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email));
}
// W6 end

export function accountsViewModel(snapshot: UsageSnapshot, relay: RelayHealth | null, now: number): AccountsViewModel {
  const accounts = snapshot.available ? snapshot.accounts : [];
  const drain = snapshot.drainTarget;
  const routingWhy: RoutingWhy = snapshot.drainTargetIsManual ? 'manual' : automaticChoice(accounts, drain, now) === drain ? 'weekly_resets_soonest' : 'relay_choice';
  // W6: what each account served in the relay's last ten minutes, and which served the newest request of all
  const activity = snapshot.available ? (snapshot.activity?.accounts ?? []) : [];
  const newest = activity.reduce<AccountActivity | null>((a, b) => (a === null || b.lastServed > a.lastServed ? b : a), null);
  const activityOf: ActivityOf = (id) => {
    const served = activity.find((a) => a.account === id) ?? null;
    return { activity: served, latest: served !== null && served === newest };
  };
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
      // W6 start
      provider: 'claude',
      severity: worstSeverity(limits),
      ...activityOf(account.uuid),
      // W6 end
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
    // W6 start
    codex: codexRows(snapshot, activityOf),
    gateway: snapshot.available ? snapshot.gateway : null,
    health: snapshot.available && snapshot.activity ? healthLine(snapshot.activity.health) : null,
    // W6 end
  };
}

// W6 start: the top bar's pill (ClaudeUsage's status item: MenuBarLabelView.swift, AppModel.menuBarState): the routing
// account's most binding limit, the highest percent across its limits, in the colour of its worst severity, dimmed
// while the account needs reauthentication (ClaudeUsage dims a reading it could not refresh). MAWS's sessions run
// through the relay whatever ClaudeUsage's toggle says (D-19), so the routing account is the drain target; with none,
// the first account in the panel's order, as ClaudeUsage falls back when no account is signed in. Null parts without
// ClaudeUsage's data or readings.
export interface UsagePillView {
  percent: number | null;
  severity: Severity | null;
  dimmed: boolean;
  account: string | null; // the account's email
  limit: string | null; // the binding limit's name
}

export function usagePill(model: AccountsViewModel | null): UsagePillView {
  const row = model?.rows.find((r) => r.role === 'routing') ?? model?.rows[0];
  if (!row) return { percent: null, severity: null, dimmed: false, account: null, limit: null };
  const binding = row.limits.reduce<LimitView | null>((max, l) => (max === null || l.percent > max.percent || (l.percent === max.percent && RANK[l.severity] > RANK[max.severity]) ? l : max), null);
  return { percent: binding ? Math.round(binding.percent) : null, severity: row.severity, dimmed: row.state === 'needs_reauth', account: row.email, limit: binding?.name ?? null };
}
// W6 end
