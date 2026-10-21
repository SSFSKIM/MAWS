// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D1, D6; §4.4 of the P4 spec, binding on the armed
// editor): the armed text box and what the stage's keys reach in it. ARMED is a selection of one text element whose
// editor is already mounted, focused and editable with its caret hidden, so the input method composes the first key in
// place (Chromium on macOS gives a focused non-editable element no input context, and tells AppKit about a newly focused
// editable only after 100 ms; spikes/p4-click-model/findings.txt).

/**
 * T10 and T11's one policy (Decision Logs 3 and 10): a printable key or an input method's first key on ARMED replaces the
 * text (PowerPoint's and Keynote's rule; the owner's choice after LC-2, Slides appending and Canva ignoring), or, under
 * `append`, goes in at the text's end. One constant, so the policy swaps without touching another transition.
 */
export const ARMED_TYPING: 'replace' | 'append' = 'replace';

/** The armed box's acts, which the stage's keys reach while it is armed. */
export interface ArmedBox {
  elementId: string;
  /** The editor's root, the focused element while armed. */
  root: HTMLElement;
  /** Whether the box is armed now (false once a key or a press turned it into an edit). */
  armed(): boolean;
  /**
   * T10 and T11 under ARMED_TYPING: `text` (a printable key's) typed over the content or after it, or, with no text (an
   * input method's keyCode-229 keydown), the content cleared or the caret put at its end before the composition starts;
   * then the edit begins on the mounted box, with no remount and no focus change.
   */
  replace(text?: string): void;
  /** T12: the edit begins with all the text selected. */
  editAll(): void;
  /** ⌘B, ⌘I or ⌘U on ARMED: the mark over the whole text, still armed. */
  markAll(mark: 'b' | 'i' | 'u'): void;
  /** The focus back on the box, its selection as it was (after a press the stage kept, on a handle or the frame). */
  focus(): void;
}

const boxes = new WeakMap<object, ArmedBox>();
/** The text box of `session` registers itself while mounted; the returned call unregisters it. */
export function registerArmed(session: object, box: ArmedBox): () => void {
  boxes.set(session, box);
  return () => {
    if (boxes.get(session) === box) boxes.delete(session);
  };
}
/** The armed box of `session`, if its text box is mounted and armed now. */
export function armedBox(session: object): ArmedBox | null {
  const box = boxes.get(session);
  return box && box.armed() && box.root.isConnected ? box : null;
}
