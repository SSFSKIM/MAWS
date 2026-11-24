// The named glyph (the word cut, "What the cut builds" and rule 4): a toolbar or row button whose word became an icon.
// The word stays its accessible name and its tooltip, with its shortcut after it (`Word · ⌘K`, the form IconButton's
// title has); the tooltip is a Tip, so the keyboard reaches it. The shortcut, and the reason of a greyed glyph, are its
// accessible description. A greyed glyph is `unavailable` with its reason, never `disabled`: it keeps the keyboard.
// Only for the glyphs rule 4 allows. The shortcut comes formatted (a renderer caller reads it with
// `useChordHint(action)`, app/IconButton.tsx), so the part reads no store and an editor bundle can draw it. A `detail`
// says what the press acts on now (the board a design's comment goes on, M5's G514): a line of the tooltip under the
// word, and part of the description, the name staying the word. A `tip` is the tooltip's words where a row the owner
// saw keeps a longer tooltip than the name (the deck's Add comment, G403), the shortcut still after it; its words are
// part of the description too, unless the name already says them ("Comments" on "Comments (3 open)").
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Tip, UNAVAILABLE_LOOK, unavailableClickProps, type TipSide } from './tip';

// The square icon button's look, which IconButton (app/IconButton.tsx) shares.
export const GLYPH_BUTTON =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent [-webkit-app-region:no-drag] hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent aria-pressed:bg-bg-active aria-pressed:text-fg';

export interface NamedGlyphProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'title' | 'disabled' | 'children'> {
  label: string; // the word: the accessible name and the tooltip
  shortcut?: string | null;
  unavailable?: string | null; // why it is greyed
  detail?: string | null; // what the press acts on now
  tip?: string; // the tooltip's words, when they are not the name's
  pressed?: boolean;
  side?: TipSide; // where the tooltip opens, when not above (Tip's rule)
  children: ReactNode; // the icon, aria-hidden
}

export function NamedGlyph({ label, shortcut, unavailable, detail, tip = label, pressed, side, className = GLYPH_BUTTON, children, ref, ...button }: NamedGlyphProps) {
  const named = shortcut ? `${tip} · ${shortcut}` : tip;
  const told = tip.toLowerCase() !== label.toLowerCase() && !label.toLowerCase().includes(tip.toLowerCase()) ? tip : null; // the name says the rest
  const description = [unavailable, told, detail, shortcut].filter((part) => part).join(' · ');
  return (
    <Tip
      content={
        unavailable || detail ? (
          <>
            <span className="block">{named}</span>
            {detail && <span className="block">{detail}</span>}
            {unavailable && <span className="block text-fg-muted">{unavailable}</span>}
          </>
        ) : (
          named
        )
      }
      description={description}
      side={side}
      {...unavailableClickProps(unavailable)}
    >
      <button ref={ref} type="button" aria-label={label} aria-pressed={pressed} className={`${className} ${UNAVAILABLE_LOOK}`} {...button}>
        {children}
      </button>
    </Tip>
  );
}
