// A row that stays where it is on screen while rows above it open or close (board ticket 789: a turn's line ends its
// turn, so a click on it opens or folds the work above it, and the line must not move away from the pointer). For the
// given time after the click, each frame scrolls the list by however far the row has moved since the click, whatever
// moved it (the fold's motion, the list's measurements, its own anchoring). While the row is not mounted (the work that
// opened pushed it out of the list's window), the list's own offset for the row places it, and the next frame, with the
// row mounted again, refines that. A reader's own scroll input ends it: from then on the place is theirs.

export interface Anchored {
  element: () => HTMLElement | null; // the row's element, while the list mounts it
  start?: () => number | null; // the row's offset in the list's content, read where no element is mounted
  scrollTo?: (offset: number) => void; // how the list scrolls; the scroller's scrollTop by default
  frame?: (step: () => void) => unknown;
}

export function keepInPlace(scroller: HTMLElement, ms: number, { element, start = () => null, scrollTo = (offset) => { scroller.scrollTop = offset; }, frame = (step) => requestAnimationFrame(step) }: Anchored): void {
  const offsetOf = (row: HTMLElement) => row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const mounted = element();
  const first = start();
  let rendered = mounted === null ? null : offsetOf(mounted); // the row's place on screen, as the reader saw it
  const placed = first === null ? null : first - scroller.scrollTop; // the same place, in the list's offsets
  if (rendered === null && placed === null) return;
  const until = performance.now() + ms;
  let done = false;
  // a press on the scroller itself is on its scrollbar; one on a row is not the reader scrolling
  const press = (event: Event) => { if (event.target === scroller) stop(); };
  function stop() {
    done = true;
    scroller.removeEventListener('wheel', stop, true);
    scroller.removeEventListener('touchstart', stop, true);
    scroller.removeEventListener('pointerdown', press, true);
    window.removeEventListener('keydown', stop, true);
  }
  scroller.addEventListener('wheel', stop, { capture: true, passive: true });
  scroller.addEventListener('touchstart', stop, { capture: true, passive: true });
  scroller.addEventListener('pointerdown', press, true);
  window.addEventListener('keydown', stop, true);
  const step = () => {
    if (done) return;
    const row = element();
    if (row !== null && rendered !== null) {
      const moved = offsetOf(row) - rendered;
      if (moved !== 0) scrollTo(scroller.scrollTop + moved);
    } else if (row !== null) {
      rendered = offsetOf(row); // mounted again after the list placed it: kept from here
    } else {
      const at = placed === null ? null : start();
      if (at === null || placed === null) return stop(); // gone from the list
      if (at - placed !== scroller.scrollTop) scrollTo(at - placed);
    }
    if (performance.now() < until) frame(step);
    else stop();
  };
  frame(step);
}
