// The toolbar's and region heads' square button (board ticket 815): the named glyph, its word a tooltip the keyboard
// reaches, the action's chord after it; a greyed one keeps Tab, says why and does nothing on a press.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveChord } from '@shared/keymap/actions';
import { formatChord } from '@shared/keymap/chord';
import { accessibleDescription } from '../test-support/accessible-text';
import { fakeTimeouts, realTimeouts } from '../test-support/fake-timeouts';
import { POINTING_DELAY_MS } from '../ui/pointing';
import { Icon, IconButton } from './IconButton';

beforeEach(fakeTimeouts);
afterEach(() => {
  cleanup();
  realTimeouts();
});
const user = () => userEvent.setup({ delay: null });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;
const chord = formatChord(effectiveChord('sidebar.toggle', {})!);

const Glyph = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);

describe('IconButton', () => {
  it('keeps its word as its accessible name and draws no system tooltip', () => {
    render(
      <IconButton label="Toggle sidebar" action="sidebar.toggle">
        <Glyph />
      </IconButton>,
    );
    const button = screen.getByRole('button', { name: 'Toggle sidebar' });
    expect(button.hasAttribute('title')).toBe(false);
    expect(accessibleDescription(button)).toBe(chord);
    expect(tooltip()).toBeNull();
  });

  it('shows its word and the action’s chord at once on keyboard focus, and acts on Enter', async () => {
    const toggle = vi.fn();
    render(
      <IconButton label="Toggle sidebar" action="sidebar.toggle" onClick={toggle}>
        <Glyph />
      </IconButton>,
    );
    await user().tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Toggle sidebar' }));
    expect(tooltip()).toBe(`Toggle sidebar · ${chord}`);
    await user().keyboard('{Enter}');
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('shows its word alone on pointing after the short delay when it mirrors no action', async () => {
    render(
      <IconButton label="Close">
        <Glyph />
      </IconButton>,
    );
    await user().hover(screen.getByRole('button', { name: 'Close' }));
    wait(POINTING_DELAY_MS - 1);
    expect(tooltip()).toBeNull();
    wait(1);
    expect(tooltip()).toBe('Close');
  });

  it('when greyed keeps Tab, says why in its tooltip and description, and swallows its press', async () => {
    const press = vi.fn();
    render(
      <IconButton label="Back" unavailable="No page to go back to" onClick={press}>
        <Glyph />
      </IconButton>,
    );
    await user().tab();
    const button = screen.getByRole('button', { name: 'Back', description: 'No page to go back to' });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(tooltip()).toBe('BackNo page to go back to');
    await user().keyboard('{Enter}');
    await user().keyboard(' ');
    await user().click(button);
    expect(press).not.toHaveBeenCalled();
  });

  it('hands its ref to the button, so a menu trigger or a focus return still finds it', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <IconButton ref={ref} label="More">
        <Glyph />
      </IconButton>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'More' }));
  });
});
