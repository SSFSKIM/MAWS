// Whether a page's actions are drawn whole, for a spec that photographs a seeded surface (the Org page, the Channel tab,
// the Share sheet).
// Both functions run in the page (`locator.evaluate(fn, entry)`), so each is self-contained: nothing outside its own
// body is in scope there.

/** The element an action must lie inside: its closest `selector`, named `name` in an offender's line; `probe` is the
 *  attribute markup that makes a probe one. */
export type ActionEntry = { selector: string; name: string; probe: string };

// Every action under `root` that is not drawn whole: each control a person can operate (a button, a field, a native
// select, a radio or checkbox, a link, anything playing one of their roles), save a form's mirror input (Radix's bubble
// input beside a radio or checkbox): hidden from assistive technology (`aria-hidden`), out of the tab order, taking no
// pointer and drawn transparent, so no one sees, reaches or clicks it. `aria-hidden` alone exempts nothing, since it
// neither hides a control from sight nor stops it working. Each is scrolled into view first (a scrolling body is no
// fault), then its four edges must lie inside its entry (else `root`), inside every ancestor that clips (an overflow
// other than visible), and inside the window. Each offender as `"<name>" <box> outside <what> <box>`, its name its label,
// else its text.
export function actionsNotWhole(root: Element, entry: ActionEntry): string[] {
  const CONTROLS = [
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'a[href]',
    '[contenteditable="true"]',
    ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'combobox', 'slider', 'textbox'].map((role) => `[role="${role}"]`),
  ].join(', ');
  type Box = { left: number; top: number; right: number; bottom: number };
  const inside = (a: Box, b: Box, slack: number) => a.left >= b.left - slack && a.top >= b.top - slack && a.right <= b.right + slack && a.bottom <= b.bottom + slack;
  const shown = (b: Box) => `${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}`;
  const mirror = (control: Element) => {
    const style = getComputedStyle(control);
    return control.closest('[aria-hidden="true"]') !== null && (control as HTMLElement).tabIndex < 0 && style.pointerEvents === 'none' && Number(style.opacity) === 0;
  };
  const controls = Array.from(root.querySelectorAll(CONTROLS)).filter((control) => !mirror(control));
  return controls.flatMap((control) => {
    // centred where its scroller can, so a whole-pixel scroll offset never leaves it a sliver past the scrollport's edge
    control.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const box = control.getBoundingClientRect();
    const label = control.getAttribute('aria-label') || control.textContent || control.tagName.toLowerCase();
    const name = `"${label.trim().slice(0, 60)}" ${shown(box)}`;
    if (box.width === 0 || box.height === 0 || getComputedStyle(control).visibility !== 'visible') return [`${name} not drawn`];
    // each bound with its slack: half a pixel for a box read as drawn; a whole one for a clipping part's, whose client
    // size is rounded to the pixel while the scrollport it measures may end mid-pixel (a body's 52vh)
    const bounds: Array<[string, Box, number]> = [
      [entry.name, (control.closest(entry.selector) ?? root).getBoundingClientRect(), 0.5],
      ['the window', { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }, 0.5],
    ];
    for (let el = control.parentElement; el !== null; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const r = el.getBoundingClientRect();
      const left = r.left + el.clientLeft;
      const top = r.top + el.clientTop;
      bounds.push([`clipping ${el.tagName.toLowerCase()}`, { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }, 1]);
    }
    return bounds.filter(([, b, slack]) => !inside(box, b, slack)).map(([what, b]) => `${name} outside ${what} ${shown(b)}`);
  });
}

// Actions clipped on purpose, appended to `root` as entries (each marked `data-probe`, removed after): a button clipped
// across ("wide probe") and one down ("tall probe"), a native select clipped across ("select probe"), and a button
// clipped across under `aria-hidden`, still drawn and still working ("hidden probe"): `actionsNotWhole` must name each
// of CLIPPED_PROBES, or it proves nothing about the surface. Beside them a form's mirror input clipped the same way
// ("mirror probe", MIRROR_PROBE), which it must not name: no one sees, reaches or clicks it.
export function addClippedProbes(root: Element, entry: ActionEntry): void {
  root.insertAdjacentHTML(
    'beforeend',
    `<div data-probe ${entry.probe} style="overflow:hidden;width:40px"><button type="button" style="width:120px">wide probe</button></div>` +
      `<div data-probe ${entry.probe} style="overflow:hidden;height:8px"><button type="button" style="height:24px">tall probe</button></div>` +
      `<div data-probe ${entry.probe} style="overflow:hidden;width:40px"><select aria-label="select probe" style="width:120px"><option>select probe</option></select></div>` +
      `<div data-probe ${entry.probe} aria-hidden="true" style="overflow:hidden;width:40px"><button type="button" style="width:120px">hidden probe</button></div>` +
      `<div data-probe ${entry.probe} style="position:relative;overflow:hidden;width:40px;height:24px"><input type="checkbox" aria-label="mirror probe" aria-hidden="true" tabindex="-1" style="position:absolute;pointer-events:none;opacity:0;margin:0;width:120px;height:24px"></div>`,
  );
}

/** The probes `actionsNotWhole` must name, as its lines begin. */
export const CLIPPED_PROBES = ['"wide probe"', '"tall probe"', '"select probe"', '"hidden probe"'] as const;
/** The mirror probe, which it must not. */
export const MIRROR_PROBE = '"mirror probe"';

/** What is wrong with `actionsNotWhole`'s lines over the probes: each clipped probe it doesn't name, and the mirror if it does. */
export function probeFaults(lines: readonly string[]): string[] {
  const named = (probe: string) => lines.some((line) => line.startsWith(probe));
  return [...CLIPPED_PROBES.filter((probe) => !named(probe)).map((probe) => `${probe} not named`), ...(named(MIRROR_PROBE) ? [`${MIRROR_PROBE} named`] : [])];
}
