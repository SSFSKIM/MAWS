import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DropdownMenu } from 'radix-ui';
import type { PointerEvent } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { preserveSubmenuPointer } from '@artifacts/ui/menu-pointer';

afterEach(cleanup);

function Menu({ leave }: { leave?: (prevented: boolean) => void }) {
  const handoff = (event: PointerEvent<HTMLDivElement>) => {
    preserveSubmenuPointer(event);
    leave?.(event.defaultPrevented);
  };
  return <DropdownMenu.Root defaultOpen modal={false}>
    <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content>
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger onPointerLeave={handoff}>Formats</DropdownMenu.SubTrigger>
        <DropdownMenu.Portal><DropdownMenu.SubContent>
          <DropdownMenu.Item>Named fonts</DropdownMenu.Item>
        </DropdownMenu.SubContent></DropdownMenu.Portal>
      </DropdownMenu.Sub>
      <DropdownMenu.Item>Other action</DropdownMenu.Item>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

async function openedSubmenu(leave?: (prevented: boolean) => void) {
  render(<Menu leave={leave} />);
  const trigger = await screen.findByRole('menuitem', { name: 'Formats' });
  await userEvent.click(trigger);
  const child = await screen.findByRole('menuitem', { name: 'Named fonts' });
  return { trigger, child, parent: trigger.closest('[role="menu"]')! };
}

describe('pointer transfer into a portalled submenu', () => {
  it('keeps the trigger focused and submenu open during a direct leftward transfer into its child', async () => {
    const { trigger, child, parent } = await openedSubmenu();
    expect(parent.contains(child)).toBe(false);
    // Radix starts its parent direction at right/0; one first move then a leftward jump must still reach the child.
    fireEvent.pointerMove(trigger, { pointerType: 'mouse', clientX: 1504, clientY: 102 });
    expect(document.activeElement).toBe(trigger);
    fireEvent.pointerOut(trigger, { pointerType: 'mouse', clientX: 1276, clientY: 135, relatedTarget: child });
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('menuitem', { name: 'Named fonts' })).toBe(child);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('does not prevent a leave to an unrelated target', async () => {
    let prevented: boolean | undefined;
    const { trigger } = await openedSubmenu((value) => { prevented = value; });
    fireEvent.pointerOut(trigger, { pointerType: 'mouse', clientX: 1276, clientY: 135, relatedTarget: document.body });
    expect(prevented).toBe(false);
  });

  it('leaves keyboard entry and Escape dismissal with Radix', async () => {
    const user = userEvent.setup();
    render(<Menu />);
    const trigger = await screen.findByRole('menuitem', { name: 'Formats' });
    trigger.focus();
    await user.keyboard('{ArrowRight}');
    const child = await screen.findByRole('menuitem', { name: 'Named fonts' });
    await waitFor(() => expect(document.activeElement).toBe(child));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Named fonts' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Actions' }));
  });
});
