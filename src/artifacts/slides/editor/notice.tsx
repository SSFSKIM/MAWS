// The toolbar's notice, shared by the deck and the design workbench (M5's "what the slide's limits refused, an upload in
// progress"). The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3; G413): a refusal is said
// shortly ("These can’t be grouped"), and the model's own reason is the notice's tooltip and accessible description, on
// the notice itself, which then takes Tab (rule 5: a fact waits on an owner the keyboard reaches). A notice goes after
// six seconds, but not while it is pointed at or holds focus, so a reason being read is not taken away; the six seconds
// start again once the pointer and the focus have left it. A status ("Uploading…") lasts as long as its operation, and
// its end clears that status only, never a refusal said after it. The expiry lives with the notice, not with its view:
// a view that goes (a version previewed) neither stops the clock nor brings an old refusal back. Its node stays mounted
// while shown, so the live region announces each.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Tip } from '../../../renderer/src/ui/tip';

export const NOTICE_MS = 6_000;

/** What a part tells the toolbar: the words, and the model's own reason when the words are a short refusal. */
export type ShowNotice = (text: string, why?: string | null) => void;
/** Shows a status for as long as an operation runs; the answer ends it, clearing it only if it is still the one shown. */
export type StartStatus = (text: string) => () => void;

interface Shown {
  text: string;
  why: string | null;
  serial: number;
  /** A status, which lasts until its operation ends it. */
  lasting: boolean;
}

export interface ToolbarNoticeState {
  text: string;
  why: string | null;
  serial: number;
  show: ShowNotice;
  begin: StartStatus;
  clear(): void;
  /** The view says the notice is pointed at or focused, so it waits. */
  hold(on: boolean): void;
}

export function useToolbarNotice(): ToolbarNoticeState {
  const serials = useRef(0);
  const [shown, setShown] = useState<Shown>({ text: '', why: null, serial: 0, lasting: false });
  const [held, setHeld] = useState(false);
  const show = useCallback<ShowNotice>((text, why = null) => {
    const serial = ++serials.current;
    setShown({ text, why: text && why ? why : null, serial, lasting: false });
  }, []);
  const clearIf = useCallback((when: (now: Shown) => boolean) => {
    const serial = ++serials.current;
    setShown((now) => (now.text !== '' && when(now) ? { text: '', why: null, serial, lasting: false } : now));
  }, []);
  const clear = useCallback(() => clearIf(() => true), [clearIf]);
  const begin = useCallback<StartStatus>(
    (text) => {
      const serial = ++serials.current;
      setShown({ text, why: null, serial, lasting: true });
      return () => clearIf((now) => now.serial === serial);
    },
    [clearIf],
  );
  const { text, why, serial, lasting } = shown;
  useEffect(() => {
    if (!text || lasting || held) return;
    const timer = setTimeout(() => clearIf((now) => now.serial === serial), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [text, serial, lasting, held, clearIf]);
  return { text, why, serial, show, begin, clear, hold: setHeld };
}

export function ToolbarNotice({ notice }: { notice: ToolbarNoticeState }) {
  const { text, why, hold } = notice;
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = pointed || focused;
  useEffect(() => {
    hold(held);
  }, [held, hold]);
  useEffect(() => () => hold(false), [hold]); // a view that goes holds nothing
  return (
    <Tip content={why} description={why}>
      <span
        role="status"
        className="deck-notice"
        data-deck-notice
        tabIndex={why || focused ? 0 : undefined /* kept while focused, so a notice without a reason never drops the focus */}
        onPointerEnter={() => setPointed(true)}
        onPointerLeave={() => setPointed(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {text}
      </span>
    </Tip>
  );
}
