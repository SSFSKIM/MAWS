import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetShellStores } from '../test-support/shell-stores';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { TabStrip } from './TabStrip';

beforeEach(() => {
  resetShellStores();
  useLayout.getState().openTab({ kind: 'diagnostics' });
  useLayout.getState().openTab({ kind: 'file', path: '/invented/notes.md', line: null, appSessionId: null, machine: TEST_MACHINE });
  useLayout.getState().activateTab('diagnostics');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('offers every clipped tab by its full name and activates the selected overflow entry', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180);
  render(<TabStrip pane={0} split={false} idPrefix="overflow" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'All tabs' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'notes.md' }));
  expect(currentSet(useLayout.getState().main).panes[0].activeTabId).toBe(`file:${TEST_MACHINE}:/invented/notes.md`);
});

it('does not spend a control on overflow when the strip fits', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(180);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
  act(() => render(<TabStrip pane={0} split={false} idPrefix="fits" />));
  expect(screen.queryByRole('button', { name: 'All tabs' })).toBeNull();
});

// UX wave U7b (the branch review): a page widens the title bar over an open side column, and the browser clamps the
// hidden strip's offset to what the wider strip allows; Back gives the strip the offset it had when the page opened.
it('Back shows the strip at the offset it had when a page opened, after the wider strip under the page clamped it', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180);
  act(() => render(<TabStrip pane={0} split={false} idPrefix="offset" />));
  const strip = screen.getByRole('tablist');
  act(() => {
    strip.scrollLeft = 120;
    strip.dispatchEvent(new Event('scroll'));
  });
  act(() => useLayout.getState().openDestination({ kind: 'projects' }));
  act(() => {
    strip.scrollLeft = 0; // the wider strip fits: the browser's clamp
    strip.dispatchEvent(new Event('scroll'));
  });
  act(() => useLayout.getState().closeDestination());
  expect(strip.scrollLeft).toBe(120);
});

