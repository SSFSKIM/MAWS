import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { AccountUsage, UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { record, status } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { createLayoutStore } from './layout';
import { createSessionsStore } from './sessions';
import { connectUsage, createUsageStore, ROUTE_HOLD_MS, windowsFor, type Windows } from './usage';

const w = (percent: number): UsageWindow => ({ percent, resetsAt: '2026-09-29T11:20:00Z', recordedAt: '2026-09-29T07:34:17Z' });
const windows = (five: number, seven: number): Windows => ({ fiveHour: w(five), sevenDay: w(seven), scoped: [] });

function account(uuid: string, win: Windows): AccountUsage {
  return {
    uuid, email: `${uuid}@example.test`, displayName: uuid, planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 0,
    credentialOwnership: null, windows: win,
  };
}

const SNAP: UsageSnapshot = {
  available: true, dataDir: '/cu', readAt: '2026-09-29T07:35:00Z', error: null, drainTarget: 'drain', drainTargetIsManual: false,
  accounts: [account('drain', windows(53, 63)), account('other', windows(77, 44))], pinsFor: { 'eng-pinned': 'other' }, gateway: null, codex: null, activity: null,
};

describe('usage store: windowsFor', () => {
  it('returns the pinned account’s windows for a record whose engine id is in pinsFor, the drain target’s otherwise', () => {
    const usage = createUsageStore();
    usage.getState().applySnapshot(SNAP);
    const pinned = windowsFor(usage.getState(), record('pinned'), null);
    expect(pinned).toMatchObject({ source: 'pinned', account: { uuid: 'other' }, windows: windows(77, 44) });
    const unpinned = windowsFor(usage.getState(), record('free'), null);
    expect(unpinned).toMatchObject({ source: 'drain', account: { uuid: 'drain' }, windows: windows(53, 63) });
    expect(usage.getState().windows).toEqual(windows(53, 63)); // C5's field: the drain target's
  });

  it('returns the direct fallback’s for gateway.mode direct, and for an exited session whose record says unrouted', () => {
    const usage = createUsageStore();
    usage.getState().applySnapshot(SNAP);
    const base = status('pinned');
    const direct = { ...base, gateway: { ...base.gateway, mode: 'direct' as const } };
    expect(windowsFor(usage.getState(), record('pinned'), direct)).toEqual({ source: 'direct', account: null, windows: null, readAt: null });
    usage.getState().setDirect('pinned' as AppSessionId, { windows: windows(12, 34), readAt: '2026-09-29T08:00:00Z' });
    expect(windowsFor(usage.getState(), record('pinned'), direct)).toEqual({ source: 'direct', account: null, windows: windows(12, 34), readAt: '2026-09-29T08:00:00Z' });
    const unrouted = record('pinned', { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } });
    expect(windowsFor(usage.getState(), unrouted, null).source).toBe('direct');
  });

  it('has nothing to show before the first snapshot or when ClaudeUsage is unavailable', () => {
    const usage = createUsageStore();
    expect(windowsFor(usage.getState(), record('a'), null)).toEqual({ source: 'drain', account: null, windows: null, readAt: null });
    usage.getState().applySnapshot({ ...SNAP, available: false, accounts: [], drainTarget: null, error: 'absent' });
    expect(windowsFor(usage.getState(), record('a'), null).windows).toBeNull();
    expect(usage.getState().windows).toBeNull();
  });
});

