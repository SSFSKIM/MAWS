// A menu item greyed with a reason (the word cut, docs/doperpowers/specs/2026-11-16-word-cut-design.md, "What the cut
// builds": a greyed control's reason needs an owner the keyboard reaches). It stays in the menu's keyboard, drawn
// aria-disabled rather than disabled, so the menu does not skip it; selecting it does nothing and keeps the menu open;
// its reason is its description and its row note, shown on pointing or focus, never a system tooltip. Its label is its
// accessible name, so the note's words never join the name. For a Radix context menu or dropdown menu alike.
import type { ContextMenu, DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';
import { RowNote, useRowNote } from './row-note';

type MenuKit = typeof DropdownMenu | typeof ContextMenu;

// `lead`, drawn before the label, keeps the room a menu's other rows give their check (board ticket 421's Tools submenu).
export function RefusedMenuItem({ kit, label, reason, lead = null, className = '', ...data }: { kit: MenuKit; label: string; reason: ReactNode; lead?: ReactNode; className?: string } & { [attribute: `data-${string}`]: string }) {
  const note = useRowNote();
  return (
    <kit.Item {...data} aria-disabled aria-label={label} textValue={label} {...note.rowProps} onSelect={(event) => event.preventDefault()} className={`relative ${className}`}>
      {lead}
      {label}
      <RowNote note={note}>{reason}</RowNote>
    </kit.Item>
  );
}
