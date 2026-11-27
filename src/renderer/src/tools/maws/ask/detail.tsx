// A failure's line in the Question sheet and the hover card's ask: its detail (main's words) is its tooltip and its
// description, and the line takes keyboard focus while it has one, so the keyboard reaches the detail too (board ticket
// 815; it was the system tooltip, which only the pointer opens).
import { Tip } from '../../../ui/tip';

export function DetailedLine({ words, detail }: { words: string; detail: string | null | undefined }) {
  return (
    <Tip content={detail} description={detail}>
      <span tabIndex={detail ? 0 : undefined} className="flex-1 rounded-sm outline-accent focus-visible:outline-2">
        {words}
      </span>
    </Tip>
  );
}
