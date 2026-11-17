// UC-7.5's two tables (UX wave U9, M1; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, Interfaces §3):
// the sentence a control issuing an act on a session on another machine is disabled with, and the sentence of an act
// that ended without its effect. One function each, so every child words them alike. The machine is invented. The UX
// wave (U4b, docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md, Interfaces C and D): Send now on a
// waiting message is offered behind a capability of its own, and it and taking a message back have their words.
import { describe, expect, it } from 'vitest';
import { ACT_WORDS, disabledWords, failureWords, REMOTE_NEEDS, REMOTE_UNAVAILABLE, refusalWords, SEND_NOW_CAPABILITY, SESSION_ACTS_CAPABILITY, type RemoteStanding } from './remote-unavailable';
import { OUTSIDE_ACTS, OUTSIDE_FILES_CAPABILITY } from '@shared/files/outside';
import { GIT_READS_CAPABILITY } from './schema/git';

const M = 'Loft';
const UP: RemoteStanding = { machine: M, phase: 'up', capabilities: [SESSION_ACTS_CAPABILITY], owner: true };
const at = (fields: Partial<RemoteStanding>): RemoteStanding => ({ ...UP, ...fields });
/** The UX wave U5b-2's three reads (M8), behind a capability of their own (below). */
const GIT_READS = ['git.branchCommits', 'git.commitDiff', 'git.changesSince'] as const;
/** What other capabilities than the session acts' gate, each pinned in its own block below. */
const OWN_CAPABILITY: readonly string[] = ['artifacts.undelete', ...GIT_READS, ...OUTSIDE_ACTS];

describe('the acts the wave offers', () => {
  it('leave the declared set and each needs `rl2.session-acts`, Fork among them (M2)', () => {
    const built = ['session.archive', 'session.update', 'session.rename', 'session.list', 'attention.acknowledge', 'session.steer.cancel', 'maws.pane.answer', 'session.fork'] as const;
    expect(Object.keys(REMOTE_NEEDS).filter((command) => !OWN_CAPABILITY.includes(command)).sort()).toEqual([...built, 'session.steer.sendNow'].sort()); // U10b's and U5b's own, below
    for (const command of built) {
      expect(REMOTE_NEEDS[command], command).toBe('rl2.session-acts');
      expect(REMOTE_UNAVAILABLE[command], command).toBeUndefined();
    }
    expect(REMOTE_UNAVAILABLE['session.stop']).toBeDefined(); // "End session": answered no
  });

  it('word the menu acts as closing while the link connects, and Send, Stop and Dismiss as held', () => {
    expect(Object.entries(ACT_WORDS).filter(([, words]) => words?.closes === true).map(([command]) => command).sort()).toEqual(['session.archive', 'session.fork', 'session.rename', 'session.update']);
    expect(ACT_WORDS['maws.pane.answer']).toBeUndefined();
  });
});

