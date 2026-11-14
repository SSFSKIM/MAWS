// The light. Open has no field under the whole window: the ground is plain, and colour is light that gathers
// where glass stands (under the left pane, under the right pane, around the composer, a breath under the tabs)
// and fades to the ground where text is read. Each gathering is one canvas, painted once per size, scheme and
// strength, that travels with its surface. The painting itself is Field's (`field/paint.ts`): soft colour masses
// in five-stop falloffs, and 1 px contour lines that are the level sets of those same masses, so the glass has a
// broad frequency to tone it and a fine one for its rim to displace. What is new here is the feather: every
// gathering is cut by a blurred copy of its surface's own shape, so the light ends a hand's width past the glass.

export type Strength = 'whisper' | 'soft' | 'warm' | 'vivid';
export type GatherKind = 'left' | 'right' | 'composer' | 'tabs' | 'home';

// Field's gains, unchanged.
const GAIN: Record<Strength, number> = { whisper: 0.14, soft: 0.36, warm: 0.64, vivid: 1 };

/** How much of the field each surface keeps under it, as a share of the left pane's. DESIGN.md has the reasons. */
export const KEEP: Record<GatherKind, number> = { left: 1, right: 0.86, composer: 0.8, tabs: 0.36, home: 0.95 };

interface Mass {
  x: number; // centre, CSS px in the canvas
  y: number;
  r: number; // radius, CSS px
  rgb: [number, number, number];
  a: number; // alpha at the centre at full strength
}

type Rgb = [number, number, number];
// Field's dusk, light: amber, the theme orange, coral, plum; and its two quieter answers for the right edge.
const L: Record<string, Rgb> = { amber: [255, 181, 92], orange: [253, 120, 15], coral: [250, 116, 112], plum: [188, 118, 178], amber2: [255, 190, 120], rose: [236, 128, 150], glow: [255, 176, 110] };
// Field's embers, dark.
const D: Record<string, Rgb> = { amber: [253, 132, 30], orange: [240, 84, 20], coral: [206, 44, 84], plum: [128, 52, 138], amber2: [253, 120, 15], rose: [150, 46, 110], glow: [220, 70, 40] };

/** The surface a gathering belongs to, in the canvas's own CSS px. */
export interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/**
 * The masses of one gathering. The left pane keeps Field's own four, placed where they fell at the lab's capture
 * size (1440 wide), so the pane's colours are the ones the owner saw; the others are the same palette laid out for
 * their own surface.
 */
function massesFor(kind: GatherKind, dark: boolean, W: number, H: number, s: Shape): Mass[] {
  const c = dark ? D : L;
  const k = (light: number, darkA: number) => (dark ? darkA : light);
  const REF = 1440;
  switch (kind) {
    case 'left':
      return [
        { x: 0.03 * REF, y: -0.04 * H, r: 0.36 * REF, rgb: c.amber!, a: k(0.95, 0.62) },
        { x: 0.2 * REF, y: 0.3 * H, r: 0.22 * REF, rgb: c.orange!, a: k(0.5, 0.3) },
        { x: -0.02 * REF, y: 0.62 * H, r: 0.32 * REF, rgb: c.coral!, a: k(0.66, 0.5) },
        { x: 0.16 * REF, y: 1.06 * H, r: 0.34 * REF, rgb: c.plum!, a: k(0.5, 0.5) },
      ];
    case 'right':
      return [
        { x: s.x + s.w + 10, y: s.y - 50, r: 430, rgb: c.amber2!, a: k(0.78, 0.5) },
        { x: s.x + s.w * 0.1, y: s.y + s.h * 0.52, r: 260, rgb: c.orange!, a: k(0.2, 0.14) },
        { x: s.x + s.w * 0.8, y: s.y + s.h + 60, r: 400, rgb: c.rose!, a: k(0.62, 0.5) },
        { x: s.x - 40, y: s.y + s.h + 30, r: 300, rgb: c.plum!, a: k(0.3, 0.34) },
      ];
    case 'composer':
      return [
        { x: s.x + s.w * 0.08, y: s.y + s.h * 0.2, r: s.w * 0.5, rgb: c.amber!, a: k(0.85, 0.56) },
        { x: s.x + s.w * 0.46, y: s.y + s.h * 1.25, r: s.w * 0.34, rgb: c.orange!, a: k(0.4, 0.26) },
        { x: s.x + s.w * 0.84, y: s.y + s.h * 0.9, r: s.w * 0.46, rgb: c.coral!, a: k(0.64, 0.5) },
        { x: s.x + s.w * 1.04, y: s.y - 10, r: s.w * 0.36, rgb: c.plum!, a: k(0.44, 0.46) },
      ];
    case 'tabs':
      return [
        { x: s.x + s.w * 0.12, y: s.y + s.h * 0.2, r: s.w * 0.55, rgb: c.amber!, a: k(0.8, 0.5) },
        { x: s.x + s.w * 0.92, y: s.y + s.h * 0.9, r: s.w * 0.5, rgb: c.coral!, a: k(0.42, 0.4) },
      ];
    case 'home':
      return [
        { x: s.x + s.w * 0.1, y: s.y - 20, r: s.w * 0.56, rgb: c.amber!, a: k(0.95, 0.74) },
        { x: s.x + s.w * 0.5, y: s.y + s.h + k(70, 30), r: s.w * 0.42, rgb: c.orange!, a: k(0.5, 0.42) },
        { x: s.x + s.w * 0.9, y: s.y + s.h * 0.7, r: s.w * 0.52, rgb: c.coral!, a: k(0.66, 0.58) },
        { x: s.x + s.w * 1.02, y: s.y - 60, r: s.w * 0.4, rgb: c.plum!, a: k(0.5, 0.5) },
      ];
  }
  void W;
}

