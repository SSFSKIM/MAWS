// E4a (Task 3.5): the Browser settings the chrome reads (X15, settings 11's `browser` section), live from the settings
// store; the defaults until main has answered. The address field turns typed text into a search through this template
// (`resolveAddress`, Design §4).
import { SETTINGS_DEFAULTS_V12 } from '@shared/settings/defaults';
import type { MawsBridge } from '@shared/ipc/schema';
import type { BrowserSettings } from '@shared/ipc/schema/settings';
import { ipc } from '../../ipc/client';
import { useSettings } from '../../stores/settings';

export const useSearchUrl = (): string => useSettings((s) => s.state?.settings.browser.searchUrl) ?? SETTINGS_DEFAULTS_V12.browser.searchUrl;

// cua #90 start: settings 12's `browser.bookmarksBar`, which ⌘⇧B flips from the page or the chrome (Chrome's chord) and
// Settings › Browser's switch sets
export const useBookmarksBar = (): BrowserSettings['bookmarksBar'] => useSettings((s) => s.state?.settings.browser.bookmarksBar) ?? SETTINGS_DEFAULTS_V12.browser.bookmarksBar;

export async function toggleBookmarksBar(client: MawsBridge = ipc): Promise<void> {
  const current = useSettings.getState().state?.settings.browser.bookmarksBar ?? SETTINGS_DEFAULTS_V12.browser.bookmarksBar;
  const result = await client.invoke('settings.set', { browser: { bookmarksBar: current === 'shown' ? 'hidden' : 'shown' } });
  if (!result.ok) console.error('[browser] the bookmarks bar could not be toggled', result.error);
}
// cua #90 end
