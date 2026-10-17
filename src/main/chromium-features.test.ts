import { describe, expect, it } from 'vitest';
import { disableChromiumFeatures, STARTUP_DISABLED_FEATURES } from './chromium-features';

// The slice of Electron's `app.commandLine` the seam uses; appendSwitch replaces the key's value the way Chromium's switch map does.
function commandLine(initial: Record<string, string> = {}) {
  const switches = new Map(Object.entries(initial));
  return {
    switches,
    hasSwitch: (name: string) => switches.has(name),
    getSwitchValue: (name: string) => switches.get(name) ?? '',
    appendSwitch: (name: string, value?: string) => void switches.set(name, value ?? ''),
  };
}

describe('disableChromiumFeatures (P3-F1 fix 3)', () => {
  it('turns WebRtcHideLocalIpsWithMdns off app-wide, so ICE gathering never starts the mDNS responder on *:5353', () => {
    expect(STARTUP_DISABLED_FEATURES).toContain('WebRtcHideLocalIpsWithMdns');
    const line = commandLine();
    disableChromiumFeatures(line, STARTUP_DISABLED_FEATURES);
    expect(line.switches.get('disable-features')).toBe('WebRtcHideLocalIpsWithMdns');
  });

  it('keeps the features a launch already disabled, in one comma-separated switch', () => {
    const line = commandLine({ 'disable-features': 'Foo,Bar' });
    disableChromiumFeatures(line, ['WebRtcHideLocalIpsWithMdns']);
    expect(line.switches.get('disable-features')).toBe('Foo,Bar,WebRtcHideLocalIpsWithMdns');
    expect(line.switches.size).toBe(1);
  });

  it('does not repeat a feature the launch already disabled, nor one listed twice', () => {
    const line = commandLine({ 'disable-features': 'Foo,WebRtcHideLocalIpsWithMdns' });
    disableChromiumFeatures(line, ['WebRtcHideLocalIpsWithMdns', 'WebRtcHideLocalIpsWithMdns']);
    expect(line.switches.get('disable-features')).toBe('Foo,WebRtcHideLocalIpsWithMdns');
  });

  it('ignores empty entries and spaces in the existing list', () => {
    const line = commandLine({ 'disable-features': ' Foo,, Bar ,' });
    disableChromiumFeatures(line, ['Baz']);
    expect(line.switches.get('disable-features')).toBe('Foo,Bar,Baz');
  });
});
