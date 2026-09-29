import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_V3 } from '@shared/settings/defaults';
import { fakeClient } from '../../../../test/support/fake-client';
import { createSettingsStore } from '../stores/settings';
import { connectGatewaySettings, createGatewayStore } from './store';

const HEALTH = { url: 'http://127.0.0.1:8641', ok: true, status: 200, latencyMs: 3, checkedAt: '2026-09-29T08:00:00.000Z', error: null };
const STATUS = { installed: true, running: true, bundleId: 'com.haegi.ClaudeUsage', dataDirPresent: true, checkedAt: '2026-09-29T08:00:00.000Z' };

describe('gateway store', () => {
  it('keeps the relay health and ClaudeUsage status it last read, and rejects a failed read without touching them', async () => {
    const fake = fakeClient({ 'engine.relayHealth': HEALTH, 'settings.claudeUsage.status': STATUS });
    const gateway = createGatewayStore(fake.client);
    expect(await gateway.getState().refreshRelay(false)).toEqual(HEALTH);
    expect(fake.invoked('engine.relayHealth')).toEqual([{ force: false }]);
    expect(gateway.getState()).toMatchObject({ relay: HEALTH, relayCheckedAt: HEALTH.checkedAt });
    expect(await gateway.getState().refreshClaudeUsage()).toEqual(STATUS);
    expect(gateway.getState().claudeUsage).toEqual(STATUS);

    const failing = fakeClient();
    const other = createGatewayStore(failing.client);
    const refused = expect(other.getState().refreshRelay(true)).rejects.toThrow('engine-host is restarting');
    await failing.fail('engine.relayHealth', 'engine-host is restarting');
    await refused;
    expect(other.getState().relay).toBeNull();
  });

  it('follows settings.changed for the launch policy, the Direct option and the near-limit threshold', () => {
    const settingsClient = fakeClient();
    const settings = createSettingsStore(settingsClient.client);
    const gateway = createGatewayStore(fakeClient().client);
    expect(gateway.getState()).toMatchObject({ policy: 'ask', offerDirect: true, threshold: 90 });
    const off = connectGatewaySettings(gateway, settings);
    settings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V3, gateway: { defaultRoute: 'gateway', relayUnreachable: 'wait', offerDirect: false }, usage: { nearLimitPercent: 80 } }, resolvedTheme: 'light' } });
    expect(gateway.getState()).toMatchObject({ policy: 'wait', offerDirect: false, threshold: 80 });
    off();
    settings.setState({ state: { settings: SETTINGS_DEFAULTS_V3, resolvedTheme: 'light' } });
    expect(gateway.getState().policy).toBe('wait');
  });
});
