// The session actions a row's and the toolbar's menus offer (§5.1; P5 O7 M2: a lane B session on another machine).
import { describe, expect, it } from 'vitest';
import { record } from '../../../../test/support/builders';
import { sessionActionsFor } from './session-actions';

describe('sessionActionsFor', () => {
  // P5 O7 M2: another machine's lane B session offers only the opens: its record's writes (pin, rename, archive), a fork,
  // a delete and a worktree's removal are not offered over that machine's link (Interfaces §L), so none is drawn to fail.
  it('offers only the opens for a lane B session on another machine', () => {
    expect(sessionActionsFor(record('app-r'), { remote: true })).toEqual(['open', 'openInNewTab', 'openInSplit']);
    expect(sessionActionsFor(record('app-r'))).toContain('rename');
  });
});
