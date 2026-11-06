// Whether a page's actions are drawn whole, for a spec that photographs a seeded surface (the Org page, the Channel tab).
// Both functions run in the page (`locator.evaluate(fn, entry)`), so each is self-contained: nothing outside its own
// body is in scope there.

/** The element an action must lie inside: its closest `selector`, named `name` in an offender's line; `probe` is the
 *  attribute markup that makes a probe one. */
export type ActionEntry = { selector: string; name: string; probe: string };

// Every action under `root` that is not drawn whole: each is scrolled into view first (a scrolling body is no fault),
// then its four edges must lie inside its entry (else `root`), inside every ancestor that clips (an overflow other than
// visible), and inside the window. Each offender as `"<text>" <box> outside <what> <box>`.
export function actionsNotWhole(root: Element, entry: ActionEntry): string[] {
  type Box = { left: number; top: number; right: number; bottom: number };
  const inside = (a: Box, b: Box) => a.left >= b.left - 0.5 && a.top >= b.top - 0.5 && a.right <= b.right + 0.5 && a.bottom <= b.bottom + 0.5;
  const shown = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}`;
  return Array.from(root.querySelectorAll('button')).flatMap((button) => {
    button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const box = button.getBoundingClientRect();
    const name = `"${(button.textContent ?? '').trim().slice(0, 60)}" ${shown(box)}`;
    if (box.width === 0 || box.height === 0 || getComputedStyle(button).visibility !== 'visible') return [`${name} not drawn`];
    const bounds: Array<[string, Box]> = [
      [entry.name, (button.closest(entry.selector) ?? root).getBoundingClientRect()],
      ['the window', { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }],
    ];
    for (let el = button.parentElement; el !== null; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const r = el.getBoundingClientRect();
      const left = r.left + el.clientLeft;
      const top = r.top + el.clientTop;
      bounds.push([`clipping ${el.tagName.toLowerCase()}`, { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }]);
    }
    return bounds.filter(([, b]) => !inside(box, b)).map(([what, b]) => `${name} outside ${what} ${shown(b)}`);
  });
}

// Two actions clipped on purpose, one across and one down, appended to `root` as entries (each marked `data-probe`,
// removed after): `actionsNotWhole` must name both, or it proves nothing about the surface.
export function addClippedProbes(root: Element, entry: ActionEntry): void {
  root.insertAdjacentHTML(
    'beforeend',
    `<div data-probe ${entry.probe} style="overflow:hidden;width:40px"><button type="button" style="width:120px">wide probe</button></div>` +
      `<div data-probe ${entry.probe} style="overflow:hidden;height:8px"><button type="button" style="height:24px">tall probe</button></div>`,
  );
}
