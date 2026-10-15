// E4a (Task 3.5): the address field's search template comes from settings 11's browser section, live (X15).
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { useSettings } from '../../stores/settings';
import { useSearchUrl } from './settings';

afterEach(() => useSettings.setState({ state: null }));

describe('useSearchUrl', () => {
  it('answers the default template until main has answered', () => {
    useSettings.setState({ state: null });
    expect(renderHook(() => useSearchUrl()).result.current).toBe('https://www.google.com/search?q=%s');
  });

  it('answers the setting, and follows a change', () => {
    const at = (searchUrl: string) => ({ settings: { ...SETTINGS_DEFAULTS_V14, browser: { ...SETTINGS_DEFAULTS_V14.browser, searchUrl } }, resolvedTheme: 'light' as const });
    useSettings.setState({ state: at('https://duckduckgo.com/?q=%s') });
    const { result } = renderHook(() => useSearchUrl());
    expect(result.current).toBe('https://duckduckgo.com/?q=%s');
    act(() => useSettings.setState({ state: at('https://www.bing.com/search?q=%s') }));
    expect(result.current).toBe('https://www.bing.com/search?q=%s');
  });
});
