import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resetShellStores } from '../test-support/shell-stores';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { TabStrip } from './TabStrip';

beforeEach(() => {
  resetShellStores();
  useLayout.getState().openTab({ kind: 'diagnostics' });
  useLayout.getState().openTab({ kind: 'settings', section: null });
  useLayout.getState().activateTab('diagnostics');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('offers every clipped tab by its full name and activates the selected overflow entry', async () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(180);
  render(<TabStrip pane={0} split={false} idPrefix="overflow" />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'All tabs' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Settings' }));
  expect(currentSet(useLayout.getState().main).panes[0].activeTabId).toBe('settings');
});

it('does not spend a control on overflow when the strip fits', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(180);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
  act(() => render(<TabStrip pane={0} split={false} idPrefix="fits" />));
  expect(screen.queryByRole('button', { name: 'All tabs' })).toBeNull();
});
