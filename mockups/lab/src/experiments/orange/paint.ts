// The ground: the owner's orange, lit. One hue throughout; what varies is light and depth. Painted once per size,
// scheme and knob, shown as the window's background and handed to the glass as its backdrop texture, so the lens
// has two spatial frequencies to work on: broad volumes of light and shade, and fine contour lines that are the
// level sets of those same volumes (painted into the plane, because a pattern laid over it in CSS is not behind
// the glass).

export type OrangeMode = 'full' | 'deep' | 'light';

export interface GroundSpec {
  /** The flat colour most of the plane is. */
  base: string;
  /** Lighter and deeper steps of the same hue (or, for `light`, the orange itself on a plain ground). */
  lift: [number, number, number];
  shade: [number, number, number];
  liftGain: number;
  shadeGain: number;
  /** Contour strokes: one lighter, one deeper. */
  lineLift: string;
  lineShade: string;
}

interface Mass {
  x: number;
  y: number;
  r: number;
  a: number;
  kind: 'lift' | 'shade';
}

// Light arrives from the upper left and pools again low in the middle, where the composer stands; depth gathers
// in the upper right and the lower left. The arrangement is the same in every mode and scheme.
const MASSES: Mass[] = [
  { x: 0.06, y: -0.06, r: 0.46, a: 1, kind: 'lift' },
  { x: 0.52, y: 1.08, r: 0.4, a: 0.9, kind: 'lift' },
  { x: 0.98, y: 0.42, r: 0.3, a: 0.55, kind: 'lift' },
  { x: 1.04, y: -0.1, r: 0.4, a: 0.9, kind: 'shade' },
  { x: -0.06, y: 1.06, r: 0.42, a: 1, kind: 'shade' },
  { x: 0.5, y: 0.36, r: 0.3, a: 0.42, kind: 'shade' },
  { x: 1.02, y: 1.1, r: 0.3, a: 0.7, kind: 'shade' },
];

function height(x: number, y: number, w: number, h: number): number {
  const long = Math.max(w, h);
  let v = 0;
  for (const m of MASSES) {
    const dx = (x - m.x * w) / (m.r * long);
    const dy = (y - m.y * h) / (m.r * long);
    v += (m.kind === 'lift' ? 1 : -0.8) * m.a * Math.exp(-(dx * dx + dy * dy) * 2.2);
  }
  return v;
}

function contours(g: CanvasRenderingContext2D, w: number, h: number, lift: string, shade: string) {
  const cell = 6;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const f = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) f[j * cols + i] = height(i * cell, j * cell, w, h);
  const lerp = (a: number, b: number, t: number) => (t - a) / (b - a);
  g.lineWidth = 1;
  for (const pass of ['lift', 'shade'] as const) {
    g.strokeStyle = pass === 'lift' ? lift : shade;
    g.beginPath();
    for (let level = -0.92; level < 1.1; level += 0.058) {
      if ((pass === 'lift') !== level > 0) continue;
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = f[j * cols + i]!;
          const b = f[j * cols + i + 1]!;
          const c = f[(j + 1) * cols + i + 1]!;
          const d = f[(j + 1) * cols + i]!;
          const code = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
          if (code === 0 || code === 15) continue;
          const x = i * cell;
          const y = j * cell;
          const top: [number, number] = [x + cell * lerp(a, b, level), y];
          const right: [number, number] = [x + cell, y + cell * lerp(b, c, level)];
          const bottom: [number, number] = [x + cell * lerp(d, c, level), y + cell];
          const left: [number, number] = [x, y + cell * lerp(a, d, level)];
          const seg = (p: [number, number], q: [number, number]) => {
            g.moveTo(p[0], p[1]);
            g.lineTo(q[0], q[1]);
          };
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
}

export function paintGround(canvas: HTMLCanvasElement, spec: GroundSpec) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  g.fillStyle = spec.base;
  g.fillRect(0, 0, w, h);
  const long = Math.max(w, h);
  for (const m of MASSES) {
    const cx = m.x * w;
    const cy = m.y * h;
    const r = m.r * long;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    const [R, G, B] = m.kind === 'lift' ? spec.lift : spec.shade;
    const gain = m.kind === 'lift' ? spec.liftGain : spec.shadeGain;
    // A smooth falloff in five stops; a two-stop radial gradient shows its edge as a ring.
    for (const [t, k] of [[0, 1], [0.25, 0.86], [0.5, 0.52], [0.75, 0.18], [1, 0]] as const) {
      grad.addColorStop(t, `rgba(${R},${G},${B},${Math.min(1, m.a * gain * k).toFixed(4)})`);
    }
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  contours(g, w, h, spec.lineLift, spec.lineShade);
}
