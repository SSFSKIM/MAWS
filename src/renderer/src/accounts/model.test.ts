// accountsViewModel over the committed ClaudeUsage fixture read by C7's own reader (C11 execution document, M5 pins,
// restated at the refresh pass against the fixture: `now` two minutes after its newest reading).
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { UsageSnapshot } from '@shared/usage/types';
import { ClaudeUsageReader } from '../../../main/usage/claude-usage-reader';
import { accountsViewModel, automaticChoice, healthLine, severityOf, usagePill } from './model';
import { REL } from '../test-support/relative-time';

const FIXTURE = join(__dirname, '../../../../test/fixtures/claude-usage');
const NOW = Date.parse('2026-09-29T07:36:17Z');
const ACCOUNT = { one: '477e393c-5c1a-4413-a3e6-7f5d1ed72cc3', three: '2aca3c4b-1e77-4091-908b-d183f6b0f092', five: 'c07e5b82-c428-48ae-b904-9c1a4b26ec25' };

let scratch: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maws-accounts-model-'));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The fixture as C7's reader answers it; `edit` rewrites a copy's accounts.json or pins.json first.
async function read(edit?: { accounts?: (a: Record<string, unknown>[]) => unknown; pins?: (p: Record<string, unknown>) => unknown }): Promise<UsageSnapshot> {
  const dir = mkdtempSync(join(scratch, 'copy-'));
  cpSync(FIXTURE, dir, { recursive: true });
  for (const [file, fn] of [['accounts.json', edit?.accounts], ['pins.json', edit?.pins]] as const) {
    if (!fn) continue;
    const path = join(dir, file);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify(fn(parsed) ?? parsed));
  }
  const reader = new ClaudeUsageReader({ dir, emit: () => {}, log: () => {}, now: () => NOW });
  try {
    return await reader.snapshot([]);
  } finally {
    reader.stop(); // closes the requests file the snapshot opened, rather than leaving it to the garbage collector
  }
}

const relay = (ok: boolean): RelayHealth => ({ url: 'http://127.0.0.1:8641', ok, status: ok ? 200 : null, latencyMs: ok ? 3.4 : null, checkedAt: new Date(NOW - 12_000).toISOString(), error: ok ? null : 'connect ECONNREFUSED 127.0.0.1:8641' });
const emails = (m: ReturnType<typeof accountsViewModel>) => m.rows.map((r) => r.email);

