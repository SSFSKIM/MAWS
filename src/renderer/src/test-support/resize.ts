// A ResizeObserver for jsdom (which has none): every observer is kept, and `resize` reports a content box for an
// element to the observers watching it, inside act so the state it sets renders before the test reads.
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export function installResizeObserver(): { resize(element: Element, size: { width: number; height: number }): void } {
  const watching = new Map<Element, Set<ResizeObserverCallback>>();
  class FakeResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      if (!watching.has(target)) watching.set(target, new Set());
      watching.get(target)!.add(this.callback);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
      watching.get(target)?.delete(this.callback);
    }
    disconnect() {
      for (const target of this.targets) watching.get(target)?.delete(this.callback);
      this.targets.clear();
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    resize(element, { width, height }) {
      const entry = { target: element, contentRect: { width, height } } as unknown as ResizeObserverEntry;
      act(() => {
        for (const callback of watching.get(element) ?? []) callback([entry], {} as ResizeObserver);
      });
    },
  };
}
