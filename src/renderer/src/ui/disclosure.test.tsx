// The shared disclosure motion (W8, T3) under happy-dom, which has no layout: the content's height is stubbed, and the
// motion's start is read at the layout it forces, the moment before the transition is set.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisclosureBody, useDisclosureMotion } from './disclosure';

const CONTENT_PX = 120;
let starts: { height: string; opacity: string; transform: string; transition: string }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  starts = [];
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => CONTENT_PX });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const { height, opacity, transform, transition } = this.style;
    starts.push({ height, opacity, transform, transition });
    return new DOMRect();
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
});

const body = () => screen.queryByTestId('body');
const Body = ({ open }: { open: boolean }) => (
  <DisclosureBody open={open} data-testid="body">
    <p>content</p>
  </DisclosureBody>
);

describe('DisclosureBody', () => {
  it('opens from height 0, transparent and lifted 8 px to the content’s height over Codex’s 300 ms, then rests unstyled', () => {
    const view = render(<Body open={false} />);
    expect(body()).toBeNull();
    view.rerender(<Body open />);
    expect(starts).toEqual([{ height: '0px', opacity: '0', transform: 'translateY(-8px)', transition: 'none' }]);
    const style = body()!.style;
    expect(style.height).toBe(`${CONTENT_PX}px`);
    expect(style.opacity).toBe('1');
    expect(style.transform).toBe('none');
    expect(style.overflow).toBe('hidden');
    expect(style.transition).toBe(
      'height 300ms cubic-bezier(0.19, 1, 0.22, 1), opacity 300ms cubic-bezier(0.19, 1, 0.22, 1), transform 300ms cubic-bezier(0.19, 1, 0.22, 1)',
    );
    act(() => vi.advanceTimersByTime(300));
    expect(body()!.getAttribute('style')).toBe('display: flow-root;');
  });

  it('closes over Codex’s 150 ms back to height 0, keeping its content until then, and unmounts it at the end', () => {
    const view = render(<Body open />);
    expect(starts).toEqual([]); // mounted open: no motion
    view.rerender(<Body open={false} />);
    expect(starts).toEqual([{ height: `${CONTENT_PX}px`, opacity: '', transform: '', transition: 'none' }]);
    const style = body()!.style;
    expect(style.height).toBe('0px');
    expect(style.opacity).toBe('0');
    expect(style.transform).toBe('translateY(-8px)');
    expect(style.transition).toContain('height 150ms cubic-bezier(0.23, 1, 0.32, 1)');
    expect(body()!.textContent).toBe('content');
    act(() => vi.advanceTimersByTime(149));
    expect(body()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(body()).toBeNull();
  });

  it('reversed mid-motion, runs the new one from where the old one got to, without a reset', () => {
    const view = render(<Body open />);
    view.rerender(<Body open={false} />);
    act(() => vi.advanceTimersByTime(80));
    view.rerender(<Body open />);
    expect(starts).toHaveLength(1); // only the close started from rest
    expect(body()!.style.height).toBe(`${CONTENT_PX}px`);
    expect(body()!.style.transition).toContain('height 300ms');
    act(() => vi.advanceTimersByTime(150)); // the close's end has passed: it was called off
    expect(body()).not.toBeNull();
    act(() => vi.advanceTimersByTime(150));
    expect(body()!.getAttribute('style')).toBe('display: flow-root;');
  });

  it('under prefers-reduced-motion, opens and closes at once with no motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', addEventListener: () => {}, removeEventListener: () => {} }));
    const view = render(<Body open={false} />);
    view.rerender(<Body open />);
    expect(body()!.getAttribute('style')).toBe('display: flow-root;');
    view.rerender(<Body open={false} />);
    expect(body()).toBeNull();
    expect(starts).toEqual([]);
  });
});

describe('reduced motion turning on mid-motion', () => {
  function switchable() {
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    vi.stubGlobal('matchMedia', () => query);
    return (matches: boolean) => {
      query.matches = matches;
      act(() => listeners.forEach((listener) => listener()));
    };
  }

  it('ends an opening at once', () => {
    const reduce = switchable();
    const view = render(<Body open={false} />);
    view.rerender(<Body open />);
    expect(body()!.style.transition).toContain('height 300ms');
    reduce(true);
    expect(body()!.getAttribute('style')).toBe('display: flow-root;');
  });

  it('ends a closing at once, its content gone for good', () => {
    const reduce = switchable();
    const view = render(<Body open />);
    view.rerender(<Body open={false} />);
    expect(body()).not.toBeNull();
    reduce(true);
    expect(body()).toBeNull();
    act(() => vi.advanceTimersByTime(0));
    reduce(false);
    expect(body()).toBeNull();
  });
});

describe('useDisclosureMotion', () => {
  function Preview({ open }: { open: boolean }) {
    const { ref, mounted } = useDisclosureMotion<HTMLDivElement>(open, { closedHeight: 48 });
    return (
      <div ref={ref} data-testid="body">
        {mounted ? 'plan' : null}
      </div>
    );
  }

  it('a preview moves between its bound and the content’s height, and stays mounted closed', () => {
    const view = render(<Preview open={false} />);
    view.rerender(<Preview open />);
    expect(starts.at(-1)).toMatchObject({ height: '48px', opacity: '', transform: '' });
    expect(body()!.style.height).toBe(`${CONTENT_PX}px`);
    expect(body()!.style.maxHeight).toBe('none'); // past the caller's own bound while it moves
    act(() => vi.advanceTimersByTime(300));
    view.rerender(<Preview open={false} />);
    expect(starts.at(-1)).toMatchObject({ height: `${CONTENT_PX}px` });
    expect(body()!.style.height).toBe('48px');
    act(() => vi.advanceTimersByTime(150));
    expect(body()!.textContent).toBe('plan');
    expect(body()!.getAttribute('style')).toBeNull();
  });

  it('with appear, runs the opening motion when it mounts open', () => {
    function Appearing() {
      const { ref } = useDisclosureMotion<HTMLDivElement>(true, { appear: true });
      return <div ref={ref} data-testid="body" />;
    }
    render(<Appearing />);
    expect(starts).toEqual([{ height: '0px', opacity: '0', transform: 'translateY(-8px)', transition: 'none' }]);
    expect(body()!.style.height).toBe(`${CONTENT_PX}px`);
  });
});
