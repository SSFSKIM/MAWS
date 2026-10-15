// Colour values of the token file (DTCG 2025.10's color module, designtokens.org/tr/2025.10/color): to CSS, to sRGB,
// WCAG 2 luminance and contrast, and alpha flattening onto a ground. The conversions follow CSS Color 4's sample code
// (each space to XYZ, then to linear sRGB); out-of-gamut results are clipped per channel, which is enough for contrast
// checks and Office's sRGB slots. Portable (§4.10): no DOM, no Node.

export const COLOR_SPACES = [
  'srgb', 'srgb-linear', 'hsl', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020', 'xyz-d65', 'xyz-d50',
] as const;
export type ColorSpace = (typeof COLOR_SPACES)[number];

/** A DTCG colour value: `components` per the space's table, `alpha` 0 to 1 (absent is opaque), `hex` a 6-digit fallback. */
export interface ColorValue {
  colorSpace: ColorSpace;
  components: readonly (number | 'none')[];
  alpha?: number;
  hex?: string;
}

/** Gamma-encoded sRGB, each channel 0 to 1, with the colour's alpha. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

/** Rounds to four decimals, the precision MAWS writes components at (a hex survives the round trip at it). */
export const round4 = (n: number): number => {
  const rounded = Math.round(n * 1e4) / 1e4;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` as an srgb value with a 6-digit hex; null for anything else. */
export function colorFromHex(text: string): ColorValue | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text.trim());
  if (!match) return null;
  let digits = match[1]!.toLowerCase();
  if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('');
  const byte = (i: number) => parseInt(digits.slice(i, i + 2), 16);
  const value: ColorValue = { colorSpace: 'srgb', components: [0, 2, 4].map((i) => round4(byte(i) / 255)) };
  if (digits.length === 8) value.alpha = round4(byte(6) / 255);
  value.hex = `#${digits.slice(0, 6)}`;
  return value;
}

const byteHex = (channel: number) =>
  Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0');

/** `#rrggbb`, or `#rrggbbaa` when asked and the colour is translucent. */
export function rgbToHex(rgb: Rgb, withAlpha = false): string {
  const hex = `#${byteHex(rgb.r)}${byteHex(rgb.g)}${byteHex(rgb.b)}`;
  return withAlpha && rgb.alpha < 1 ? hex + byteHex(rgb.alpha) : hex;
}

const num = (n: number | 'none') => (n === 'none' ? 'none' : String(round4(n)));
const pct = (n: number | 'none') => (n === 'none' ? 'none' : `${round4(n)}%`);
const FUNCTIONS: Partial<Record<ColorSpace, (c: readonly (number | 'none')[]) => string>> = {
  hsl: (c) => `hsl(${num(c[0]!)} ${pct(c[1]!)} ${pct(c[2]!)}`,
  hwb: (c) => `hwb(${num(c[0]!)} ${pct(c[1]!)} ${pct(c[2]!)}`,
  lab: (c) => `lab(${c.map(num).join(' ')}`,
  lch: (c) => `lch(${c.map(num).join(' ')}`,
  oklab: (c) => `oklab(${c.map(num).join(' ')}`,
  oklch: (c) => `oklch(${c.map(num).join(' ')}`,
};

/** The colour in CSS: hex for srgb, the space's own function (or `color()`) otherwise. */
export function colorToCss(color: ColorValue): string {
  if (color.colorSpace === 'srgb') return rgbToHex(toSrgb(color), true);
  const alpha = color.alpha !== undefined && color.alpha < 1 ? ` / ${round4(color.alpha)}` : '';
  const fn = FUNCTIONS[color.colorSpace];
  return fn ? `${fn(color.components)}${alpha})` : `color(${color.colorSpace} ${color.components.map(num).join(' ')}${alpha})`;
}

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];
const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// CSS Color 4, §18 (sample code for colour conversions).
const XYZ_D65_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const LIN_P3_TO_XYZ: Mat3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const LIN_A98_TO_XYZ: Mat3 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.0752914584939978],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
const LIN_PROPHOTO_TO_XYZ_D50: Mat3 = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];
const LIN_REC2020_TO_XYZ: Mat3 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

