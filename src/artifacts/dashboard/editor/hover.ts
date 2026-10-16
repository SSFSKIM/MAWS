// The host's hover around a figure (P3-E2 M3; parent §2 "Views": hover adds event handlers around the output, never a
// script inside it). A discrete mark carries its value in `data-tip` and is its own hit target; the points of a line,
// an area or a scatter sit in the figure's one `data-hover="nearest"` layer, searched here for the point nearest the
// pointer (within a reach of 32 figure units), so every point has a value, the last of thousands included. The tip is
// text (`textContent`: labels are the data's), shown beside the pointer and hidden when it leaves; the same values are
// in the source sheet for the keyboard and a screen reader.
const REACH = 32;

interface Layer {
  xy: Float64Array;
  tips: string[];
}

function layerOf(svg: SVGSVGElement): Layer | null {
  const g = svg.querySelector('[data-hover="nearest"]');
  if (!g) return null;
  const pairs = (g.getAttribute('data-xy') ?? '').split(' ');
  const xy = new Float64Array(pairs.length * 2);
  pairs.forEach((pair, i) => {
    const [x, y] = pair.split(',');
    xy[i * 2] = Number(x);
    xy[i * 2 + 1] = Number(y);
  });
  return { xy, tips: (g.getAttribute('data-tips') ?? '').split('\n') };
}

/** Hover over the figure in `frame`, its tip drawn in `tip`; answers its removal. */
export function attachHover(frame: HTMLElement, tip: HTMLElement): () => void {
  let layer: Layer | null | undefined; // read on first use after each drawing
  let drawn: SVGSVGElement | null = null;
  const hide = () => {
    tip.hidden = true;
  };
  const show = (text: string, event: PointerEvent) => {
    const box = frame.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${Math.max(0, event.clientX - box.left + 12)}px`;
    tip.style.top = `${Math.max(0, event.clientY - box.top + 12)}px`;
  };
  const move = (event: PointerEvent) => {
    const target = event.target as Element | null;
    const svg = frame.querySelector('svg');
    if (!svg || !target) return hide();
    const mark = target.closest('[data-tip]');
    if (mark && svg.contains(mark)) return show(mark.getAttribute('data-tip') ?? '', event);
    if (svg !== drawn) {
      drawn = svg;
      layer = undefined;
    }
    if (layer === undefined) layer = layerOf(svg);
    if (!layer || layer.tips.length === 0) return hide();
    // the pointer in the figure's own units (the figure scales to its column)
    const box = svg.getBoundingClientRect();
    const scale = box.width > 0 ? Number(svg.getAttribute('width')) / box.width : 1;
    const x = (event.clientX - box.left) * scale;
    const y = (event.clientY - box.top) * scale;
    let best = -1;
    let bestD = REACH * REACH;
    for (let i = 0; i < layer.tips.length; i += 1) {
      const dx = layer.xy[i * 2] - x;
      const dy = layer.xy[i * 2 + 1] - y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return hide();
    show(layer.tips[best], event);
  };
  frame.addEventListener('pointermove', move);
  frame.addEventListener('pointerleave', hide);
  // a figure the pointer left through its own element (the SVG's pointerleave does not bubble)
  const leave = (event: Event) => {
    if (event.target instanceof SVGSVGElement) hide();
  };
  frame.addEventListener('pointerleave', leave, true);
  return () => {
    frame.removeEventListener('pointermove', move);
    frame.removeEventListener('pointerleave', hide);
    frame.removeEventListener('pointerleave', leave, true);
  };
}
