// The work area's fold as motion (W8, T3). The divider's disclosure is no one element: the work area's rows are rows of
// the virtual list. So each mounted work-area row runs the shared disclosure motion on its own outer element (Row.tsx).
// A divider that opens marks its turn opening for one open motion, and the rows that mount in that window grow from
// nothing; one that closes marks its turn folding, its rows close to nothing, and the store folds the turn once the
// close has run, so no row leaves the list at a height it still had. A second click while a fold runs takes it back.
// Only the reader's own clicks move: a turn that folds by itself (it finished while followed) or opens for a jump
// changes at once, as Codex's does (its duration is 0 unless the reader toggled).
import { CLOSE_MOTION, OPEN_MOTION, prefersReducedMotion } from '../../ui/disclosure';
import { isPersistentRow } from '../model/derive';
import type { Row, TurnId } from '../model/rows';

// A row the divider folds away: its turn's rows but the divider, the receipt, time separators and the rows that stay in
// view when the turn folds (the divider's own aria-controls reads the same set off the list).
export const inWorkArea = (row: Row) => row.turnId !== null && row.kind !== 'divider' && row.kind !== 'receipt' && row.kind !== 'time' && !isPersistentRow(row);

export class WorkMotion {
  private folding = new Map<TurnId, ReturnType<typeof setTimeout>>();
  private opening = new Map<TurnId, number>(); // until, on performance.now()
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  isFolding = (turn: TurnId) => this.folding.has(turn);
  isOpening = (turn: TurnId) => (this.opening.get(turn) ?? -Infinity) > performance.now();

  // The divider's click. `fold` is the store's toggle of the turn.
  toggle(turn: TurnId, expanded: boolean, fold: () => void): void {
    const running = this.folding.get(turn);
    if (running !== undefined) {
      clearTimeout(running);
      this.folding.delete(turn);
      this.emit();
      return;
    }
    if (prefersReducedMotion()) return fold();
    if (expanded) {
      this.folding.set(
        turn,
        setTimeout(() => {
          this.folding.delete(turn);
          fold();
          this.emit();
        }, CLOSE_MOTION.ms),
      );
      this.emit();
      return;
    }
    this.opening.set(turn, performance.now() + OPEN_MOTION.ms);
    fold();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
