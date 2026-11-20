// The named glyph (the word cut, rule 4): an icon button whose word stays its accessible name and its tooltip, with its
// shortcut in the tooltip; the tooltip shows on pointing after the short delay and at once on keyboard focus.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawnText } from '../test-support/drawn-text';
import { fakeTimeouts, realTimeouts } from '../test-support/fake-timeouts';
import { NamedGlyph } from './glyph';
import { POINTING_DELAY_MS } from './pointing';

beforeEach(fakeTimeouts);
afterEach(() => {
  cleanup();
  realTimeouts();
});
const user = () => userEvent.setup({ delay: null });
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;

const Plus = () => (
  <svg aria-hidden viewBox="0 0 16 16">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

describe('NamedGlyph', () => {
  it('keeps its word as its accessible name, draws no word at rest, and describes its shortcut', () => {
    render(
      <div data-testid="bar">
        <NamedGlyph label="New slide" shortcut="⌘⇧N" onClick={() => {}}>
          <Plus />
        </NamedGlyph>
      </div>,
    );
    expect(screen.getByRole('button', { name: 'New slide', description: '⌘⇧N' })).toBeTruthy();
    expect(drawnText(screen.getByTestId('bar'))).toBe('');
    expect(tooltip()).toBeNull();
  });

  it('shows its word and shortcut on pointing after the short delay', async () => {
    render(
      <NamedGlyph label="New slide" shortcut="⌘⇧N">
        <Plus />
      </NamedGlyph>,
    );
    await user().hover(screen.getByRole('button'));
    wait(POINTING_DELAY_MS - 1);
    expect(tooltip()).toBeNull();
    wait(1);
    expect(tooltip()).toBe('New slide · ⌘⇧N');
  });

  it('shows its word at once on keyboard focus, and acts on Enter', async () => {
    const add = vi.fn();
    render(
      <NamedGlyph label="Export" onClick={add}>
        <Plus />
      </NamedGlyph>,
    );
    const keys = user();
    await keys.tab();
    expect(tooltip()).toBe('Export');
    expect(screen.getByRole('button', { name: 'Export' }).hasAttribute('aria-describedby')).toBe(false); // nothing beyond its name to describe
    await keys.keyboard('{Enter}');
    expect(add).toHaveBeenCalledOnce();
  });

  it('greyed, keeps the keyboard and says why, and does not act', async () => {
    const add = vi.fn();
    render(
      <NamedGlyph label="New slide" shortcut="⌘⇧N" unavailable="The deck has reached its slide limit" onClick={add}>
        <Plus />
      </NamedGlyph>,
    );
    const button = screen.getByRole('button', { name: 'New slide', description: 'The deck has reached its slide limit · ⌘⇧N' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const keys = user();
    await keys.tab();
    expect(document.activeElement).toBe(button);
    expect(tooltip()).toBe('New slide · ⌘⇧NThe deck has reached its slide limit');
    await keys.keyboard('{Enter}');
    await keys.click(button);
    expect(add).not.toHaveBeenCalled();
  });

  it('says whether it is pressed', () => {
    render(
      <NamedGlyph label="Bold" pressed>
        <Plus />
      </NamedGlyph>,
    );
    expect(screen.getByRole('button', { name: 'Bold', pressed: true })).toBeTruthy();
  });
});
