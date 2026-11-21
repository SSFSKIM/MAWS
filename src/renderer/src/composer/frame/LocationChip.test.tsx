// The toolbar's location under the word cut: a started session's popover is the path and the additional directories,
// with no line saying the location is fixed, and the chip's tooltip ends at the branch (C22); each extra folder ends
// with a copy glyph whose word, "Copy" and then "Copied", is its name and its tooltip, which focus reaches (C24).
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LocationChip } from './LocationChip';

const tooltip = () => screen.queryByRole('tooltip')?.textContent ?? null;
afterEach(cleanup);

describe('the location chip', () => {
  it('shows the path and the extra folders, with no line saying the location is fixed', async () => {
    render(<LocationChip location={{ path: '/work/app', branch: 'main', note: null }} directories={['/work/extra']} dirty={false} />);
    const chip = screen.getByRole('button', { name: 'Location /work/app' });
    expect(chip.title).toBe('/work/app · main');
    await userEvent.setup().click(chip);
    const popover = screen.getByRole('dialog', { name: 'Location' });
    expect(popover.textContent).not.toContain('fixed');
    expect(within(popover).getByRole('list', { name: 'Additional directories' }).textContent).toBe('/work/extra');
  });

  it('keeps a note it is given, a gate’s reason', () => {
    render(<LocationChip location={{ path: '', branch: null, note: 'Session ended' }} directories={[]} dirty={false} />);
    expect(screen.getByRole('button', { name: /^Location/ }).title).toBe('Session ended');
  });

  it('copies an extra folder from a glyph named Copy, then Copied, its word its tooltip on focus', async () => {
    const user = userEvent.setup();
    render(<LocationChip location={{ path: '/work/app', branch: null, note: null }} directories={['/work/extra']} dirty={false} />);
    await user.click(screen.getByRole('button', { name: 'Location /work/app' }));
    const list = screen.getByRole('list', { name: 'Additional directories' });
    const copy = within(list).getByRole('button', { name: 'Copy' });
    expect(copy.textContent).toBe(''); // a glyph, no word drawn
    act(() => copy.focus());
    expect(tooltip()).toBe('Copy');
    await user.click(copy);
    expect(await navigator.clipboard.readText()).toBe('/work/extra'); // user-event's clipboard
    expect(within(list).getByRole('button', { name: 'Copied' })).toBe(copy);
  });
});
