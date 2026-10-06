// routingFacts and paceLine (C11 execution document, Interfaces "Gateway", *Routing facts*; M4's pins and refresh tasks
// "the popover footer as C7 asked" and "the recorded route when it is unknown").
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V9 } from '@shared/settings/defaults';
import type { AccountUsage, UsageSnapshot } from '@shared/usage/types';
import { loadScenario } from '../../../../test/support/scenario';
import { paceLine, paceRunsOutAt, routingFacts, unstartedRoute } from './routing-facts';

const ROOT = join(__dirname, '../../../..');
const scenario = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
const READY = 'app-7412a115' as AppSessionId; // routed, idle, live
const recordOf = (id: string): SessionRecord => scenario.sessions.find((r) => r.appId === id)!;
const statusOf = (id: string): EngineSessionStatus => scenario.engine.find((s) => s.appSessionId === id)!;
const record = recordOf(READY);
const routed: EngineSessionStatus = { ...statusOf(READY), gateway: { ...statusOf(READY).gateway, mode: 'gateway', verified: 'routed', baseUrl: 'http://127.0.0.1:8641' } };
const direct: EngineSessionStatus = { ...routed, gateway: { ...routed.gateway, mode: 'direct', verified: 'direct', baseUrl: null } };

const account = (uuid: string, email: string): AccountUsage => ({
  uuid, email, displayName: email, planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 0, credentialOwnership: null,
  windows: { fiveHour: null, sevenDay: null, scoped: [] },
});
const snapshot = (pinsFor: Record<string, string> = {}): UsageSnapshot => ({
  available: true, dataDir: '/x', readAt: '2026-09-29T07:36:17Z', error: null, drainTarget: 'u3', drainTargetIsManual: false,
  accounts: [account('u1', '1@example.test'), account('u3', '3@example.test')], pinsFor, gateway: null, codex: null, activity: null,
});
const settings = (patch: Partial<Settings['gateway']> = {}): Settings => ({ ...SETTINGS_DEFAULTS_V9, gateway: { ...SETTINGS_DEFAULTS_V9.gateway, ...patch } });

describe('routingFacts names the account and the switch', () => {
  it('a routed session: the relay sentence, the pinned account when pinsFor names it, Switch to Direct…', () => {
    const facts = routingFacts(record, routed, snapshot({ [record.engineSessionId!]: 'u1' }), settings(), null);
    expect(facts).toMatchObject({ route: 'gateway', line: "Routed through ClaudeUsage's relay", account: { email: '1@example.test', why: 'pinned' }, canSwitch: true, switchLabel: 'Switch to Direct…' });
    expect(facts.targets).toEqual(['direct']);
  });

  it('the drain target when the session is not pinned', () => {
    expect(routingFacts(record, routed, snapshot(), settings(), null).account).toEqual({ email: '3@example.test', why: 'routing' });
    expect(routingFacts(record, routed, null, settings(), null).account).toBeNull();
  });

  it('offerDirect false hides Switch to Direct… only', () => {
    const facts = routingFacts(record, routed, snapshot(), settings({ offerDirect: false }), null);
    expect(facts).toMatchObject({ canSwitch: false, targets: [] });
    expect(routingFacts(record, direct, snapshot(), settings({ offerDirect: false }), null)).toMatchObject({ canSwitch: true, switchLabel: 'Switch to gateway…' });
  });

  it("a direct session: the engine's own login with the Login row's value, no gateway models, Switch to gateway…", () => {
    const facts = routingFacts(record, direct, snapshot(), settings(), { login: 'Expired — log in again', email: null, organization: null });
    expect(facts).toMatchObject({
      route: 'direct',
      line: "Direct · engine's own login · Expired — log in again",
      note: 'no gateway models · usage windows from the engine',
      account: null,
      canSwitch: true,
      switchLabel: 'Switch to gateway…',
      targets: ['gateway'],
    });
    expect(routingFacts(record, direct, snapshot(), settings(), null).line).toBe("Direct · engine's own login");
  });

  it('a session without a status states the last route; one not held elsewhere can be started on the other route', () => {
    expect(routingFacts({ ...record, gateway: { ...record.gateway, routed: true } }, null, snapshot(), settings(), null)).toMatchObject({ route: 'gateway', line: 'Last ran routed', account: null, targets: ['direct'] });
    expect(routingFacts({ ...record, gateway: { ...record.gateway, routed: false } }, null, snapshot(), settings(), null)).toMatchObject({ route: 'direct', line: 'Last ran direct', targets: ['gateway'] });
  });

  it('an unknown recorded route is never a routing fact: route unknown, the default named, both targets offered', () => {
    const unknown = { ...record, gateway: { ...record.gateway, routed: null } };
    expect(routingFacts(unknown, null, snapshot(), settings(), null)).toMatchObject({
      route: 'unknown',
      line: 'Route not recorded · a resume uses the default route (gateway)',
      account: null,
      canSwitch: true,
      targets: ['gateway', 'direct'],
    });
    expect(routingFacts(unknown, null, snapshot(), settings({ defaultRoute: 'direct' }), null).line).toBe('Route not recorded · a resume uses the default route (direct)');
  });

  it('no switch for a session held elsewhere or archived, with the reason', () => {
    const foreign = recordOf('app-466b0d0d'); // held by a terminal
    expect(routingFacts(foreign, null, snapshot(), settings(), null)).toMatchObject({ canSwitch: false, targets: [], refusal: 'Held by a terminal · switch it there' });
    expect(routingFacts({ ...record, archived: true }, null, snapshot(), settings(), null)).toMatchObject({ canSwitch: false, refusal: 'Archived · unarchive it to switch' });
  });
});