/** The scalar the contours are level sets of: the masses summed as soft bumps (Field's). */
function height(masses: Mass[], x: number, y: number): number {
  let v = 0;
  for (const m of masses) {
    const dx = (x - m.x) / m.r;
    const dy = (y - m.y) / m.r;
    v += m.a * Math.exp(-(dx * dx + dy * dy) * 2.2);
  }
  return v;
}

function contours(g: CanvasRenderingContext2D, masses: Mass[], w: number, h: number, stroke: string) {
  const cell = 6;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const f = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) f[j * cols + i] = height(masses, i * cell, j * cell);
  g.strokeStyle = stroke;
  g.lineWidth = 1;
  g.beginPath();
  const lerp = (a: number, b: number, t: number) => (t - a) / (b - a);
  for (let level = 0.06; level < 1.3; level += 0.062) {
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = f[j * cols + i]!, b = f[j * cols + i + 1]!, c = f[(j + 1) * cols + i + 1]!, d = f[(j + 1) * cols + i]!;
        const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const x = i * cell, y = j * cell;
        const top: [number, number] = [x + cell * lerp(a, b, level), y];
        const right: [number, number] = [x + cell, y + cell * lerp(b, c, level)];
        const bottom: [number, number] = [x + cell * lerp(d, c, level), y + cell];
        const left: [number, number] = [x, y + cell * lerp(a, d, level)];
        const seg = (p: [number, number], q: [number, number]) => { g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); };
        switch (code) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 10: seg(top, right); seg(left, bottom); break;
        }
      }
    }
  }
  g.stroke();
}

export interface Painted {
  /** A small copy of what was painted (straight alpha), for reading the level under a surface. */
  data: ImageData;
  /** CSS px per sample of `data`. */
  step: number;
}

/**
 * Paint one gathering into its canvas. `shape` is the surface it belongs to, in the canvas's own CSS px;
 * `reach` is how far past the surface the light is allowed to fall before it is the plain ground again.
 */
