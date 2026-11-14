// The environment: one full-bleed, viewport-fixed canvas the three windows look through. It is painted, not
// photographed, from the owner's orange and the ground candidate, and every scene carries both spatial
// frequencies the lens needs: broad forms to tone the glass bodies and fine lines, painted into the plane, for the
// rims to displace. The dark scheme is a second print of each scene (ember levels), not the light one dimmed:
// the dark material cannot carry text over a bright backdrop (DESIGN.md, "Environment").

export type EnvScene = 'sun' | 'dunes' | 'orbit';

export interface EnvOptions {
  scene: EnvScene;
  dark: boolean;
  /** The ground candidate, as a hex colour. */
  ground: string;
  /** A measuring aid, never a scene: vertical grey strips from black to white. */
  probe?: boolean;
}

type RGB = [number, number, number];

const ORANGE: RGB = [253, 120, 15];

function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function css(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
}
function luma(c: RGB): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}
let grainTile: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const g = c.getContext('2d')!;
  const d = g.createImageData(192, 192);
  // A fixed seed, so two captures of one scene are the same picture.
  let s = 0x9e3779b9;
  for (let i = 0; i < d.data.length; i += 4) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const v = (s >>> 0) % 256;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  grainTile = c;
  return c;
}

interface Palette {
  ground: RGB;
  /** Brightest to quietest, the last one step from the ground. */
  steps: RGB[];
  line: string;
  lineStrong: string;
  hair: string;
  /** A soft shadow laid inside each step's outer edge, so a step reads as a lit ridge and not a flat poster band. */
  shade: string;
}

/**
 * The broad forms are painted about ten degrees yellower than the owner's orange. Measured on a strip probe
 * (`probe=hue`), the material gives a saturated orange back about thirteen degrees redder: #FD780F under a light
 * window comes out salmon, rgb(255,211,199). An amber of hue 36 to 40 under the glass is what reads as that orange
 * through it. The lines, the small bodies and every accent in the interface are the exact colour.
 */
const AMBER: RGB = [255, 158, 30];

function palette(o: EnvOptions): Palette {
  const ground = hex(o.ground);
  if (o.dark) {
    // The dark material draws its body from the level declared under each footprint, and at window scale that
    // body reaches the ink dead band (encoded 0.39 to 0.49) once the footprint averages about 0.3 (measured,
    // DESIGN.md). So the dark print keeps every broad form at or under 0.21 and gives the orange to the lines,
    // which are too thin to move a footprint's average.
    const k = 0.21 / luma(AMBER);
    const core: RGB = [AMBER[0] * k, AMBER[1] * k, AMBER[2] * k];
    const ts = [0, 0.14, 0.3, 0.47, 0.64, 0.8, 0.92];
    return {
      ground,
      steps: ts.map((t) => mix(core, ground, t)),
      line: css(ORANGE, 0.42),
      lineStrong: css(ORANGE, 0.85),
      hair: css(ORANGE, 0.09),
      shade: 'rgba(0,0,0,0.16)',
    };
  }
  // Light: the owner's orange at the core, then amber, then a cream that keeps the far steps on the orange's side
  // of the wheel (pale orange mixed straight into paper turns pink), then the ground.
  const cream: RGB = [255, 233, 196];
  const stops: [number, RGB][] = [
    [0, ORANGE],
    [0.2, AMBER],
    [0.66, cream],
    [1, ground],
  ];
  const at = (t: number): RGB => {
    for (let i = 1; i < stops.length; i++) {
      const [t1, c1] = stops[i]!;
      const [t0, c0] = stops[i - 1]!;
      if (t <= t1) return mix(c0, c1, (t - t0) / (t1 - t0));
    }
    return ground;
  };
  return {
    ground,
    steps: [0, 0.12, 0.28, 0.46, 0.64, 0.8, 0.92].map(at),
    line: 'rgba(255,255,255,0.6)',
    lineStrong: 'rgba(255,255,255,0.9)',
    hair: 'rgba(170,80,0,0.075)',
    shade: 'rgba(200,90,0,0.10)',
  };
}

