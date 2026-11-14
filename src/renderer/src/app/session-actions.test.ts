// The session actions a row's and the toolbar's menus offer (§5.1; P5 O7 M2: a lane B session on another machine; the
// UX wave, U9, Interfaces §6: what a session on another machine offers, whether this Mac holds its record or only its
// listing).
import { describe, expect, it } from 'vitest';
import { record } from '../../../../test/support/builders';
import { REMOTE_ACTION_COMMAND, remoteSessionActions, sessionActionsFor } from './session-actions';

describe('sessionActionsFor', () => {
  // The UX wave, U9 (S-02, O-48): another machine's lane B record offers the opens, Pin where the machine keeps the
  // member's reading, and its acts over the link: Rename… and Archive for a session you own, Fork for any.
  it('offers a lane B record on another machine the opens, Fork, and Rename… and Archive when it is yours', () => {
    expect(sessionActionsFor(record('app-r'), { remote: true })).toEqual(['open', 'openInNewTab', 'openInSplit', 'fork']);
    expect(sessionActionsFor(record('app-r'), { remote: true, mine: true })).toEqual(['open', 'openInNewTab', 'openInSplit', 'rename', 'fork', 'archive']);
    expect(sessionActionsFor(record('app-r'))).toContain('rename');
  });

  // P5 O8 M6a: Pin too, where the machine keeps the member's own reading (it isn't known to refuse `session.reader.update`)
  it('offers Pin for a lane B session on another machine that keeps the member’s reading', () => {
    expect(sessionActionsFor(record('app-r'), { remote: true, remoteReading: true })).toEqual(['open', 'openInNewTab', 'openInSplit', 'pin', 'fork']);
    expect(sessionActionsFor(record('app-r'), { remote: true, remoteReading: true, mine: true })).toEqual(['open', 'openInNewTab', 'openInSplit', 'pin', 'rename', 'fork', 'archive']);
  });

  it('keeps a session on this Mac as it was, whatever `mine` says', () => {
    expect(sessionActionsFor(record('x', { holder: { kind: 'none' } }), { mine: false })).toEqual(sessionActionsFor(record('x', { holder: { kind: 'none' } })));
  });
});

describe('remoteSessionActions', () => {
  const each = (lane: 'A' | 'B', record: boolean, mine: boolean, remoteReading = true) => remoteSessionActions({ lane, record, mine, remoteReading });

  it('answers each combination of lane, record and mine, in the menu’s order', () => {
    // lane B with a record: the opens, Pin (the member's reading kept), Rename… when yours, Fork, Archive when yours
    expect(each('B', true, true)).toEqual(['open', 'openInNewTab', 'openInSplit', 'pin', 'rename', 'fork', 'archive']);
    expect(each('B', true, false)).toEqual(['open', 'openInNewTab', 'openInSplit', 'pin', 'fork']);
    // lane B from its listing alone: no opens and no Pin (they act on a record); its acts over the link
    expect(each('B', false, true)).toEqual(['rename', 'fork', 'archive']);
    expect(each('B', false, false)).toEqual(['fork']);
    // lane A (a terminal session there): the opens with a record, and nothing more (UC-7.4, "Not on this route")
    expect(each('A', true, true)).toEqual(['open', 'openInNewTab', 'openInSplit']);
    expect(each('A', true, false)).toEqual(['open', 'openInNewTab', 'openInSplit']);
    expect(each('A', false, true)).toEqual([]);
    expect(each('A', false, false)).toEqual([]);
  });

  it('offers Pin only with a record of a machine that keeps the member’s reading', () => {
    expect(each('B', true, true, false)).toEqual(['open', 'openInNewTab', 'openInSplit', 'rename', 'fork', 'archive']);
    expect(each('B', false, true, true)).not.toContain('pin');
  });
});

describe('REMOTE_ACTION_COMMAND', () => {
  it('names the command each act over the link issues, and nothing for the opens or Pin', () => {
    expect(REMOTE_ACTION_COMMAND).toEqual({ rename: 'session.rename', fork: 'session.fork', archive: 'session.archive' });
  });
});
