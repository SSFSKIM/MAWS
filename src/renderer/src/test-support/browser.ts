// Browser suites (E4a, M3): a schema-valid `BrowserTab` as main would send it, idle, loaded and placed nowhere, with
// whatever a case overrides.
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';

export const T1 = 'b_000000000001';
export const T2 = 'b_000000000002';
export const T3 = 'b_000000000003';

export function browserTab(tabId: string, appSessionId: AppSessionId, over: Partial<BrowserTab> = {}): BrowserTab {
  return {
    tabId,
    appSessionId,
    partition: 'persist:maws-browser',
    url: 'https://example.com/a',
    title: 'Example A',
    favicon: null,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    zoom: 1,
    control: 'idle',
    controlSince: '2026-10-06T10:00:00.000Z',
    suspended: false,
    loadError: null,
    crashed: null,
    failed: null,
    unresponsive: false,
    blockedPopups: 0,
    find: null,
    denied: [],
    download: null,
    memoryKiB: null,
    placedIn: null,
    covered: false,
    createdAt: '2026-10-06T10:00:00.000Z',
    lastShownAt: '2026-10-06T10:00:00.000Z',
    agentBadge: null, // E13
    internal: null, // cua #90
    ...over,
  };
}
