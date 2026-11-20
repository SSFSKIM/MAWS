// The colour field: one static painting, made once per size, scheme and strength, and handed to the glass as its
// backdrop texture. Nothing in it carries meaning. It has the two spatial frequencies a lens needs: broad warm
// masses to tone the pane, and fine contour lines (the level sets of the same masses) for its rim to displace.

export type Strength = 'whisper' | 'soft' | 'warm' | 'vivid';

const GAIN: Record<Strength, number> = { whisper: 0.14, soft: 0.36, warm: 0.64, vivid: 1 };

interface Mass {
  x: number; // centre, as a share of the width
  y: number; // centre, as a share of the height
  r: number; // radius, as a share of the longer side
  rgb: [number, number, number];
  a: number; // alpha at the centre at full strength
}

// Light: a dusk read top to bottom down the sidebar's column: amber, the theme orange, coral, plum. The right edge
// answers quietly, because all that shows of it is the frame around the sheet.
const LIGHT: Mass[] = [
  { x: 0.03, y: -0.04, r: 0.36, rgb: [255, 181, 92], a: 0.95 },
  { x: 0.2, y: 0.3, r: 0.22, rgb: [253, 120, 15], a: 0.5 },
  { x: -0.02, y: 0.62, r: 0.32, rgb: [250, 116, 112], a: 0.66 },
  { x: 0.16, y: 1.06, r: 0.34, rgb: [188, 118, 178], a: 0.5 },
  { x: 1.02, y: -0.06, r: 0.36, rgb: [255, 190, 120], a: 0.6 },
  { x: 0.98, y: 1.08, r: 0.34, rgb: [236, 128, 150], a: 0.42 },
  { x: 0.55, y: 1.1, r: 0.3, rgb: [255, 176, 110], a: 0.35 },
];

// Dark: the same journey as embers. Kept deep on purpose: the pane's drawn body has to stay under the level where
// neither black nor white ink carries text.
const DARK: Mass[] = [
  { x: 0.03, y: -0.04, r: 0.34, rgb: [253, 132, 30], a: 0.62 },
  { x: 0.2, y: 0.3, r: 0.2, rgb: [240, 84, 20], a: 0.3 },
  { x: -0.02, y: 0.62, r: 0.3, rgb: [206, 44, 84], a: 0.5 },
  { x: 0.16, y: 1.06, r: 0.34, rgb: [128, 52, 138], a: 0.5 },
  { x: 1.02, y: -0.06, r: 0.34, rgb: [253, 120, 15], a: 0.36 },
  { x: 0.98, y: 1.08, r: 0.32, rgb: [150, 46, 110], a: 0.34 },
  { x: 0.55, y: 1.1, r: 0.28, rgb: [220, 70, 40], a: 0.22 },
];

const BASE = { light: '#f1ede7', dark: '#0e0d0c' } as const;

/** The scalar the contours are level sets of: the masses summed as soft bumps. */
function height(masses: Mass[], x: number, y: number, w: number, h: number): number {
  const long = Math.max(w, h);
  let v = 0;
  for (const m of masses) {
    const dx = (x - m.x * w) / (m.r * long);
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

export function paintField(canvas: HTMLCanvasElement, dark: boolean, strength: Strength) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const gain = GAIN[strength];
  const masses = dark ? DARK : LIGHT;
  g.fillStyle = dark ? BASE.dark : BASE.light;
  g.fillRect(0, 0, w, h);
  const long = Math.max(w, h);
  for (const m of masses) {
    const cx = m.x * w, cy = m.y * h, r = m.r * long;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    const [R, G, B] = m.rgb;
    // A smooth falloff in five stops; a two-stop radial gradient shows its edge as a ring.
    for (const [t, k] of [[0, 1], [0.25, 0.86], [0.5, 0.52], [0.75, 0.18], [1, 0]] as const) {
      grad.addColorStop(t, `rgba(${R},${G},${B},${(m.a * gain * k).toFixed(4)})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  const ink = dark ? 255 : 60;
  contours(g, masses, w, h, `rgba(${ink},${dark ? 235 : 30},${dark ? 215 : 0},${((dark ? 0.05 : 0.055) * (0.45 + 0.55 * gain)).toFixed(4)})`);
}
