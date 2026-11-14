import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { disableChromiumFeatures, setBlinkSettings, STARTUP_BLINK_SETTINGS, STARTUP_DISABLED_FEATURES } from './chromium-features';

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

// Ticket 662: main's entry appends it before ready (index.test.ts pins where); this file pins its value and its one writer.
describe('setBlinkSettings (ticket 662)', () => {
  it('turns Blink’s DNS prefetching off, the only setting in one blink-settings switch', () => {
    expect(STARTUP_BLINK_SETTINGS).toEqual(['dnsPrefetchingEnabled=false']);
    const line = commandLine();
    setBlinkSettings(line, STARTUP_BLINK_SETTINGS);
    expect([...line.switches]).toEqual([['blink-settings', 'dnsPrefetchingEnabled=false']]);
  });

  // A second blink-settings value would replace this one, so no other source names the switch: every .ts, .tsx, .js and
  // .mjs file under src/ but the suites, read as text.
  it('is the only writer of blink-settings, and main’s entry its only caller', () => {
    const root = resolve(__dirname, '../..');
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
        return /\.(tsx?|m?js)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative(root, path).split('\\').join('/')] : [];
      });
    const naming = (pattern: RegExp) => sources(join(root, 'src')).filter((file) => pattern.test(readFileSync(join(root, file), 'utf8'))).sort();
    expect(naming(/blink-settings/)).toEqual(['src/main/chromium-features.ts']);
    expect(naming(/\bsetBlinkSettings\s*\(/)).toEqual(['src/main/chromium-features.ts', 'src/main/index.ts']);
    expect(readFileSync(join(root, 'src/main/index.ts'), 'utf8').match(/\bsetBlinkSettings\s*\(/g)).toHaveLength(1);
  });
});
