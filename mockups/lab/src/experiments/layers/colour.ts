// The Colour switch. In Layers colour does three jobs: the field the glass stands on, the tint that glass and its
// shadows pick up from it, and the one mark that means "this session needs you". A colouring settles all three
// together, for both schemes; nothing else in the experiment names a hue. Values and their reasons: DESIGN.md §12.
//
// Fields are authored in OKLCH (lightness, chroma, hue), because the two things a field has to hold are stated in
// those terms: how light the ground under prose stays, and how deep the ground under dark glass stays.
import type { Scheme } from '../../lab/types';

export interface Mass {
  x: number; // centre, as a share of the width
  y: number; // centre, as a share of the height
  r: number; // radius, as a share of the longer side
  rgb: [number, number, number];
  a: number; // alpha at the centre at full strength
}

export interface Field {
  masses: Mass[];
  /** The contour lines' ink, as `r,g,b`, and their alpha at full strength. */
  line: [string, number];
  /** A field that is a picture and not a set of masses names its painter; `masses` and `line` are then unused. */
  picture?: 'paper';
  /** For a picture: the same forms under low light. */
  night?: boolean;
}

export interface Tokens {
  /** The page's ink, as `r g b`. Every fill and hairline is this ink at an alpha. */
  ink: string;
  /** The tint under the CSS shadows, as `r g b`: a shadow takes the colour of the room it falls in. */
  shade: string;
  /** "It is your move": the fill (the capsule's seed, Approve, send), and the ink on it. */
  accent: string;
  onAccent: string;
  /** The same meaning as a 15 px stroke on the pane, deepened or lifted until it holds 3:1 there. */
  mark: string;
  /** Keyboard focus. The accent, unless the accent is too pale to ring a white surface. */
  focus: string;
}

export interface Colouring {
  id: string;
  /**
   * How a waiting row says so. `stroke`: Quiet's glyph, drawn in the mark colour. `badge`: the same glyph reversed
   * out of a small disc of the accent, for an accent that cannot be a 15 px stroke: the ink itself, which would be
   * one more grey mark among the row's own.
   */
  mark: 'stroke' | 'badge';
  /** A colouring that is about its ground names it; the Ground knob is then not consulted. */
  ground?: Record<Scheme, string>;
  field: Record<Scheme, Field>;
  tokens: Record<Scheme, Tokens>;
}

// ---- OKLCH to sRGB, with chroma given up until the colour is in gamut -------------------------------------------

const enc = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
};

export function oklch(L: number, C: number, H: number): [number, number, number] {
  let c = C;
  for (let i = 0; i < 80; i++) {
    const a = c * Math.cos((H * Math.PI) / 180);
    const b = c * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    if ((Math.min(r, g, bl) >= -1e-4 && Math.max(r, g, bl) <= 1 + 1e-4) || i === 79) return [enc(r), enc(g), enc(bl)];
    c *= 0.97;
  }
  return [0, 0, 0];
}
const css = (L: number, C: number, H: number) => `rgb(${oklch(L, C, H).join(' ')})`;

// ---- the field's geometry ----------------------------------------------------------------------------------------

// Field's composition, kept for every colouring that fills the room: seven masses at the edges, read top to bottom
// down the pane's column (0 to 3), answered at the right edge where the modules stand (4, 5) and under the composer
// (6); then four wider ones across the main space at about a third of the edge level, because prose is read there.
const EDGE: [number, number, number][] = [
  [0.03, -0.04, 0.36],
  [0.2, 0.3, 0.22],
  [-0.02, 0.62, 0.32],
  [0.16, 1.06, 0.34],
  [1.02, -0.06, 0.36],
  [0.98, 1.08, 0.34],
  [0.55, 1.1, 0.3],
];
const MAIN: [number, number, number][] = [
  [0.46, 0.02, 0.46],
  [0.74, 0.5, 0.4],
  [0.5, 0.98, 0.36],
  [0.34, 0.6, 0.3],
];

