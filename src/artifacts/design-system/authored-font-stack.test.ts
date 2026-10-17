// P3-E (E2 M5 correction; P3-E Decision Log 37): `authoredFontStack`, a family stack as the system authored it. A scope
// declares a system's uploaded faces under private names (`fontFaces` aliased) and puts each before its authored name
// in the scope's family values; a figure written for a file names the authored families only, so the editor's figure
// and an export's are one figure. The inverse of the scope's aliasing, over D's own stack reader and writer.
import { describe, expect, it } from 'vitest';
import { defaultSystem } from '../types/design_system/defaults';
import { authoredFontStack, fontFaces } from './assets';
import { DOCUMENT_CSS_PATH } from './canon';
import { fontFamilyCss } from './css';
import { parseTokens } from './tokens';

const official = defaultSystem('official')!;
const tokens = parseTokens(official.files['tokens.tokens.json']!).tokens!;
const BODY = ['Charter', 'Noto Serif KR', 'Cambria', 'Batang', 'serif'];

describe('authoredFontStack', () => {
  it('drops the scope’s private names of a system’s uploaded faces, keeping every authored family in order', () => {
    const { aliases } = fontFaces(official.files[DOCUMENT_CSS_PATH], tokens, (ref) => `maws-artifact://sys/3/${ref}`, { aliased: true });
    expect(aliases.size).toBeGreaterThan(0);
    const scoped = fontFamilyCss(BODY, aliases);
    expect(scoped).toMatch(/^Charter, ds-face-[0-9a-z]+, "Noto Serif KR", Cambria, Batang, serif$/);
    expect(authoredFontStack(scoped)).toBe(fontFamilyCss(BODY));
  });

  it('writes a stack once canonically: an authored one as it is, a single-quoted one as the scope’s writer does', () => {
    const house = '"SF Pro Text", "Apple SD Gothic Neo", -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';
    expect(authoredFontStack(house)).toBe(house);
    expect(authoredFontStack(fontFamilyCss(BODY))).toBe(fontFamilyCss(BODY));
    expect(authoredFontStack("'Noto Serif KR', serif")).toBe('"Noto Serif KR", serif');
  });

  it('keeps what it cannot read as a stack as it is', () => {
    expect(authoredFontStack('')).toBe('');
    expect(authoredFontStack('var(--brand-face), serif')).toBe('var(--brand-face), serif');
  });
});