const signed = (fn: (x: number) => number) => (x: number) => Math.sign(x) * fn(Math.abs(x));
const srgbDecode = signed((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
const srgbEncode = signed((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));
const a98Decode = signed((x) => x ** (563 / 256));
const prophotoDecode = signed((x) => (x <= 16 / 512 ? x / 16 : x ** 1.8));
const REC_A = 1.09929682680944;
const REC_B = 0.018053968510807;
const rec2020Decode = signed((x) => (x < REC_B * 4.5 ? x / 4.5 : ((x + REC_A - 1) / REC_A) ** (1 / 0.45)));

function hslToSrgb([h, s, l]: Vec3): Vec3 {
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hwbToSrgb([h, w, b]: Vec3): Vec3 {
  w /= 100;
  b /= 100;
  if (w + b >= 1) {
    const grey = w / (w + b);
    return [grey, grey, grey];
  }
  return hslToSrgb([h, 100, 50]).map((c) => c * (1 - w - b) + w) as Vec3;
}

function labToXyzD50([l, a, b]: Vec3): Vec3 {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const xyz: Vec3 = [
    f0 ** 3 > epsilon ? f0 ** 3 : (116 * f0 - 16) / kappa,
    l > kappa * epsilon ? f1 ** 3 : l / kappa,
    f2 ** 3 > epsilon ? f2 ** 3 : (116 * f2 - 16) / kappa,
  ];
  return xyz.map((v, i) => v * D50_WHITE[i]!) as Vec3;
}

const polar = ([l, c, h]: Vec3): Vec3 => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

// Björn Ottosson's OKLab to linear sRGB.
function oklabToLinSrgb([l, a, b]: Vec3): Vec3 {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const xyzD65ToLin = (xyz: Vec3) => mul(XYZ_D65_TO_LIN_SRGB, xyz);
const xyzD50ToLin = (xyz: Vec3) => xyzD65ToLin(mul(D50_TO_D65, xyz));

/** Linear-light sRGB (unclipped) of any DTCG colour. `none` components count as zero. */
function toLinearSrgb(color: ColorValue): Vec3 {
  const c = [0, 1, 2].map((i) => {
    const v = color.components[i];
    return typeof v === 'number' ? v : 0;
  }) as Vec3;
  switch (color.colorSpace) {
    case 'srgb':
      return c.map(srgbDecode) as Vec3;
    case 'srgb-linear':
      return c;
    case 'hsl':
      return hslToSrgb(c).map(srgbDecode) as Vec3;
    case 'hwb':
      return hwbToSrgb(c).map(srgbDecode) as Vec3;
    case 'lab':
      return xyzD50ToLin(labToXyzD50(c));
    case 'lch':
      return xyzD50ToLin(labToXyzD50(polar(c)));
    case 'oklab':
      return oklabToLinSrgb(c);
    case 'oklch':
      return oklabToLinSrgb(polar(c));
    case 'display-p3':
      return xyzD65ToLin(mul(LIN_P3_TO_XYZ, c.map(srgbDecode) as Vec3));
    case 'a98-rgb':
      return xyzD65ToLin(mul(LIN_A98_TO_XYZ, c.map(a98Decode) as Vec3));
    case 'prophoto-rgb':
      return xyzD50ToLin(mul(LIN_PROPHOTO_TO_XYZ_D50, c.map(prophotoDecode) as Vec3));
    case 'rec2020':
      return xyzD65ToLin(mul(LIN_REC2020_TO_XYZ, c.map(rec2020Decode) as Vec3));
    case 'xyz-d65':
      return xyzD65ToLin(c);
    case 'xyz-d50':
      return xyzD50ToLin(c);
  }
}

const clip = (x: number) => Math.min(1, Math.max(0, x));

/** The colour in gamma-encoded sRGB, clipped to the gamut. */
export function toSrgb(color: ColorValue): Rgb {
  const [r, g, b] = color.colorSpace === 'srgb' ? (color.components.map((v) => (typeof v === 'number' ? v : 0)) as Vec3) : toLinearSrgb(color).map(srgbEncode);
  return { r: clip(r), g: clip(g), b: clip(b), alpha: color.alpha ?? 1 };
}

const asRgb = (color: ColorValue | Rgb): Rgb => ('colorSpace' in color ? toSrgb(color) : color);
const WHITE: Rgb = { r: 1, g: 1, b: 1, alpha: 1 };

/** `color` composited over `ground` (itself first composited over white), opaque. */
export function flatten(color: ColorValue | Rgb, ground: ColorValue | Rgb): Rgb {
  const top = asRgb(color);
  let base = asRgb(ground);
  if (base.alpha < 1) base = flatten(base, WHITE);
  const mix = (a: number, b: number) => a * top.alpha + b * (1 - top.alpha);
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), alpha: 1 };
}

/** WCAG 2 relative luminance of the colour's (clipped) sRGB, alpha ignored. */
export function relativeLuminance(color: ColorValue | Rgb): number {
  const { r, g, b } = asRgb(color);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2 contrast ratio (1 to 21) of a foreground over a ground; a translucent foreground is flattened first. */
export function contrastRatio(foreground: ColorValue | Rgb, ground: ColorValue | Rgb): number {
  const base = flatten(ground, WHITE);
  const a = relativeLuminance(flatten(foreground, base));
  const b = relativeLuminance(base);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
