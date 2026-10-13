// The exporters' view of the design system (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; X28): the
// local `resolveDsVars` keeps D's semantics, overrides win over the system, the page follows Decision Log 43, and the
// local Office theme maps the roles as D's does.
import { describe, expect, it } from 'vitest';
import { HOUSE_TOKENS, dsValue, exportDesign, hexOf, houseSystem, officeFace, officeThemeXmlLocal, pageOf, resolveDsVarsLocal, twipsOf } from './design-system';
import { isDarkGround } from './highlight';

const tokens = { properties: { '--ds-color-text': '#111111', '--ds-space-2': '8px' } } as const;

describe('resolveDsVarsLocal (D’s semantics)', () => {
  it('replaces a defined name, takes a --ds-* fallback otherwise, and leaves other custom properties', () => {
    expect(resolveDsVarsLocal('color: var(--ds-color-text, var(--fg));', tokens)).toBe('color: #111111;');
    expect(resolveDsVarsLocal('padding: var(--ds-space-9, calc(var(--ds-space-2) * 2));', tokens)).toBe('padding: calc(8px * 2);');
    expect(resolveDsVarsLocal('color: var(--ds-color-accent);', tokens)).toBe('color: var(--ds-color-accent);');
    expect(resolveDsVarsLocal('color: var(--fg, var(--ds-color-text));', tokens)).toBe('color: var(--fg, #111111);');
    expect(resolveDsVarsLocal('color: var(--ds-color-text', tokens)).toBe('color: var(--ds-color-text');
  });

  it('defines every name of the ledger’s X28 row in the house tokens', () => {
    const names = [
      ...['bg', 'bg-raised', 'text', 'text-muted', 'accent', 'accent-text', 'border', 'status-ok', 'status-warn', 'status-error', 'status-info'].map((n) => `--ds-color-${n}`),
      ...['display', 'body', 'mono'].map((n) => `--ds-font-${n}`),
      ...['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote'].flatMap((role) => ['size', 'line', 'weight'].map((p) => `--ds-type-${role}-${p}`)),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--ds-space-${n}`),
      ...['sm', 'md', 'lg', 'full'].map((n) => `--ds-radius-${n}`),
      ...['sm', 'md', 'lg'].map((n) => `--ds-shadow-${n}`),
      '--ds-page-width',
      '--ds-page-height',
      '--ds-page-margin',
    ];
    expect(names.filter((name) => !(name in HOUSE_TOKENS.properties))).toEqual([]);
  });
});

describe('the export design', () => {
  it('puts the document’s overrides over the system', () => {
    const design = exportDesign(houseSystem, { '--ds-color-text': '#0b5fff' });
    expect(design.resolveCss('a { color: var(--ds-color-text, var(--fg)); margin: var(--ds-space-2); }')).toBe('a { color: #0b5fff; margin: 8px; }');
    expect(dsValue(design, '--ds-color-text')).toBe('#0b5fff');
    expect(dsValue(design, '--ds-color-nonesuch')).toBeNull();
  });

  it('prints on the size chosen, else the system’s page, else Letter, with the system’s margin else 1in', () => {
    const house = exportDesign(houseSystem, {});
    expect(pageOf(house)).toEqual({ width: '8.5in', height: '11in', margin: '72px' });
    expect(pageOf(house, 'a4')).toEqual({ width: '210mm', height: '297mm', margin: '72px' });
    const a4System = exportDesign({ ...houseSystem, tokens: { properties: { ...HOUSE_TOKENS.properties, '--ds-page-width': '210mm', '--ds-page-height': '297mm' } } }, {});
    expect(pageOf(a4System)).toEqual({ width: '210mm', height: '297mm', margin: '72px' });
    expect(pageOf(a4System, 'letter').width).toBe('8.5in');
    const bare = exportDesign({ ...houseSystem, tokens: { properties: {} } }, {});
    expect(pageOf(bare)).toEqual({ width: '8.5in', height: '11in', margin: '1in' });
  });
});

describe('values for Office', () => {
  it('reads colours, lengths and faces', () => {
    expect(hexOf('#abc')).toBe('AABBCC');
    expect(hexOf('#C9663F80')).toBe('C9663F');
    expect(hexOf('rgb(255 0 128 / 0.5)')).toBe('FF0080');
    expect(hexOf('oklch(0.5 0.1 20)')).toBeNull();
    expect(twipsOf('8.5in')).toBe(12240);
    expect(twipsOf('210mm')).toBe(11906);
    expect(twipsOf('72px')).toBe(1080);
    expect(twipsOf('calc(1px + 2px)')).toBeNull();
    expect(officeFace('ui-monospace, "SF Mono", Menlo, monospace')).toBe('SF Mono');
    expect(officeFace('-apple-system, sans-serif')).toBe('Arial');
    expect(isDarkGround('#faf9f6')).toBe(false);
    expect(isDarkGround('#1f1e1b')).toBe(true);
  });

  it('writes the Office theme from the roles and the system’s Office fonts, Korean included', () => {
    const xml = officeThemeXmlLocal(HOUSE_TOKENS, 'MAWS & co');
    expect(xml).toContain('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="MAWS &amp; co">');
    expect(xml).toContain('<a:dk1><a:srgbClr val="1F1E1B"/></a:dk1><a:lt1><a:srgbClr val="FAF9F6"/></a:lt1>');
    expect(xml).toContain('<a:accent1><a:srgbClr val="C9663F"/></a:accent1>');
    expect(xml).toContain('<a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Malgun Gothic"/><a:cs typeface=""/></a:majorFont>');
    const derived = officeThemeXmlLocal({ properties: HOUSE_TOKENS.properties }, 'Derived');
    expect(derived).toContain('<a:minorFont><a:latin typeface="SF Pro Text"/>');
  });
});
