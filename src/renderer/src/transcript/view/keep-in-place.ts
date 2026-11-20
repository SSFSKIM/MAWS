// A row that stays where it is on screen while rows above it open or close (board ticket 789: a turn's line ends its
// turn, so a click on it opens or folds the work above it, and the line must not move away from the pointer). For the
// given time after the click, each frame scrolls the list by however far the row has moved since the click, whatever
// moved it (the fold's motion, the list's measurements, its own anchoring); a row gone from the list ends it.

export function keepInPlace(row: () => HTMLElement | null, scroller: HTMLElement, ms: number, frame: (step: () => void) => unknown = requestAnimationFrame): void {
  const start = row();
  if (start === null) return;
  const top = start.getBoundingClientRect().top;
  const until = performance.now() + ms;
  const step = () => {
    const element = row();
    if (element === null) return;
    const moved = element.getBoundingClientRect().top - top;
    if (moved !== 0) scroller.scrollTop += moved;
    if (performance.now() < until) frame(step);
  };
  frame(step);
}
