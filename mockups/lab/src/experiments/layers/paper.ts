// The Paper colouring's field: not a hue but a still life, painted by this file and by nothing else. One sheet of
// paper lifts off the floor in a slow arch at the lower left, comes down to a fold under the composer, and from the
// fold rises to the upper right as a leaf of clear glass. The paper is declared by its shading (a lit crest, a
// shaded underside, one soft shadow on the floor), the glass by a bright rim, a faint reflection inside it and the
// shadow it casts, never by a tint. It is composed for the window: the reading column is left quiet, and the form
// stands where there is room (under the pane, under the composer, in the right margin, across new chat).
//
// Every shape is a spline in shares of the window, so the picture is the same at every size. Field strength is how
// far the shading departs from the ground. Dark is the same forms under a low lamp, not the light one recoloured:
// see `NIGHT`. Nothing here moves.

type P = [number, number];

/** A Catmull-Rom spline through the points, sampled evenly per span. */
function spline(points: P[], perSpan: number): P[] {
  const out: P[] = [];
  const at = (i: number) => points[Math.min(points.length - 1, Math.max(0, i))]!;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < perSpan; s++) {
      const t = s / perSpan;
      const t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** The same number of points along a polyline, evenly by length, so two edges can be joined rung by rung. */
function resample(line: P[], n: number): P[] {
  const d = [0];
  for (let i = 1; i < line.length; i++) d.push(d[i - 1]! + Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]));
  const total = d[d.length - 1]!;
  const out: P[] = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const want = (total * i) / (n - 1);
    while (j < line.length - 1 && d[j]! < want) j++;
    const span = d[j]! - d[j - 1]! || 1;
    const t = (want - d[j - 1]!) / span;
    out.push([line[j - 1]![0] + (line[j]![0] - line[j - 1]![0]) * t, line[j - 1]![1] + (line[j]![1] - line[j - 1]![1]) * t]);
  }
  return out;
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.max(0, Math.min(1, a)).toFixed(4)})`;
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** What the light does to each material. Two of these exist: daylight, and the same room under a low lamp. */
interface Light {
  /** Broad light across the floor: where it gathers, how wide, its colour and strength; then where the room falls off. */
  pool: { at: P; r: number; rgb: RGB; a: number };
  fall: { rgb: RGB; a: number };
  /** Paper: the top surface where it faces the light, the crest's edge, and the underside from its lightest to its deepest. */
  top: RGB;
  edge: RGB;
  under: [RGB, RGB];
  /** The far edge of the top surface, as an alpha of the fall colour: it barely leaves the ground. */
  far: number;
  /** Shadow on the floor: colour, and alpha under the paper and under the glass (a clear thing casts a lighter one). */
  shadow: RGB;
  shadowPaper: number;
  shadowGlass: number;
  /** Glass: the body's veil, the light caught inside it, the rim, the line beside the rim, the light it throws on the floor. */
  veil: [RGB, number];
  inner: [RGB, number];
  rim: [RGB, number];
  beside: [RGB, number];
  caustic: [RGB, number];
  /** Paper grain, as an alpha of black and of white specks. */
  grain: number;
}

// Daylight from the upper left. The ground is the owner's ivory; the crest sits just above it, the underside a
// clear step below, and the one shadow between the two.
const DAY: Light = {
  pool: { at: [0.3, 0.1], r: 0.9, rgb: [255, 253, 250], a: 0.12 },
  fall: { rgb: [150, 128, 108], a: 0.1 },
  top: [243, 238, 232],
  edge: [251, 248, 244],
  under: [[216, 207, 197], [196, 185, 172]],
  far: 0.1,
  shadow: [126, 104, 84],
  shadowPaper: 0.3,
  shadowGlass: 0.24,
  veil: [[255, 255, 255], 0.11],
  inner: [[255, 255, 255], 0.17],
  rim: [[255, 255, 255], 0.95],
  beside: [[120, 100, 84], 0.26],
  caustic: [[255, 252, 246], 0.5],
  grain: 0.016,
};

// The same room at night, lit by one low lamp at the left. The floor is nearly dark and warm, with a pool of light
// where the lamp reaches; the paper is still ivory, so its crest is the brightest broad thing in the room and its
// underside sinks under the floor's level; the glass has almost no body left and is all rim, reflection and the
// light it gathers onto the floor.
const NIGHT: Light = {
  pool: { at: [0.3, 0.95], r: 0.52, rgb: [255, 224, 188], a: 0.15 },
  fall: { rgb: [0, 0, 0], a: 0.3 },
  top: [104, 95, 84],
  edge: [196, 184, 168],
  under: [[52, 47, 42], [18, 16, 14]],
  far: 0.5,
  shadow: [0, 0, 0],
  shadowPaper: 0.5,
  shadowGlass: 0.3,
  veil: [[255, 244, 228], 0.045],
  inner: [[255, 240, 218], 0.075],
  rim: [[255, 244, 226], 0.62],
  beside: [[0, 0, 0], 0.4],
  caustic: [[255, 226, 186], 0.2],
  grain: 0.02,
};

// ---- the composition, in shares of the window (x of the width, y of the height) ---------------------------------

// The arch. Its near edge is the crest the light catches; the floor line is where its underside ends.
const CREST: P[] = [[-0.03, 0.815], [0.07, 0.775], [0.17, 0.74], [0.27, 0.752], [0.38, 0.82], [0.48, 0.905], [0.56, 0.958]];
const FLOOR: P[] = [[-0.03, 0.875], [0.1, 0.885], [0.24, 0.9], [0.38, 0.925], [0.48, 0.945], [0.56, 0.958]];
const FAR: P[] = [[-0.03, 0.755], [0.07, 0.716], [0.17, 0.69], [0.28, 0.705], [0.39, 0.775], [0.49, 0.878], [0.56, 0.958]];
// The leaf. `RISE` is the edge that continues the paper's own curve; `BELLY` comes back down to the fold.
const RISE: P[] = [[0.56, 0.958], [0.612, 0.912], [0.672, 0.826], [0.74, 0.69], [0.812, 0.515], [0.884, 0.33], [0.942, 0.19], [0.974, 0.122]];
const BELLY: P[] = [[0.974, 0.122], [0.992, 0.21], [0.993, 0.375], [0.972, 0.55], [0.926, 0.708], [0.845, 0.83], [0.735, 0.908], [0.64, 0.943], [0.56, 0.958]];
// A reflection inside the glass has an edge of its own: the rising edge again, a little way in.
const SHEEN: P[] = [[0.7, 0.86], [0.775, 0.725], [0.84, 0.56], [0.9, 0.39], [0.948, 0.25], [0.974, 0.16]];

function trace(g: CanvasRenderingContext2D, line: P[], move = true) {
  line.forEach(([x, y], i) => (i === 0 && move ? g.moveTo(x, y) : g.lineTo(x, y)));
}

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
    const dark = v < 0.5;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = dark ? 0 : 255;
    img.data[i + 3] = Math.round(255 * Math.abs(v - 0.5) * 2);
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

/**
 * How present the form is. The room (its light, its falloff, the grain) is always painted; the form (the sheet, the
 * leaf and the shadows they cast) is laid over it twice at most: `sharp` is the picture as composed, `soft` is the
 * same picture out of focus, with no line left in it. Each is a share, 0 to 1. `FULL` is the picture as it was
 * before presence existed, and is painted by the same calls in the same order.
 */
export interface Presence {
  sharp: number;
  soft: number;
}
export const FULL: Presence = { sharp: 1, soft: 0 };

/** How far out of focus the soft form is: the blur's deviation in CSS px on a window 1440 on its longer side. */
const DEFOCUS = 8;
/** The form is painted this far past the window on every side, so its out-of-focus copy does not thin at an edge. */
const MARGIN = 72;

let layers: { key: string; sharp: HTMLCanvasElement; soft: HTMLCanvasElement | null } | null = null;

/**
 * Paints the still life over a ground already filled. `k` is the field strength as a share of the default, so 1 is
 * the picture as composed.
 */
export function paintPaper(g: CanvasRenderingContext2D, w: number, h: number, night: boolean, k: number, ground: RGB, presence: Presence = FULL) {
  const L = night ? NIGHT : DAY;
  const px = (line: P[]): P[] => line.map(([x, y]) => [x * w, y * h]);
  const long = Math.max(w, h);
  const blur = (n: number) => `blur(${((n * long) / 1440).toFixed(1)}px)`;
  const depth = Math.min(1.6, k);

  // The room's light: a broad pool, and a falloff toward the far corner.
  let grad = g.createRadialGradient(L.pool.at[0] * w, L.pool.at[1] * h, 0, L.pool.at[0] * w, L.pool.at[1] * h, L.pool.r * long);
  for (const [t, f] of [[0, 1], [0.3, 0.8], [0.6, 0.36], [1, 0]] as const) grad.addColorStop(t, rgba(L.pool.rgb, L.pool.a * depth * f));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  grad = g.createLinearGradient(0.2 * w, 0, w, h);
  grad.addColorStop(0, rgba(L.fall.rgb, 0));
  grad.addColorStop(0.55, rgba(L.fall.rgb, 0));
  grad.addColorStop(1, rgba(L.fall.rgb, L.fall.a * depth));
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const sharp = Math.max(0, Math.min(1, presence.sharp));
  const soft = Math.max(0, Math.min(1, presence.soft));
  if (sharp >= 1 && soft <= 0) {
    form(g);
  } else if (sharp > 0 || soft > 0) {
    // Anything less than the whole picture is laid over the room from two kept layers, so that a change of
    // presence (a scene arriving) can be shown frame by frame without painting the form again.
    const scale = g.canvas.width / w;
    const m = Math.round(MARGIN * scale);
    const key = `${g.canvas.width}x${g.canvas.height}:${w}x${h}:${night}:${k}:${ground.join()}`;
    if (!layers || layers.key !== key) {
      const c = document.createElement('canvas');
      c.width = g.canvas.width + 2 * m;
      c.height = g.canvas.height + 2 * m;
      const lg = c.getContext('2d')!;
      lg.setTransform(scale, 0, 0, scale, m, m);
      form(lg);
      layers = { key, sharp: c, soft: null };
    }
    if (soft > 0 && !layers.soft) {
      const c = document.createElement('canvas');
      c.width = layers.sharp.width;
      c.height = layers.sharp.height;
      const lg = c.getContext('2d')!;
      lg.filter = `blur(${((DEFOCUS * long * scale) / 1440).toFixed(1)}px)`;
      lg.drawImage(layers.sharp, 0, 0);
      layers.soft = c;
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (soft > 0 && layers.soft) {
      g.globalAlpha = soft;
      g.drawImage(layers.soft, -m, -m);
    }
    if (sharp > 0) {
      g.globalAlpha = sharp;
      g.drawImage(layers.sharp, -m, -m);
    }
    g.restore();
  }

  // Grain: paper is matte, and a lens needs something fine to displace everywhere.
  g.save();
  g.globalAlpha = L.grain * (0.6 + 0.4 * Math.min(1, depth));
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = g.createPattern(grain(), 'repeat')!;
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  g.restore();

  /** The form: the shadows, the sheet and the leaf, on whatever it is handed (the field itself, or a kept layer). */
  function form(g: CanvasRenderingContext2D) {
    let grad: CanvasGradient;
    const N = 220;
    const crest = resample(px(spline(CREST, 24)), N);
    const floor = resample(px(spline(FLOOR, 24)), N);
    const far = resample(px(spline(FAR, 24)), N);
    const rise = px(spline(RISE, 28));
    const belly = px(spline(BELLY, 28));

    // ---- the shadows, first: a contact shadow where the arch meets the floor, and the one the leaf throws ----
    g.save();
    g.filter = blur(20);
    g.fillStyle = rgba(L.shadow, L.shadowPaper * depth);
    g.beginPath();
    trace(g, floor.slice(Math.round(N * 0.06)));
    g.lineTo(0.6 * w, 0.982 * h);
    g.lineTo(0.4 * w, 0.985 * h);
    g.lineTo(0.16 * w, 0.955 * h);
    g.lineTo(0.02 * w, 0.92 * h);
    g.closePath();
    g.fill();
    g.filter = blur(22);
    g.fillStyle = rgba(L.shadow, L.shadowGlass * depth);
    g.beginPath();
    g.ellipse(0.775 * w, 0.958 * h, 0.2 * w, 0.024 * h, -0.045, 0, Math.PI * 2);
    g.fill();
    // Light gathered by the glass and laid inside its own shadow.
    g.filter = blur(14);
    g.fillStyle = rgba(L.caustic[0], L.caustic[1] * depth);
    g.beginPath();
    g.ellipse(0.79 * w, 0.957 * h, 0.1 * w, 0.009 * h, -0.05, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // ---- the paper: the top surface behind the crest, then the underside, rung by rung ----
    // The top surface is one shape: it faces the light most where the sheet is still rising, turns away past the
    // crest, and its far edge is soft, because it barely leaves the ground.
    const groundTop = mix(ground, L.top, Math.min(1, depth));
    g.save();
    g.filter = blur(1.6);
    grad = g.createLinearGradient(crest[0]![0], 0, crest[N - 1]![0], 0);
    for (let i = 0; i <= 16; i++) {
      const u = i / 16;
      const facing = 1 - smooth((u - 0.34) / 0.5);
      grad.addColorStop(u, rgba(mix(ground, groundTop, 0.3 + 0.7 * facing), 1 - smooth((u - 0.8) / 0.2)));
    }
    g.fillStyle = grad;
    g.beginPath();
    trace(g, far);
    trace(g, [...crest].reverse(), false);
    g.closePath();
    g.fill();
    g.strokeStyle = rgba(L.fall.rgb, L.far * depth);
    g.lineWidth = 1;
    g.beginPath();
    trace(g, far.slice(0, Math.round(N * 0.84)));
    g.stroke();
    g.restore();

    for (let i = 0; i < N - 1; i++) {
      const u = i / (N - 1);
      // The underside deepens toward the fold, where the least light gets in.
      const deep = smooth((u - 0.12) / 0.78);
      const base = mix(L.under[0], L.under[1], deep);
      const c = mix(ground, base, Math.min(1, depth));
      const [x0, y0] = crest[i]!;
      const [x1, y1] = floor[i]!;
      const band = g.createLinearGradient(x0, y0, x1, y1);
      // Darkest just under the edge, lifted near the floor by the light the floor sends back.
      band.addColorStop(0, rgba(mix(c, L.under[1], 0.3 * Math.min(1, depth))));
      band.addColorStop(0.35, rgba(c));
      band.addColorStop(1, rgba(mix(c, ground, night ? 0.3 : 0.4)));
      g.fillStyle = g.strokeStyle = band;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(crest[i + 1]![0], crest[i + 1]![1]);
      g.lineTo(floor[i + 1]![0], floor[i + 1]![1]);
      g.lineTo(x1, y1);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // The crest: the sheet's own edge, catching the light along the whole arch.
    g.strokeStyle = rgba(L.edge, Math.min(1, 0.9 * depth));
    g.lineWidth = 1.25;
    g.lineJoin = 'round';
    g.beginPath();
    trace(g, crest);
    g.stroke();

    // ---- the leaf: where the sheet stands up it is glass ----
    const leaf = () => {
      g.beginPath();
      trace(g, rise);
      trace(g, belly, false);
      g.closePath();
    };
    const fold: P = [0.56 * w, 0.958 * h];
    const tip: P = [0.972 * w, 0.118 * h];
    g.save();
    leaf();
    g.clip();
    // The veil: glass is a little lighter than what is behind it, more so toward the tip.
    grad = g.createLinearGradient(fold[0], fold[1], tip[0], tip[1]);
    grad.addColorStop(0, rgba(L.veil[0], L.veil[1] * 0.35 * depth));
    grad.addColorStop(0.55, rgba(L.veil[0], L.veil[1] * 0.8 * depth));
    grad.addColorStop(1, rgba(L.veil[0], L.veil[1] * depth));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Paper passes into glass along the same curve: opaque at the fold, clear a third of the way up.
    grad = g.createLinearGradient(fold[0], fold[1], fold[0] + (tip[0] - fold[0]) * 0.42, fold[1] + (tip[1] - fold[1]) * 0.42);
    const sheet = mix(ground, L.top, Math.min(1, depth) * 0.8);
    grad.addColorStop(0, rgba(sheet, 1));
    grad.addColorStop(0.3, rgba(sheet, 0.82));
    grad.addColorStop(0.7, rgba(sheet, 0.26));
    grad.addColorStop(1, rgba(sheet, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Light caught inside: a soft reflection that fills the upper leaf and ends on an edge of its own, the belly's
    // inner edge, and one fine line where the far face shows through.
    g.filter = blur(10);
    grad = g.createLinearGradient(fold[0], fold[1], tip[0], tip[1]);
    grad.addColorStop(0.2, rgba(L.inner[0], 0));
    grad.addColorStop(0.6, rgba(L.inner[0], L.inner[1] * depth));
    grad.addColorStop(1, rgba(L.inner[0], L.inner[1] * 0.8 * depth));
    g.fillStyle = grad;
    const sheen = px(spline(SHEEN, 20));
    g.beginPath();
    trace(g, sheen);
    trace(g, belly.slice(0, Math.round(belly.length * 0.66)), false);
    g.closePath();
    g.fill();
    g.filter = blur(1.2);
    g.strokeStyle = rgba(L.inner[0], L.inner[1] * 1.2 * depth);
    g.lineWidth = 1;
    g.beginPath();
    trace(g, sheen.slice(4));
    g.stroke();
    g.filter = blur(4);
    g.strokeStyle = rgba(L.beside[0], L.beside[1] * 0.4 * depth);
    g.lineWidth = 2;
    g.beginPath();
    trace(g, belly.slice(3, Math.round(belly.length * 0.9)).map(([x, y]) => [x - 0.007 * w, y - 0.003 * h] as P));
    g.stroke();
    g.restore();

    // The rim: one bright line, and a fine dark one beside it so the line holds on a ground as light as itself.
    const fromGlass = rise.slice(Math.round(rise.length * 0.14));
    g.lineJoin = g.lineCap = 'round';
    g.strokeStyle = rgba(L.beside[0], L.beside[1] * depth);
    g.lineWidth = 1;
    g.beginPath();
    trace(g, fromGlass.map(([x, y]) => [x - 1.1, y - 0.5] as P));
    g.stroke();
    g.beginPath();
    trace(g, belly.map(([x, y]) => [x + 1, y + 0.6] as P));
    g.stroke();
    g.strokeStyle = rgba(L.rim[0], Math.min(1, L.rim[1] * (0.5 + 0.5 * depth)));
    g.lineWidth = 1.5;
    g.beginPath();
    trace(g, fromGlass);
    g.stroke();
    g.lineWidth = 1.1;
    g.strokeStyle = rgba(L.rim[0], Math.min(1, L.rim[1] * 0.7 * (0.5 + 0.5 * depth)));
    g.beginPath();
    trace(g, belly);
    g.stroke();
    // The glass has thickness, and it shows where the two edges meet.
    g.strokeStyle = rgba(L.rim[0], Math.min(1, L.rim[1] * (0.5 + 0.5 * depth)));
    g.lineWidth = 2.2;
    g.beginPath();
    trace(g, belly.slice(0, Math.round(belly.length * 0.1)));
    g.stroke();
    // The paper's edge runs on up the leaf until the paper is gone.
    grad = g.createLinearGradient(fold[0], fold[1], fold[0] + (tip[0] - fold[0]) * 0.3, fold[1] + (tip[1] - fold[1]) * 0.3);
    grad.addColorStop(0, rgba(L.edge, Math.min(1, 0.9 * depth)));
    grad.addColorStop(1, rgba(L.edge, 0));
    g.strokeStyle = grad;
    g.lineWidth = 1.25;
    g.beginPath();
    trace(g, rise.slice(0, Math.round(rise.length * 0.4)));
    g.stroke();
  }
}
