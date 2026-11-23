// The disclosure motion's view of layout under happy-dom, which has none (board ticket 850; as `ui/disclosure.test.tsx`
// reads it): every element's content is `content` px tall and its box `box` px, and each motion's start is read at the
// layout it forces, the moment before its transition is set. Not a test file itself.
import { act } from '@testing-library/react';
import { vi } from 'vitest';

export interface MotionStart {
  height: string;
  opacity: string;
  transform: string;
  transition: string;
}

/** Stubs the layout the motion reads; call in `beforeEach`, with `restoreMotionLayout` in `afterEach`. */
export function stubMotionLayout(content = 120, box = 48): MotionStart[] {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const starts: MotionStart[] = [];
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => content });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => box });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const { height, opacity, transform, transition } = this.style;
    starts.push({ height, opacity, transform, transition });
    return new DOMRect();
  });
  return starts;
}

export function restoreMotionLayout(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
}

/** `prefers-reduced-motion: reduce` from now on. */
export function reduceMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', addEventListener: () => {}, removeEventListener: () => {} }));
}

export const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

/** Whether an element is mid-way through the opening (300 ms) or the closing (150 ms) motion. */
export const opening = (element: Element | null) => (element as HTMLElement | null)?.style.transition.includes('height 300ms') === true;
export const closing = (element: Element | null) => (element as HTMLElement | null)?.style.transition.includes('height 150ms') === true;
