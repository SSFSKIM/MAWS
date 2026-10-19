// W1 (tech debt, 2026-10-19): what a sortable list's drag tells assistive technology. dnd-kit's default announcements
// read the items' ids ("Draggable item s1wil85gy3z9-1 was dropped over droppable area plan"); these name the item by
// its position and title and say the position it moves to. Shared by the deck's filmstrip and the design's board list.
import type { Announcements, UniqueIdentifier } from '@dnd-kit/core';
import { DECK_COPY as C } from './copy';

/**
 * The announcements for a list whose order is `order()` (as last drawn: a drop is announced before the moved order is
 * drawn) and whose items `name(id, position)` names, position counted from 1. One drag at a time: the item over its
 * own place as it is picked up is not announced, so the pick-up is what is heard.
 */
export function reorderAnnouncements(order: () => readonly string[], name: (id: string, position: number) => string): Announcements {
  const at = (id: UniqueIdentifier) => order().indexOf(String(id)) + 1;
  const item = (id: UniqueIdentifier) => name(String(id), at(id));
  let picked: UniqueIdentifier | null = null;
  return {
    onDragStart: ({ active }) => {
      picked = active.id;
      return C.reorder.start(item(active.id));
    },
    onDragOver: ({ active, over }) => {
      const first = picked !== null && over?.id === picked;
      picked = null;
      if (first) return undefined;
      return over ? C.reorder.over(item(active.id), at(over.id)) : C.reorder.away(item(active.id));
    },
    onDragEnd: ({ active, over }) => (over ? C.reorder.end(item(active.id), at(over.id)) : C.reorder.cancel(item(active.id), at(active.id))),
    onDragCancel: ({ active }) => C.reorder.cancel(item(active.id), at(active.id)),
  };
}