function sun(g: CanvasRenderingContext2D, w: number, h: number, p: Palette) {
  // A sun standing half under the bottom edge, drawn as stepped rings: the composer sits in its core and the
  // light thins upward through the transcript. The steps are hard on purpose; an edge is what a rim can bend.
  // Its axis is the session column's when both side windows are open: the viewport's centre, moved by half the
  // difference between the sidebar and the side column.
  const cx = w * 0.5 - 16;
  const cy = h * 1.12;
  const unit = Math.max(h, w * 0.62);
  const radii = [0.27, 0.42, 0.58, 0.75, 0.93, 1.12, 1.32].map((r) => r * unit);
  for (let i = radii.length - 1; i >= 0; i--) {
    const r = radii[i]!;
    g.fillStyle = css(p.steps[i]!);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    // Each step is lit from the centre: a little darker just inside its own edge.
    const inner = radii[i - 1] ?? 0;
    const lit = g.createRadialGradient(cx, cy, inner, cx, cy, r);
    lit.addColorStop(0, 'rgba(0,0,0,0)');
    lit.addColorStop(0.55, 'rgba(0,0,0,0)');
    lit.addColorStop(1, p.shade);
    g.fillStyle = lit;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  }
  // Fine structure: one bright line on each step, and hairlines between them.
  g.lineWidth = 1;
  for (let i = 0; i < radii.length; i++) {
    g.strokeStyle = i < 3 ? p.lineStrong : p.line;
    g.beginPath();
    g.arc(cx, cy, radii[i]! - 0.5, 0, Math.PI * 2);
    g.stroke();
    const next = radii[i + 1] ?? radii[i]! + 0.2 * unit;
    g.strokeStyle = p.hair;
    for (let k = 1; k < 8; k++) {
      g.beginPath();
      g.arc(cx, cy, radii[i]! + ((next - radii[i]!) * k) / 8, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

function dunes(g: CanvasRenderingContext2D, w: number, h: number, p: Palette) {
  // A calm sky of ground over six ridges that gain colour toward the bottom edge.
  const ridge = (i: number, x: number) => {
    const base = h * (0.34 + 0.115 * i);
    return (
      base +
      Math.sin(x / (210 + i * 37) + i * 1.9) * (22 + i * 7) +
      Math.sin(x / (83 + i * 11) + i * 0.7) * (5 + i * 1.5)
    );
  };
  for (let i = 0; i < 6; i++) {
    const colour = p.steps[5 - i]!;
    const path = (dy: number) => {
      g.beginPath();
      g.moveTo(-10, ridge(i, -10) + dy);
      for (let x = 0; x <= w + 10; x += 6) g.lineTo(x, ridge(i, x) + dy);
    };
    path(0);
    g.lineTo(w + 10, h + 10);
    g.lineTo(-10, h + 10);
    g.closePath();
    g.fillStyle = css(colour);
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = i > 2 ? p.lineStrong : p.line;
    path(0.5);
    g.stroke();
    g.strokeStyle = p.hair;
    for (const dy of [9, 19, 30, 42]) {
      path(dy);
      g.stroke();
    }
  }
}

function orbit(g: CanvasRenderingContext2D, w: number, h: number, p: Palette, dark: boolean) {
  // The quiet scene: the ground, a small warm body and the rings around it. Almost no colour reaches the glass,
  // so this is the scene that asks how little environment the windows need.
  const cx = w * 0.66;
  const cy = h * 0.4;
  const halo = g.createRadialGradient(cx, cy, 0, cx, cy, h * 0.62);
  halo.addColorStop(0, css(p.steps[2]!, 0.9));
  halo.addColorStop(0.32, css(p.steps[4]!, 0.7));
  halo.addColorStop(1, css(p.ground, 0));
  g.fillStyle = halo;
  g.fillRect(0, 0, w, h);
  g.fillStyle = css(p.steps[0]!);
  g.beginPath();
  g.arc(cx, cy, 34, 0, Math.PI * 2);
  g.fill();
  const ink = dark ? '255,255,255' : '90,45,10';
  g.lineWidth = 1;
  for (let i = 1; i <= 34; i++) {
    const r = 34 + i * 38;
    const strong = i % 4 === 0;
    g.strokeStyle = `rgba(${ink},${strong ? (dark ? 0.2 : 0.22) : dark ? 0.08 : 0.1})`;
    g.setLineDash(i % 6 === 3 ? [2, 7] : []);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.setLineDash([]);
  // Three bodies on their rings: the orange at full strength where it is too small to tone a window.
  const bodies: [number, number, number][] = [
    [4, 2.5, 7],
    [9, 3.9, 11],
    [16, 0.55, 5],
  ];
  for (const [ring, angle, size] of bodies) {
    const r = 34 + ring * 38;
    g.fillStyle = css(ORANGE);
    g.beginPath();
    g.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, size, 0, Math.PI * 2);
    g.fill();
  }
}

/** Paint the scene at the canvas's own box, so the texture the glass samples is the picture the page shows. */
export function paintEnv(canvas: HTMLCanvasElement, o: EnvOptions) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (o.probe && new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('probe') === 'hue') {
    // Sixteen strips of one lightness walking from red-orange to yellow, to read what hue the body gives back.
    for (let i = 0; i < 16; i++) {
      g.fillStyle = `hsl(${14 + i * 2.4} 98% 53%)`;
      g.fillRect((i * w) / 16, 0, w / 16 + 1, h);
    }
    return;
  }
  if (o.probe) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const v = Math.round((i / (n - 1)) * 255);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect((i * w) / n, 0, w / n + 1, h);
    }
    return;
  }
  const p = palette(o);
  g.fillStyle = css(p.ground);
  g.fillRect(0, 0, w, h);
  if (o.scene === 'sun') sun(g, w, h, p);
  else if (o.scene === 'dunes') dunes(g, w, h, p);
  else orbit(g, w, h, p, o.dark);
  // Grain, in the plane: device-pixel noise the heavy scatter averages away and the rim keeps.
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = o.dark ? 0.05 : 0.035;
  g.globalCompositeOperation = o.dark ? 'screen' : 'multiply';
  g.fillStyle = g.createPattern(grain(), 'repeat')!;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

export interface Level {
  /** Mean encoded luma, 0..1: the scale the dead band is stated on. */
  encoded: number;
  /** Mean relative luminance, 0..1: what a backdrop hint declares. */
  luminance: number;
}

/** A small copy of the painted plane, read once per paint, that footprints are measured against. */
export function sampleEnv(canvas: HTMLCanvasElement): (rect: { left: number; top: number; width: number; height: number }) => Level {
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
    let e = 0;
    let l = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * sw + x) * 4;
        const r = data[i]!;
        const gg = data[i + 1]!;
        const b = data[i + 2]!;
        e += (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
        l += 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
        n++;
      }
    }
    return n === 0 ? { encoded: 0.5, luminance: 0.2 } : { encoded: e / n, luminance: l / n };
  };
}
