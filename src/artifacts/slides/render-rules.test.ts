// P3-C M9 fix wave 1 (finding 7): the rules the DOM canvas and the export page share, one copy: the embed's sandbox
// policy, the crop's region and focus, and the fit's search, which the export window receives as its source text.
import { describe, expect, it } from 'vitest';
import { cropStyle, EMBED_CSP, embedDocument, shrinkScale } from './render-rules';

describe('the rules the canvas and the export share', () => {
  it('sandboxes an embed with no network', () => {
    expect(EMBED_CSP).toBe("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:");
    expect(embedDocument('<p>x</p>')).toBe(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${EMBED_CSP}"><style>html,body{margin:0;height:100%;overflow:hidden}</style><p>x</p>`);
  });

  it('crops to 1/ZOOM of the picture about its focus, the focus also its object-position', () => {
    expect(cropStyle('2 25% 50%')).toEqual({ 'object-view-box': 'inset(25% 37.5% 25% 12.5%)', 'object-position': '25% 50%' });
    expect(cropStyle('1 0% 100%')).toEqual({ 'object-view-box': 'inset(0% 0% 0% 0%)', 'object-position': '0% 100%' });
    expect(cropStyle(undefined)).toBeNull();
    expect(cropStyle('big')).toBeNull();
  });

  it('searches the fit’s scale alone (its source evaluated where nothing else is in scope)', () => {
    const alone = new Function(`return (${String(shrinkScale)})`)() as typeof shrinkScale;
    // text that fits at 80 px or less, set at 100 px: the scale found is within 1 % of 0.8
    expect(alone(100, (px) => px > 80)).toBeCloseTo(0.8, 2);
    expect(alone(100, () => true)).toBe(0.6); // never fits: the floor, 60 %
    expect(alone(10, () => true)).toBe(0.8); // or 8 px, whichever is larger
    expect(alone(100, () => false)).toBeCloseTo(1, 2);
  });
});
