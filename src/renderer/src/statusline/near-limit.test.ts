import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountUsage, UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { fakeClient } from '../../../../test/support/fake-client';
import { createNoticesStore } from '../stores/notices';
import { createSettingsStore } from '../stores/settings';
import { createUsageStore } from '../stores/usage';
import { bannerKey, connectNearLimitBanners, nearLimitBanners, thresholdFrom } from './near-limit';
import { SETTINGS_DEFAULTS_V6 } from '@shared/settings/defaults';

const NOW = Date.parse('2026-09-29T08:00:00Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const HOUR = 3_600_000;

const win = (percent: number, resetsInMs = 2 * HOUR): UsageWindow => ({ percent, resetsAt: at(resetsInMs), recordedAt: at(-60_000) });

function account(uuid: string, email: string, windows: Partial<AccountUsage['windows']>): AccountUsage {
  return {
    uuid, email, displayName: email, planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 0, credentialOwnership: null,
    windows: { fiveHour: null, sevenDay: null, scoped: [], ...windows },
  };
}

function snapshot(accounts: AccountUsage[]): UsageSnapshot {
  return { available: true, dataDir: '/x', readAt: at(0), error: null, drainTarget: accounts[0]?.uuid ?? null, drainTargetIsManual: false, accounts, pinsFor: {}, gateway: null, codex: null, activity: null };
}

// One 92 % 5-hour window, one 100 % weekly window, one 89 % window, one 80 % scoped window, one past 95 % window.
const MIXED = snapshot([
  account('a1', 'one@example.test', { fiveHour: win(92, 3 * HOUR), sevenDay: win(89, 50 * HOUR) }),
  account('a2', 'two@example.test', { sevenDay: win(100, 26 * HOUR), scoped: [{ model: 'Fable', window: win(80, 30 * HOUR) }] }),
  account('a3', 'three@example.test', { fiveHour: win(95, -HOUR) }),
]);

describe('near-limit banner posts once per window', () => {
  it('yields one banner per window at or over the threshold whose reset is ahead', () => {
    const banners = nearLimitBanners(MIXED, [], { now: NOW });
    expect(banners.map((b) => b.key)).toEqual([bannerKey('a1', 'session', at(3 * HOUR)), bannerKey('a2', 'weekly_all', at(26 * HOUR))]);
    expect(banners[0].text).toBe('5-hour window at 92% for one@example.test · resets in 3h 0m');
    expect(banners[1].text).toBe('Weekly window at 100% for two@example.test · resets in 1d 2h');
  });

  it('a window at 80 % yields a banner only under thresholdPercent 80, naming 80 %', () => {
    const banners = nearLimitBanners(MIXED, [], { now: NOW, thresholdPercent: 80 });
    const fable = banners.find((b) => b.key === bannerKey('a2', 'weekly_scoped#Fable', at(30 * HOUR)));
    expect(fable?.text).toBe('Weekly Fable window at 80% for two@example.test · resets in 1d 6h');
    expect(banners.map((b) => b.key)).toContain(bannerKey('a1', 'weekly_all', at(50 * HOUR))); // 89 % under 80
    expect(banners.some((b) => b.key.startsWith('usage:a3:'))).toBe(false); // the past reset never
  });

  it('never yields a dismissed key', () => {
    const dismissed = [bannerKey('a1', 'session', at(3 * HOUR))];
    expect(nearLimitBanners(MIXED, dismissed, { now: NOW }).map((b) => b.key)).toEqual([bannerKey('a2', 'weekly_all', at(26 * HOUR))]);
  });

  it('treats reset times within 90 s as one window: a dismissed key still names it when ClaudeUsage’s resetsAt moves', () => {
    const jittered = (resetsAt: string) => snapshot([account('a1', 'one@example.test', { fiveHour: { percent: 95, resetsAt, recordedAt: at(0) } })]);
    // the fixture's own jitter (07:49:59Z, then 07:50:00Z), and one straddling a half minute
    expect(nearLimitBanners(jittered('2026-09-29T09:50:00Z'), ['usage:a1:session:2026-09-29T09:49:59Z'], { now: NOW })).toEqual([]);
    expect(nearLimitBanners(jittered('2026-09-29T09:50:31Z'), ['usage:a1:session:2026-09-29T09:50:29Z'], { now: NOW })).toEqual([]);
    // two minutes apart is another window, and another account or limit is never the same one
    expect(nearLimitBanners(jittered('2026-09-29T09:52:00Z'), ['usage:a1:session:2026-09-29T09:50:00Z'], { now: NOW }).map((b) => b.key)).toEqual(['usage:a1:session:2026-09-29T09:52:00Z']);
    expect(nearLimitBanners(jittered('2026-09-29T09:50:00Z'), ['usage:a2:session:2026-09-29T09:50:00Z', 'usage:a1:weekly_all:2026-09-29T09:50:00Z'], { now: NOW })).toHaveLength(1);
    expect(bannerKey('aa9db20d', 'session', '2026-09-29T07:49:59.000Z')).toBe('usage:aa9db20d:session:2026-09-29T07:49:59Z');
  });

  it('reads the threshold from settings v3’s usage.nearLimitPercent, 90 before the settings are read', () => {
    expect(thresholdFrom(null)).toBe(90);
    expect(thresholdFrom(SETTINGS_DEFAULTS_V6)).toBe(90);
    expect(thresholdFrom({ ...SETTINGS_DEFAULTS_V6, usage: { nearLimitPercent: 75 } })).toBe(75);
  });
});

describe('near-limit banner posts once per window: the notices adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  const setup = (dismissed: string[] | null = []) => {
    const fake = fakeClient({ 'layout.get': { value: dismissed }, 'layout.set': undefined });
    const usage = createUsageStore();
    const notices = createNoticesStore();
    const settings = createSettingsStore(fake.client);
    const off = connectNearLimitBanners({ client: fake.client, usage, notices, settings });
    const banners = () => notices.getState().notices.filter((n) => n.kind === 'banner');
    return { fake, usage, notices, settings, off, banners };
  };

  it('posts nothing until the dismissed keys are read, then each qualifying window once, keyed by its id', async () => {
    const { usage, banners, off } = setup();
    usage.getState().applySnapshot(MIXED);
    await vi.advanceTimersByTimeAsync(0);
    expect(banners().map((b) => b.id)).toEqual([bannerKey('a1', 'session', at(3 * HOUR)), bannerKey('a2', 'weekly_all', at(26 * HOUR))]);
    expect(banners()[0]).toMatchObject({ level: 'warning', dismissible: true });
    usage.getState().applySnapshot({ ...MIXED, readAt: at(1000) }); // the same windows again
    expect(banners()).toHaveLength(2);
    off();
  });

  it('a dismissal is written to usage.banners and the window never returns in this run or the next', async () => {
    const first = setup();
    first.usage.getState().applySnapshot(MIXED);
    await vi.advanceTimersByTimeAsync(0);
    const key = bannerKey('a1', 'session', at(3 * HOUR));
    first.notices.getState().dismiss(key); // the banner host's dismiss control
    await vi.advanceTimersByTimeAsync(0);
    expect(first.fake.invoked('layout.set')).toEqual([{ key: 'usage.banners', value: [key] }]);
    first.usage.getState().applySnapshot({ ...MIXED, readAt: at(2000) });
    expect(first.banners().map((b) => b.id)).not.toContain(key);
    first.off();

    const next = setup([key]); // a reload: the key comes back from layout.json
    next.usage.getState().applySnapshot(MIXED);
    await vi.advanceTimersByTimeAsync(0);
    expect(next.banners().map((b) => b.id)).toEqual([bannerKey('a2', 'weekly_all', at(26 * HOUR))]);
    next.off();
  });

  it('a window whose reset time moves by a second keeps its first key: one banner, refreshed in place, and after a dismissal and a reload none', async () => {
    const reading = (resetsAt: string) => snapshot([account('a4', 'four@example.test', { fiveHour: { percent: 99, resetsAt, recordedAt: at(0) } })]);
    const first = setup();
    first.usage.getState().applySnapshot(reading('2026-09-29T09:49:59Z'));
    await vi.advanceTimersByTimeAsync(0);
    first.usage.getState().applySnapshot(reading('2026-09-29T09:50:00Z'));
    expect(first.banners().map((b) => b.id)).toEqual(['usage:a4:session:2026-09-29T09:49:59Z']);
    first.notices.getState().dismiss('usage:a4:session:2026-09-29T09:49:59Z');
    await vi.advanceTimersByTimeAsync(0);
    first.off();

    const reloaded = setup(['usage:a4:session:2026-09-29T09:49:59Z']);
    reloaded.usage.getState().applySnapshot(reading('2026-09-29T09:50:00Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reloaded.banners()).toEqual([]);
    reloaded.off();
  });

  it('measures the 90 s tolerance reading to reading: a reset time drifting a minute per reading stays one banner, and a drifted dismissal is recorded again so a reload still finds it', async () => {
    const reading = (resetsAt: string) => snapshot([account('a5', 'five@example.test', { fiveHour: { percent: 99, resetsAt, recordedAt: at(0) } })]);
    const first = setup();
    for (const resetsAt of ['2026-09-29T09:50:00Z', '2026-09-29T09:51:00Z', '2026-09-29T09:52:00Z', '2026-09-29T09:53:00Z']) {
      first.usage.getState().applySnapshot(reading(resetsAt));
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(first.banners().map((b) => b.id)).toEqual(['usage:a5:session:2026-09-29T09:50:00Z']); // three minutes from its first key, one window
    first.notices.getState().dismiss('usage:a5:session:2026-09-29T09:50:00Z');
    await vi.advanceTimersByTimeAsync(0);
    first.usage.getState().applySnapshot(reading('2026-09-29T09:54:00Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(first.banners()).toEqual([]);
    // the dismissal is written, then written again at the drifted reading, so the next run measures from there
    expect(first.fake.invoked('layout.set').at(-1)).toEqual({ key: 'usage.banners', value: ['usage:a5:session:2026-09-29T09:54:00Z'] });
    first.off();

    const reloaded = setup(['usage:a5:session:2026-09-29T09:54:00Z']);
    reloaded.usage.getState().applySnapshot(reading('2026-09-29T09:55:00Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reloaded.banners()).toEqual([]);
    reloaded.off();
  });

  it('a banner dismissed after its window drifted is recorded at its latest reading, so a reload at once still finds it', async () => {
    const reading = (resetsAt: string) => snapshot([account('a6', 'six@example.test', { fiveHour: { percent: 99, resetsAt, recordedAt: at(0) } })]);
    const first = setup();
    for (const resetsAt of ['2026-09-29T09:50:00Z', '2026-09-29T09:51:00Z', '2026-09-29T09:52:00Z']) {
      first.usage.getState().applySnapshot(reading(resetsAt));
      await vi.advanceTimersByTimeAsync(0);
    }
    first.notices.getState().dismiss('usage:a6:session:2026-09-29T09:50:00Z');
    await vi.advanceTimersByTimeAsync(0);
    expect(first.fake.invoked('layout.set')).toEqual([{ key: 'usage.banners', value: ['usage:a6:session:2026-09-29T09:52:00Z'] }]);
    first.off();

    const reloaded = setup(['usage:a6:session:2026-09-29T09:52:00Z']);
    reloaded.usage.getState().applySnapshot(reading('2026-09-29T09:52:00Z'));
    await vi.advanceTimersByTimeAsync(0);
    expect(reloaded.banners()).toEqual([]);
    reloaded.off();
  });

  it('keeps usage.banners to the newest fifty keys', async () => {
    const old = Array.from({ length: 50 }, (_, i) => `usage:old:${i}`);
    const { usage, notices, fake, off } = setup(old);
    usage.getState().applySnapshot(MIXED);
    await vi.advanceTimersByTimeAsync(0);
    notices.getState().dismiss(bannerKey('a1', 'session', at(3 * HOUR)));
    await vi.advanceTimersByTimeAsync(0);
    const written = fake.invoked('layout.set')[0] as { value: string[] };
    expect(written.value).toHaveLength(50);
    expect(written.value[0]).toBe('usage:old:1');
    expect(written.value[49]).toBe(bannerKey('a1', 'session', at(3 * HOUR)));
    off();
  });

  it('refreshes a shown banner’s countdown and withdraws it once its window resets, without recording a dismissal', async () => {
    const { usage, banners, fake, off } = setup();
    usage.getState().applySnapshot(MIXED);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(banners()[0].text).toBe('5-hour window at 92% for one@example.test · resets in 2h 0m');
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(banners().map((b) => b.id)).toEqual([bannerKey('a2', 'weekly_all', at(26 * HOUR))]);
    expect(fake.invoked('layout.set')).toEqual([]);
    off();
  });

  it('takes its threshold from the settings’ usage.nearLimitPercent, so an 80 % window posts under 80', async () => {
    const { usage, banners, settings: settingsStore, off } = setup();
    const fable = bannerKey('a2', 'weekly_scoped#Fable', at(30 * HOUR));
    usage.getState().applySnapshot(MIXED);
    await vi.advanceTimersByTimeAsync(0);
    expect(banners().map((b) => b.id)).not.toContain(fable);
    // C11's field (settings v3): the state as main sends it
    const state = { settings: { ...SETTINGS_DEFAULTS_V6, theme: 'system' as const, usage: { nearLimitPercent: 80 } }, resolvedTheme: 'light' as const };
    settingsStore.setState({ state });
    expect(banners().map((b) => b.id)).toContain(fable);
    off();
  });

  it('posts nothing while ClaudeUsage is unavailable', async () => {
    const { usage, banners, off } = setup();
    usage.getState().applySnapshot({ ...MIXED, available: false, error: 'absent' });
    await vi.advanceTimersByTimeAsync(0);
    expect(banners()).toEqual([]);
    off();
  });
});