/** One mass's colour: lightness, chroma, hue, and alpha at the centre at full strength. */
type Stop = [L: number, C: number, H: number, a: number];
/** A mass with its own place: x, y, r, then the colour. */
type Placed = [x: number, y: number, r: number, L: number, C: number, H: number, a: number];

const room = (edge: Stop[], main: Stop[]): Mass[] =>
  [...edge.map((s, i) => [EDGE[i]!, s] as const), ...main.map((s, i) => [MAIN[i]!, s] as const)].map(([[x, y, r], [L, C, H, a]]) => ({ x, y, r, rgb: oklch(L, C, H), a }));
const placed = (list: Placed[]): Mass[] => list.map(([x, y, r, L, C, H, a]) => ({ x, y, r, rgb: oklch(L, C, H), a }));
const raw = (edge: [[number, number, number], number][], main: [[number, number, number], number][]): Mass[] =>
  [...edge.map((s, i) => [EDGE[i]!, s] as const), ...main.map((s, i) => [MAIN[i]!, s] as const)].map(([[x, y, r], [rgb, a]]) => ({ x, y, r, rgb, a }));

const WARM_LINE = { light: ['60,30,0', 0.055], dark: ['255,235,215', 0.05] } as const;
const WARM_INK = { light: '31 27 22', dark: '241 237 232' } as const;

// ---- the colourings ----------------------------------------------------------------------------------------------

const paper: Colouring = {
  id: 'paper',
  mark: 'badge',
  // The owner's picture: a matte ivory, a shade deeper and greyer than the app's #faf9f5, so that glass, which is
  // nearly white at this size, is the lighter thing. Dark is the same room with the lamp low.
  ground: { light: '#e8e1db', dark: '#181614' },
  field: {
    light: { masses: [], line: ['0,0,0', 0], picture: 'paper' },
    dark: { masses: [], line: ['0,0,0', 0], picture: 'paper', night: true },
  },
  tokens: {
    // Four materials and no hue: paper, glass, shadow, ink. What stands out on paper is ink, so the mark is ink.
    light: { ink: '33 30 27', shade: '84 62 42', accent: 'rgb(33 30 27)', onAccent: '#f4f0eb', mark: 'rgb(33 30 27)', focus: 'rgb(33 30 27)' },
    // At night the ink is the colour the paper was.
    dark: { ink: '232 225 219', shade: '0 0 0', accent: 'rgb(232 225 219)', onAccent: '#1c1a17', mark: 'rgb(232 225 219)', focus: 'rgb(232 225 219)' },
  },
};

const orange: Colouring = {
  id: 'orange',
  mark: 'stroke',
  field: {
    // Field's dusk, unchanged: amber, the theme orange, coral, plum.
    light: {
      masses: raw(
        [[[255, 181, 92], 0.95], [[253, 120, 15], 0.5], [[250, 116, 112], 0.66], [[188, 118, 178], 0.5], [[255, 190, 120], 0.6], [[236, 128, 150], 0.42], [[255, 176, 110], 0.35]],
        [[[255, 200, 138], 0.36], [[252, 164, 128], 0.3], [[253, 138, 60], 0.34], [[244, 150, 150], 0.2]],
      ),
      line: [...WARM_LINE.light],
    },
    dark: {
      masses: raw(
        [[[253, 132, 30], 0.62], [[240, 84, 20], 0.3], [[206, 44, 84], 0.5], [[128, 52, 138], 0.5], [[253, 120, 15], 0.36], [[150, 46, 110], 0.34], [[220, 70, 40], 0.22]],
        [[[200, 96, 30], 0.17], [[170, 60, 60], 0.13], [[236, 100, 24], 0.24], [[150, 50, 96], 0.1]],
      ),
      line: [...WARM_LINE.dark],
    },
  },
  tokens: {
    light: { ink: WARM_INK.light, shade: '90 45 0', accent: '#fd780f', onAccent: '#2a1300', mark: '#c84c00', focus: '#fd780f' },
    dark: { ink: WARM_INK.dark, shade: '0 0 0', accent: '#fd780f', onAccent: '#2a1300', mark: '#fd780f', focus: '#fd780f' },
  },
};

