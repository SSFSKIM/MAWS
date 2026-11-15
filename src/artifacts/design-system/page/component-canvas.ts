// The canvas a canon component is drawn on (UX wave U10b, M11; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md,
// §J and M11 decisions 2 and 3; l6-artifacts-15). A component used to sit on a 1920 × 1080 slide, about a fifth of its
// size in a card. It is now drawn on the smallest of three canvases of the slide's aspect that holds it, inset by a
// fifteenth of the canvas's width (64 px at 960), so a card shows it at up to twice that size. "Holds": the margin boxes
// of the frame body's children fit inside the canvas less the inset, with CANVAS_SPARE to spare in height (a scroll
// height does not see the inset). A sandboxed frame cannot be measured, so the canvas of each component of the three
// bundled systems is a table here, which the measuring scene of e2e/design-systems.spec.ts checks against the rule,
// outside the sandbox, and a component the table does not name (a system the person or an agent made, or a bundled
// component since changed) is drawn on the largest canvas, which most likely holds it (tracker row of 2026-11-15).

export const COMPONENT_CANVASES = [
  { width: 960, height: 540 },
  { width: 1120, height: 630 },
  { width: 1280, height: 720 },
] as const;
export type ComponentCanvas = (typeof COMPONENT_CANVASES)[number];
const [SMALL, MIDDLE, LARGE] = COMPONENT_CANVASES;

export const CANVAS_SPARE = 8; // px a component must leave free on the canvas it is given
export const insetOf = (canvas: { width: number }) => canvas.width / 15; // 64 px at 960

// The table, by bundled system (its directory under src/artifacts/types/design_system/defaults/) and component path.
// Derived from the drawn and measured page 6 of the document's "The look" (each component loaded alone at 960 × 540,
// its content's height against the canvas less twice the inset; Classroom's data table at all three), read with the
// rule above; the measuring scene corrects any entry the app's Chromium measures otherwise.
//   maws/status        96.6 of 412 px at 960                                                     960
//   maws/table          394 of 412 at 960: 18 to spare                                           960
//   maws/todo           292 of 412 at 960                                                        960
//   classroom/data-table 540 of 412 at 960, 482 of 480.7 at 1,120, 308 of 549.3 at 1,280         1,280
//   classroom/part-tab  241.8 of 412 at 960                                                      960
//   classroom/status    163.2 of 412 at 960                                                      960
//   classroom/tip       259.4 of 412 at 960                                                      960
//   official/action     183.6 of 412 at 960                                                      960
//   official/fact-table 430 of 412 at 960 (eight lines in four rows); at 1,120 its cells are wider, so it takes no
//                       more lines: at most 430 of 480.7                                         1,120
//   official/signature  404.9 at every width (no line wraps): 7.1 to spare at 960, short of 8;
//                       75.8 at 1,120                                                            1,120 (close to the rule's edge)
//   official/status     127.8 of 412 at 960                                                      960
export const BUNDLED_COMPONENT_CANVASES: Readonly<Record<string, Readonly<Record<string, ComponentCanvas>>>> = {
  maws: { 'components/status.html': SMALL, 'components/table.html': SMALL, 'components/todo.html': SMALL },
  classroom: { 'components/data-table.html': LARGE, 'components/part-tab.html': SMALL, 'components/status.html': SMALL, 'components/tip.html': SMALL },
  official: { 'components/action.html': SMALL, 'components/fact-table.html': MIDDLE, 'components/signature.html': MIDDLE, 'components/status.html': SMALL },
};

/** The canvas a bundled system's component is drawn on; a component the table does not name takes the largest. */
export function componentCanvas(systemId: string, componentPath: string): ComponentCanvas {
  const table = Object.hasOwn(BUNDLED_COMPONENT_CANVASES, systemId) ? BUNDLED_COMPONENT_CANVASES[systemId]! : {};
  return Object.hasOwn(table, componentPath) ? table[componentPath]! : LARGE;
}

/** The union of the margin boxes of a component frame's body's children, in the canvas's pixels. */
export interface ContentBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const SUBPIXEL = 0.5; // layout rounds a box's edge to a 64th of a pixel; a block the inset's width is inside it

/** Whether `canvas` holds a component whose content is `box`: inside the inset sideways, CANVAS_SPARE to spare in height. */
export function holds(canvas: ComponentCanvas, box: ContentBox): boolean {
  const inset = insetOf(canvas);
  const inside = box.left >= inset - SUBPIXEL && box.right <= canvas.width - inset + SUBPIXEL;
  return inside && box.bottom - box.top + CANVAS_SPARE <= canvas.height - 2 * inset;
}

/** The canvas the rule gives, from the component measured on each canvas in turn (in COMPONENT_CANVASES' order). */
export function smallestHolding(measured: readonly ContentBox[]): ComponentCanvas {
  return (
    COMPONENT_CANVASES.find((canvas, k) => {
      const box = measured[k];
      return box !== undefined && holds(canvas, box);
    }) ?? LARGE
  );
}

/** The component frame's own canvas: its size, its inset, the content centred on the system's ground and cut at the edge. */
export const componentFrameCss = (canvas: ComponentCanvas): string =>
  `body { width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden; box-sizing: border-box; padding: ${insetOf(canvas)}px; display: flex; flex-direction: column; justify-content: safe center; background: var(--ds-color-bg); }`;
