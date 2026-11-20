import { CircleQuestionMark, Hand, ListChecks } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useGlassPress } from '@vitreajs/vitrea-react';
import type { SessionState } from '../../content/fixtures';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ---- Quiet's state vocabulary (quiet/glyphs.tsx), unchanged in meaning -----------------------------------------

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
      <span className="xo-glyph" role="img" aria-label={stateWord[state]} key={state}>
        <i className="xo-dot" data-run={state === 'running' ? '' : undefined} />
      </span>
    );
  }
  const Icon = state === 'approval' ? Hand : state === 'question' ? CircleQuestionMark : ListChecks;
  return (
    <span className="xo-glyph" data-kind="yours" role="img" aria-label={stateWord[state]} key={state}>
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}

/** A share of something, as an arc. Two of them nest (Quiet's). */
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
    <svg className="xo-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {inner === undefined ? arc(8.5, value, 3) : arc(9.75, value, 2.5)}
      {inner !== undefined && arc(4.75, inner, 2.5)}
    </svg>
  );
}

/** Height that opens and closes without knowing its size (Quiet's). Closed content is inert. */
export function Fold({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx('xo-fold', className)} data-open={open}>
      <div className="xo-fold-in" inert={!open}>
        {children}
      </div>
    </div>
  );
}

/**
 * A plain control that stands on glass (Instrument's `GBtn`). It is a fill, never glass of its own, and a press on
 * it presses the glass it stands on: light at the pointer and a little compression, from the runtime.
 */
export function GBtn({ label, tip, tipAt, children, className, ...rest }: { label: string; tip?: string; tipAt?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const press = useGlassPress();
  return (
    <button type="button" aria-label={label} data-tip={tip} data-tip-at={tipAt} className={cx('xo-gbtn', className)} {...press} {...rest}>
      {children}
    </button>
  );
}

export const clock = (sec: number) => (sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`);
export const split = (path: string) => {
  const i = path.lastIndexOf('/');
  return [path.slice(0, i + 1), path.slice(i + 1)] as const;
};

/** Move between the lab's scenes from inside the window, keeping the scheme and the knobs (Quiet's). */
export function go(scene: 'session' | 'settings' | 'home') {
  const h = window.location.hash;
  window.location.hash = /^#\/open\/[a-z]+/.test(h) ? h.replace(/^#\/open\/[a-z]+/, `#/open/${scene}`) : `#/open/${scene}`;
}
