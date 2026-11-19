import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

// ---- The mark ---------------------------------------------------------------------------------------------------
// One primitive carries every state in the app: a circle on a 16 px field. Hollow is not yet, turning is working,
// solid is done, a small solid dot is unseen, and the one coloured dot is "your turn".

export type MarkKind = 'none' | 'ring' | 'run' | 'dot' | 'turn' | 'done' | 'level';

const R = 5.25;
const C = 2 * Math.PI * R;

export function Mark({ kind, value = 0, label }: { kind: MarkKind; value?: number; label?: string }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <svg className="mark" data-kind={kind} viewBox="0 0 16 16" width="16" height="16" {...a11y}>
      {kind === 'ring' && <circle cx="8" cy="8" r={R} className="m-ring" />}
      {kind === 'run' && (
        <>
          <circle cx="8" cy="8" r={R} className="m-track" />
          <circle cx="8" cy="8" r={R} className="m-arc m-spin" strokeDasharray={`${C / 4} ${C}`} />
        </>
      )}
      {kind === 'dot' && <circle cx="8" cy="8" r="3" className="m-ink" />}
      {kind === 'turn' && <circle cx="8" cy="8" r="4" className="m-turn" />}
      {kind === 'done' && (
        <>
          <circle cx="8" cy="8" r="6" className="m-done" />
          <path d="M5.5 8.25 7.25 10 10.5 6.25" className="m-tick" />
        </>
      )}
      {kind === 'level' && <Level c={8} r={5} value={value} />}
    </svg>
  );
}

/** A quantity is a ring that fills from the top: hollow is none of it, closed is all of it. */
function Level({ c, r, value }: { c: number; r: number; value: number }) {
  const len = 2 * Math.PI * r;
  return (
    <>
      <circle cx={c} cy={c} r={r} className="m-track m-level" />
      <circle cx={c} cy={c} r={r} className="m-arc m-level" strokeDasharray={`${len * Math.min(1, Math.max(0, value))} ${len}`} transform={`rotate(-90 ${c} ${c})`} />
    </>
  );
}

/** Two quantities on one dial: the outer ring is the longer window (the week), the inner ring the shorter (five hours). */
export function Dial({ inner, outer }: { inner: number; outer: number }) {
  return (
    <svg className="mark" viewBox="0 0 20 20" width="20" height="20" aria-hidden>
      <Level c={10} r={8.5} value={outer} />
      <Level c={10} r={4.5} value={inner} />
    </svg>
  );
}

/** The window's own controls, drawn so the clearance at the top left is honest. Platform chrome, not a design colour. */
export function Lights() {
  return (
    <div className="lights" aria-hidden>
      <i style={{ background: '#ff5f57' }} />
      <i style={{ background: '#febc2e' }} />
      <i style={{ background: '#28c840' }} />
    </div>
  );
}

// ---- Dismissal --------------------------------------------------------------------------------------------------

export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

// ---- Controls ---------------------------------------------------------------------------------------------------

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)} />;
}

export function Segmented({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  const i = Math.max(0, options.indexOf(value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ ['--n' as string]: options.length, ['--i' as string]: i }}>
      <span className="thumb" />
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={o === value} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

/** One member of a set, on or off: the same circle as every other state. Solid with a tick is on, hollow is off. */
export function Member({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} className="member" onClick={() => onChange(!on)}>
      <Mark kind={on ? 'done' : 'ring'} />
      {children}
    </button>
  );
}

export function Select({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div className="anchor" ref={ref}>
      <button type="button" className="btn ring select" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
        {value}
        <ChevronDown size={14} strokeWidth={1.5} />
      </button>
      <div className="pop menu below" role="listbox" data-open={open}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="option"
            aria-selected={o === value}
            className="item"
            onClick={() => {
              onChange(o);
              setOpen(false);
            }}
          >
            <span className="grow">{o}</span>
            {o === value && <Check size={14} strokeWidth={1.75} />}
          </button>
        ))}
      </div>
    </div>
  );
}
