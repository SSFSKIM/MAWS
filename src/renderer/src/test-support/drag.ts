// A drag driven event by event (P4-B3's `shell/transfer-drag.test.tsx` helpers, shared since UX wave U6b-1): a
// DataTransfer as a drag carries it, since happy-dom's own cannot be filled from a test, and an event fired with this
// very transfer (testing-library would copy it into a read-only one, losing what a handler sets on it) and its x.
import { act, createEvent, fireEvent } from '@testing-library/react';

export function transfer() {
  const data = new Map<string, string>();
  const types: string[] = [];
  return {
    types,
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type: string, value: string) => {
      data.set(type, value);
      if (!types.includes(type)) types.push(type);
    },
    getData: (type: string) => data.get(type) ?? '',
    setDragImage: () => {},
  };
}
export type Transfer = ReturnType<typeof transfer>;

// Answers whether a handler accepted the event (prevented it).
export function drag(kind: 'dragStart' | 'dragEnter' | 'dragOver' | 'dragLeave' | 'drop' | 'dragEnd', target: Element, dataTransfer: Transfer = transfer(), clientX = 0): boolean {
  const event = createEvent[kind](target);
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'clientX', { value: clientX });
  act(() => void fireEvent(target, event));
  return event.defaultPrevented;
}
