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
