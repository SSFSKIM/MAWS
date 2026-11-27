// The submit control (C7 execution document, "Submit control and queue"; UX wave U4a, l3-input-15): one round button
// whose glyph is the decision's (`glyphs.tsx`), its word kept as visually hidden text, so its accessible name and its
// text stay Send, Stop, Resume, Run, Save to memory or Starting… (decision 9 of the U4a document). The tooltip says what
// it does; the description says it when the word alone would not (a Send while a turn runs goes at the next step; `!`
// while busy runs now, inside the turn). W10: no caret menu and no Stop beside it. It sits beside the editor and outside
// the composer key sink, so it is ordinary pane content for C5's dispatcher.
import { Tip, unavailableClickProps } from '../../ui/tip';
import { GLYPHS } from './glyphs';
import type { SubmitDecision } from './submit-state';

export interface SubmitControlProps {
  decision: SubmitDecision;
  onPrimary(): void;
}

const SHAPE =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-accent focus-visible:outline-2 disabled:bg-bg-hover disabled:text-fg-faint aria-disabled:border-transparent aria-disabled:bg-bg-hover aria-disabled:text-fg-faint';
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
      return 'Stop the running turn · ⌘.';
    case 'end':
      return d.detail ?? d.label; // P5 O16 M3b fix wave 1
    case 'resume':
      return 'Resume the paused queue';
    default: {
      const enter = `${d.detail ?? d.label} · Enter`;
      return d.steer && d.queues ? `${enter} · ⌘Enter queues for later` : enter; // UX wave U4a: a steer, where ⌘Enter keeps it for after the turn
    }
  }
}

// Board ticket 815: the tooltip is a Tip, which keyboard focus opens, and the control's description (its key with it).
// Greyed with a reason, the control keeps Tab, its reason the tooltip, and its press does nothing; greyed with none (an
// empty editor) it is disabled.
export function SubmitControl({ decision, onPrimary }: SubmitControlProps) {
  const Glyph = GLYPHS[decision.glyph];
  const reason = decision.enabled ? null : decision.reason;
  const tip = tooltip(decision);
  return (
    <Tip content={tip} description={tip} {...unavailableClickProps(reason)}>
      <button
        type="button"
        data-submit-state={decision.primary}
        data-glyph={decision.glyph}
        aria-description={decision.detail ?? undefined}
        disabled={!decision.enabled && reason === null}
        onClick={onPrimary}
        className={`${SHAPE} ${TONE[decision.glyph]}`}
      >
        <Glyph />
        <span className="sr-only">{decision.label}</span>
      </button>
    </Tip>
  );
}
