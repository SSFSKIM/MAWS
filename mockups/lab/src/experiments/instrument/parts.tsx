import { Check } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useGlassPress } from '@vitreajs/vitrea-react';
import type { SessionState } from '../../content/fixtures';
import s from './instrument.module.css';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/** Relative luminance of a `#rrggbb` colour, 0..1 (linear), which is what a backdrop hint declares. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** Relative luminance of `top` laid over `under` at `alpha`, blended the way CSS blends: on encoded values. */
export function luminanceOver(under: string, top: string, alpha: number): number {
  const u = parseInt(under.replace('#', ''), 16);
  const o = parseInt(top.replace('#', ''), 16);
  const ch = (shift: number) => Math.round(((u >> shift) & 255) * (1 - alpha) + ((o >> shift) & 255) * alpha);
  return luminance(`#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`);
}

/** A turn in flight: an open ring that turns. The only thing on screen that moves on its own. */
export function Spinner() {
  return (
    <svg className={s.spin} viewBox="0 0 12 12" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const needsLabel: Partial<Record<SessionState, string>> = {
  approval: 'Waiting for your approval',
  question: 'Asked you a question',
  plan: 'A plan waits for review',
};

/** The state of a session as a shape: a turning ring, an orange dot that means "needs you", a small ink dot, or nothing. */
export function StateMark({ state }: { state: SessionState }) {
  if (state === 'running')
    return (
      <span className={s.mark} role="img" aria-label="Running">
        <Spinner />
      </span>
    );
  if (state === 'approval' || state === 'question' || state === 'plan')
    return (
      <span className={cx(s.mark, s.markNeeds)} role="img" aria-label={needsLabel[state]}>
        <i />
      </span>
    );
  if (state === 'unread')
    return (
      <span className={cx(s.mark, s.markUnread)} role="img" aria-label="Unread">
        <i />
      </span>
    );
  return null;
}

export function DoneMark() {
  return (
    <span className={cx(s.mark, s.markDone)} role="img" aria-label="Done">
      <Check />
    </span>
  );
}

/** A round meter: the share of a budget in use. A fat ring, so it never reads as the thin turning one. */
export function Ring({ value, size = 14 }: { value: number; size?: number }) {
  const w = size * 0.2;
  const r = (size - w) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="currentColor" strokeOpacity="0.2" strokeWidth={w} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="currentColor"
        strokeWidth={w}
        strokeDasharray={`${c * value} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** A plain button that sits on glass. It is a fill, and a press on it presses the glass it sits on. */
export function GBtn({ label, children, className, ...rest }: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const press = useGlassPress();
  return (
    <button type="button" aria-label={label} title={label} className={cx(s.gbtn, className)} {...press} {...rest}>
      {children}
    </button>
  );
}

/** Height that opens and closes; the content is clipped, never scaled. */
export function Fold({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={s.fold} data-open={open}>
      <div className={s.foldInner} inert={!open}>
        {children}
      </div>
    </div>
  );
}