// W6 route executor: a Route ClaudeUsage answered is laid over the snapshots until C7's reader names its drain target.
describe('usage store: a Route ClaudeUsage answered', () => {
  const THREE: UsageSnapshot = { ...SNAP, accounts: [...SNAP.accounts, account('third', windows(5, 6))] };
  const naming = (drainTarget: string, drainTargetIsManual: boolean): UsageSnapshot => ({ ...THREE, drainTarget, drainTargetIsManual });
  afterEach(() => vi.useRealTimers());

  it('holds over every snapshot, an event’s or a reply’s, until one names its drain target, then follows them', () => {
    const usage = createUsageStore();
    usage.getState().applySnapshot(THREE);
    usage.getState().applyRoute('other', true);
    expect(usage.getState().snapshot).toMatchObject({ drainTarget: 'other', drainTargetIsManual: true });
    expect(usage.getState().windows).toEqual(windows(77, 44));
    usage.getState().applySnapshot({ ...THREE, readAt: '2026-09-29T07:35:05Z', pinsFor: {} }, 'merge'); // an unrelated file changed
    expect(usage.getState().snapshot).toMatchObject({ drainTarget: 'other', drainTargetIsManual: true, readAt: '2026-09-29T07:35:05Z' });
    expect(usage.getState().windows).toEqual(windows(77, 44));
    expect(usage.getState().pinsFor).toEqual({ 'eng-pinned': 'other' });
    usage.getState().applySnapshot(THREE); // settings.usage's reply
    expect(usage.getState().snapshot!.drainTarget).toBe('other');
    usage.getState().applySnapshot(naming('other', true)); // the reader caught up
    expect(usage.getState().snapshot).toMatchObject({ drainTarget: 'other', drainTargetIsManual: true });
    usage.getState().applySnapshot(naming('third', false)); // ClaudeUsage moved on by itself: the reader is the word again
    expect(usage.getState().snapshot).toMatchObject({ drainTarget: 'third', drainTargetIsManual: false });
    expect(usage.getState().windows).toEqual(windows(5, 6));
  });

  it('lets go after its bound, and another Route replaces it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.parse('2026-09-29T07:35:00Z'));
    const usage = createUsageStore();
    usage.getState().applySnapshot(THREE);
    usage.getState().applyRoute('other', true);
    vi.advanceTimersByTime(ROUTE_HOLD_MS - 1);
    usage.getState().applySnapshot(THREE);
    expect(usage.getState().snapshot!.drainTarget).toBe('other');
    vi.advanceTimersByTime(1);
    usage.getState().applySnapshot(THREE);
    expect(usage.getState().snapshot).toMatchObject({ drainTarget: 'drain', drainTargetIsManual: false });

    usage.getState().applyRoute('other', true);
    usage.getState().applyRoute('third', false);
    usage.getState().applySnapshot(naming('other', true)); // the first Route's write, overtaken by the second
    expect(usage.getState().snapshot).toMatchObject({ drainTarget: 'third', drainTargetIsManual: false });
    expect(usage.getState().windows).toEqual(windows(5, 6));
  });
});

describe('usage store: connectUsage', () => {
  const setup = () => {
    const fake = fakeClient();
    const usage = createUsageStore();
    const sessions = createSessionsStore();
    const layout = createLayoutStore();
    sessions.getState().applyList({ sessions: [record('a'), record('b'), record('c', { engineSessionId: null })], revision: 1 });
    layout.setState({ hydrated: true });
    return { fake, usage, sessions, layout };
  };

  it('subscribes before it asks, and asks with the engine ids of the open session tabs', async () => {
    const { fake, usage, sessions, layout } = setup();
    layout.getState().openSession('a' as AppSessionId);
    layout.getState().openSession('c' as AppSessionId);
    const off = connectUsage(fake.client, { usage, sessions, layout });
    expect(fake.calls.slice(0, 2)).toEqual(['on settings.usageChanged', 'invoke settings.usage']);
    expect(fake.invoked('settings.usage')).toEqual([{ engineSessionIds: ['eng-a'] }]);
    await fake.reply('settings.usage', { ...SNAP, pinsFor: { 'eng-a': 'other' } });
    expect(usage.getState().pinsFor).toEqual({ 'eng-a': 'other' });
    off();
  });

  it('asks again when the open tabs change, and not when they do not', async () => {
    const { fake, usage, sessions, layout } = setup();
    const off = connectUsage(fake.client, { usage, sessions, layout });
    await fake.reply('settings.usage', SNAP);
    layout.getState().openSession('b' as AppSessionId);
    expect(fake.invoked('settings.usage').at(-1)).toEqual({ engineSessionIds: ['eng-b'] });
    await fake.reply('settings.usage', SNAP);
    layout.getState().setSplitRatio(0.4);
    expect(fake.invoked('settings.usage')).toHaveLength(2);
    off();
  });

  it('applies settings.usageChanged at once, keeps its pins beside the held ones, and asks again for the open tabs', async () => {
    const { fake, usage, sessions, layout } = setup();
    layout.getState().openSession('a' as AppSessionId);
    const off = connectUsage(fake.client, { usage, sessions, layout });
    await fake.reply('settings.usage', { ...SNAP, pinsFor: { 'eng-a': 'other' } });
    fake.event('settings.usageChanged', { ...SNAP, accounts: [account('drain', windows(60, 63))], pinsFor: {} });
    expect(usage.getState().windows?.fiveHour?.percent).toBe(60);
    expect(usage.getState().pinsFor).toEqual({ 'eng-a': 'other' });
    expect(fake.invoked('settings.usage')).toHaveLength(2);
    off();
  });

  it('drops a reply that an event overtook', async () => {
    const { fake, usage, sessions, layout } = setup();
    const off = connectUsage(fake.client, { usage, sessions, layout });
    fake.event('settings.usageChanged', { ...SNAP, accounts: [account('drain', windows(60, 63))] });
    await fake.reply('settings.usage', SNAP); // asked before the event: stale
    expect(usage.getState().windows?.fiveHour?.percent).toBe(60);
    off();
  });
});
