// P3-F1 fix 3: Chromium features main turns off for the whole app, before the app is ready.
//
// WebRtcHideLocalIpsWithMdns makes Chromium register a page's host ICE candidates under `.local` names, and its mDNS
// responder binds UDP sockets on *:5353 as soon as ICE gathering starts, even where `guardFrames`' 'disable_non_proxied_udp'
// policy leaves no candidate to publish. On macOS that raised the firewall prompt for Electron Helper. The frames are meant
// to reach nothing, so the feature is off app-wide. That leaves no .local name over a host candidate anywhere, so every
// other page that may gather candidates is held to its default public interface instead: the browser's tabs, adopted
// window.open children included, take 'default_public_interface_only' as their view is made (browser/view.ts).
export const STARTUP_DISABLED_FEATURES: readonly string[] = ['WebRtcHideLocalIpsWithMdns'];

// The slice of Electron's `app.commandLine` this uses.
interface FeatureSwitches {
  getSwitchValue(name: string): string;
  appendSwitch(name: string, value?: string): void;
}

// Chromium reads one `--disable-features=a,b` list and a second append would replace the first, so a list a launch
// already passed is read and kept, and the result is written back as one comma-separated switch with no repeats.
export function disableChromiumFeatures(commandLine: FeatureSwitches, features: readonly string[]): void {
  const current = commandLine.getSwitchValue('disable-features').split(',');
  const merged = [...new Set([...current, ...features].map((feature) => feature.trim()).filter(Boolean))];
  commandLine.appendSwitch('disable-features', merged.join(','));
}

// Board ticket 662: Blink's settings main sets for every renderer, before the app is ready. A `<link rel="dns-prefetch">`
// connected to a document makes Chromium resolve the name it holds, so a page in a store frame (an HTML artifact's
// script, or markup it writes into its document) could send data out of the machine in DNS queries; the frame's policy,
// its sandbox, main's request filter and the store-frame policies never see that query
// (spikes/viewer-frame/FINDINGS.md, "2026-11-14 follow-up: the DNS-prefetch channel"). `dnsPrefetchingEnabled=false`
// closes it. The cost is app-wide: no page in the app gets DNS-prefetch hints, the in-app browser included (its anchors
// lose their hover prefetch); name resolution and page loads are untouched. The page-side controls do not govern an
// explicit link on Chromium 152: an `X-DNS-Prefetch-Control: off` header or meta leaves it sending, and Electron's web
// preferences and sessions have nothing that reaches the setting.
export const STARTUP_BLINK_SETTINGS: readonly string[] = ['dnsPrefetchingEnabled=false'];

// Chromium reads one `--blink-settings=a=b,c=d` list and a second append replaces the first, so this is the only writer
// of the switch (the unit guard holds every other source to that) and runs once, in main's entry.
export function setBlinkSettings(commandLine: Pick<FeatureSwitches, 'appendSwitch'>, settings: readonly string[]): void {
  commandLine.appendSwitch('blink-settings', settings.join(','));
}
