// Lifted from the Quiet experiment (`../quiet/glyphs.tsx`): the state vocabulary of the sidebar, the tabs and the
// waiting capsule. Unchanged in meaning; the classes are this experiment's.
import { CircleQuestionMark, Hand, ListChecks } from 'lucide-react';
import type { SessionState } from '../../content/fixtures';

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

/** Grey and moving: the agent is busy. Solid ink: something new to read. Orange with a shape: it is your move. */
export function StateGlyph({ state, size = 15 }: { state: SessionState; size?: number }) {
  if (state === 'idle') return null;
  if (state === 'running' || state === 'unread') {
    return (
      <span className="xs-glyph" role="img" aria-label={stateWord[state]} key={state}>
        <i className="xs-dot" data-run={state === 'running' ? '' : undefined} />
      </span>
    );
  }
  const Icon = state === 'approval' ? Hand : state === 'question' ? CircleQuestionMark : ListChecks;
  return (
    <span className="xs-glyph" data-kind="yours" role="img" aria-label={stateWord[state]} key={state}>
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
    <svg className="xs-ring" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {inner === undefined ? arc(8.5, value, 3) : arc(9.75, value, 2.5)}
      {inner !== undefined && arc(4.75, inner, 2.5)}
    </svg>
  );
}
