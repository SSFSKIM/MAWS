// The colour field, lifted from the Field experiment (`../field/paint.ts`): one painting handed to the glass as its
// backdrop texture, with broad warm masses to tone the panes and fine contour lines (the level sets of the same
// masses) for the rims to displace. Two things changed for this synthesis. The right edge is no longer a frame
// around a sheet but the ground of a second pane, so it has masses of its own. And one mass is not fixed: the
// field gathers its colour where the composer stands, so that mass takes a position and a weight from the layout
// and is repainted while the composer travels between scenes. Nothing in the field carries state.

export type Strength = 'whisper' | 'soft' | 'warm' | 'vivid';

const GAIN: Record<Strength, number> = { whisper: 0.14, soft: 0.36, warm: 0.64, vivid: 1 };

interface Mass {
  x: number; // centre, as a share of the width
  y: number; // centre, as a share of the height
  r: number; // radius, as a share of the longer side
  rgb: [number, number, number];
  a: number; // alpha at the centre at full strength
  sx?: number; // horizontal stretch: a mass wider than it is tall
}

/** Where the field gathers: a point in shares of the window, and a weight from 0 (no composer) to 1. */
export interface Gather {
  x: number;
  y: number;
  k: number;
}

// Light: Field's dusk down the left pane (amber, the theme orange, coral, plum); a quieter answer down the right
// pane (amber, rose, a little plum), so the left stays the stronger of the two.
const LIGHT: Mass[] = [
  { x: 0.03, y: -0.04, r: 0.36, rgb: [255, 181, 92], a: 0.95 },
  { x: 0.2, y: 0.3, r: 0.22, rgb: [253, 120, 15], a: 0.5 },
  { x: -0.02, y: 0.62, r: 0.32, rgb: [250, 116, 112], a: 0.66 },
  { x: 0.16, y: 1.06, r: 0.34, rgb: [188, 118, 178], a: 0.5 },
  { x: 1.02, y: -0.06, r: 0.36, rgb: [255, 190, 120], a: 0.66 },
  { x: 1.04, y: 0.46, r: 0.24, rgb: [248, 138, 122], a: 0.4 },
  { x: 0.96, y: 1.08, r: 0.34, rgb: [214, 124, 168], a: 0.46 },
  // The band the tab capsule stands on: a low amber sky from pane to pane, so the capsule has colour to stand over.
  { x: 0.5, y: -0.1, r: 0.115, sx: 5, rgb: [255, 178, 96], a: 0.72 },
];

// Dark: the same journey as embers, kept deep so the drawn bodies stay under the level where neither ink carries text.
const DARK: Mass[] = [
  { x: 0.03, y: -0.04, r: 0.34, rgb: [253, 132, 30], a: 0.62 },
  { x: 0.2, y: 0.3, r: 0.2, rgb: [240, 84, 20], a: 0.3 },
  { x: -0.02, y: 0.62, r: 0.3, rgb: [206, 44, 84], a: 0.5 },
  { x: 0.16, y: 1.06, r: 0.34, rgb: [128, 52, 138], a: 0.5 },
  { x: 1.02, y: -0.06, r: 0.34, rgb: [253, 120, 15], a: 0.4 },
  { x: 1.04, y: 0.46, r: 0.22, rgb: [214, 60, 60], a: 0.26 },
  { x: 0.96, y: 1.08, r: 0.32, rgb: [150, 46, 110], a: 0.4 },
  { x: 0.5, y: -0.1, r: 0.115, sx: 5, rgb: [244, 112, 22], a: 0.36 },
];

// The gathered colour: two masses on one centre, a wide amber and a tighter core of the theme orange.
const POOL: Record<'light' | 'dark', { r: number; sx: number; rgb: [number, number, number]; a: number }[]> = {
  light: [
    { r: 0.2, sx: 2, rgb: [255, 166, 80], a: 0.92 },
    { r: 0.1, sx: 2.6, rgb: [253, 120, 15], a: 0.62 },
  ],
  dark: [
    { r: 0.2, sx: 2, rgb: [224, 86, 18], a: 0.44 },
    { r: 0.1, sx: 2.6, rgb: [253, 120, 15], a: 0.12 },
  ],
};