describe('accountsViewModel marks the drain target and states why', () => {
  it('over the fixture: 3@ routing because its weekly resets soonest, the sort, the saved sessions, two columns', async () => {
    const model = accountsViewModel(await read(), relay(true), NOW);
    expect(emails(model)).toEqual(['3@example.test', '4@example.test', '1@example.test', '5@example.test', '2@example.test']);
    expect(model.rows[0]).toMatchObject({ uuid: ACCOUNT.three, role: 'routing', routingWhy: 'weekly_resets_soonest', state: 'ready', pinnedSessionCount: 8, planLabel: 'Max', rateLimitTier: 'default_claude_max_20x' });
    expect(model.rows.slice(1).every((r) => r.role === 'other' && r.routingWhy === null && r.pinnedSessionCount === 1)).toBe(true);
    expect(model.columns).toBe(2);
    expect(model.updatedAt).toBe('2026-09-29T07:34:17Z');
    expect(model.relayLine).toBe(`Relay listening on 127.0.0.1:8641 · checked ${REL.now} · 3 ms`);
  });

  it('limit rows: 5h, Weekly and the scoped model, 100 % marked full, a reset that passed reads 0 %', async () => {
    const model = accountsViewModel(await read(), null, NOW);
    const byEmail = (email: string) => model.rows.find((r) => r.email === email)!;
    expect(byEmail('3@example.test').limits.map((l) => [l.name, l.percent])).toEqual([['5h', 53], ['Weekly', 63], ['Fable', 82]]);
    expect(byEmail('1@example.test').limits.map((l) => [l.name, l.percent])).toEqual([['5h', 77], ['Weekly', 44], ['Fable', 44]]);
    expect(byEmail('4@example.test').limits[0]).toMatchObject({ name: '5h', percent: 100, full: true, reset: false });
    expect(byEmail('2@example.test').limits[0]).toMatchObject({ name: '5h', percent: 0, reset: true, resetInMs: null, full: false });
    expect(model.relayLine).toBe('Relay not checked yet');
  });

  it('manual when pins.json says so; the relay\'s choice, with no reason, when MAWS\'s re-run disagrees', async () => {
    const manual = accountsViewModel(await read({ pins: (p) => ({ ...p, drainTargetIsManual: true }) }), null, NOW);
    expect(manual.rows[0]).toMatchObject({ uuid: ACCOUNT.three, routingWhy: 'manual' });
    const other = accountsViewModel(await read({ pins: (p) => ({ ...p, drainTarget: ACCOUNT.one }) }), null, NOW);
    expect(other.rows[0]).toMatchObject({ email: '1@example.test', role: 'routing', routingWhy: 'relay_choice' });
  });

  it('an account needing reauthentication is dimmed state, sorts last, and never takes the routing mark', async () => {
    const snapshot = await read({ accounts: (a) => a.map((x) => (x.email === '5@example.test' ? { ...x, needsReauthentication: true } : x)) });
    const model = accountsViewModel(snapshot, null, NOW);
    expect(emails(model)).toEqual(['3@example.test', '4@example.test', '1@example.test', '2@example.test', '5@example.test']);
    expect(model.rows.at(-1)).toMatchObject({ state: 'needs_reauth', role: 'other' });
    expect(model.rows[0]).toMatchObject({ email: '3@example.test', routingWhy: 'weekly_resets_soonest' });
  });

  it('one column for two accounts; a relay that is down says why', async () => {
    const snapshot = await read({ accounts: (a) => a.slice(0, 2) });
    const model = accountsViewModel(snapshot, relay(false), NOW);
    expect(model.columns).toBe(1);
    expect(model.relayLine).toBe('Relay not answering · connect ECONNREFUSED 127.0.0.1:8641');
  });

  it('no readings, and no data at all', async () => {
    const snapshot = await read();
    const bare = { ...snapshot.accounts[0]!, windows: { fiveHour: null, sevenDay: null, scoped: [] } };
    expect(accountsViewModel({ ...snapshot, accounts: [bare] }, null, NOW).rows[0]).toMatchObject({ state: 'no_readings', limits: [] });
    expect(accountsViewModel({ ...snapshot, available: false }, null, NOW).rows).toEqual([]);
  });
});

describe('automaticChoice re-runs the relay\'s order', () => {
  it('an account at 100 % is rejected; ties on the weekly reset keep the incumbent, then the lower 5-hour percent', async () => {
    const { accounts } = await read();
    expect(automaticChoice(accounts, ACCOUNT.three, NOW)).toBe(ACCOUNT.three);
    // Without 3@, 4@ (5h at 100 %, weekly 10-02) is rejected, so the next earliest weekly reset is 5@'s 10-03.
    expect(automaticChoice(accounts.filter((a) => a.uuid !== ACCOUNT.three), null, NOW)).toBe(ACCOUNT.five);
    const week = accounts.find((a) => a.uuid === ACCOUNT.three)!.windows.sevenDay!;
    const tied = accounts.map((a) => (a.uuid === ACCOUNT.one ? { ...a, windows: { ...a.windows, sevenDay: week } } : a));
    expect(automaticChoice(tied, ACCOUNT.one, NOW)).toBe(ACCOUNT.one); // the incumbent keeps a tie
    expect(automaticChoice(tied, null, NOW)).toBe(ACCOUNT.three); // else the lower 5-hour percent: 53 against 77
  });
});

