// The toolbar's notice, shared by the deck and the design workbench (M5's "what the slide's limits refused, an upload in
// progress"). The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 3; G413): a refusal is said
// shortly ("These can’t be grouped"), and the model's own reason is the notice's tooltip and accessible description, on
// the notice itself, which then takes Tab (rule 5: a fact waits on an owner the keyboard reaches). A notice goes after
// six seconds, but not while it is pointed at or holds focus, so a reason being read is not taken away; the six seconds
// start again once the pointer and the focus have left it. Its node stays mounted, so the live region announces each.
import { useCallback, useEffect, useState } from 'react';
import { Tip } from '../../../renderer/src/ui/tip';

export const NOTICE_MS = 6_000;

/** What a part tells the toolbar: the words, and the model's own reason when the words are a short refusal. */
export type ShowNotice = (text: string, why?: string | null) => void;

export interface ToolbarNoticeState {
  text: string;
  why: string | null;
  serial: number;
  show: ShowNotice;
  clear(): void;
}

export function useToolbarNotice(): ToolbarNoticeState {
  const [shown, setShown] = useState<{ text: string; why: string | null; serial: number }>({ text: '', why: null, serial: 0 });
  const show = useCallback<ShowNotice>((text, why = null) => setShown((now) => ({ text, why: text && why ? why : null, serial: now.serial + 1 })), []);
  const clear = useCallback(() => setShown((now) => (now.text === '' ? now : { text: '', why: null, serial: now.serial + 1 })), []);
  return { ...shown, show, clear };
}

export function ToolbarNotice({ notice }: { notice: ToolbarNoticeState }) {
  const { text, why, serial, clear } = notice;
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = pointed || focused;
  useEffect(() => {
    if (!text || held) return;
    const timer = setTimeout(clear, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [text, serial, held, clear]);
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