export function paintGather(canvas: HTMLCanvasElement, kind: GatherKind, dark: boolean, strength: Strength, shape: Shape, reach: number, floor?: { ground?: string; blank?: boolean }): Painted | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const gain = floor?.blank ? 0 : GAIN[strength] * KEEP[kind];
  const masses = massesFor(kind, dark, w, h, shape);
  // Field painted its masses on a base of its own, a shade under the sheet (a deeper warm grey in light, near
  // black in dark), and that base is half of how its pane looked: in dark it is what keeps the embers saturated
  // instead of greyed by the ground. So each gathering lays the same base under its light, inside its feather.
  if (!floor?.blank) {
    // Under glass that is made over this canvas as a texture the base is whole: a texel that is part transparent is
    // part black to the lens.
    const baseA = floor ? 1 : KEEP[kind] * Math.min(1, 0.45 + GAIN[strength]);
    g.fillStyle = dark ? `rgba(14,13,12,${baseA.toFixed(3)})` : `rgba(241,237,231,${baseA.toFixed(3)})`;
    g.fillRect(0, 0, w, h);
  }
  for (const m of masses) {
    const grad = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
    const [R, G, B] = m.rgb;
    // A smooth falloff in five stops; a two-stop radial gradient shows its edge as a ring (Field's).
    for (const [t, k] of [[0, 1], [0.25, 0.86], [0.5, 0.52], [0.75, 0.18], [1, 0]] as const) {
      grad.addColorStop(t, `rgba(${R},${G},${B},${(m.a * gain * k).toFixed(4)})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  const ink = dark ? 255 : 60;
  // The contours are for a lens to displace; the tab capsule is too small to show them as anything but rings.
  if (!floor?.blank && kind !== 'tabs') contours(g, masses, w, h, `rgba(${ink},${dark ? 235 : 30},${dark ? 215 : 0},${((dark ? 0.05 : 0.055) * (0.45 + 0.55 * GAIN[strength])).toFixed(4)})`);

  // The feather: keep the light where the surface is and let it die over `reach` beyond it.
  const mask = document.createElement('canvas');
  mask.width = canvas.width;
  mask.height = canvas.height;
  const mg = mask.getContext('2d')!;
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  mg.filter = `blur(${(reach * 0.42).toFixed(1)}px)`;
  mg.fillStyle = '#000';
  const grow = reach * 0.3;
  mg.beginPath();
  mg.roundRect(shape.x - grow, shape.y - grow, shape.w + grow * 2, shape.h + grow * 2, shape.r + grow);
  mg.fill();
  g.globalCompositeOperation = 'destination-in';
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(mask, 0, 0);
  // A gathering that is also a glass texture (a pane's) carries the ground under its light, because a texture's
  // transparent pixels are not the page showing through: the glass would read them as black.
  if (floor?.ground) {
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = floor.ground;
    g.fillRect(0, 0, canvas.width, canvas.height);
  }
  g.globalCompositeOperation = 'source-over';

  // A coarse copy to read levels from.
  const step = 8;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / step));
  small.height = Math.max(1, Math.round(h / step));
  const sg = small.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(canvas, 0, 0, small.width, small.height);
  return { data: sg.getImageData(0, 0, small.width, small.height), step };
}

// ---- Reading the level under a surface -------------------------------------------------------------------------

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const hexRgb = (hex: string): Rgb => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const luminanceOf = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** Every gathering on the page, so a surface can ask what the ground looks like under its own box. */
const layers = new Map<HTMLCanvasElement, Painted>();
export function register(canvas: HTMLCanvasElement, painted: Painted | null) {
  if (painted) layers.set(canvas, painted);
  else layers.delete(canvas);
}

/**
 * Mean relative luminance of the ground with its light, under a viewport box: the plain ground composited with
 * whichever gatherings reach it, blended on encoded values as CSS blends them. A gathering that has been put away
 * with its pane (`data-away`) counts for nothing.
 */
export function levelUnder(rect: { left: number; top: number; width: number; height: number }, ground: Rgb): number {
  const n = 6;
  let sum = 0;
  let count = 0;
  const live = [...layers].filter(([c]) => c.isConnected && c.dataset.away !== 'true').map(([c, p]) => ({ box: c.getBoundingClientRect(), p }));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n * 2; i++) {
      const x = rect.left + ((i + 0.5) / (n * 2)) * rect.width;
      const y = rect.top + ((j + 0.5) / n) * rect.height;
      let [r, g, b] = ground;
      for (const { box, p } of live) {
        const sx = Math.floor((x - box.left) / p.step);
        const sy = Math.floor((y - box.top) / p.step);
        if (sx < 0 || sy < 0 || sx >= p.data.width || sy >= p.data.height) continue;
        const o = (sy * p.data.width + sx) * 4;
        const a = p.data.data[o + 3]! / 255;
        r = r * (1 - a) + p.data.data[o]! * a;
        g = g * (1 - a) + p.data.data[o + 1]! * a;
        b = b * (1 - a) + p.data.data[o + 2]! * a;
      }
      sum += luminanceOf([r, g, b]);
      count++;
    }
  }
  return sum / count;
}