const peach: Colouring = {
  id: 'peach',
  mark: 'stroke',
  field: {
    light: {
      masses: room(
        [[0.88, 0.075, 70, 0.95], [0.82, 0.09, 52, 0.5], [0.82, 0.085, 25, 0.6], [0.78, 0.06, 335, 0.5], [0.89, 0.06, 68, 0.6], [0.82, 0.07, 10, 0.42], [0.87, 0.065, 60, 0.35]],
        [[0.9, 0.05, 70, 0.36], [0.86, 0.055, 45, 0.3], [0.84, 0.075, 52, 0.3], [0.85, 0.055, 20, 0.2]],
      ),
      line: [...WARM_LINE.light],
    },
    dark: {
      masses: room(
        [[0.66, 0.12, 62, 0.6], [0.58, 0.13, 45, 0.3], [0.5, 0.13, 20, 0.5], [0.42, 0.1, 332, 0.5], [0.62, 0.12, 55, 0.36], [0.44, 0.1, 350, 0.34], [0.55, 0.12, 38, 0.22]],
        [[0.54, 0.09, 55, 0.17], [0.46, 0.09, 25, 0.13], [0.57, 0.11, 48, 0.22], [0.42, 0.08, 355, 0.1]],
      ),
      line: [...WARM_LINE.dark],
    },
  },
  tokens: {
    light: { ink: WARM_INK.light, shade: '90 50 20', accent: css(0.8, 0.11, 58), onAccent: '#2a1605', mark: css(0.56, 0.12, 55), focus: css(0.6, 0.125, 56) },
    dark: { ink: WARM_INK.dark, shade: '0 0 0', accent: css(0.8, 0.11, 58), onAccent: '#2a1605', mark: css(0.8, 0.11, 58), focus: css(0.8, 0.11, 58) },
  },
};

const honey: Colouring = {
  id: 'honey',
  mark: 'stroke',
  field: {
    light: {
      masses: room(
        [[0.92, 0.09, 88, 0.95], [0.86, 0.12, 80, 0.5], [0.84, 0.1, 66, 0.6], [0.78, 0.05, 40, 0.5], [0.92, 0.075, 86, 0.6], [0.84, 0.06, 55, 0.42], [0.88, 0.09, 76, 0.35]],
        [[0.93, 0.06, 88, 0.36], [0.89, 0.07, 76, 0.3], [0.86, 0.1, 78, 0.3], [0.87, 0.06, 62, 0.2]],
      ),
      line: ['70,45,0', 0.055],
    },
    dark: {
      masses: room(
        [[0.68, 0.13, 74, 0.6], [0.6, 0.13, 66, 0.3], [0.5, 0.12, 52, 0.5], [0.38, 0.07, 30, 0.5], [0.64, 0.12, 72, 0.36], [0.42, 0.08, 40, 0.34], [0.56, 0.12, 62, 0.22]],
        [[0.56, 0.09, 72, 0.17], [0.46, 0.08, 55, 0.13], [0.6, 0.12, 68, 0.22], [0.42, 0.06, 40, 0.1]],
      ),
      line: ['255,240,205', 0.05],
    },
  },
  tokens: {
    light: { ink: WARM_INK.light, shade: '90 60 0', accent: css(0.83, 0.16, 84), onAccent: '#271b00', mark: css(0.55, 0.115, 78), focus: css(0.6, 0.12, 78) },
    dark: { ink: WARM_INK.dark, shade: '0 0 0', accent: css(0.83, 0.16, 84), onAccent: '#271b00', mark: css(0.83, 0.16, 84), focus: css(0.83, 0.16, 84) },
  },
};

