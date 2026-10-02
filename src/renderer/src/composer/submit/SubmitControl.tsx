// The submit control (C7 execution document, "Submit control and queue"): one button reading the decision's label
// (Send, Stop, Resume, Run, Save to memory, Starting…) with its reason, or what it does when the label alone would not
// say (a Send while a turn runs goes at the next step; `!` while busy runs now, inside the turn), as the tooltip and
// description. W10: no caret menu and no Stop beside it. It sits beside the editor and outside the composer key sink,
// so it is ordinary pane content for C5's dispatcher.
import type { SubmitDecision } from './submit-state';

export interface SubmitControlProps {
  decision: SubmitDecision;
  multiline: boolean; // Enter breaks lines once the document has more than one (§5.8), so the tooltip names ⌘Enter
  onPrimary(): void;
}

const PRIMARY =
  'inline-flex h-7 shrink-0 items-center rounded-lg px-3 text-ui font-medium outline-accent focus-visible:outline-2 disabled:bg-bg-hover disabled:text-fg-faint';
const TONE: Record<SubmitDecision['primary'], string> = {
  send: 'bg-accent text-bg hover:opacity-90',
  stop: 'bg-fg text-bg hover:opacity-90',
  resume: 'bg-accent text-bg hover:opacity-90',
};

function tooltip(d: SubmitDecision, multiline: boolean): string {
  if (d.reason) return d.reason;
  switch (d.primary) {
    case 'stop':
      return 'Stop the running turn (⌘.)';
    case 'resume':
      return 'Resume the paused queue';
    default:
      return `${d.detail ?? d.label} (${multiline ? '⌘Enter' : 'Enter'})`;
  }
}

export function SubmitControl({ decision, multiline, onPrimary }: SubmitControlProps) {
  return (
    <button
      type="button"
      data-submit-state={decision.primary}
      title={tooltip(decision, multiline)}
      aria-description={decision.detail ?? undefined}
      disabled={!decision.enabled}
      onClick={onPrimary}
      className={`${PRIMARY} ${TONE[decision.primary]}`}
    >
      {decision.label}
    </button>
  );
}
