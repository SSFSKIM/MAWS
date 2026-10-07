import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { choosePartition, chromeUserAgent, Partitions, preparePartition, readProfiles, type BrowserProfile } from './partition';

const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) maws/0.0.0 Chrome/146.0.7680.65 Electron/44.4.5 Safari/537.36';

const profiles: BrowserProfile[] = [{ profileDir: 'Profile 1', name: 'Work', partition: profilePartition('Profile 1'), importedAt: 't' }];

function fakeSession() {
  let ua = ELECTRON_UA;
  const ses = {
    getUserAgent: () => ua,
    setUserAgent: vi.fn((next: string) => void (ua = next)),
    webRequest: { onBeforeRequest: vi.fn() },
  };
  return ses as typeof ses & Session;
}

describe('the partition (E4a Design §9, Decision Log 8)', () => {
  it('the user agent is Chromium\'s without the Electron and app product tokens', () => {
    expect(chromeUserAgent(ELECTRON_UA)).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.65 Safari/537.36',
    );
    expect(chromeUserAgent(ELECTRON_UA.replace('maws/', 'MAWS/'))).not.toMatch(/MAWS|Electron/);
  });

  it('prepares a session: the user agent, and file: and maws-deliverable: requests cancelled', () => {
    const ses = fakeSession();
    preparePartition(ses);
    expect(ses.getUserAgent()).not.toMatch(/Electron|maws/);
    const [listener] = ses.webRequest.onBeforeRequest.mock.calls[0] as [(details: { url: string }, callback: (r: { cancel: boolean }) => void) => void];
    const answer = (url: string) => {
      let cancel: boolean | undefined;
      listener({ url }, (r) => void (cancel = r.cancel));
      return cancel;
    };
    expect(answer('file:///etc/hosts')).toBe(true);
    expect(answer('maws-deliverable://App-A/x/1')).toBe(true);
    expect(answer('https://a.test/')).toBe(false);
    expect(answer('data:image/png;base64,AA')).toBe(false);
  });

  it('opens each partition once and prepares it once', () => {
    const sessions = new Map<string, ReturnType<typeof fakeSession>>();
    const fromPartition = vi.fn((name: string) => sessions.get(name) ?? sessions.set(name, fakeSession()).get(name)!);
    const prepare = vi.fn();
    const partitions = new Partitions(fromPartition, [prepare]);
    const first = partitions.session(DEFAULT_PARTITION);
    expect(partitions.session(DEFAULT_PARTITION)).toBe(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(first, DEFAULT_PARTITION);
  });

  describe('choosePartition', () => {
    const opens = () => {};

    it('the default profile is the default partition', () => {
      expect(choosePartition(null, profiles, opens)).toEqual({ partition: DEFAULT_PARTITION, notice: null });
    });

    it('an imported profile is its own partition', () => {
      expect(choosePartition('Profile 1', profiles, opens)).toEqual({ partition: 'persist:maws-chrome-Profile 1', notice: null });
    });

    it('an unknown profile falls back to the default with one notice, the setting untouched', () => {
      expect(choosePartition('Profile 9', profiles, opens)).toEqual({ partition: DEFAULT_PARTITION, notice: { kind: 'profileMissing', name: 'Profile 9' } });
    });

    it('a partition that fails to open falls back to the default and names the profile', () => {
      const failing = (partition: string) => {
        if (partition !== DEFAULT_PARTITION) throw new Error('cannot open');
      };
      expect(choosePartition('Profile 1', profiles, failing)).toEqual({ partition: DEFAULT_PARTITION, notice: { kind: 'partitionFallback', name: 'Work' } });
    });
  });

  describe('profiles.json (E4b writes it; E4a reads it when present)', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'maws-browser-profiles-'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('absent: no profiles', () => {
      expect(readProfiles(join(dir, 'profiles.json'))).toEqual([]);
    });

    it('present: its profiles', () => {
      const file = join(dir, 'profiles.json');
      writeFileSync(file, JSON.stringify({ version: 1, profiles }));
      expect(readProfiles(file)).toEqual(profiles);
    });

    it('unreadable: no profiles, logged', () => {
      const file = join(dir, 'profiles.json');
      writeFileSync(file, '{"version": 1, "profiles": [{}]}');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(readProfiles(file)).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });
  });
});
