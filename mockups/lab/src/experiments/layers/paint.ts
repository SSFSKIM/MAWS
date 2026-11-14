// The colour field, lifted from the Field experiment's painter and regraded for this layout. One static painting,
// made once per size, scheme, ground, strength and colouring, and handed to both glass roots as their backdrop
// texture. It carries no meaning. Two spatial frequencies, as a lens needs: broad masses, and fine contour lines
// that are the level sets of those same masses.
//
// What changed from Field: the base is the owner's ground candidate (there is no sheet to carry it), and a second
// set of masses reaches across the main space at a lower level, because here the field is what prose is read on.
// The masses and the contour ink come from the colouring (`colour.ts`); this file only paints them.
import type { Field, Mass } from './colour';
import { paintPaper } from './paper';

export type Strength = 'whisper' | 'soft' | 'warm' | 'vivid';

const GAIN: Record<Strength, number> = { whisper: 0.2, soft: 0.42, warm: 0.68, vivid: 1 };

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
  for (let level = 0.05; level < 1.5; level += 0.05) {
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

export function paintField(canvas: HTMLCanvasElement, field: Field, strength: Strength, ground: string) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const gain = GAIN[strength];
  const masses = field.masses;
  g.fillStyle = ground;
  g.fillRect(0, 0, w, h);
  if (field.picture === 'paper') {
    const n = parseInt(ground.slice(1), 16);
    paintPaper(g, w, h, !!field.night, gain / GAIN.warm, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    return;
  }
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
  const [ink, alpha] = field.line;
  contours(g, masses, w, h, `rgba(${ink},${(alpha * (0.45 + 0.55 * gain)).toFixed(4)})`);
}
