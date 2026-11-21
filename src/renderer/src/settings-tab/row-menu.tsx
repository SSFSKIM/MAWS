// A Settings row's actions in one "…" menu (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md, M1:
// G73's imported profile, and the Org page's people, devices and machines, G162, G163, G173), drawn as the library's row
// menu is (library/RowMenu.tsx). Its trigger is a glyph named, and tipped, by what the actions act on ("Actions for
// <profile>"); a removal reads in the danger colour. A row with no action offered draws no menu. Choosing an item hands
// the keyboard back to the trigger before the action runs, so a sheet the action opens remembers the trigger (which
// stays) as its opener, not the item (which leaves with the menu), and Cancel or Escape lands on the row's "…" again.
import { DropdownMenu } from 'radix-ui';
import { useRef } from 'react';
import { MoreIcon } from '../tools/browser/icons';
import { Tip } from '../ui/tip';

// A glyph button in a row (the menu's trigger, a disclosure chevron): the library's row size, the app's glyph look.
export const ROW_GLYPH = 'inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active data-[state=open]:text-fg';
const MENU = 'z-50 min-w-48 rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-float';
const MENU_ITEM = 'flex h-7 cursor-default items-center rounded-sm px-2 outline-none select-none data-disabled:text-fg-faint data-highlighted:bg-bg-hover';

export type RowAction = { label: string; onSelect(): void; disabled?: boolean; danger?: boolean };

export function RowMenu({ label, actions }: { label: string; actions: readonly (RowAction | false | null | undefined)[] }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const offered = actions.filter((action): action is RowAction => Boolean(action));
  if (offered.length === 0) return null;
  return (
    <DropdownMenu.Root modal={false}>
      <Tip content={label}>
        <DropdownMenu.Trigger asChild>
          <button ref={trigger} type="button" aria-label={label} className={ROW_GLYPH}>
            <MoreIcon />
          </button>
        </DropdownMenu.Trigger>
      </Tip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          {offered.map((action) => (
            <DropdownMenu.Item
              key={action.label}
              disabled={action.disabled}
              className={`${MENU_ITEM} ${action.danger ? 'text-danger' : ''}`}
              onSelect={() => {
                trigger.current?.focus({ preventScroll: true });
                action.onSelect();
              }}
            >
              {action.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
