// The refused menu item (the word cut, N90, N94): in the menu's keyboard, greyed, named by its label alone, its reason
// its description and its note on focus; selecting it neither runs anything nor closes the menu.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu } from 'radix-ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefusedMenuItem } from './refused-menu-item';

afterEach(cleanup);

describe('a refused menu item', () => {
  it('is reached by the arrows, says why on focus, and its press keeps the menu open', async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    render(
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>Open</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={chosen}>Rename</DropdownMenu.Item>
            <RefusedMenuItem kit={DropdownMenu} data-kind="move" label="Move to the archive" reason="Only a finished draft moves" />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const item = await screen.findByRole('menuitem', { name: 'Move to the archive', description: 'Only a finished draft moves' });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.hasAttribute('data-disabled')).toBe(false);
    expect(item.getAttribute('title')).toBeNull();
    expect(item.dataset.kind).toBe('move');
    act(() => screen.getByRole('menuitem', { name: 'Rename' }).focus());
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item);
    expect(item.querySelector('[data-row-note]')?.hasAttribute('data-open')).toBe(true);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(chosen).not.toHaveBeenCalled();
  });
});
