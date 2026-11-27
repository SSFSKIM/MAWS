// The bare count (the word cut, "What the cut builds"): the number after a heading ("Agents 2"), its meaning ("2
// running") its accessible name, so the heading reads "Agents 2 running", and its tooltip. It takes keyboard focus, as
// the owner of a tooltip must (rule 5). A count stays a number: rule 4 bars a glyph or a dot in its place. A count of
// a whole is the numbers as text (the Tasks panel's `3/7`, its meaning `3 of 7 completed`).
import { Tip, type TipSide } from './tip';

export function BareCount({ count, meaning, side, className = '' }: { count: number | string; meaning: string; side?: TipSide; className?: string }) {
  return (
    <Tip content={meaning} side={side}>
      <span role="img" aria-label={meaning} tabIndex={0} className={`rounded-sm font-normal text-fg-muted tabular-nums outline-accent focus-visible:outline-2 ${className}`}>
        {count}
      </span>
    </Tip>
  );
}
