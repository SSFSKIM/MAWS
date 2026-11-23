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
  // the word cut (T478, T479): the account's names alone, and no line for a profile with no account
  it('names the signed-in account, or nothing when the profile is signed in to none', () => {
    expect(accountLine({ gaiaName: 'Probe Owner', userName: 'probe@example.test' })).toBe('Probe Owner · probe@example.test');
    expect(accountLine({ gaiaName: 'Probe Owner', userName: null })).toBe('Probe Owner');
    expect(accountLine({ gaiaName: null, userName: 'probe@example.test' })).toBe('probe@example.test');
    expect(accountLine({ gaiaName: null, userName: null })).toBeNull();
    expect(accountLine({ gaiaName: '', userName: '' })).toBeNull();
  });
});

describe('syncLine', () => {
  const NOW = Date.parse('2026-10-09T12:00:00.000Z');
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
  const state = (over: object) => ({ consentedAt: at(600), syncedAt: at(5), count: 46, error: null, errorAt: null, ...over });

  it('says when the last sync was', () => {
    expect(syncLine(state({}), NOW)).toBe('Last synced 5 minutes ago');
    expect(syncLine(state({ syncedAt: at(0.5) }), NOW)).toBe('Last synced now'); // the age is the date module's, in English (P4 DL 4)
    expect(syncLine(state({ syncedAt: null }), NOW)).toBeNull();
  });

  // the word cut (T484): under the popover's Sync bookmarks the age alone; Settings' note keeps the sentence
  it('in its short form says the age alone, and a failure as the sentence form does', () => {
    expect(syncLine(state({}), NOW, 'age')).toBe('5 minutes ago');
    expect(syncLine(state({ syncedAt: null }), NOW, 'age')).toBeNull();
    expect(syncLine(state({ error: 'missing', errorAt: at(1) }), NOW, 'age')).toBe('Couldn’t read Chrome’s bookmarks file · Last synced 5 minutes ago');
  });

  it('says the file could not be read, with the last good sync, or that the index is unavailable', () => {
    expect(syncLine(state({ error: 'missing', errorAt: at(1) }), NOW)).toBe('Couldn’t read Chrome’s bookmarks file · Last synced 5 minutes ago');
    expect(syncLine(state({ error: 'unreadable', errorAt: at(1), syncedAt: null }), NOW)).toBe('Couldn’t read Chrome’s bookmarks file · Never synced');
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
