// The board's own furniture: the frame a variant stands in (its letter and name, set outside the thing judged),
// the state every variant on a page shares (at rest or opened, a replay count), and the two things most variants
// are made of: a block standing on glass and a menu that opens from its control.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useGlassUnder, useKick } from '../layers/glass';
import { cx, usePresence } from '../layers/parts';
import type { Scheme } from '../../lab/types';
import { LETTERS, SUGGESTED, type PartDef } from './parts';

export interface Board {
  part: PartDef;
  scheme: Scheme;
  /** Every variant shows what waits behind its click or hover. */
  open: boolean;
  /** A page's own state, where it has one (the composer running, idle, typed). */
  state: string;
  /** Counts up on Replay. */
  replay: number;
  picks: Record<string, string>;
  pick: (part: string, letter: string) => void;
}

export const BoardCtx = createContext<Board | null>(null);
/** The page's scroller. A block's glass is drawn in the window's plane, so it is cut to the scroller by hand. */
export const ClipCtx = createContext<HTMLElement | null>(null);
export const useBoard = () => useContext(BoardCtx)!;

/** One variant: its tag in the margin (click it to pick), and the thing itself. */
export function Variant({ n, children, className, style }: { n: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  const { part, picks, pick } = useBoard();
  const letter = LETTERS[n]!;
  const picked = picks[part.id] === letter;
  // The owner took the suggested set (2026-11-14): that form is Layers now, and A is the part as Layers had it.
  const now = SUGGESTED[part.id] === letter;
  return (
    <section className={cx('xc-variant', className)} aria-label={`${letter}: ${part.variants[n]}`} style={style}>
      <button type="button" className="xc-tag" aria-pressed={picked} onClick={() => pick(part.id, letter)} title={picked ? 'Your pick' : 'Pick this one'}>
        <b>{letter}</b>
        <span className="xc-tag-name">
          {part.variants[n]}
          {(n === 0 || now || part.notes?.[n]) && <small>{now ? 'in Layers now' : n === 0 ? 'as it was' : part.notes?.[n]}</small>}
        </span>
      </button>
      <div className="xc-thing">{children}</div>
    </section>
  );
}

/** A block of the board that stands on glass, as a transcript block does in Layers. */
export function Block({ className, radius = 18, clip, on = true, children, style, ...rest }: { className?: string; radius?: number; clip?: HTMLElement | null; on?: boolean; children: ReactNode; style?: CSSProperties } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const page = useContext(ClipCtx);
  useGlassUnder(ref, { radius, clip: clip ?? page, on });
  return (
    <div ref={ref} className={cx('xl-block', className)} style={style} {...rest}>
      {children}
    </div>
  );
}

/** True while a thing is disclosed: by its own click, or because the page is showing everything opened. */
export function useOpen(follow = true) {
  const board = useBoard();
  const all = follow && board.open;
  const [own, setOwn] = useState(false);
  const kick = useKick();
  useEffect(() => setOwn(false), [all]);
  const open = own || all;
  return [open, () => (setOwn((v) => !v), kick(520)), () => setOwn(false)] as const;
}

/** Closes on a press outside and on Escape. */
export function useDismiss(el: HTMLElement | null, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open || !el) return;
    const down = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [el, open, close]);
}

export type MenuMotion = 'corner' | 'unroll' | 'become';
export type MenuPlace = 'above-end' | 'above-start' | 'below-end' | 'below-start';

/**
 * A menu that opens from the control beside it. It stands in the page (not in a portal), inside the element that
 * wraps its control, so several can be open on one board. `motion` is how it arrives and leaves:
 * `corner` is Layers' own (it grows from the corner nearest its control and fades), `unroll` lets it down from the
 * control's edge by its height, `become` grows it out of the control's own box, which it then covers.
 */
export function Menu({ open, motion = 'corner', place = 'above-end', label, className, children }: { open: boolean; motion?: MenuMotion; place?: MenuPlace; label: string; className?: string; children: ReactNode }) {
  const exit = motion === 'corner' ? 130 : motion === 'unroll' ? 190 : 240;
  const { mounted, state } = usePresence(open, exit);
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; aw: number; ah: number } | null>(null);
  // `become` travels between two measured boxes: the control's and the menu's own.
  useLayoutEffect(() => {
    if (!mounted || motion !== 'become') return;
    const anchor = ref.current?.parentElement?.querySelector<HTMLElement>('[data-menu-anchor]');
    const box = inner.current;
    if (!anchor || !box) return;
    setSize({ w: box.offsetWidth, h: box.offsetHeight, aw: anchor.offsetWidth, ah: anchor.offsetHeight });
  }, [mounted, motion]);
  if (!mounted) return null;
  const vars = size ? ({ '--xc-w': `${size.w}px`, '--xc-h': `${size.h}px`, '--xc-aw': `${size.aw}px`, '--xc-ah': `${size.ah}px` } as CSSProperties) : undefined;
  return (
    <div ref={ref} role="dialog" aria-label={label} className={cx('xl-pop xc-menu', className)} data-state={state} data-motion={motion} data-place={place} data-sized={size ? '' : undefined} style={vars}>
      <div className="xc-menu-in" ref={inner}>
        {children}
      </div>
    </div>
  );
}

/** A count that runs: a running command's clock. Starts again from the fixture's value when the page is replayed. */
export function useClock(from: number) {
  const [n, setN] = useState(from);
  useEffect(() => {
    const t = window.setInterval(() => setN((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return n;
}
