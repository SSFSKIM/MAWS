import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import s from './orange.module.css';

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
  children: ReactNode;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

/** A platter of glass tied to the thing that opened it. It grows out of that corner and shrinks back on leaving. */
export function Pop({ open, anchor, place, onClose, className, children, onPointerEnter, onPointerLeave }: PopProps) {
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
      const gap = 7;
      if (place === 'below-start') setPos({ left: r.left, top: r.bottom + gap });
      else if (place === 'below-end') setPos({ right: vw - r.right, top: r.bottom + gap });
      else if (place === 'above-start') setPos({ left: r.left, bottom: vh - r.top + gap });
      else if (place === 'above-end') setPos({ right: vw - r.right, bottom: vh - r.top + gap });
      else {
        const h = ref.current?.offsetHeight ?? 0;
        setPos({ left: r.right + 10, top: Math.max(10, Math.min(r.top - 12, vh - h - 12)) });
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
      className={`${s.pop} ${s.glass} ${className ?? ''}`}
      data-state={state}
      style={{ ...pos, transformOrigin: from, ['--o-pop-from' as string]: shift }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </div>,
    root,
  );
}

/** Height that opens and closes without knowing its size. Closed content is inert, so focus cannot land in it. */
export function Fold({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`${s.fold} ${className ?? ''}`} data-open={open}>
      <div className={s.foldIn} inert={!open}>
        {children}
      </div>
    </div>
  );
}
