import { describe, expect, it } from 'vitest';
import { colorFromHex, colorToCss, contrastRatio, flatten, relativeLuminance, rgbToHex, toSrgb, type ColorValue } from './color';

const srgb = (r: number, g: number, b: number, alpha?: number): ColorValue => ({ colorSpace: 'srgb', components: [r, g, b], ...(alpha === undefined ? {} : { alpha }) });
const hexOf = (color: ColorValue) => rgbToHex(toSrgb(color));

describe('colour values', () => {
  it('reads #rgb, #rgba, #rrggbb and #rrggbbaa into srgb values with a six-digit hex and the alpha apart', () => {
    expect(colorFromHex('#FFF')).toEqual({ colorSpace: 'srgb', components: [1, 1, 1], hex: '#ffffff' });
    expect(colorFromHex('#c9663f')).toEqual({ colorSpace: 'srgb', components: [0.7882, 0.4, 0.2471], hex: '#c9663f' });
    expect(colorFromHex('#1f1e1b9e')).toEqual({ colorSpace: 'srgb', components: [0.1216, 0.1176, 0.1059], alpha: 0.6196, hex: '#1f1e1b' });
    expect(colorFromHex('#0008')).toEqual({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.5333, hex: '#000000' });
    expect(colorFromHex('#00000')).toBeNull();
    expect(colorFromHex('red')).toBeNull();
  });

  it('round-trips every hex through its rounded components', () => {
    for (let v = 0; v < 256; v++) {
      const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
      expect(hexOf(colorFromHex(hex)!)).toBe(hex);
    }
  });

  // The color module's own examples (designtokens.org/tr/2025.10/color §4.2): each space's hot pink is #ff00ff. Its HSL
  // and HWB examples give hue 330, which is #ff0080, not the #ff00ff fallback the example prints; the components win.
  it.each([
    ['srgb-linear', [1, 0, 1], '#ff00ff'],
    ['hsl', [330, 100, 50], '#ff0080'],
    ['hwb', [330, 0, 0], '#ff0080'],
    ['lab', [60.17, 93.54, -60.5], '#ff00ff'],
    ['lch', [60.17, 111.4, 327.11], '#ff00ff'],
    ['oklab', [0.701, 0.2746, -0.169], '#ff00ff'],
    ['oklch', [0.7016, 0.3225, 328.363], '#ff00ff'],
    ['xyz-d65', [0.5929, 0.2848, 0.9699], '#ff00ff'],
    ['xyz-d50', [0.5791, 0.2831, 0.728], '#ff00ff'],
    ['display-p3', [1, 0, 1], '#ff00ff'],
    ['a98-rgb', [1, 0, 1], '#ff00ff'],
    ['rec2020', [1, 0, 1], '#ff00ff'],
    ['prophoto-rgb', [1, 0, 1], '#ff00ff'],
  ] as const)('converts %s to sRGB (clipped to the gamut)', (colorSpace, components, hex) => {
    expect(hexOf({ colorSpace, components: [...components] })).toBe(hex);
  });

  it('treats a `none` component as zero when converting', () => {
    expect(hexOf({ colorSpace: 'hsl', components: ['none', 0, 100] })).toBe('#ffffff');
  });

  it('writes CSS: hex for srgb (alpha as a fourth pair), the space’s own function otherwise', () => {
    expect(colorToCss(srgb(0.7882, 0.4, 0.2471))).toBe('#c9663f');
    expect(colorToCss(srgb(0, 0, 0, 0.1))).toBe('#0000001a');
    expect(colorToCss({ colorSpace: 'oklch', components: [0.86, 0.12, 90] })).toBe('oklch(0.86 0.12 90)');
    expect(colorToCss({ colorSpace: 'oklch', components: [0.86, 'none', 90], alpha: 0.5 })).toBe('oklch(0.86 none 90 / 0.5)');
    expect(colorToCss({ colorSpace: 'hsl', components: [330, 100, 50] })).toBe('hsl(330 100% 50%)');
    expect(colorToCss({ colorSpace: 'hwb', components: [330, 0, 0] })).toBe('hwb(330 0% 0%)');
    expect(colorToCss({ colorSpace: 'lab', components: [60.17, 93.54, -60.5] })).toBe('lab(60.17 93.54 -60.5)');
    expect(colorToCss({ colorSpace: 'display-p3', components: [1, 0, 1] })).toBe('color(display-p3 1 0 1)');
    expect(colorToCss({ colorSpace: 'xyz-d65', components: [0.5929, 0.2848, 0.9699], alpha: 0.25 })).toBe('color(xyz-d65 0.5929 0.2848 0.9699 / 0.25)');
  });

  it('computes WCAG 2 relative luminance and contrast', () => {
    expect(relativeLuminance(srgb(1, 1, 1))).toBeCloseTo(1, 6);
    expect(relativeLuminance(srgb(0, 0, 0))).toBe(0);
    expect(contrastRatio(srgb(0, 0, 0), srgb(1, 1, 1))).toBeCloseTo(21, 6);
    expect(contrastRatio(srgb(1, 1, 1), srgb(0, 0, 0))).toBeCloseTo(21, 6); // order-free
    expect(contrastRatio(colorFromHex('#767676')!, srgb(1, 1, 1))).toBeCloseTo(4.54, 2); // the classic AA grey
  });

  it('flattens a translucent colour onto its ground, and contrast flattens the foreground first', () => {
    expect(rgbToHex(flatten(srgb(0, 0, 0, 0.5), srgb(1, 1, 1)))).toBe('#808080');
    expect(rgbToHex(flatten(srgb(1, 0, 0), srgb(0, 0, 1)))).toBe('#ff0000');
    // A translucent ground is first flattened onto white.
    expect(rgbToHex(flatten(srgb(0, 0, 0, 0), srgb(0, 0, 0, 0.5)))).toBe('#808080');
    const muted = srgb(0, 0, 0, 0.5);
    expect(contrastRatio(muted, srgb(1, 1, 1))).toBeCloseTo(contrastRatio(srgb(0.5, 0.5, 0.5), srgb(1, 1, 1)), 6);
  });
});
