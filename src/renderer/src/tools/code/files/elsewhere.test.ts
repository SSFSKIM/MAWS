// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; decisions 11 to 13 and
// 18): which sessions take the remote route (a lane B session main runs on another machine over RL2, and no other), the
// sentence the window's helper gives an outside act there, and what the person opened on a machine this run. Invented
// names and paths.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { RemoteStanding } from '@shared/ipc/remote-unavailable';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { leaveRl2, overRl2 } from '../../../test-support/code-disk';
import { forgetOpenedThere, openedThere, outsideUnavailable, takesRemoteRoute } from './elsewhere';

const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const T = addressOf(OTHER_MACHINE, 'app-terminal' as AppSessionId);
const L = at('app-l' as AppSessionId);
const THIRD = 'ThirdMachineRef0000000' as typeof OTHER_MACHINE;

beforeEach(() => {
  window.maws = { localMachine: TEST_MACHINE } as never;
  resetRemoteLaneBStore();
  leaveRl2();
  forgetOpenedThere();
});
afterEach(() => {
  leaveRl2();
  forgetOpenedThere();
});

describe('takesRemoteRoute', () => {
  it('is true for a lane B session main runs on another machine over RL2', () => {
    overRl2(R);
    expect(takesRemoteRoute(R)).toBe(true);
  });

  it('is false for a session of this Mac, of another profile of this Mac (no RL2 roster entry) and for a terminal session there', () => {
    expect(takesRemoteRoute(L)).toBe(false);
    expect(takesRemoteRoute(R)).toBe(false); // another machine, but its sessions take the manager's path (a socket)
    overRl2(T, {}, 'A');
    expect(takesRemoteRoute(T)).toBe(false); // a terminal session there: lane A's adapter takes only laneA.*
  });
});

describe('outsideUnavailable', () => {
  const standing = (over: Partial<RemoteStanding> = {}): RemoteStanding => ({ machine: 'studio', phase: 'up', capabilities: ['rl2.outside-files'], owner: true, ...over });

  it('is null with no standing and for an owner of a machine that lists the capability', () => {
    expect(outsideUnavailable(null, 'files.chooseOutside')).toBeNull();
    expect(outsideUnavailable(standing(), 'files.chooseOutside')).toBeNull();
    expect(outsideUnavailable(standing(), 'files.writeOutside')).toBeNull();
  });

  it('gives decision 12’s sentences, the first that applies', () => {
    expect(outsideUnavailable(standing({ capabilities: ['rl2.channel'] }), 'files.chooseOutside')).toBe('Can’t open a file on studio yet. Update MAWS on studio and try again.');
    expect(outsideUnavailable(standing({ phase: 'offline', capabilities: null }), 'files.chooseOutside')).toBe('Open File is unavailable while studio is offline.');
    expect(outsideUnavailable(standing({ phase: 'connecting', capabilities: null }), 'files.chooseOutside')).toBe('Connecting to studio…');
    expect(outsideUnavailable(standing({ phase: 'reconnecting', capabilities: null }), 'files.chooseOutside')).toBe('Reconnecting to studio…');
    expect(outsideUnavailable(standing({ owner: false }), 'files.chooseOutside')).toBe('Only studio’s owners can open a file there.');
    expect(outsideUnavailable(standing({ owner: null }), 'files.chooseOutside')).toBe('Only studio’s owners can open a file there.'); // R10
    expect(outsideUnavailable(standing({ owner: false }), 'files.writeOutside')).toBe('Only studio’s owners can save this file there.');
  });
});

describe('openedThere', () => {
  it('holds what the person opened on a machine, and every path under it, for that machine alone', () => {
    const there = openedThere(OTHER_MACHINE);
    expect(there.has('/home/someone/Documents/notes.txt')).toBe(false);
    there.add('/home/someone/Documents');
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents')).toBe(true);
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents/a/notes.txt')).toBe(true);
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents-old/notes.txt')).toBe(false); // a sibling sharing a prefix
    expect(openedThere(OTHER_MACHINE).has('/home/someone')).toBe(false);
    expect(openedThere(THIRD).has('/home/someone/Documents/notes.txt')).toBe(false);
    openedThere(THIRD).add('/srv/single.txt');
    expect(openedThere(THIRD).has('/srv/single.txt')).toBe(true);
    expect(openedThere(THIRD).has('/srv/single.txt.bak')).toBe(false);
  });

  // Fix wave (review finding 1): containment is proven on a normalized path, so a parent segment cannot leave the folder
  it('lends nothing to a path with a "." or ".." segment, beside a descendant written plainly', () => {
    openedThere(OTHER_MACHINE).add('/home/someone/Documents');
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents/minutes/rota.ods')).toBe(true); // the control
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents/../Downloads')).toBe(false);
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents/../Downloads/notes.txt')).toBe(false);
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents/./rota.ods')).toBe(false);
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Documents/minutes/..')).toBe(false);
  });

  it('is kept in memory alone and forgotten whole', () => {
    openedThere(OTHER_MACHINE).add('/home/someone/Desktop');
    forgetOpenedThere();
    expect(openedThere(OTHER_MACHINE).has('/home/someone/Desktop')).toBe(false);
  });
});