describe('Send now and taking back (U4b)', () => {
  it('offer Send now behind `rl2.send-now`, its own capability, and no longer declare it', () => {
    expect(SEND_NOW_CAPABILITY).toBe('rl2.send-now');
    expect(REMOTE_NEEDS['session.steer.sendNow']).toBe('rl2.send-now');
    expect(REMOTE_UNAVAILABLE['session.steer.sendNow']).toBeUndefined();
  });

  it('give the two acts their words, held under the link’s hold as Send and Stop are', () => {
    expect(ACT_WORDS['session.steer.cancel']).toEqual({ act: 'take back', done: 'taken back' });
    expect(ACT_WORDS['session.steer.sendNow']).toEqual({ act: 'send now', done: 'sent now' });
  });

  it('close each control with its own label: the update sentence, then the offline one; held while the link reconnects', () => {
    const buildG = at({ capabilities: [SESSION_ACTS_CAPABILITY] });
    expect(disabledWords('session.steer.sendNow', buildG, 'send now')).toBe('Can’t send now on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('session.steer.sendNow', buildG)).toBe('Can’t send now on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('session.steer.sendNow', at({ capabilities: [SESSION_ACTS_CAPABILITY, SEND_NOW_CAPABILITY] }), 'send now')).toBeNull();
    const buildF = at({ capabilities: ['rl2.executor.machine'] });
    expect(disabledWords('session.steer.cancel', buildF, 'edit')).toBe('Can’t edit on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('session.steer.cancel', buildF, 'delete')).toBe('Can’t delete on Loft yet. Update MAWS on Loft and try again.');
    const offline = at({ phase: 'offline', capabilities: null });
    expect(disabledWords('session.steer.sendNow', offline, 'send now')).toBe('Send now is unavailable while Loft is offline.');
    expect(disabledWords('session.steer.cancel', offline, 'edit')).toBe('Edit is unavailable while Loft is offline.');
    expect(disabledWords('session.steer.cancel', offline, 'delete')).toBe('Delete is unavailable while Loft is offline.');
    for (const phase of ['connecting', 'reconnecting'] as const) {
      expect(disabledWords('session.steer.sendNow', at({ phase, capabilities: null }), 'send now'), phase).toBeNull();
      expect(disabledWords('session.steer.cancel', at({ phase, capabilities: null }), 'edit'), phase).toBeNull();
    }
  });

  it('word a refusal after the act, an earlier engine host’s apart from the endpoint’s own `unavailable`', () => {
    expect(refusalWords('session.steer.sendNow', M, 'host-older')).toBe('Not sent now: the engine host on Loft is finishing an update; this works once it has handed the session over');
    expect(refusalWords('session.steer.sendNow', M, 'unavailable')).toBe('Not sent now: Loft is busy; try again in a moment');
    expect(refusalWords('session.steer.sendNow', M, 'offline')).toBe('Not sent now: Loft is offline');
    expect(refusalWords('session.steer.sendNow', M, 'not-offered')).toBe('Not sent now: update MAWS on Loft and try again');
    expect(refusalWords('session.steer.sendNow', M, 'grade')).toBe('Not sent now: you can read this session but not act on it');
    expect(refusalWords('session.steer.sendNow', M, 'read-only')).toBe('Not sent now: Loft is in read-only mode');
    expect(refusalWords('session.steer.cancel', M, 'offline')).toBe('Not taken back: Loft is offline');
    expect(failureWords('session.steer.sendNow', 'the session isn’t running on Loft')).toBe('Not sent now: the session isn’t running on Loft');
    expect(failureWords('session.steer.cancel', 'the session isn’t running on Loft')).toBe('Not taken back: the session isn’t running on Loft');
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
    expect(disabledWords('maws.pane.answer', offline)).toBeNull();
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

// UX wave U10b (M4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §C.3): Undo of an agent's delete, an
// act on the artifact the machine's owners alone may make, behind a capability of its own.
describe('the undelete over the link', () => {
  const STANDS: RemoteStanding = { ...UP, capabilities: ['rl2.artifacts', 'rl2.artifact-undelete'] };
  it('needs `rl2.artifact-undelete`, and is worded restore and restored', () => {
    expect(REMOTE_NEEDS['artifacts.undelete']).toBe('rl2.artifact-undelete');
    expect(REMOTE_UNAVAILABLE['artifacts.undelete']).toBeUndefined();
    expect(ACT_WORDS['artifacts.undelete']).toEqual({ act: 'restore', done: 'restored' });
  });

  it('is disabled for a machine without the capability, while it is offline, and for a member who does not own it', () => {
    expect(disabledWords('artifacts.undelete', STANDS)).toBeNull();
    expect(disabledWords('artifacts.undelete', { ...STANDS, owner: null })).toBeNull(); // not known: the machine decides
    expect(disabledWords('artifacts.undelete', { ...STANDS, capabilities: ['rl2.artifacts'] })).toBe('Can’t restore on Loft yet. Update MAWS on Loft and try again.');
    expect(disabledWords('artifacts.undelete', { ...STANDS, phase: 'offline', capabilities: null })).toBe('Restore is unavailable while Loft is offline.');
    expect(disabledWords('artifacts.undelete', { ...STANDS, owner: false })).toBe('Only Loft’s owners can restore an artifact there.');
    expect(disabledWords('artifacts.undelete', { ...STANDS, owner: false, capabilities: ['rl2.artifacts'] })).toBe('Can’t restore on Loft yet. Update MAWS on Loft and try again.');
  });

  it('ends without its effect in the act’s words', () => {
    expect(refusalWords('artifacts.undelete', M, 'offline')).toBe('Not restored: Loft is offline');
    expect(refusalWords('artifacts.undelete', M, 'owners-only')).toBe('Not restored: only Loft’s owners can');
    expect(failureWords('artifacts.undelete', 'this artifact was deleted in the Library, not by an agent')).toBe('Not restored: this artifact was deleted in the Library, not by an agent');
  });
});

// UX wave U5b-2 (M8; docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md §D): the branch read, the
// commit read and the working-tree read go only to a machine whose endpoint lists `rl2.git-reads`. A read is not an act:
// it has no words here; Review and Source control's page word its failures themselves.
describe('the git reads over the link', () => {
  it('each need `rl2.git-reads`, are not declared, and have no act’s words', () => {
    expect(GIT_READS_CAPABILITY).toBe('rl2.git-reads');
    for (const command of GIT_READS) {
      expect([command, REMOTE_NEEDS[command]]).toEqual([command, GIT_READS_CAPABILITY]);
      expect([command, REMOTE_UNAVAILABLE[command], ACT_WORDS[command]]).toEqual([command, undefined, undefined]);
    }
  });
});

// UX wave U6f (M2; docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §C): a file outside a
// session's folders opened, listed, chosen and saved there goes only to a machine whose endpoint lists
// `rl2.outside-files`; the save leaves the declared set U6e put it in. M3 gives the four their words.
describe('the outside acts over the link', () => {
  it('each need `rl2.outside-files`, and none is declared', () => {
    expect(OUTSIDE_FILES_CAPABILITY).toBe('rl2.outside-files');
    for (const command of OUTSIDE_ACTS) {
      expect([command, REMOTE_NEEDS[command]]).toEqual([command, OUTSIDE_FILES_CAPABILITY]);
      expect([command, REMOTE_UNAVAILABLE[command]]).toEqual([command, undefined]);
    }
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
