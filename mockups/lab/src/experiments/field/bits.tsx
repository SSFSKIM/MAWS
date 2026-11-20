import { useId, useState, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { SessionState } from '../../content/fixtures';

/** The one state mark. Shape carries the state before colour does: a turning arc, a haloed dot, a small dot, nothing. */
export function Mark({ state }: { state?: SessionState | 'done' }) {
  const kind = state === 'running' ? 'running' : state === 'approval' || state === 'question' || state === 'plan' ? 'needs' : state === 'unread' ? 'unread' : state === 'done' ? 'done' : 'idle';
  const label = { running: 'Running', needs: 'Needs you', unread: 'Unread', done: 'Done', idle: undefined }[kind];
  return (
    <span className="xf-mark" data-kind={kind} role={label ? 'img' : undefined} aria-label={label}>
      {kind === 'done' && <Check size={11} strokeWidth={2.6} />}
    </span>
  );
}

export function seconds(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** A block that opens by growing: the row height animates, the content never jumps. */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="xf-fold" data-open={open} inert={!open}>
      <div className="xf-fold-in">{children}</div>
    </div>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return <ChevronRight className="xf-chev" data-open={open} size={14} strokeWidth={2} aria-hidden="true" />;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="xf-switch" onClick={() => onChange(!on)}>
      <span className="xf-switch-thumb" />
    </button>
  );
}

export function Segmented({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  const name = useId();
  const index = Math.max(0, options.indexOf(value));
  return (
    <div className="xf-seg" role="radiogroup" aria-label={label} style={{ ['--n' as string]: options.length, ['--i' as string]: index }}>
      <span className="xf-seg-pill" aria-hidden="true" />
      {options.map((o) => (
        <label key={o} className="xf-seg-item" data-on={o === value}>
          <input type="radio" name={name} checked={o === value} onChange={() => onChange(o)} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  );
}

/** One chip for every list of on/off things (plugins, notification kinds). */
export function ToggleChip({ label, on: initial }: { label: string; on: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <button type="button" className="xf-chip" aria-pressed={on} onClick={() => setOn(!on)}>
      <span className="xf-chip-check" aria-hidden="true"><Check size={11} strokeWidth={2.8} /></span>
      {label}
    </button>
  );
}

/** A share of something, drawn as a filled slice of a small disc: round, and never mistaken for a spinner. */
export function Pie({ share, size = 16 }: { share: number; size?: number }) {
  const c = size / 2;
  const r = c - 1.25;
  const a = Math.min(0.999, Math.max(0.001, share)) * 2 * Math.PI;
  const x = c + r * Math.sin(a);
  const y = c - r * Math.cos(a);
  return (
    <svg className="xf-pie" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} className="xf-pie-disc" />
      <path d={`M${c} ${c}L${c} ${c - r}A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}Z`} className="xf-pie-slice" />
    </svg>
  );
}
