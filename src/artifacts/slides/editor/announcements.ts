// W1 (tech debt, 2026-10-19): what a sortable list's drag tells assistive technology. dnd-kit's default announcements
// read the items' ids ("Draggable item s1wil85gy3z9-1 was dropped over droppable area plan"); these name the item by
// its position and title and say the position it moves to. Shared by the deck's filmstrip and the design's board list.
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { Announcements, UniqueIdentifier } from '@dnd-kit/core';
import { DECK_COPY as C } from './copy';

/**
 * A sortable list's DndContext `accessibility`, one object for the list's life: the announcements for a list whose
 * order is `order` and whose items `name(id, position)` names, position counted from 1, both as last drawn (a drop is
 * announced before the moved order is drawn). One drag at a time: the item over its own place as it is picked up is
 * not announced, so the pick-up is what is heard.
 */
export function useReorderAccessibility(order: readonly string[], name: (id: string, position: number) => string): { announcements: Announcements } {
  // read only as a drag is announced, never in render (the React Compiler compiles the lists that use this)
  const drawn = useRef({ order, name });
  useLayoutEffect(() => {
    drawn.current = { order, name };
  });
  const picked = useRef<UniqueIdentifier | null>(null);
  return useMemo(() => {
    const at = (id: UniqueIdentifier) => drawn.current.order.indexOf(String(id)) + 1;
    const item = (id: UniqueIdentifier) => drawn.current.name(String(id), at(id));
    return {
      announcements: {
        onDragStart: ({ active }) => {
          picked.current = active.id;
          return C.reorder.start(item(active.id));
        },
        onDragOver: ({ active, over }) => {
          const first = picked.current !== null && over?.id === picked.current;
          picked.current = null;
          if (first) return undefined;
          return over ? C.reorder.over(item(active.id), at(over.id)) : C.reorder.away(item(active.id));
        },
        onDragEnd: ({ active, over }) => (over ? C.reorder.end(item(active.id), at(over.id)) : C.reorder.cancel(item(active.id), at(active.id))),
        onDragCancel: ({ active }) => C.reorder.cancel(item(active.id), at(active.id)),
      },
    };
  }, []);
}
