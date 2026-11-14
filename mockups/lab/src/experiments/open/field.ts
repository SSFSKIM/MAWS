// The light. Open has no field under the whole window and no drawing in it: the ground is plain, and light gathers
// where glass stands (under the left pane, under the right pane, around the composer, a breath under the tabs) and
// fades to the ground where text is read. Each gathering is one canvas, painted once per size, scheme, strength and
// colouring, that travels with its surface. The painting is Field's (`field/paint.ts`): soft masses in five-stop
// falloffs, and 1 px contour lines that are the level sets of those same masses, cut by a blurred copy of the
// surface's own shape so the light ends a hand's width past the glass.
//
// What the light is made of comes from the colouring (`../layers/colour`), and from nothing else:
// - a colouring whose field is colour (masses) lends its colours: the seven places Field's composition names (four
//   down the pane's column, two at the right edge, one under the composer) are looked up in its masses;
// - a colouring whose field is a picture has no colour to lend, and its picture is not painted here. It gathers
//   light itself: a lamp. What the lamp is made of is what Layers' own plain ground gathers for that colouring
//   (`gatherOf` in `../layers/plain`: a warmer Paper's own light where it names one, Paper's shade or lamp where it
//   does not), laid out in Open's composition, plus the shade the glass throws. DESIGN.md 10.2 has the derivation.
import type { Field, Tokens } from '../layers/colour';
import { oklch } from '../layers/colour';
import { gatherOf } from '../layers/plain';

/** Open's default colouring: the owner's choice. `meta.ts` falls back to Layers' default if it is ever absent. */
export const OPEN_COLOUR = 'warmpaper';

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

export type Rgb = [number, number, number];

// ---- What a colouring lends the light ---------------------------------------------------------------------------

type Role = 'amber' | 'orange' | 'coral' | 'plum' | 'amber2' | 'rose' | 'glow';
/** The seven places of Field's composition, in shares of the window, and the level each was painted at there. */
const PLACE: Record<Role, [x: number, y: number, light: number, dark: number]> = {
  amber: [0.03, -0.04, 0.95, 0.62],
  orange: [0.2, 0.3, 0.5, 0.3],
  coral: [-0.02, 0.62, 0.66, 0.5],
  plum: [0.16, 1.06, 0.5, 0.5],
  amber2: [1.02, -0.06, 0.6, 0.36],
  rose: [0.98, 1.08, 0.42, 0.34],
  glow: [0.55, 1.1, 0.35, 0.22],
};
const ROLES = Object.keys(PLACE) as Role[];

export interface Light {
  /** Each place's colour, and how strong this colouring paints it there against Field's own level (1 is the same). */
  roles: Record<Role, { rgb: Rgb; k: number }>;
  /** The contour lines' ink, as `r,g,b`, and their alpha at full strength. */
  line: [string, number];
  /** Laid under the light inside its feather: a shade under the ground in light, a floor that keeps colour deep in dark. */
  base: Rgb;
  /** True where the light is a lamp and not a colour: the glass's shade is then painted with it. */
  lamp: boolean;
  /** A key for effects: two lights with the same key paint the same. */
  key: string;
}

const lin = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** sRGB to OKLCH: what a ground or a shadow tint is, in the terms the light is derived in. */
function toOklch([r, g, b]: Rgb): [L: number, C: number, H: number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, bb), ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360];
}
export const hexRgb = (hex: string): Rgb => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** `r g b`, as a colouring's tokens write an ink or a shadow tint. */
export const tripleRgb = (triple: string): Rgb => {
  const [r = 0, g = 0, b = 0] = triple.trim().split(/[\s,]+/).map(Number);
  return [r, g, b];
};

/** The warm hue a lamp has when a colouring gives none to go by: the lamp of Paper's own night (about hue 68). */
const LAMP_HUE = 68;

/**
 * What a colouring lends Open's light, for one scheme.
 *
 * A field of colour lends its colours: each of the seven places takes the mass painted nearest to it (faint floors
 * are passed over), at that mass's own level against Field's.
 *
 * A picture field lends none, so the light is a lamp, and the lamp is the colouring's own. Layers states what
 * gathers under glass on a plain ground for each picture colouring, as one colour and a strength (`gatherOf`):
 * the colouring's shadow by day and its lamp by night, or the light a warmer Paper names for itself. Open takes
 * its hue from that colour. Its chroma is a floor (a lamp is warm), plus twice the chroma of the colouring's
 * ground, plus three times how much more colour this colouring gathers than Paper does (chroma times strength).
 * So Paper is the quietest lamp, a Paper on a warmer ground is warmer, and one whose light is the orange is
 * orange, by day and by night. Down the pane's column it runs from the lamp, to the same light deepened, to the
 * tone a sheet has in its own shade, to the shade itself.
 */
