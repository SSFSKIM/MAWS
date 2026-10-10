// P2-E2: a tab's dock is the latest of its live registrations; a disposer removes only its own, so a short-lived second
// pane leaving gives the dock back to the pane that still holds the view.
import { describe, expect, it } from 'vitest';
import { dockOf, registerDock } from './dock';

describe('the dock registry', () => {
  it('answers the latest registration, and a later one leaving gives the dock back to the one still registered', () => {
    const leaveA = registerDock('t-overlap', 'host-a');
    expect(dockOf('t-overlap')).toBe('host-a');
    const leaveB = registerDock('t-overlap', 'host-b');
    expect(dockOf('t-overlap')).toBe('host-b');
    leaveB();
    expect(dockOf('t-overlap')).toBe('host-a');
    leaveA();
    expect(dockOf('t-overlap')).toBeNull();
  });

  it('an earlier registration leaving keeps the latest; a disposer called twice removes nothing more', () => {
    const leaveA = registerDock('t-early', 'host-a');
    const leaveB = registerDock('t-early', 'host-b');
    leaveA();
    expect(dockOf('t-early')).toBe('host-b');
    leaveA();
    expect(dockOf('t-early')).toBe('host-b');
    leaveB();
    expect(dockOf('t-early')).toBeNull();
    expect(dockOf('t-never')).toBeNull();
  });
});
