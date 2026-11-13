// UC-7.5's two tables (UX wave U9, M1; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §3):
// the sentence a control issuing an act on a session on another machine is disabled with, and the sentence of an act
// that ended without its effect. One function each, so every child words them alike. The machine is invented.
import { describe, expect, it } from 'vitest';
import { ACT_WORDS, disabledWords, failureWords, REMOTE_NEEDS, REMOTE_UNAVAILABLE, refusalWords, SESSION_ACTS_CAPABILITY, type RemoteStanding } from './remote-unavailable';

const M = 'Loft';
const UP: RemoteStanding = { machine: M, phase: 'up', capabilities: [SESSION_ACTS_CAPABILITY], owner: true };
const at = (fields: Partial<RemoteStanding>): RemoteStanding => ({ ...UP, ...fields });

describe('the acts the wave offers', () => {
  it('leave the declared set and each needs `rl2.session-acts`, Fork among them (M2)', () => {
    const built = ['session.archive', 'session.update', 'session.rename', 'session.list', 'attention.acknowledge', 'session.steer.cancel', 'maws.pane.answer', 'session.fork'] as const;
    expect(Object.keys(REMOTE_NEEDS).sort()).toEqual([...built].sort());
    for (const command of built) {
      expect(REMOTE_NEEDS[command], command).toBe('rl2.session-acts');
      expect(REMOTE_UNAVAILABLE[command], command).toBeUndefined();
    }
    expect(REMOTE_UNAVAILABLE['session.stop']).toBeDefined(); // "End session": answered no
  });

  it('word the menu acts as closing while the link connects, and Send, Stop and Dismiss as held', () => {
    expect(Object.entries(ACT_WORDS).filter(([, words]) => words?.closes === true).map(([command]) => command).sort()).toEqual(['session.archive', 'session.fork', 'session.rename', 'session.update']);
    expect(ACT_WORDS['session.steer.cancel']).toBeUndefined();
    expect(ACT_WORDS['maws.pane.answer']).toBeUndefined();
  });
});

