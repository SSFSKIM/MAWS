// The submit control (C7 execution document, "Submit control and queue"; UX wave U4a, l3-input-15): one round button
// whose glyph is the decision's (`glyphs.tsx`), its word kept as visually hidden text, so its accessible name and its
// text stay Send, Stop, Resume, Run, Save to memory or Starting… (decision 9 of the U4a document). The tooltip says what
// it does; the description says it when the word alone would not (a Send while a turn runs goes at the next step; `!`
// while busy runs now, inside the turn). W10: no caret menu and no Stop beside it. It sits beside the editor and outside
// the composer key sink, so it is ordinary pane content for C5's dispatcher.
import { GLYPHS } from './glyphs';
import type { SubmitDecision } from './submit-state';

export interface SubmitControlProps {
  decision: SubmitDecision;
  onPrimary(): void;
}

const SHAPE =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-accent focus-visible:outline-2 disabled:bg-bg-hover disabled:text-fg-faint';
// the owner's answers (2026-11-12): Send on the accent fill, Stop on the strong fill (the text's colour), the queue mark an
// accent outline
const TONE: Record<SubmitDecision['glyph'], string> = {
  arrow: 'bg-accent text-bg hover:opacity-90',
  square: 'bg-fg text-bg hover:opacity-90',
  queue: 'border border-accent text-accent hover:bg-bg-hover',
  play: 'bg-accent text-bg hover:opacity-90',
  spinner: 'bg-accent text-bg',
};

function tooltip(d: SubmitDecision): string {
  if (d.reason) return d.reason;
  switch (d.primary) {
    case 'stop':
      return 'Stop the running turn (⌘.)';
    case 'end':
      return d.detail ?? d.label; // P5 O16 M3b fix wave 1
    case 'resume':
      return 'Resume the paused queue';
    default: {
      const enter = `${d.detail ?? d.label} (Enter)`;
      return d.steer && d.queues ? `${enter} · ⌘Enter queues for later` : enter; // UX wave U4a: a steer, where ⌘Enter keeps it for after the turn
    }
  }
}

export function SubmitControl({ decision, onPrimary }: SubmitControlProps) {
  const Glyph = GLYPHS[decision.glyph];
  return (
    <button
      type="button"
      data-submit-state={decision.primary}
      data-glyph={decision.glyph}
      title={tooltip(decision)}
      aria-description={decision.detail ?? undefined}
      disabled={!decision.enabled}
      onClick={onPrimary}
      className={`${SHAPE} ${TONE[decision.glyph]}`}
    >
      <Glyph />
      <span className="sr-only">{decision.label}</span>
    </button>
  );
}
