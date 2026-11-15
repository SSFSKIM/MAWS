// UX wave U1b M4: happy-dom lays nothing out, so a prompt's guard (`request-card/prompt-guard.ts`) would find every card
// out of view. This lays each mounted permission card out in the window, one band each in document order, its row of
// decision buttons (`[data-decision-buttons]`) along the band's bottom and topmost at its points; every other element
// keeps happy-dom's own rectangle. `shift` moves every band (a scroll); the guard hears it at its next scroll event.
import { vi } from 'vitest';

const BAND = 120;
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-decision-buttons]')];
const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

export function layOutPrompts(): { shift(by: number): void; restore(): void } {
  let offset = 0;
  const cardAt = (band: number) => new DOMRect(10, offset + 20 + band * BAND, 620, BAND - 10);
  const buttonsAt = (band: number) => new DOMRect(20, offset + 90 + band * BAND, 600, 32);
  const original = Element.prototype.getBoundingClientRect; // eslint-disable-line @typescript-eslint/unbound-method
  const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const all = rows();
    const band = all.indexOf(this as HTMLElement);
    if (band >= 0) return buttonsAt(band);
    const card = this.hasAttribute('data-request-card') ? all.findIndex((row) => this.contains(row)) : -1;
    return card >= 0 ? cardAt(card) : original.call(this);
  });
  const own = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  document.elementFromPoint = (x: number, y: number) => rows().find((_, band) => inside(buttonsAt(band), x, y)) ?? document.body;
  return {
    shift: (by) => void (offset = by),
    restore: () => {
      spy.mockRestore();
      if (own) Object.defineProperty(document, 'elementFromPoint', own);
      else delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    },
  };
}