// W6 start: the top bar's pill and the rest of the copy of ClaudeUsage's panel (E1)
describe('the usage pill and popover model (W6)', () => {
  it("colours by ClaudeUsage's rule for a reading without severity: 75 % a warning, 95 % critical", () => {
    expect([0, 74, 75, 94, 95, 100].map(severityOf)).toEqual(['normal', 'normal', 'warning', 'warning', 'critical', 'critical']);
  });

  it("the pill is the routing account's most binding percent in its worst severity", async () => {
    const model = accountsViewModel(await read(), null, NOW);
    expect(usagePill(model)).toEqual({ percent: 82, severity: 'warning', dimmed: false, account: '3@example.test', limit: 'Fable' });
    expect(model.rows.find((r) => r.email === '4@example.test')!.limits[0]).toMatchObject({ percent: 100, severity: 'critical' });
    // the drain target needing reauthentication dims the pill; with no drain target the panel's first account shows
    const reauth = await read({ accounts: (a) => a.map((x) => (x.email === '3@example.test' ? { ...x, needsReauthentication: true } : x)) });
    expect(usagePill(accountsViewModel(reauth, null, NOW))).toMatchObject({ percent: 82, dimmed: true });
    const none = await read({ pins: (p) => ({ ...p, drainTarget: null }) });
    expect(usagePill(accountsViewModel(none, null, NOW))).toMatchObject({ account: '4@example.test', percent: 100, severity: 'critical' });
  });

  it('the pill has nothing to show without data or readings', async () => {
    const snapshot = await read();
    expect(usagePill(null)).toEqual({ percent: null, severity: null, dimmed: false, account: null, limit: null });
    expect(usagePill(accountsViewModel({ ...snapshot, available: false }, null, NOW)).percent).toBeNull();
    const bare = snapshot.accounts.map((a) => ({ ...a, windows: { fiveHour: null, sevenDay: null, scoped: [] } }));
    expect(usagePill(accountsViewModel({ ...snapshot, accounts: bare }, null, NOW))).toMatchObject({ percent: null, severity: null, account: '3@example.test' });
  });

  it("carries each account's last ten minutes, the newest server, the Codex section, the toggle and the health line", async () => {
    const model = accountsViewModel(await read(), null, NOW);
    const row = (email: string) => [...model.rows, ...model.codex!].find((r) => r.email === email)!;
    expect(row('3@example.test')).toMatchObject({ activity: { requests: 5 }, latest: true, severity: 'warning' });
    expect(row('1@example.test')).toMatchObject({ activity: { requests: 1 }, latest: false });
    expect(row('2@example.test')).toMatchObject({ activity: null, latest: false });
    expect(model.codex!.map((r) => [r.email, r.role, r.state, r.pinnedSessionCount, r.provider, r.limits.length])).toEqual([
      ['6@example.test', 'routing', 'no_readings', 2, 'codex', 0],
      ['7@example.test', 'other', 'needs_reauth', 1, 'codex', 0],
    ]);
    expect(row('6@example.test')).toMatchObject({ routingWhy: 'relay_choice', activity: { requests: 1 }, latest: false });
    expect(model.gateway).toEqual({ routingEnabled: true, port: 8641 });
    expect(model.health).toEqual({ line: 'Last 10 min: 8 requests · response start median 1.0s, p95 3.2s · 1 stall, 1 connection error, 1 refused, 1 held', degraded: true });
  });

  it("writes the health line as ClaudeUsage's GatewayHealthText does", () => {
    const quiet = { requests: 1, served: 1, firstByteP50: 12.4, firstByteP95: 12.4, stalls: 0, transportFailures: 0, refused: 0, unreachable: 0, held: 0 };
    expect(healthLine(quiet)).toEqual({ line: 'Last 10 min: 1 request · response start median 12s, p95 12s · no errors', degraded: false });
    expect(healthLine({ ...quiet, firstByteP50: null, unreachable: 2, transportFailures: 2 })).toEqual({ line: 'Last 10 min: 1 request · 2 connection errors, 2 unreachable', degraded: true });
    expect(healthLine({ ...quiet, requests: 0 })).toBeNull();
  });
});
// W6 end
