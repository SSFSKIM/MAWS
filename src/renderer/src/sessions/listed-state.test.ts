// The one reader of a session's state where its listing decides it (./listed-state.ts). The UX wave, U9 (S-05; A7;
// docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §10): a lane B listing that carries the live
// word reads it over sminos's published state, which trails the session by seconds: `running` is busy, `resting` turns
// busy and waiting into idle and leaves every other word; with no word the listing's own word stands.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionDigest } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import type { ListedSession } from '../stores/sessions';
import { isWorking, listedStateOf } from './listed-state';

const listing = (over: Partial<ListedSession> = {}): ListedSession => ({ ...remoteRow(OTHER_MACHINE, 'b1'), appId: addressOf(OTHER_MACHINE, 'b1' as AppSessionId), ...over });

describe('listedStateOf and isWorking', () => {
  it('read the listing’s word with no live word, and nothing where a digest decides or the listing is lane A’s', () => {
    expect(listedStateOf(null, listing({ state: 'waiting' }))).toBe('waiting');
    expect(isWorking(null, listing({ state: 'busy' }))).toBe(true);
    expect(listedStateOf({ phase: 'idle' } as SessionDigest, listing({ state: 'busy', live: 'running' }))).toBeNull();
    expect(listedStateOf(null, listing({ lane: 'A', state: 'busy', live: 'running' }))).toBeNull();
  });

  it('read `running` as busy, whatever the listing says yet', () => {
    for (const state of ['idle', 'waiting', 'busy']) {
      expect(listedStateOf(null, listing({ state, live: 'running' })), state).toBe('busy');
      expect(isWorking(null, listing({ state, live: 'running' })), state).toBe(true);
    }
  });

  it('read `resting` as idle where the listing still says busy or waiting, and leave every other word', () => {
    expect(listedStateOf(null, listing({ state: 'busy', live: 'resting' }))).toBe('idle');
    expect(listedStateOf(null, listing({ state: 'waiting', live: 'resting' }))).toBe('idle');
    expect(isWorking(null, listing({ state: 'busy', live: 'resting' }))).toBe(false);
    expect(listedStateOf(null, listing({ state: 'idle', live: 'resting' }))).toBe('idle');
    expect(listedStateOf(null, listing({ state: 'error', live: 'resting' }))).toBe('error');
  });

  it('read a private session’s listing, which came over the link, like any other', () => {
    const channel = listing({ state: 'idle', audience: ['member-1'], policyRev: 3, live: 'running' });
    expect(listedStateOf(null, channel)).toBe('busy');
  });

  it('read as today for a session with no listing entry yet', () => {
    expect(listedStateOf(null, undefined)).toBeNull();
    expect(isWorking(null, undefined)).toBe(false);
  });
});