export function lightOf(field: Field, tokens: Tokens, ground: string, dark: boolean): Light {
  const g = hexRgb(ground);
  // Under the light: Field's base. A shade under the ground by day; by night a floor no darker than Field's own,
  // which is also what keeps a faint tail of colour from turning into a wash over pure black.
  const base: Rgb = dark ? [Math.max(14, g[0] * 0.55), Math.max(13, g[1] * 0.55), Math.max(12, g[2] * 0.55)] : [g[0] * 0.962, g[1] * 0.95, g[2] * 0.94];
  const key = `${dark}:${ground}:${field.picture ?? ''}:${field.masses.length}:${field.masses.map((m) => m.rgb.join('.')).join('|')}:${tokens.shade}:${field.picture ? JSON.stringify(gatherOf(dark, field.light)) : ''}`;

  const strong = field.masses.filter((m) => m.a >= 0.12);
  if (!field.picture && strong.length > 0) {
    const roles = {} as Light['roles'];
    for (const role of ROLES) {
      const [x, y, la, da] = PLACE[role];
      let best = strong[0]!;
      let bestD = Infinity;
      for (const m of strong) {
        const d = Math.hypot(m.x - x, m.y - y);
        if (d < bestD) {
          bestD = d;
          best = m;
        }
      }
      roles[role] = { rgb: best.rgb, k: Math.min(1.5, Math.max(0.6, best.a / (dark ? da : la))) };
    }
    return { roles, line: field.line, base, lamp: false, key };
  }

  const [, gc] = toOklch(g);
  const own = gatherOf(dark, field.light);
  const paper = gatherOf(dark);
  const [, oc, oh] = toOklch(own.rgb);
  const [, pc] = toOklch(paper.rgb);
  // Keep the lamp a lamp: whatever is gathered, its light stays between ember and gold.
  const hue = oc > 0.008 && oh > 20 && oh < 100 ? oh : LAMP_HUE;
  // How much more colour this colouring gathers than Paper does.
  const more = Math.max(-0.02, Math.min(0.09, 3 * (oc * own.a - pc * paper.a)));
  const warm = gc * 2 + more;
  // By day a stronger light is also a little deeper, or it would have no room to be more than cream.
  const dip = dark ? 0 : Math.max(0, more) * 0.5;
  const at = (L: number, C: number, dh = 0): Rgb => oklch(L - dip, C, hue + dh);
  const roles: Light['roles'] = dark
    ? {
        amber: { rgb: at(0.66, 0.07 + warm), k: 1 },
        orange: { rgb: at(0.56, 0.085 + warm, -8), k: 1 },
        coral: { rgb: at(0.44, 0.07 + warm, -20), k: 0.9 },
        plum: { rgb: at(0.34, 0.045 + warm, -30), k: 0.9 },
        amber2: { rgb: at(0.62, 0.065 + warm), k: 1 },
        rose: { rgb: at(0.4, 0.06 + warm, -22), k: 0.9 },
        glow: { rgb: at(0.52, 0.08 + warm, -10), k: 1 },
      }
    : {
        // By day the hue hardly moves down the column: a lamp that turns toward red as it deepens reads as pink
        // on ivory, and what was asked for is the older orange's warmth, not a blush.
        amber: { rgb: at(0.965, 0.036 + warm, 6), k: 1 },
        orange: { rgb: at(0.93, 0.055 + warm, 2), k: 1 },
        coral: { rgb: at(0.87, 0.055 + warm, -3), k: 0.9 },
        plum: { rgb: at(0.79, 0.045 + warm, -8), k: 0.9 },
        amber2: { rgb: at(0.965, 0.032 + warm, 6), k: 1 },
        rose: { rgb: at(0.85, 0.05 + warm, -4), k: 0.9 },
        glow: { rgb: at(0.92, 0.055 + warm), k: 1 },
      };
  const [lr, lg, lb] = dark ? [255, 236, 214] : tripleRgb(tokens.shade).map((v) => Math.round(v * 0.7));
  return { roles, line: [`${lr},${lg},${lb}`, dark ? 0.04 : 0.05], base, lamp: true, key };
}


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
function massesFor(kind: GatherKind, light: Light, dark: boolean, W: number, H: number, s: Shape): Mass[] {
  const c = Object.fromEntries(ROLES.map((r) => [r, light.roles[r].rgb])) as Record<Role, Rgb>;
  const k = (lightA: number, darkA: number) => (dark ? darkA : lightA);
  const REF = 1440;
  switch (kind) {
    case 'left':
      return [
        { x: 0.03 * REF, y: -0.04 * H, r: 0.36 * REF, rgb: c.amber, a: k(0.95, 0.62) * light.roles.amber.k },
        { x: 0.2 * REF, y: 0.3 * H, r: 0.22 * REF, rgb: c.orange, a: k(0.5, 0.3) * light.roles.orange.k },
        { x: -0.02 * REF, y: 0.62 * H, r: 0.32 * REF, rgb: c.coral, a: k(0.66, 0.5) * light.roles.coral.k },
        { x: 0.16 * REF, y: 1.06 * H, r: 0.34 * REF, rgb: c.plum, a: k(0.5, 0.5) * light.roles.plum.k },
      ];
    case 'right':
      return [
        { x: s.x + s.w + 10, y: s.y - 50, r: 430, rgb: c.amber2, a: k(0.78, 0.5) * light.roles.amber2.k },
        { x: s.x + s.w * 0.1, y: s.y + s.h * 0.52, r: 260, rgb: c.orange, a: k(0.2, 0.14) * light.roles.orange.k },
        { x: s.x + s.w * 0.8, y: s.y + s.h + 60, r: 400, rgb: c.rose, a: k(0.62, 0.5) * light.roles.rose.k },
        { x: s.x - 40, y: s.y + s.h + 30, r: 300, rgb: c.plum, a: k(0.3, 0.34) * light.roles.plum.k },
      ];
    case 'composer':
      return [
        { x: s.x + s.w * 0.08, y: s.y + s.h * 0.2, r: s.w * 0.5, rgb: c.amber, a: k(0.85, 0.56) * light.roles.amber.k },
        { x: s.x + s.w * 0.46, y: s.y + s.h * 1.25, r: s.w * 0.34, rgb: c.orange, a: k(0.4, 0.26) * light.roles.orange.k },
        { x: s.x + s.w * 0.84, y: s.y + s.h * 0.9, r: s.w * 0.46, rgb: c.coral, a: k(0.64, 0.5) * light.roles.coral.k },
        { x: s.x + s.w * 1.04, y: s.y - 10, r: s.w * 0.36, rgb: c.plum, a: k(0.44, 0.46) * light.roles.plum.k },
      ];
    case 'tabs':
      return [
        { x: s.x + s.w * 0.12, y: s.y + s.h * 0.2, r: s.w * 0.55, rgb: c.amber, a: k(0.8, 0.5) * light.roles.amber.k },
        { x: s.x + s.w * 0.92, y: s.y + s.h * 0.9, r: s.w * 0.5, rgb: c.coral, a: k(0.42, 0.4) * light.roles.coral.k },
      ];
    case 'home':
      return [
        { x: s.x + s.w * 0.1, y: s.y - 20, r: s.w * 0.56, rgb: c.amber, a: k(0.95, 0.74) * light.roles.amber.k },
        { x: s.x + s.w * 0.5, y: s.y + s.h + k(70, 30), r: s.w * 0.42, rgb: c.orange, a: k(0.5, 0.42) * light.roles.orange.k },
        { x: s.x + s.w * 0.9, y: s.y + s.h * 0.7, r: s.w * 0.52, rgb: c.coral, a: k(0.66, 0.58) * light.roles.coral.k },
        { x: s.x + s.w * 1.02, y: s.y - 60, r: s.w * 0.4, rgb: c.plum, a: k(0.5, 0.5) * light.roles.plum.k },
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
export function paintGather(canvas: HTMLCanvasElement, kind: GatherKind, light: Light, dark: boolean, strength: Strength, shape: Shape, reach: number, floor?: { ground?: string; blank?: boolean }): Painted | null {
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
  const masses = massesFor(kind, light, dark, w, h, shape);
  // Field painted its masses on a base of its own, a shade under the sheet, and that base is half of how its pane
  // looked: in dark it is what keeps the light saturated instead of greyed by the ground. So each gathering lays
  // the colouring's base under its light, inside its feather.
  if (!floor?.blank) {
    // Under glass that is made over this canvas as a texture the base is whole: a texel that is part transparent is
    // part black to the lens.
    const baseA = floor ? 1 : KEEP[kind] * Math.min(1, 0.45 + GAIN[strength]);
    g.fillStyle = `rgba(${light.base.map(Math.round).join(',')},${baseA.toFixed(3)})`;
    g.fillRect(0, 0, w, h);
    // A lamp's light comes from the upper left, so the glass throws its shade down and to the right: the last
    // mass of each gathering is already that shade; here it is only deepened a little under the far corner.
    if (light.lamp && !dark && kind !== 'tabs') {
      const sx = shape.x + shape.w * 0.82, sy = shape.y + Math.min(shape.h, h - shape.y) * 0.96, sr = Math.max(180, Math.min(shape.w, 520) * 0.9);
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
      const [R, G, B] = light.roles.plum.rgb;
      for (const [t, f] of [[0, 1], [0.3, 0.7], [0.65, 0.25], [1, 0]] as const) grad.addColorStop(t, `rgba(${R},${G},${B},${(0.3 * gain * f).toFixed(4)})`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
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
  // The contours are for a lens to displace; the tab capsule is too small to show them as anything but rings.
  if (!floor?.blank && kind !== 'tabs') contours(g, masses, w, h, `rgba(${light.line[0]},${(light.line[1] * (0.45 + 0.55 * GAIN[strength])).toFixed(4)})`);

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
