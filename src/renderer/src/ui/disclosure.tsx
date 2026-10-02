// The one motion every disclosure shares (W8, T3: the owner asked that opening a tool summary or the work summary be a
// smooth motion rather than a jump). Codex desktop's, read at build chatgpt-26.928.40906 (research/SOURCES.md): its
// work-area fold (`renderer/app/sites-end-resource-ef2bd7525d8a.js:25258` and `:25525-25600`) opens from height 0,
// opacity 0 and translateY(-8px) to the content's height, opacity 1 and no lift over 300 ms on cubic-bezier(0.19, 1,
// 0.22, 1) (`Pui`, `app-shared-360504a28a87.js:345680`), and closes back to them over 150 ms on cubic-bezier(0.23, 1,
// 0.32, 1) (`Oui`, `:345662`). Here the height runs from the content's measured scrollHeight; under
// prefers-reduced-motion nothing moves. A body that closes all the way unmounts its content once the close has run,
// so whatever measures it (the virtualised transcript's rows) settles on the end state; while the motion runs, every
// frame's height is real layout, so what sits below moves with it.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';

export const OPEN_MOTION = { ms: 300, easing: 'cubic-bezier(0.19, 1, 0.22, 1)' } as const;
export const CLOSE_MOTION = { ms: 150, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' } as const;
const LIFT = 'translateY(-8px)';

const REDUCED = '(prefers-reduced-motion: reduce)';
// One query per matchMedia (a test that replaces window.matchMedia gets its own).
const queries = new WeakMap<object, MediaQueryList>();
function reducedQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  let query = queries.get(window.matchMedia);
  if (!query) queries.set(window.matchMedia, (query = window.matchMedia(REDUCED)));
  return query;
}
export const prefersReducedMotion = () => reducedQuery()?.matches ?? false;
const subscribeReduced = (listener: () => void) => {
  const query = reducedQuery();
  query?.addEventListener('change', listener);
  return () => query?.removeEventListener('change', listener);
};
export const useReducedMotion = () => useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);

export interface DisclosureMotionOptions {
  // A preview that stays mounted closed, bounded at this many px by the caller's own CSS (a plan's first 144 px); 0,
  // the default, closes all the way and unmounts the content.
  closedHeight?: number;
  // Run the opening motion when the element mounts open (a row that appears because its disclosure was opened).
  appear?: boolean;
}

const clear = (style: CSSStyleDeclaration) => {
  for (const property of ['transition', 'height', 'max-height', 'overflow', 'opacity', 'transform']) style.removeProperty(property);
};

// Animates the element behind `ref` whenever `open` changes after mount. `mounted` says whether the content renders: it
// stays true through a close until its motion has run. The element carries no vertical border (its height is set from
// its scrollHeight).
export function useDisclosureMotion<T extends HTMLElement>(open: boolean, options: DisclosureMotionOptions = {}): { ref: RefObject<T | null>; mounted: boolean } {
  const { closedHeight = 0, appear = false } = options;
  const full = closedHeight === 0;
  const reduced = useReducedMotion();
  const ref = useRef<T>(null);
  const [closing, setClosing] = useState(false);
  const [rendered, setRendered] = useState(open);
  if (rendered !== open) {
    setRendered(open);
    setClosing(!open && full && !reduced);
  }
  const moved = useRef(appear ? !open : open); // the state the element last moved to
  const running = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (moved.current === open) return;
    moved.current = open;
    if (!element) return;
    const style = element.style;
    if (running.current !== null) clearTimeout(running.current);
    if (reduced) {
      running.current = null;
      clear(style);
      return;
    }
    const natural = element.scrollHeight;
    const bound = Math.min(closedHeight, natural);
    if (running.current === null) {
      // From rest: the closed end is 0 (fresh content) or the preview's bound, the open end the content's height.
      style.transition = 'none';
      style.overflow = 'hidden';
      style.maxHeight = 'none';
      style.height = `${open ? bound : natural}px`;
      if (full && open) {
        style.opacity = '0';
        style.transform = LIFT;
      }
      element.getBoundingClientRect(); // a layout here, so the start takes effect before the transition does (a call: a bare property read is compiled away)
    } // else a motion is under way: the new one starts from wherever it has got to
    const { ms, easing } = open ? OPEN_MOTION : CLOSE_MOTION;
    style.transition = ['height', 'opacity', 'transform'].map((property) => `${property} ${ms}ms ${easing}`).join(', ');
    style.height = `${open ? natural : bound}px`;
    if (full) {
      style.opacity = open ? '1' : '0';
      style.transform = open ? 'none' : LIFT;
    }
    running.current = setTimeout(() => {
      running.current = null;
      clear(style);
      if (!open) setClosing(false);
    }, ms);
  }, [open, reduced, closedHeight, full]);

  useEffect(
    () => () => {
      if (running.current !== null) clearTimeout(running.current);
    },
    [],
  );

  return { ref, mounted: !full || open || (closing && !reduced) };
}

// A disclosure's body: its children while open and through the close, nothing once closed. `flow-root` keeps the
// children's margins inside the measured box, so the height it opens to is the height it rests at.
const BODY: CSSProperties = { display: 'flow-root' };
export function DisclosureBody({ open, children, ...rest }: { open: boolean; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'style'>) {
  const { ref, mounted } = useDisclosureMotion<HTMLDivElement>(open);
  if (!mounted) return null;
  return (
    <div ref={ref} style={BODY} {...rest}>
      {children}
    </div>
  );
}
