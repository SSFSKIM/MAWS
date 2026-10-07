import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { chromeUserAgent, partitionFor, Partitions, readProfiles, tabPartition, type BrowserProfile } from './partition';

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

  // The request listener a prepared fake session holds, as a function of the URL.
  const listenerOf = (ses: ReturnType<typeof fakeSession>) => {
    const [listener] = ses.webRequest.onBeforeRequest.mock.calls[0] as [(details: { url: string }, callback: (r: object) => void) => void];
    return (url: string) => {
      let answer: object | undefined;
      listener({ url }, (r) => void (answer = r));
      return answer;
    };
  };

  it('prepares a session: the user agent, and file: and maws-deliverable: requests cancelled by the first rule', () => {
    const ses = fakeSession();
    new Partitions(() => ses).session(DEFAULT_PARTITION);
    expect(ses.getUserAgent()).not.toMatch(/Electron|maws/);
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    const answer = listenerOf(ses);
    expect(answer('file:///etc/hosts')).toEqual({ cancel: true });
    expect(answer('maws-deliverable://App-A/x/1')).toEqual({ cancel: true });
    expect(answer('https://a.test/')).toEqual({});
    expect(answer('data:image/png;base64,AA')).toEqual({});
  });

  it('request rules compose in one listener: in order, the first answer wins, a rule added later applies, removal works', () => {
    const ses = fakeSession();
    const partitions = new Partitions(() => ses);
    partitions.session(DEFAULT_PARTITION);
    const seen: string[] = [];
    const remove = partitions.registerRequestRule((details, partition) => {
      seen.push(partition);
      if (details.url.includes('/blocked')) return { cancel: true };
      if (details.url.startsWith('file:')) return { redirectURL: 'https://never.test/' }; // never reached: the refusal answers first
      return undefined;
    });
    partitions.registerRequestRule((details) => (details.url.includes('/moved') ? { redirectURL: 'https://a.test/new' } : undefined));
    const answer = listenerOf(ses);
    expect(answer('file:///etc/hosts')).toEqual({ cancel: true });
    expect(answer('https://a.test/blocked')).toEqual({ cancel: true });
    expect(answer('https://a.test/moved')).toEqual({ redirectURL: 'https://a.test/new' });
    expect(seen).toEqual([DEFAULT_PARTITION, DEFAULT_PARTITION]);
    remove();
    expect(answer('https://a.test/blocked')).toEqual({});
    expect(ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
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
    expect(fromPartition).toHaveBeenCalledTimes(1);
  });

  describe('partitionFor (pure)', () => {
    it('the default profile is the default partition', () => {
      expect(partitionFor(null, profiles)).toEqual({ partition: DEFAULT_PARTITION, notice: null });
    });

    it('an imported profile is its own partition', () => {
      expect(partitionFor('Profile 1', profiles)).toEqual({ partition: 'persist:maws-chrome-Profile 1', notice: null });
    });

    it('an unknown profile falls back to the default with one notice, the setting untouched', () => {
      expect(partitionFor('Profile 9', profiles)).toEqual({ partition: DEFAULT_PARTITION, notice: { kind: 'profileMissing', name: 'Profile 9' } });
    });
  });

  describe('tabPartition (partitionFor, then opened)', () => {
    const partitionsOver = (failing: (partition: string) => boolean) =>
      new Partitions((partition) => {
        if (failing(partition)) throw new Error('cannot open');
        return fakeSession();
      });

    it('opens the chosen partition', () => {
      expect(tabPartition('Profile 1', profiles, partitionsOver(() => false))).toEqual({ partition: 'persist:maws-chrome-Profile 1', notice: null });
    });

    it('a partition that fails to open falls back to the default and names the profile (logged)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(tabPartition('Profile 1', profiles, partitionsOver((p) => p !== DEFAULT_PARTITION))).toEqual({
          partition: DEFAULT_PARTITION,
          notice: { kind: 'partitionFallback', name: 'Work' },
        });
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    });

    it('a default partition that fails to open is a failure, not a fallback', () => {
      expect(() => tabPartition(null, profiles, partitionsOver(() => true))).toThrow('cannot open');
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

    it('keeps E4b\'s own keys rather than refusing the file', () => {
      const file = join(dir, 'profiles.json');
      const e4b = [{ ...profiles[0], storageDirName: 'maws-chrome-profile%201', userDataDir: '/x', extensions: [], report: { cookies: 3 } }];
      writeFileSync(file, JSON.stringify({ version: 1, profiles: e4b, importedBy: 'E4b' }));
      expect(readProfiles(file)).toEqual(e4b);
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
