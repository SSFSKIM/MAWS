// Small parts shared by the scenes: the menu layer, the round marks, and the settings controls.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import s from './desktop.module.css';

// ---- Menus ------------------------------------------------------------------------------------------------------
// One menu at a time, drawn in a layer above the window (never inside the pane: a backdrop blur nested in another
// would only see its parent). A menu grows out of the control that opened it and fades when it leaves.

interface MenuState {
  id: string | null;
  anchor: HTMLElement | null;
  closing: boolean;
}

interface MenuCtl extends MenuState {
  layer: HTMLElement | null;
  toggle: (id: string, anchor: HTMLElement) => void;
  close: () => void;
}

const MenuContext = createContext<MenuCtl | null>(null);

export function useMenu(): MenuCtl {
  const ctl = useContext(MenuContext);
  if (!ctl) throw new Error('menu context missing');
  return ctl;
}

const LEAVE_MS = 110;

export function MenuProvider({ layer, children }: { layer: HTMLElement | null; children: ReactNode }) {
  const [state, setState] = useState<MenuState>({ id: null, anchor: null, closing: false });
  const now = useRef(state);
  now.current = state;
  const timer = useRef(0);
  const leave = useCallback(() => {
    setState({ ...now.current, closing: true });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState({ id: null, anchor: null, closing: false }), LEAVE_MS);
  }, []);
  const close = useCallback(() => {
    if (now.current.id && !now.current.closing) leave();
  }, [leave]);
  const toggle = useCallback(
    (id: string, anchor: HTMLElement) => {
      if (now.current.id === id && !now.current.closing) return leave();
      window.clearTimeout(timer.current);
      setState({ id, anchor, closing: false });
    },
    [leave],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const ctl = useMemo(() => ({ ...state, layer, toggle, close }), [state, layer, toggle, close]);
  return <MenuContext.Provider value={ctl}>{children}</MenuContext.Provider>;
}

type Place = 'below-start' | 'below-end' | 'above-start' | 'above-end';

export function Popover({
  id,
  place = 'below-start',
  width,
  label,
  role = 'menu',
  children,
}: {
  id: string;
  place?: Place;
  width?: number;
  label: string;
  role?: 'menu' | 'dialog' | 'listbox' | 'note';
  children: ReactNode;
}) {
  const ctl = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const open = ctl.id === id;
  const { anchor, close } = ctl;

  useLayoutEffect(() => {
    if (!open || !anchor) return void setPos(null);
    const a = anchor.getBoundingClientRect();
    const gap = 6;
    const st: CSSProperties = {};
    if (place.startsWith('below')) st.top = a.bottom + gap;
    else st.bottom = window.innerHeight - a.top + gap;
    if (place.endsWith('start')) st.left = Math.max(8, a.left);
    else st.right = Math.max(8, window.innerWidth - a.right);
    setPos(st);
  }, [open, anchor, place]);

  useEffect(() => {
    if (!open || !pos) return;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('button, a[href], input');
    (first ?? el)?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el?.contains(t) || anchor?.contains(t)) return;
      close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        anchor?.focus({ preventScroll: true });
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(el?.querySelectorAll<HTMLElement>('button, a[href]') ?? []);
        if (items.length === 0) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const n = e.key === 'ArrowDown' ? i + 1 : i - 1;
        items[(n + items.length) % items.length]?.focus();
      }
    };
    const away = () => close();
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', away);
    };
  }, [open, pos, anchor, close]);

  if (!open || !pos || !ctl.layer) return null;
  return createPortal(
    <div
      ref={ref}
      className={s.pop}
      data-place={place}
      data-closing={ctl.closing || undefined}
      style={{ ...pos, width }}
      role={role}
      aria-label={label}
      tabIndex={-1}
    >
      {children}
    </div>,
    ctl.layer,
  );
}

export function MenuItem({
  children,
  trailing,
  checked,
  onSelect,
  href,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  checked?: boolean;
  onSelect?: () => void;
  href?: string;
}) {
  const { close } = useMenu();
  const body = (
    <>
      {checked !== undefined && <span className={s.menuCheck}>{checked ? <CheckGlyph /> : null}</span>}
      <span className={s.menuLabel}>{children}</span>
      {trailing !== undefined && <span className={s.menuTrailing}>{trailing}</span>}
    </>
  );
  if (href) {
    return (
      <a className={s.menuItem} role="menuitem" href={href} onClick={close}>
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={s.menuItem}
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      onClick={() => {
        onSelect?.();
        close();
      }}
    >
      {body}
    </button>
  );
}

// ---- Round marks ------------------------------------------------------------------------------------------------

export function CheckGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.6 6.4 5 8.7l4.5-5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The Mac's own "working" mark: eight spokes turning in steps. Rings are kept for shares of a whole. */
export function Spinner({ size = 13 }: { size?: number }) {
  return (
    <svg className={s.spinner} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <line key={i} x1="8" y1="1.5" x2="8" y2="5" transform={`rotate(${i * 45} 8 8)`} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" opacity={0.18 + 0.82 * (i / 7)} />
      ))}
    </svg>
  );
}

/** A share of something as an arc: the round replacement for a bar. */
export function Ring({ value, size, stroke, inner }: { value: number; size: number; stroke: number; inner?: number }) {
  const c = size / 2;
  const arc = (r: number, v: number) => {
    const len = 2 * Math.PI * r;
    return (
      <>
        <circle cx={c} cy={c} r={r} className={s.ringTrack} strokeWidth={stroke} fill="none" />
        <circle
          cx={c}
          cy={c}
          r={r}
          className={s.ringValue}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${len * v} ${len}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </>
    );
  };
  const r1 = c - stroke / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {arc(r1, value)}
      {inner !== undefined && arc(r1 - stroke - 1.5, inner)}
    </svg>
  );
}

// ---- Settings controls ------------------------------------------------------------------------------------------

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={s.switch} onClick={() => onChange(!on)}>
      <span className={s.knob} />
    </button>
  );
}

export function Segmented({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value, options]);
  return (
    <div ref={ref} className={s.segmented} role="radiogroup" aria-label={label}>
      {thumb && <span className={s.segThumb} style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} />}
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} className={s.segment} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** The current hash with another scene, so moving between scenes keeps the scheme and the knobs. */
export function sceneHref(scene: string): string {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?');
  const [exp = 'desktop'] = path.split('/');
  return `#/${exp}/${scene}${query ? `?${query}` : ''}`;
}

export function clock(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
