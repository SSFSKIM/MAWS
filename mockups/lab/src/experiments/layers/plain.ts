// The plain ground: Open's ground, as a position of Layers' Painted form switch. No drawing on any page. The ground
// is one plain colour (with the paper's grain, which is a surface and not a drawing), and the only light and shade
// on it is what gathers where glass stands: under the pane, the side card, the composer, and, more faintly, under
// the tab capsule and the small controls. Open's method is kept (`open/field.ts`): each gathering is its surface's
// own shape, grown a little and blurred, so it ends a hand's width past the glass; and so are Open's shares of the
// pane's strength for the other surfaces.
//
// What gathers is the colouring's. Under Paper by day it is shade, not light: light glass on ivory is declared by
// the soft shadow it lays on the floor, as in the picture Paper was built from, and a pool lighter than the ground
// would take away the one thing the glass differs from. At night it is the lamp's light, laid around each piece's
// foot and kept out from under it. A warmer Paper names its own (`PaperLight.gather`), and that is where its warmth sits here.
//
// The pools are soft, so they are painted on a canvas a quarter of the window's size and scaled up: a gathering
// follows its surface frame by frame while a pane slides or the side card grows, and that has to cost nothing.
import { PAPER_DAY, PAPER_NIGHT, type PaperLight } from './paper';

/** A piece of glass the ground gathers under: its box in CSS px, its corner, its share of the pane's strength, its reach. */
export interface Gather {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  /** A share of the pane's strength (Open's `KEEP`). */
  keep: number;
  /** How far past the surface the pool is allowed to fall before the ground is plain again, in CSS px. */
  reach: number;
}

const DOWN = 4; // the pools' canvas is this many times smaller than the window
let small: HTMLCanvasElement | null = null;
let grainTile: HTMLCanvasElement | null = null;

function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const g = c.getContext('2d')!;
  const img = g.createImageData(192, 192);
  let seed = 20261114;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rnd();
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v < 0.5 ? 0 : 255;
    img.data[i + 3] = Math.round(255 * Math.abs(v - 0.5) * 2);
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

/** What gathers, and how strongly at full share and default strength. */
export function gatherOf(night: boolean, light?: PaperLight): { rgb: [number, number, number]; a: number } {
  const L = light ?? (night ? PAPER_NIGHT : PAPER_DAY);
  if (L.gather) return L.gather;
  return night ? { rgb: L.pool.rgb, a: L.pool.a } : { rgb: L.shadow, a: 0.26 };
}

/**
 * Paints the gatherings over a ground already filled. `k` is the field strength as a share of the default. The
 * strength is capped where the quietest text beside a control would begin to lose its floor (DESIGN.md §16).
 */
export function paintPlain(g: CanvasRenderingContext2D, w: number, h: number, night: boolean, k: number, shapes: Gather[], light?: PaperLight) {
  const L = light ?? (night ? PAPER_NIGHT : PAPER_DAY);
  const { rgb, a } = gatherOf(night, light);
  const depth = Math.min(1.6, k);
  const sw = Math.ceil(w / DOWN);
  const sh = Math.ceil(h / DOWN);
  if (!small) small = document.createElement('canvas');
  if (small.width !== sw || small.height !== sh) {
    small.width = sw;
    small.height = sh;
  }
  const s = small.getContext('2d')!;
  s.setTransform(1 / DOWN, 0, 0, 1 / DOWN, 0, 0);
  s.clearRect(0, 0, w, h);
  for (const shape of shapes) {
    if (shape.w < 8 || shape.h < 8 || shape.x > w || shape.y > h || shape.x + shape.w < 0 || shape.y + shape.h < 0) continue;
    const grow = shape.reach * 0.3;
    // Shade falls: by day the pool hangs a little below its surface. Light at night stays where the glass is.
    const drop = night ? 0 : shape.reach * 0.1;
    const alpha = Math.min(night ? 0.22 : 0.3, a * shape.keep * depth);
    s.filter = `blur(${((shape.reach * 0.42) / DOWN).toFixed(2)}px)`;
    // Deeper toward the foot, so a tall pane does not stand over one flat tone.
    const fall = s.createLinearGradient(0, shape.y, 0, shape.y + shape.h);
    fall.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(alpha * 0.6).toFixed(4)})`);
    fall.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(4)})`);
    s.fillStyle = fall;
    s.beginPath();
    s.roundRect(shape.x - grow, shape.y - grow + drop, shape.w + 2 * grow, shape.h + 2 * grow, Math.min(shape.r + grow, (shape.h + 2 * grow) / 2));
    s.fill();
  }
  // At night what gathers is light, and light under a body of dark glass lifts the floor to the glass's own level:
  // measured, a body then stood 0.01 to 0.03 from its ground where it stands 0.06 to 0.08 with no pool at all. So
  // at night the light is kept out from under the glass: it shows around each piece's foot, where the rim bends
  // it, and the body stands on the dark floor. By day the shade stays under the glass, where it is what the light
  // body differs from.
  if (night) {
    s.globalCompositeOperation = 'destination-out';
    s.fillStyle = 'rgba(0,0,0,0.82)';
    for (const shape of shapes) {
      if (shape.w < 8 || shape.h < 8) continue;
      s.filter = `blur(${((6 + shape.reach * 0.05) / DOWN).toFixed(2)}px)`;
      s.beginPath();
      s.roundRect(shape.x + 1, shape.y + 1, shape.w - 2, shape.h - 2, Math.max(0, shape.r - 1));
      s.fill();
    }
    s.globalCompositeOperation = 'source-over';
  }
  s.filter = 'none';
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, sw, sh, 0, 0, sw * DOWN, sh * DOWN);
  g.restore();
  // The paper's grain, as under the picture: the ground is still paper, and a lens needs something fine.
  g.save();
  g.globalAlpha = L.grain * (0.6 + 0.4 * Math.min(1, depth));
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = g.createPattern(grain(), 'repeat')!;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.restore();
}