describe('disabledWords: before the act', () => {
  it('answers nothing for an act that can go now', () => {
    for (const command of ['session.archive', 'session.update', 'session.rename', 'attention.acknowledge', 'session.interrupt', 'session.send'] as const) expect(disabledWords(command, UP), command).toBeNull();
  });

  it('keeps a declared command’s own words, whatever else holds', () => {
    expect(disabledWords('session.takeOver', at({ phase: 'offline', capabilities: [], owner: false }))).toBe(REMOTE_UNAVAILABLE['session.takeOver']);
    expect(disabledWords('session.delete', UP)).toBe(REMOTE_UNAVAILABLE['session.delete']);
  });

  it('says to update a machine whose build does not list the capability, before the phase', () => {
    const older = at({ capabilities: ['rl2.feeds'], phase: 'offline' });
    expect(disabledWords('session.rename', older)).toBe('Can’t rename on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('session.archive', older)).toBe('Can’t archive on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('attention.acknowledge', older)).toBe('Can’t dismiss on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('session.list', older, 'list archived sessions')).toBe('Can’t list archived sessions on Loft yet. Update MAWS on Loft and try again.');
    // a command offered since P5 needs no capability of the wave's
    expect(disabledWords('session.interrupt', at({ capabilities: [] }))).toBeNull();
    // capabilities unknown (the link not up): nothing is said of the build
    expect(disabledWords('session.rename', at({ capabilities: null }))).toBeNull();
  });

  it('says an act is unavailable while its machine is offline, the label standing for the act where given', () => {
    const offline = at({ phase: 'offline', capabilities: null });
    expect(disabledWords('session.archive', offline)).toBe('Archive is unavailable while Loft is offline.');
    expect(disabledWords('session.interrupt', offline)).toBe('Stop is unavailable while Loft is offline.');
    expect(disabledWords('session.send', offline)).toBe('Send is unavailable while Loft is offline.');
    expect(disabledWords('session.list', offline, 'list archived sessions')).toBe('List archived sessions is unavailable while Loft is offline.');
    // an act with no words and no label is not worded here
    expect(disabledWords('session.steer.cancel', offline)).toBeNull();
  });

  it('closes the menu acts while the link connects or reconnects, and holds Send, Stop and Dismiss', () => {
    expect(disabledWords('session.rename', at({ phase: 'connecting', capabilities: null }))).toBe('Connecting to Loft…');
    expect(disabledWords('session.update', at({ phase: 'reconnecting', capabilities: null }))).toBe('Reconnecting to Loft…');
    for (const command of ['session.send', 'session.interrupt', 'attention.acknowledge'] as const) expect(disabledWords(command, at({ phase: 'reconnecting', capabilities: null })), command).toBeNull();
  });

  it('closes Fork for a member known not to own the machine, after the build and the phase', () => {
    expect(disabledWords('session.fork', at({ owner: false }))).toBe('Only Loft’s owners can fork a session there.');
    expect(disabledWords('session.fork', at({ owner: null }))).toBeNull(); // not known: the machine decides
    expect(disabledWords('session.fork', UP)).toBeNull();
    expect(disabledWords('session.fork', at({ owner: false, capabilities: ['rl2.feeds'] }))).toBe('Can’t fork on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('session.fork', at({ owner: false, phase: 'reconnecting', capabilities: null }))).toBe('Reconnecting to Loft…');
  });

  it('leaves the removed phase to main', () => {
    expect(disabledWords('session.rename', at({ phase: 'removed', capabilities: null }))).toBeNull();
  });
});

describe('refusalWords: an act that ended without its effect', () => {
  const words = (refusal: string, command: Parameters<typeof refusalWords>[0] = 'session.rename', detail?: { mode?: string }) => refusalWords(command, M, refusal, detail);

  it('answers each row of UC-7.5’s second table', () => {
    expect(words('offline')).toBe('Not renamed: Loft is offline');
    expect(words('not-sent', 'session.archive')).toBe('Not archived: Loft is offline');
    expect(words('not-offered', 'session.update')).toBe('Not unarchived: update MAWS on Loft and try again');
    expect(words('owners-only', 'session.fork')).toBe('Not forked: only Loft’s owners can');
    expect(words('step-up', 'session.fork')).toBe('Not forked: the confirmation was cancelled');
    expect(words('read-only', 'attention.acknowledge')).toBe('Not dismissed: Loft is in read-only mode');
    for (const busy of ['unavailable', 'restart', 'busy', 'state-too-old']) expect(words(busy, 'session.interrupt'), busy).toBe('Not stopped: Loft is busy; try again in a moment');
    expect(words('no-target', 'session.send')).toBe('Not sent: Loft refused it (no-target)');
  });

  it('words a `grade` refusal by the rank the act needed', () => {
    expect(words('grade', 'session.fork')).toBe('Not forked: you can’t start sessions on Loft');
    expect(words('grade', 'session.archive')).toBe('Not archived: only the session’s owners can');
    expect(words('grade', 'session.update')).toBe('Not unarchived: only the session’s owners can');
    expect(words('grade', 'attention.acknowledge')).toBe('Not dismissed: you can read this session but not act on it');
    expect(words('grade', 'session.send')).toBe('Not sent: you can read this session but not act on it');
  });

  it('names the mode a ceiling refusal names, else the code', () => {
    expect(words('ceiling', 'session.fork', { mode: 'bypassPermissions' })).toBe('Not forked: Loft doesn’t start sessions in bypassPermissions from another machine');
    expect(words('ceiling', 'session.fork')).toBe('Not forked: Loft refused it (ceiling)');
  });

  it('gives a failure the machine’s own sentence', () => {
    expect(failureWords('session.fork', 'the session has a turn running; fork it once the turn ends')).toBe('Not forked: the session has a turn running; fork it once the turn ends');
  });
});
