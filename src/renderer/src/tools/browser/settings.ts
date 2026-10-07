// E4a (Task 3.5): the Browser settings the chrome reads (X15, settings 11's `browser` section), live from the settings
// store; the defaults until main has answered. The address field turns typed text into a search through this template
// (`resolveAddress`, Design §4).
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
import { useSettings } from '../../stores/settings';

export const useSearchUrl = (): string => useSettings((s) => s.state?.settings.browser.searchUrl) ?? SETTINGS_DEFAULTS_V11.browser.searchUrl;
