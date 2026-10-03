import { expect, it } from 'vitest';
import type { AccountUsage, UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { fakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { useUsage } from '../stores/usage';
import { connectStatusLine } from './index';

const NOW = Date.now();
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

it('keeps shared usage live without posting banners or reading/writing their retired layout key', async () => {
  const fake = fakeClient({ 'layout.get': { value: [] } }); window.maws = fake.client;
  useNotices.setState({ notices: [] });
  const off = connectStatusLine();
  try {
    await fake.reply('settings.usage', MIXED);
    expect(useUsage.getState().snapshot?.accounts).toHaveLength(3);
    expect(useNotices.getState().notices).toEqual([]);
    expect(fake.invoked('layout.get')).toEqual([]);
    fake.event('settings.usageChanged', { ...MIXED, readAt: at(1000) });
    await fake.reply('settings.usage', { ...MIXED, readAt: at(1000) });
    expect(useUsage.getState().snapshot?.readAt).toBe(at(1000));
    expect(fake.invoked('layout.set')).toEqual([]);
  } finally { off(); }
  const calls = fake.invoked('settings.usage').length;
  fake.event('settings.usageChanged', MIXED);
  expect(fake.invoked('settings.usage')).toHaveLength(calls);
});