const rose: Colouring = {
  id: 'rose',
  mark: 'stroke',
  field: {
    light: {
      masses: room(
        [[0.86, 0.09, 35, 0.95], [0.76, 0.15, 8, 0.45], [0.74, 0.13, 350, 0.6], [0.66, 0.11, 315, 0.5], [0.87, 0.075, 25, 0.6], [0.74, 0.11, 335, 0.42], [0.84, 0.09, 15, 0.35]],
        [[0.9, 0.055, 30, 0.36], [0.84, 0.08, 10, 0.3], [0.8, 0.11, 5, 0.3], [0.82, 0.08, 340, 0.2]],
      ),
      line: ['70,10,30', 0.055],
    },
    dark: {
      masses: room(
        [[0.62, 0.17, 15, 0.6], [0.52, 0.18, 5, 0.3], [0.46, 0.16, 350, 0.5], [0.38, 0.13, 315, 0.5], [0.58, 0.16, 12, 0.36], [0.4, 0.13, 330, 0.34], [0.5, 0.16, 8, 0.22]],
        [[0.5, 0.12, 12, 0.17], [0.42, 0.12, 355, 0.13], [0.52, 0.15, 8, 0.22], [0.38, 0.11, 330, 0.1]],
      ),
      line: ['255,225,232', 0.05],
    },
  },
  tokens: {
    light: { ink: '31 25 26', shade: '90 20 45', accent: css(0.56, 0.2, 5), onAccent: '#ffffff', mark: css(0.54, 0.2, 5), focus: css(0.56, 0.2, 5) },
    dark: { ink: '242 236 237', shade: '0 0 0', accent: css(0.74, 0.15, 5), onAccent: '#2b0614', mark: css(0.76, 0.14, 5), focus: css(0.74, 0.15, 5) },
  },
};

const bluehour: Colouring = {
  id: 'bluehour',
  mark: 'stroke',
  field: {
    light: {
      masses: room(
        [[0.86, 0.075, 240, 0.95], [0.76, 0.12, 265, 0.5], [0.74, 0.12, 285, 0.6], [0.72, 0.1, 315, 0.5], [0.88, 0.06, 230, 0.6], [0.76, 0.1, 300, 0.42], [0.84, 0.07, 340, 0.35]],
        [[0.91, 0.045, 245, 0.36], [0.86, 0.06, 270, 0.3], [0.84, 0.07, 300, 0.3], [0.85, 0.06, 280, 0.2]],
      ),
      line: ['10,25,80', 0.05],
    },
    dark: {
      masses: room(
        [[0.52, 0.15, 250, 0.6], [0.46, 0.17, 268, 0.3], [0.42, 0.17, 285, 0.5], [0.36, 0.13, 315, 0.5], [0.5, 0.13, 240, 0.36], [0.38, 0.13, 300, 0.34], [0.44, 0.12, 330, 0.22]],
        [[0.45, 0.11, 255, 0.17], [0.4, 0.12, 275, 0.13], [0.42, 0.13, 295, 0.22], [0.36, 0.1, 310, 0.1]],
      ),
      line: ['215,225,255', 0.05],
    },
  },
  tokens: {
    light: { ink: '22 25 34', shade: '30 40 95', accent: css(0.8, 0.16, 74), onAccent: '#291a00', mark: css(0.55, 0.125, 68), focus: css(0.6, 0.13, 70) },
    dark: { ink: '234 237 244', shade: '0 0 0', accent: css(0.8, 0.16, 74), onAccent: '#291a00', mark: css(0.82, 0.15, 76), focus: css(0.8, 0.16, 74) },
  },
};

