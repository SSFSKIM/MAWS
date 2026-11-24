// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4; G518, G539): a board edit the model
// refuses, in a person's words. The model's own words (`BoardError`'s problems, `frameProblems`) name the board by its id
// and the key by its letter, for the agents and the loader that read them; the workbench words the refusal's structured
// fault (`BoardFault`, `FrameFault`), which the writers carry beside those words, so it never reads the refusal back from
// the design (M5 task 4's review: a copy's frame is checked under an id no design holds yet). A refusal no fault here
// words says what was asked and keeps the model's words as its reason (the toolbar notice's tooltip, as the deck's do).
import { CANVAS_LIMITS, type FrameFault } from '../canvas';
import { BoardError } from '../writers';
import { DESIGN_COPY } from './copy';

const R = DESIGN_COPY.refused;
const NUMBER = new Intl.NumberFormat('en-US');

/** What was asked of a board when the model refused it. */
export type BoardAct = 'add' | 'duplicate' | 'rename' | 'delete' | 'resize' | 'move';

const faultWords = (fault: FrameFault): string => {
  switch (fault.kind) {
    case 'not-number':
      return R.notNumber;
    case 'empty':
      return R.empty;
    case 'side':
      return R.side(NUMBER.format(CANVAS_LIMITS.side));
    case 'area':
      return R.area(NUMBER.format(CANVAS_LIMITS.area));
  }
};

/** A frame's faults in words, each limit once. */
export const frameRefusals = (faults: readonly FrameFault[]): string[] => [...new Set(faults.map(faultWords))];

/**
 * A refused board edit as the toolbar says it: `text`, and the model's words as `why` only where no fault here words the
 * refusal. A frame's limit is the text of an edit that asked for the frame; a copy, whose frame is its original's, says
 * it could not be made and why. An error that is no `BoardError` (the session stopped taking writes) keeps its message,
 * as before the cut.
 */
export function boardRefusal(error: unknown, act: BoardAct): { text: string; why: string | null } {
  if (!(error instanceof BoardError)) return { text: error instanceof Error ? error.message : String(error), why: null };
  const fault = error.fault;
  const move = act === 'move';
  switch (fault.kind) {
    case 'held':
      return { text: move ? R.moveHeld : R.held(act), why: null };
    case 'missing':
      return { text: move ? R.moveMissing : R.missing(act), why: null };
    case 'full':
      return { text: R.full(act, fault.limit), why: null };
    case 'gone':
      return { text: R.gone, why: null };
    case 'frame': {
      const limits = frameRefusals(fault.faults).join('; ');
      return { text: act === 'duplicate' ? R.copyLimit(limits) : limits, why: null };
    }
    case 'other':
      return { text: move ? R.moveOther : R.other(act), why: error.problems.join('; ') };
  }
}
