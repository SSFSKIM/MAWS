// cua #90: the pill's and the popover's rules (the spec's "The avatar and the profile popover"), pure.
import { describe, expect, it } from 'vitest';
import type { BrowserProfileListItem } from '@shared/browser/profiles';
import { DEFAULT_PARTITION, profilePartition } from '@shared/browser/tab';
import { AVATAR_TONES, accountLine, avatarTone, switchTargets, syncLine } from './profile';

const item = (profileDir: string, name: string): BrowserProfileListItem => ({ profileDir, name, gaiaName: null, userName: null, avatar: { kind: 'initials', letter: name[0]! } });

describe('avatarTone', () => {
  it('is one of four accent tokens, the same for a profile directory every time', () => {
    expect(AVATAR_TONES).toHaveLength(4);
    for (const dir of ['Default', 'Profile 1', 'Profile 2', 'Profile 37']) {
      expect(AVATAR_TONES).toContain(avatarTone(dir));
      expect(avatarTone(dir)).toBe(avatarTone(dir));
    }
    expect(new Set(['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4', 'Profile 5', 'Profile 6'].map(avatarTone)).size).toBeGreaterThan(1);
  });
});

describe('accountLine', () => {
  it('names the signed-in account, or says the profile is not signed in', () => {
    expect(accountLine({ gaiaName: 'Probe Owner', userName: 'probe@example.test' })).toBe('로그인: Probe Owner · probe@example.test');
    expect(accountLine({ gaiaName: 'Probe Owner', userName: null })).toBe('로그인: Probe Owner');
    expect(accountLine({ gaiaName: null, userName: 'probe@example.test' })).toBe('로그인: probe@example.test');
    expect(accountLine({ gaiaName: null, userName: null })).toBe('Chrome에 로그인되지 않은 프로필');
  });
});

describe('syncLine', () => {
  const NOW = Date.parse('2026-10-09T12:00:00.000Z');
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
  const state = (over: object) => ({ consentedAt: at(600), syncedAt: at(5), count: 46, error: null, errorAt: null, ...over });

  it('says when the last sync was', () => {
    expect(syncLine(state({}), NOW)).toBe('마지막 동기화 5 minutes ago');
    expect(syncLine(state({ syncedAt: null }), NOW)).toBeNull();
  });

  it('says the file could not be read, with the last good sync, or that the index is unavailable', () => {
    expect(syncLine(state({ error: 'missing', errorAt: at(1) }), NOW)).toBe('Chrome의 북마크 파일을 읽지 못함 · 마지막 동기화 5 minutes ago');
    expect(syncLine(state({ error: 'unreadable', errorAt: at(1), syncedAt: null }), NOW)).toBe('Chrome의 북마크 파일을 읽지 못함 · 마지막 동기화 없음');
    expect(syncLine(state({ error: 'indexUnavailable', errorAt: at(1) }), NOW)).toBe('Unavailable in this build');
  });
});

describe('switchTargets', () => {
  const work = item('Profile 1', 'Work');
  const person = item('Default', 'Person 1');

  it('lists every other imported profile, then Default, from an imported profile’s tab', () => {
    expect(switchTargets([person, work], profilePartition('Profile 1'))).toEqual([
      { profileDir: 'Default', partition: profilePartition('Default'), profile: person },
      { profileDir: null, partition: DEFAULT_PARTITION, profile: null },
    ]);
  });

  it('lists every imported profile from a Default tab, and nothing but them', () => {
    expect(switchTargets([person, work], DEFAULT_PARTITION).map((target) => target.profileDir)).toEqual(['Default', 'Profile 1']);
    expect(switchTargets([], DEFAULT_PARTITION)).toEqual([]);
  });
});
