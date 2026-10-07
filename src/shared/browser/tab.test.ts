import { describe, expect, it } from 'vitest';
import {
  BROWSER_HANDBACK_IDLE_MS,
  BROWSER_LOADED_TABS_MAX,
  BROWSER_TAB_ID,
  BROWSER_TABS_MEMORY_MAX_MIB,
  BROWSER_PLACEHOLDER_MAX_BYTES,
  BROWSER_SUGGESTIONS_MAX,
  BrowserPartitionSchema,
  BrowserTabSchema,
  DEFAULT_PARTITION,
  profilePartition,
} from './tab';

// A tab as main would send it: every ledger field, then E4a's additive ones (E4a execution document, Design §2).
const TAB = {
  tabId: 'b_0123456789ab', appSessionId: 'app-1', partition: 'persist:maws-browser',
  url: 'https://example.com/', title: 'Example Domain', favicon: 'data:image/png;base64,iVBORw0KGgo=',
  loading: false, canGoBack: true, canGoForward: false, zoom: 1,
  control: 'idle', controlSince: '2026-10-06T00:00:00.000Z',
  suspended: false,
  loadError: null, crashed: null, failed: null, unresponsive: false, blockedPopups: 0, find: null, denied: [], download: null,
  memoryKiB: null, placedIn: null, covered: false,
  createdAt: '2026-10-06T00:00:00.000Z', lastShownAt: '2026-10-06T00:00:00.000Z',
} as const;

describe('BrowserTab (E4a, the cross-child model)', () => {
  it('accepts the Interfaces shape, the fields filled in', () => {
    expect(BrowserTabSchema.parse(TAB)).toEqual(TAB);
    const busy = {
      ...TAB,
      control: 'human',
      loadError: { url: 'http://127.0.0.1:1/', host: '127.0.0.1', kind: 'refused', code: -102, description: 'ERR_CONNECTION_REFUSED' },
      crashed: { reason: 'crashed' },
      failed: { message: 'boom' },
      find: { active: 2, matches: 7 },
      denied: [{ host: 'example.com', permission: 'notifications' }],
      download: { name: 'file.bin', state: 'done', received: 4096, total: 4096, path: '/tmp/file.bin' },
      memoryKiB: 120_000,
      placedIn: { paneId: '1c0f4e0e-2c55-4d1e-9f5e-3b1d9a1f6d2a', surface: 'main' },
      covered: true,
    };
    expect(BrowserTabSchema.parse(busy)).toEqual(busy);
  });

  it('refuses an extra key, a malformed id, a page-URL favicon, a load error of an unknown kind and a ninth denial', () => {
    expect(BrowserTabSchema.safeParse({ ...TAB, pinned: true }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, tabId: 'b_0123456789AB' }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, tabId: 'b_0123' }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, favicon: 'https://example.com/favicon.ico' }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, control: 'paused' }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, loadError: { url: 'x', host: 'x', kind: 'teapot', code: -1, description: '' } }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, denied: Array(9).fill({ host: 'a', permission: 'media' }) }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, partition: 'persist:maws-capture' }).success).toBe(false);
    expect(BrowserTabSchema.safeParse({ ...TAB, zoom: 0 }).success).toBe(false);
  });

  it('names the partitions: the default and one per imported profile, nothing else', () => {
    expect(DEFAULT_PARTITION).toBe('persist:maws-browser');
    expect(profilePartition('Profile 1')).toBe('persist:maws-chrome-Profile 1');
    expect(BrowserPartitionSchema.safeParse(DEFAULT_PARTITION).success).toBe(true);
    expect(BrowserPartitionSchema.safeParse(profilePartition('Default')).success).toBe(true);
    for (const other of ['', 'persist:maws-chrome-', 'maws-capture', 'persist:maws-capture', 'persist:maws-browser2'])
      expect(BrowserPartitionSchema.safeParse(other).success, other).toBe(false);
  });

  it('exports the constants the siblings read', () => {
    expect(BROWSER_TAB_ID.test('b_abcdef012345')).toBe(true);
    expect(BROWSER_HANDBACK_IDLE_MS).toBe(3000);
    expect(BROWSER_LOADED_TABS_MAX).toBe(12);
    expect(BROWSER_TABS_MEMORY_MAX_MIB).toBe(2048);
    expect(BROWSER_PLACEHOLDER_MAX_BYTES).toBe(400 * 1024);
    expect(BROWSER_SUGGESTIONS_MAX).toBe(8);
  });
});
