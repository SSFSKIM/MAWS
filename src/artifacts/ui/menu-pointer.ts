import type { PointerEvent } from 'react';

// A body-portal submenu is a logical child of its trigger. Radix's direction-based pointer grace can miss a direct
// transfer into a collision-flipped menu; do not let that leave focus the parent and dismiss the child being entered.
export function preserveSubmenuPointer(event: Pick<PointerEvent<HTMLElement>, 'currentTarget' | 'relatedTarget' | 'preventDefault'>): void {
  const trigger = event.currentTarget;
  const target = event.relatedTarget;
  if (trigger.getAttribute('aria-expanded') !== 'true' || !(target instanceof Node)) return;
  const id = trigger.getAttribute('aria-controls');
  const submenu = id ? trigger.ownerDocument.getElementById(id) : null;
  if (submenu?.contains(target)) event.preventDefault();
}
