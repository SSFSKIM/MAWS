// Where Hide stands in a session row's menu (UX wave U7, O-16; docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md,
// Interfaces §C, `withHide`): directly after Pin; with no Pin, after the record's opening items. Read against the lists
// `sessionActionsFor` really gives each kind of record.
import { describe, expect, it } from 'vitest';
import { record } from '../../../../test/support/builders';
import { sessionActionsFor } from '../app/session-actions';
import { withHide } from './menus';

describe('withHide', () => {
  it('puts Hide directly after Pin in a local record’s menu, so Archive and the deletes keep the end', () => {
    const ids = withHide(sessionActionsFor(record('a')));
    expect(ids.slice(ids.indexOf('pin'), ids.indexOf('pin') + 2)).toEqual(['pin', 'hide']);
    expect(ids.slice(-2)).toEqual(['archive', 'deleteConversation']);
    const worktree = withHide(sessionActionsFor(record('w', { worktree: { path: '/r/.claude/worktrees/w', branch: 'w' } })));
    expect(worktree.at(-1)).toBe('removeWorktree');
  });

  it('puts Hide after Open in new tab for a session a terminal holds, before what its bridge adds', () => {
    const terminal = record('t', { holder: { kind: 'terminal', pid: 7 } });
    expect(withHide(sessionActionsFor(terminal))).toEqual(['open', 'openInNewTab', 'hide']);
    expect(withHide(sessionActionsFor(terminal, { bridged: true }))).toEqual(['open', 'openInNewTab', 'hide', 'takeOver', 'fork']);
  });

  it('puts Hide after Attach in a terminal tab for a background job', () => {
    expect(withHide(sessionActionsFor(record('j', { holder: { kind: 'background_job', pid: 9, jobId: 'job-1' } })))).toEqual(['open', 'openInNewTab', 'attach', 'hide']);
  });

  it('puts Hide after Pin for a record of another machine, or after Open in split where it has no Pin', () => {
    const remote = record('r');
    // the chain merge: U9's Fork follows (Rename… and Archive too, where the listing says the session is yours)
    expect(withHide(sessionActionsFor(remote, { remote: true, remoteReading: true }))).toEqual(['open', 'openInNewTab', 'openInSplit', 'pin', 'hide', 'fork']);
    expect(withHide(sessionActionsFor(remote, { remote: true }))).toEqual(['open', 'openInNewTab', 'openInSplit', 'hide', 'fork']);
    expect(withHide(sessionActionsFor(remote, { remote: true, mine: true }))).toEqual(['open', 'openInNewTab', 'openInSplit', 'hide', 'rename', 'fork', 'archive']);
  });

  it('puts Hide after Resume for a session at rest, which has Resume among its opens', () => {
    const ids = withHide(sessionActionsFor(record('n', { holder: { kind: 'none' } })));
    expect(ids.slice(0, 6)).toEqual(['open', 'openInNewTab', 'resume', 'openInSplit', 'pin', 'hide']);
  });
});
