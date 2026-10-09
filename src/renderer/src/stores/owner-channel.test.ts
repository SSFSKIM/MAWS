import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { OwnerChannelState } from '@shared/owner/state';
import { fakeClient } from '../../../../test/support/fake-client';
import { attachOwnerChannel, resetOwnerChannelStore, useOwnerChannelStore } from './owner-channel';

const APP = 'app-1' as AppSessionId;
const OTHER = 'app-2' as AppSessionId;
const stateOf = (appSessionId: AppSessionId, on: boolean): OwnerChannelState => ({
  appSessionId, lane: { on, override: 'inherit', applied: null, pending: null, mismatch: null }, marks: [],
});
const held = (appSessionId = APP) => useOwnerChannelStore.getState().bySession.get(appSessionId);
const settings = (enabled: boolean) => ({ settings: { mods: { toHuman: { enabled } } } });

afterEach(resetOwnerChannelStore);

describe('the owner channel store holds each attached session’s lane and marks as main reports them', () => {
  it('subscribes before it reads the state, then follows the changes for its session only', async () => {
    const f = fakeClient();
    const off = attachOwnerChannel(APP, f.client);
    expect(f.calls).toEqual(['on ownerChannel.changed', 'on settings.changed', 'invoke ownerChannel.state']);
    await f.reply('ownerChannel.state', stateOf(APP, true));
    expect(held()).toEqual(stateOf(APP, true));
    f.event('ownerChannel.changed', { appSessionId: OTHER, state: stateOf(OTHER, true) });
    f.event('ownerChannel.changed', { appSessionId: APP, state: stateOf(APP, false) });
    expect(held()).toEqual(stateOf(APP, false));
    expect(held(OTHER)).toBeUndefined();
    off();
  });

  it('keeps a change that raced the read: the event is the newer fact', async () => {
    const f = fakeClient();
    attachOwnerChannel(APP, f.client);
    f.event('ownerChannel.changed', { appSessionId: APP, state: stateOf(APP, false) });
    await f.reply('ownerChannel.state', stateOf(APP, true));
    expect(held()).toEqual(stateOf(APP, false));
  });

  it('holds nothing for a session main cannot answer for, so it draws as before', async () => {
    const f = fakeClient();
    attachOwnerChannel(APP, f.client);
    await f.fail('ownerChannel.state');
    expect(held()).toBeUndefined();
  });

  it('reads the state again when the app’s switch moves, which main announces only for marked sessions', async () => {
    const f = fakeClient();
    attachOwnerChannel(APP, f.client);
    await f.reply('ownerChannel.state', stateOf(APP, true));
    f.event('settings.changed', settings(true)); // the first one read again: what the switch was is not known before it
    await f.reply('ownerChannel.state', stateOf(APP, true));
    f.event('settings.changed', settings(true)); // another setting moved
    expect(f.pending('ownerChannel.state')).toBe(0);
    f.event('settings.changed', settings(false));
    await f.reply('ownerChannel.state', stateOf(APP, false));
    expect(held()).toEqual(stateOf(APP, false));
  });

  it('shares one subscription between holders and lets go after the last', async () => {
    const f = fakeClient();
    const first = attachOwnerChannel(APP, f.client);
    const second = attachOwnerChannel(APP, f.client);
    expect(f.calls.filter((call) => call === 'invoke ownerChannel.state')).toHaveLength(1);
    await f.reply('ownerChannel.state', stateOf(APP, true));
    first();
    f.event('ownerChannel.changed', { appSessionId: APP, state: stateOf(APP, false) });
    expect(held()?.lane.on).toBe(false);
    second();
    f.event('ownerChannel.changed', { appSessionId: APP, state: stateOf(APP, true) });
    expect(held()?.lane.on).toBe(false);
  });
});
