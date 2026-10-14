// P3-C M9 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D12 "Font variants"): the face a PPTX run names.
import { describe, expect, it } from 'vitest';
import { basicFace, faceFor, fontStack, namedFace } from './fonts';

describe('the PPTX font variants', () => {
  it('reads a computed stack, quoted or not', () => {
    expect(fontStack(`"Source Serif 4", Georgia, serif`)).toEqual(['Source Serif 4', 'Georgia', 'serif']);
    expect(fontStack(`'Brand  Sans',system-ui`)).toEqual(['Brand Sans', 'system-ui']);
  });

  it('names the stack’s first face, past generics and the system aliases', () => {
    expect(namedFace(`"Source Serif 4", Georgia, serif`)).toBe('Source Serif 4');
    expect(namedFace(`system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`)).toBe('Helvetica Neue');
    expect(namedFace('monospace')).toBe('Courier New');
    expect(namedFace('system-ui')).toBe('Arial');
  });

  it('substitutes Claude’s basic faces: the first the stack names, else its generic’s', () => {
    expect(basicFace(`"Source Serif 4", Georgia, serif`)).toBe('Georgia');
    expect(basicFace(`"Brand Sans", serif`)).toBe('Times New Roman');
    expect(basicFace(`Inter, sans-serif`)).toBe('Arial');
    expect(basicFace(`"Fira Code", monospace`)).toBe('Courier New');
    expect(basicFace(`"Caveat", cursive`)).toBe('Brush Script MT');
    expect(basicFace(`Inter`)).toBe('Arial');
    expect(basicFace(`inter, trebuchet ms, sans-serif`)).toBe('Trebuchet MS');
  });

  it('chooses by variant (embedded names as named)', () => {
    expect(faceFor('Inter, sans-serif', 'named')).toBe('Inter');
    expect(faceFor('Inter, sans-serif', 'embedded')).toBe('Inter');
    expect(faceFor('Inter, sans-serif', 'basic')).toBe('Arial');
  });
});
