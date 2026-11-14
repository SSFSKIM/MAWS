// Small parts shared by every scene. The glyphs, the ring, the fold and the popover are Quiet's, moved onto
// prefixed class names; the pressed-glass button is Instrument's.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useGlassPress } from '@vitreajs/vitrea-react';
import { CircleQuestionMark, Hand, ListChecks } from 'lucide-react';
import type { SessionState } from '../../content/fixtures';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** The words a glyph stands for. They are read out and shown in tooltips, never printed in a row. */
export const stateWord: Record<SessionState, string> = {
  running: 'Running',
  approval: 'Waiting for your approval',
  question: 'Asked you a question',
  plan: 'Plan ready for review',
  unread: 'Finished, not read yet',
  idle: '',
};

export const isYours = (state: SessionState) => state === 'approval' || state === 'question' || state === 'plan';

/** Grey and breathing: the agent is busy. Solid ink: something new to read. Orange with a shape: it is your move. */
export function StateGlyph({ state, size = 15 }: { state: SessionState; size?: number }) {
  if (state === 'idle') return null;
  if (state === 'running' || state === 'unread') {
    return (
      <span className="xl-glyph" role="img" aria-label={stateWord[state]} key={state}>
        <i className="xl-dot" data-run={state === 'running' ? '' : undefined} />
      </span>
    );
  }
  const Icon = state === 'approval' ? Hand : state === 'question' ? CircleQuestionMark : ListChecks;
  return (
    <span className="xl-glyph" data-kind="yours" role="img" aria-label={stateWord[state]} key={state}>
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

/** A share of something, as an arc. Two of them nest. */
export function Ring({ value, inner, size = 18 }: { value: number; inner?: number; size?: number }) {
  const arc = (r: number, v: number, w: number) => {
    const c = 2 * Math.PI * r;
    return (
      <>
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth={w} />
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 12 12)" />
      </>
    );
  };
  return (
    <svg className="xl-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {inner === undefined ? arc(8.5, value, 3) : arc(9.75, value, 2.5)}
      {inner !== undefined && arc(4.75, inner, 2.5)}
    </svg>
  );
}

/** A share of something, as a level in a small round glass: one round thing that fills as a limit nears. */
export function Drop({ value, size = 18 }: { value: number; size?: number }) {
  const id = `xl-drop-${Math.round(value * 1000)}-${size}`;
  const top = 18.5 - 13 * value;
  return (
    <svg className="xl-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <clipPath id={id}>
        <circle cx="12" cy="12" r="6.5" />
      </clipPath>
      <circle cx="12" cy="12" r="9.75" fill="none" stroke="currentColor" strokeOpacity="0.38" strokeWidth="1.75" />
      <rect x="0" y={top} width="24" height={24 - top} fill="currentColor" clipPath={`url(#${id})`} />
    </svg>
  );
}

/** Height that opens and closes without knowing its size. Closed content is inert, so focus cannot land in it. */
export function Fold({ open, children, className, clipRef }: { open: boolean; children: ReactNode; className?: string; clipRef?: (el: HTMLDivElement | null) => void }) {
  return (
    <div className={cx('xl-fold', className)} data-open={open}>
      <div className="xl-fold-in" inert={!open} ref={clipRef}>
        {children}
      </div>
    </div>
  );
}

/** A plain button that sits on glass. It is a fill, and a press on it presses the glass it sits on. */
export function GBtn({ label, tip, children, className, ...rest }: { label: string; tip?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const press = useGlassPress();
  return (
    <button type="button" aria-label={label} data-tip={tip} className={cx('xl-gbtn', className)} {...press} {...rest}>
      {children}
    </button>
  );
}

// ---- Popovers: a raised panel tied to the thing that opened it ----------------------------------------------------

/** The experiment's root element: overlays are portalled into it so they inherit its tokens. */
export const RootCtx = createContext<HTMLElement | null>(null);

/** Keeps a thing mounted while it leaves, so every overlay has an exit as well as an entrance. */
export function usePresence(open: boolean, exitMs = 130) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<'open' | 'closing'>('open');
  useEffect(() => {
    if (open) {
      setMounted(true);
      setState('open');
      return;
    }
    setState('closing');
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted: mounted || open, state: open ? 'open' : state } as const;
}

export type Place = 'below-start' | 'below-end' | 'above-start' | 'above-end' | 'right';

const origin: Record<Place, [string, string]> = {
  'below-start': ['0 0', 'translateY(-5px)'],
  'below-end': ['100% 0', 'translateY(-5px)'],
  'above-start': ['0 100%', 'translateY(5px)'],
  'above-end': ['100% 100%', 'translateY(5px)'],
  right: ['0 24px', 'translateX(-8px)'],
};

interface PopProps {
  open: boolean;
  anchor: HTMLElement | null;
  place: Place;
  onClose: () => void;
  className?: string;
  label?: string;
  children: ReactNode;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/** It grows out of the corner nearest its anchor and shrinks back on leaving. */
export function Pop({ open, anchor, place, onClose, className, label, children, onPointerEnter, onPointerLeave }: PopProps) {
  const root = useContext(RootCtx);
  const { mounted, state } = usePresence(open);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const put = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 8;
      if (place === 'below-start') setPos({ left: r.left, top: r.bottom + gap });
      else if (place === 'below-end') setPos({ right: vw - r.right, top: r.bottom + gap });
      else if (place === 'above-start') setPos({ left: r.left, bottom: vh - r.top + gap });
      else if (place === 'above-end') setPos({ right: vw - r.right, bottom: vh - r.top + gap });
      else {
        const h = ref.current?.offsetHeight ?? 0;
        setPos({ left: r.right + 14, top: Math.max(10, Math.min(r.top - 12, vh - h - 12)) });
      }
    };
    put();
    // The side card is measured once it exists, so it never hangs off the bottom of the window.
    const again = place === 'right' ? window.requestAnimationFrame(put) : 0;
    window.addEventListener('resize', put);
    return () => {
      window.cancelAnimationFrame(again);
      window.removeEventListener('resize', put);
    };
  }, [open, anchor, place]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open, anchor, onClose]);

  if (!mounted || !root || !pos) return null;
  const [from, shift] = origin[place];
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cx('xl-pop', className)}
      data-state={state}
      style={{ ...pos, transformOrigin: from, ['--xl-pop-from' as string]: shift }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>,
    root,
  );
}

export const clock = (sec: number) => (sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`);
export const split = (path: string) => {
  const i = path.lastIndexOf('/');
  return [path.slice(0, i + 1), path.slice(i + 1)] as const;
};