const opal: Colouring = {
  id: 'opal',
  mark: 'badge',
  field: {
    light: {
      masses: room(
        [[0.88, 0.09, 60, 0.95], [0.8, 0.11, 8, 0.5], [0.78, 0.1, 305, 0.6], [0.8, 0.09, 240, 0.5], [0.88, 0.07, 185, 0.6], [0.8, 0.09, 275, 0.42], [0.86, 0.08, 35, 0.35]],
        [[0.92, 0.045, 80, 0.3], [0.88, 0.05, 200, 0.28], [0.86, 0.06, 330, 0.26], [0.87, 0.05, 280, 0.2]],
      ),
      line: ['40,20,60', 0.05],
    },
    dark: {
      masses: room(
        [[0.6, 0.14, 50, 0.55], [0.5, 0.17, 5, 0.3], [0.42, 0.16, 305, 0.5], [0.42, 0.13, 245, 0.5], [0.5, 0.1, 190, 0.36], [0.4, 0.14, 275, 0.34], [0.48, 0.14, 20, 0.22]],
        [[0.45, 0.08, 80, 0.12], [0.42, 0.08, 200, 0.14], [0.42, 0.12, 330, 0.16], [0.38, 0.1, 280, 0.1]],
      ),
      line: ['240,230,255', 0.05],
    },
  },
  tokens: {
    light: { ink: '27 26 30', shade: '50 35 80', accent: 'rgb(27 26 30)', onAccent: '#ffffff', mark: 'rgb(27 26 30)', focus: 'rgb(27 26 30)' },
    dark: { ink: '240 238 242', shade: '0 0 0', accent: 'rgb(240 238 242)', onAccent: '#17161a', mark: 'rgb(240 238 242)', focus: 'rgb(240 238 242)' },
  },
};

const cobalt: Colouring = {
  id: 'cobalt',
  mark: 'stroke',
  ground: { light: '#ffffff', dark: '#000000' },
  field: {
    light: {
      masses: placed([
        [0.02, -0.02, 0.3, 0.8, 0.11, 258, 0.9],
        [0.12, 0.42, 0.2, 0.66, 0.19, 264, 0.4],
        [-0.02, 0.78, 0.28, 0.72, 0.15, 272, 0.55],
        [0.1, 1.08, 0.26, 0.78, 0.11, 250, 0.5],
        [1.02, 0.1, 0.26, 0.84, 0.08, 255, 0.5],
        [0.98, 1.05, 0.26, 0.78, 0.1, 268, 0.4],
        [0.5, 1.12, 0.22, 0.78, 0.12, 262, 0.45],
        [0.45, -0.1, 0.2, 0.86, 0.07, 258, 0.4],
      ]),
      line: ['0,20,110', 0.05],
    },
    dark: {
      masses: placed([
        [0.1, 0.5, 0.5, 1, 0, 0, 0.05],
        [0.92, 0.5, 0.5, 1, 0, 0, 0.045],
        [0.02, -0.02, 0.3, 0.5, 0.2, 262, 0.7],
        [0.12, 0.42, 0.2, 0.42, 0.22, 266, 0.4],
        [-0.02, 0.78, 0.28, 0.4, 0.2, 275, 0.55],
        [0.1, 1.08, 0.26, 0.46, 0.16, 250, 0.5],
        [1.02, 0.1, 0.26, 0.45, 0.15, 255, 0.4],
        [0.98, 1.05, 0.26, 0.4, 0.16, 268, 0.34],
        [0.5, 1.12, 0.22, 0.45, 0.18, 262, 0.4],
      ]),
      line: ['200,215,255', 0.06],
    },
  },
  tokens: {
    light: { ink: '12 13 17', shade: '10 30 110', accent: css(0.5, 0.23, 264), onAccent: '#ffffff', mark: css(0.5, 0.23, 264), focus: css(0.5, 0.23, 264) },
    dark: { ink: '243 244 247', shade: '0 0 0', accent: css(0.55, 0.22, 264), onAccent: '#ffffff', mark: css(0.74, 0.14, 260), focus: css(0.7, 0.16, 260) },
  },
};

export const COLOURINGS: Record<string, Colouring> = { paper, peach, honey, rose, bluehour, opal, cobalt, orange };
export const DEFAULT_COLOUR = 'paper';
export const colouringOf = (id: string | undefined): Colouring => COLOURINGS[id ?? ''] ?? COLOURINGS[DEFAULT_COLOUR]!;
