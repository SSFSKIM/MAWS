import { describe, expect, it } from 'vitest';
import { visibleSessionStep } from './session-navigation';

describe('session stepping follows rendered sidebar rows', () => {
  it('walks Needs-you first, skips duplicate rows, and wraps across projects', () => {
    document.body.innerHTML = `<div data-testid="sidebar-tree"><button data-menu="session:b"></button><div data-menu="project:p"></div><div data-menu="session:a"></div><div data-menu="session:b"></div><div data-menu="session:c"></div></div>`;
    expect(visibleSessionStep('b', 1)).toBe('a');
    expect(visibleSessionStep('a', -1)).toBe('b');
    expect(visibleSessionStep('c', 1)).toBe('b');
    expect(visibleSessionStep(null, -1)).toBe('c');
  });
  it('does not walk sessions outside the sidebar or invent a row when none is shown', () => {
    document.body.innerHTML = '<div data-menu="session:outside"></div><div data-testid="sidebar-tree"></div>';
    expect(visibleSessionStep('outside', 1)).toBeNull();
  });
});