// The architect's ruling (Decision Log, 2026-09-29, from C10's review): D-19's per-session Direct on an unstarted
// session is a choice of the intent's route (`session.intent.patch { gateway }`), restarting nothing. The footer reads it
// before routingFacts, which would call such a session's unrecorded route unknown and offer a restart.
describe('an unstarted session chooses its route and restarts nothing', () => {
  it('names the route the intent starts on and offers both', () => {
    expect(unstartedRoute({ gateway: 'gateway' }, settings())).toEqual({ route: 'gateway', line: "Starts routed through ClaudeUsage's relay", choices: ['gateway', 'direct'] });
    expect(unstartedRoute({ gateway: 'direct' }, settings())).toMatchObject({ route: 'direct', line: "Starts direct · engine's own login" });
  });

  it('offerDirect false offers no choice on a routed intent, and the way back on a direct one', () => {
    expect(unstartedRoute({ gateway: 'gateway' }, settings({ offerDirect: false })).choices).toEqual([]);
    expect(unstartedRoute({ gateway: 'direct' }, settings({ offerDirect: false })).choices).toEqual(['gateway', 'direct']);
  });

  it('what routingFacts would say of the same session, which is why the footer branches first', () => {
    const unstarted = { ...record, gateway: { ...record.gateway, routed: null } }; // a provisional record: no status, no route yet
    expect(routingFacts(unstarted, null, null, settings(), null)).toMatchObject({ route: 'unknown', targets: ['gateway', 'direct'] });
  });
});

describe('paceLine warns when the window runs out before it resets', () => {
  const NOW = Date.parse('2026-09-29T07:36:17Z'); // two minutes after the fixture's newest reading
  // test/fixtures/claude-usage/history/2aca3c4b…jsonl: 3@example.test's newest weekly_all reading
  const weekly = { percent: 63, resetsAt: '2026-09-30T03:59:59Z', recordedAt: '2026-09-29T07:26:14Z' };

  it("3@example.test's weekly at 63 % with about 20 h left shows nothing", () => {
    expect(paceRunsOutAt(weekly, 'weekly', NOW)).toBeNull();
    expect(paceLine(weekly, 'weekly', NOW)).toBeNull();
  });

  it('a copy at 90 % with three days left names the weekday and hour it runs out', () => {
    const copy = { ...weekly, percent: 90, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() };
    const at = paceRunsOutAt(copy, 'weekly', NOW)!;
    // 96 h elapsed at 90 %: 10 % more takes 96 / 9 h
    expect(at).toBeCloseTo(NOW + (96 / 9) * 3_600_000, -3);
    const weekday = new Date(at).toLocaleDateString('en-US', { weekday: 'short' });
    expect(paceLine(copy, 'weekly', NOW)).toMatch(new RegExp(`^At this rate weekly runs out ${weekday} \\d{1,2} (AM|PM), before it resets$`));
  });

  it('the 5-hour form names the time; nothing without a reading, at 0 % or at 100 %', () => {
    const five = { percent: 80, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString(), recordedAt: weekly.recordedAt };
    expect(paceLine(five, 'fiveHour', NOW)).toMatch(/^At this rate the 5-hour window runs out at \d{1,2}:\d{2} (AM|PM)$/);
    expect(paceLine(null, 'fiveHour', NOW)).toBeNull();
    expect(paceLine({ ...five, percent: 0 }, 'fiveHour', NOW)).toBeNull();
    expect(paceLine({ ...five, percent: 100 }, 'fiveHour', NOW)).toBeNull();
  });
});