const BASE = { light: '#f1ede7', dark: '#0e0d0c' } as const;

function massesFor(dark: boolean, gather: Gather): Mass[] {
  const pool = POOL[dark ? 'dark' : 'light'].map((p) => ({ x: gather.x, y: gather.y, r: p.r, sx: p.sx, rgb: p.rgb, a: p.a * gather.k }));
  return [...(dark ? DARK : LIGHT), ...pool];
}

/** The scalar the contours are level sets of: the masses summed as soft bumps. */
function height(masses: Mass[], x: number, y: number, w: number, h: number): number {
  const long = Math.max(w, h);
  let v = 0;
  for (const m of masses) {
    const dx = (x - m.x * w) / (m.r * long * (m.sx ?? 1));
    const dy = (y - m.y * h) / (m.r * long);
    v += m.a * Math.exp(-(dx * dx + dy * dy) * 2.2);
  }
  return v;
}

function contours(g: CanvasRenderingContext2D, masses: Mass[], w: number, h: number, stroke: string) {
  const cell = 6;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const f = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) f[j * cols + i] = height(masses, i * cell, j * cell, w, h);
  g.strokeStyle = stroke;
  g.lineWidth = 1;
  g.beginPath();
  const lerp = (a: number, b: number, t: number) => (t - a) / (b - a);
  for (let level = 0.06; level < 1.6; level += 0.062) {
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

export function paintField(canvas: HTMLCanvasElement, dark: boolean, strength: Strength, gather: Gather) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const gain = GAIN[strength];
  const masses = massesFor(dark, gather);
  g.fillStyle = dark ? BASE.dark : BASE.light;
  g.fillRect(0, 0, w, h);
  const long = Math.max(w, h);
  for (const m of masses) {
    if (m.a <= 0.001) continue;
    const cx = m.x * w, cy = m.y * h, r = m.r * long, sx = m.sx ?? 1;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
    const [R, G, B] = m.rgb;
    // A smooth falloff in five stops; a two-stop radial gradient shows its edge as a ring.
    for (const [t, k] of [[0, 1], [0.25, 0.86], [0.5, 0.52], [0.75, 0.18], [1, 0]] as const) {
      grad.addColorStop(t, `rgba(${R},${G},${B},${(m.a * gain * k).toFixed(4)})`);
    }
    g.save();
    g.translate(cx, cy);
    g.scale(sx, 1);
    g.fillStyle = grad;
    g.fillRect(-cx / sx, -cy, w / sx, h);
    g.restore();
  }
  const ink = dark ? 255 : 60;
  contours(g, masses, w, h, `rgba(${ink},${dark ? 235 : 30},${dark ? 215 : 0},${((dark ? 0.05 : 0.055) * (0.45 + 0.55 * gain)).toFixed(4)})`);
}

export interface Level {
  /** Mean relative (linear) luminance, which is what a backdrop hint declares. */
  luminance: number;
}
export type Sampler = (rect: { left: number; top: number; width: number; height: number }) => Level;

/** Reads the painted field under a box, from a small copy of the canvas (the Windows experiment's method). */
export function sampleField(canvas: HTMLCanvasElement): Sampler {
  const sw = 192;
  const sh = Math.max(1, Math.round((192 * canvas.height) / Math.max(1, canvas.width)));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const g = small.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(canvas, 0, 0, sw, sh);
  const data = g.getImageData(0, 0, sw, sh).data;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return (rect) => {
    const x0 = Math.max(0, Math.floor((rect.left / cw) * sw));
    const x1 = Math.min(sw, Math.ceil(((rect.left + rect.width) / cw) * sw));
    const y0 = Math.max(0, Math.floor((rect.top / ch) * sh));
    const y1 = Math.min(sh, Math.ceil(((rect.top + rect.height) / ch) * sh));
    let l = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * sw + x) * 4;
        l += 0.2126 * lin(data[i]!) + 0.7152 * lin(data[i + 1]!) + 0.0722 * lin(data[i + 2]!);
        n++;
      }
    }
    return { luminance: n === 0 ? 0.2 : l / n };
  };
}
