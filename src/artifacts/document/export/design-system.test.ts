// The exporters' view of the design system (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; X28): the
// local `resolveDsVars` keeps D's semantics, overrides win over the system, the page follows Decision Log 43, and the
// local Office theme maps the roles as D's does.
import { describe, expect, it } from 'vitest';
import { officeThemeXml } from '../../design-system/office';
import { resolveDsVars } from '../../design-system/resolve-vars';
import type { TokenSet } from '../../design-system/tokens';
import { builtinView } from '../../design-system/view';
import { COMPACT, HOUSE_TOKENS, dsValue, exportDesign, hexOf, houseSystem, officeFace, officeThemeXmlLocal, pageOf, resolveDsVarsLocal, twipsOf, type DesignSystemExport, type DsName, type LocalTokens } from './design-system';
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
    expect(xml).toContain('<a:hlink><a:srgbClr val="1F1E1B"/></a:hlink>'); // a link is the text's colour (P3-F, F18)
    expect(xml).toContain('<a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Malgun Gothic"/><a:cs typeface=""/></a:majorFont>');
    const derived = officeThemeXmlLocal({ properties: HOUSE_TOKENS.properties }, 'Derived');
    expect(derived).toContain('<a:minorFont><a:latin typeface="SF Pro Text"/>');
  });

  // X28 as D's M6 took B's request: `officeThemeXml(tokens, name, overrides?)`, so a document's `dsOverrides` reach the
  // Word theme part: a colour or a font stack replaces its role's slots; anything else (a `var()`, a gradient) is left
  // to the styles; a slot the system wrote as a literal (its Office fonts) stays.
  it('puts a document’s colour and font overrides on the roles’ Office slots', () => {
    const xml = officeThemeXmlLocal({ properties: HOUSE_TOKENS.properties }, 'Doc', {
      '--ds-color-accent': '#0b5fff',
      '--ds-color-text': 'rgb(17 34 51)',
      '--ds-color-bg': 'linear-gradient(red, blue)',
      '--ds-font-body': '"Iowan Old Style", Georgia, serif',
      '--ds-font-display': 'var(--elsewhere)',
    });
    expect(xml).toContain('<a:accent1><a:srgbClr val="0B5FFF"/></a:accent1>');
    expect(xml).toContain('<a:hlink><a:srgbClr val="112233"/></a:hlink>'); // the text role's, not the accent's (P3-F, F18)
    expect(xml).toContain('<a:dk1><a:srgbClr val="112233"/></a:dk1>');
    expect(xml).toContain('<a:lt1><a:srgbClr val="FAF9F6"/></a:lt1>'); // the gradient is not a colour: the system's stays
    expect(xml).toContain('<a:minorFont><a:latin typeface="Iowan Old Style"/>');
    expect(xml).toContain('<a:majorFont><a:latin typeface="SF Pro Display"/>'); // a var() is not a face
    const literal = officeThemeXmlLocal(HOUSE_TOKENS, 'Doc', { '--ds-font-body': 'Georgia, serif' });
    expect(literal).toContain('<a:minorFont><a:latin typeface="Segoe UI"/>'); // the system's own Office font stays
  });

  it('hands the document’s overrides to the system’s helpers (D’s signatures), not a pre-resolved text', () => {
    const calls: unknown[] = [];
    const design = exportDesign(
      {
        ...houseSystem,
        resolveDsVars: (css, tokens, medium, overrides) => (calls.push(['css', medium, overrides]), houseSystem.resolveDsVars(css, tokens, medium, overrides)),
        officeThemeXml: (tokens, name, overrides) => (calls.push(['theme', name, overrides]), houseSystem.officeThemeXml(tokens, name, overrides)),
      },
      { '--ds-color-accent': '#0b5fff' },
    );
    expect(design.resolveCss('a { color: var(--ds-color-accent); }')).toBe('a { color: #0b5fff; }');
    expect(design.officeThemeXml()).toContain('<a:accent1><a:srgbClr val="0B5FFF"/></a:accent1>');
    expect(calls).toEqual([
      ['css', 'document', { '--ds-color-accent': '#0b5fff' }],
      ['theme', 'MAWS', { '--ds-color-accent': '#0b5fff' }],
    ]);
  });
});

// UX wave U10b (l6-artifacts-07 (b), M2 decision 4; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md §B.4): Compact
// is computed from the governing system's own values, beneath the document's overrides, each number in its own unit
describe('the export design at compact density', () => {
  const sizes = (design: ReturnType<typeof exportDesign>, names: DsName[]) => names.map((name) => dsValue(design, name));
  const systemOf = (properties: Record<DsName, string>): DesignSystemExport<LocalTokens> => ({ ...houseSystem, tokens: { properties: { ...HOUSE_TOKENS.properties, ...properties } } });
  const TYPE = ['title', 'subtitle', 'h1', 'h2', 'h3', 'body', 'caption', 'quote'].map((role) => `--ds-type-${role}-size` as DsName);
  const SPACE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `--ds-space-${n}` as DsName);

  it('holds the three numbers the owner chose in one place', () => {
    expect(COMPACT).toEqual({ type: 0.9, space: 0.75, margin: '0.75in' });
  });

  it('scales the eight type sizes by 0.9 and the eight spaces by 0.75, rounded to two decimals; the rest stays the system’s', () => {
    const compact = exportDesign(houseSystem, {}, 'compact');
    expect(sizes(compact, TYPE)).toEqual(['30.6px', '17.1px', '23.4px', '18.9px', '15.3px', '14.4px', '11.7px', '15.3px']);
    expect(sizes(compact, SPACE)).toEqual(['3px', '6px', '9px', '12px', '18px', '24px', '36px', '48px']);
    expect(sizes(compact, ['--ds-type-body-line', '--ds-type-h1-weight', '--ds-color-text', '--ds-radius-md', '--ds-page-margin'])).toEqual(['1.7', '700', '#1f1e1b', '10px', '72px']);
    expect(sizes(exportDesign(houseSystem, {}), ['--ds-type-body-size', '--ds-space-3'])).toEqual(['16px', '12px']);
  });

  it('keeps each value’s unit: a rem token is scaled in rem, a value it cannot read is left as the system wrote it', () => {
    const compact = exportDesign(systemOf({ '--ds-type-body-size': '1.125rem', '--ds-space-2': '0.5rem', '--ds-space-4': '1.5em', '--ds-type-title-size': 'clamp(28px, 4vw, 40px)' }), {}, 'compact');
    expect(sizes(compact, ['--ds-type-body-size', '--ds-space-2', '--ds-space-4', '--ds-type-title-size'])).toEqual(['1.01rem', '0.38rem', '1.13em', 'clamp(28px, 4vw, 40px)']);
  });

  it('lets the document’s own override of a size win over compact’s value for that token alone', () => {
    const compact = exportDesign(houseSystem, { '--ds-type-body-size': '15px', '--ds-space-3': '10px' }, 'compact');
    expect(sizes(compact, ['--ds-type-body-size', '--ds-space-3', '--ds-type-h1-size', '--ds-space-4'])).toEqual(['15px', '10px', '23.4px', '12px']);
  });

  it('sets the page margin to 0.75 in only where the system’s is larger (a system that names none prints at 1in)', () => {
    const margin = (properties: Record<DsName, string>) => pageOf(exportDesign(systemOf(properties), {}, 'compact')).margin;
    expect(margin({ '--ds-page-margin': '1in' })).toBe('0.75in');
    expect(margin({ '--ds-page-margin': '30mm' })).toBe('0.75in');
    expect(margin({ '--ds-page-margin': '72px' })).toBe('72px');
    expect(margin({ '--ds-page-margin': '0.5in' })).toBe('0.5in');
    expect(pageOf(exportDesign({ ...houseSystem, tokens: { properties: {} } }, {}, 'compact')).margin).toBe('0.75in');
    expect(pageOf(exportDesign(systemOf({ '--ds-page-margin': '1in' }), { '--ds-page-margin': '2in' }, 'compact')).margin).toBe('2in');
  });

  it('reaches a bundled system through D’s resolver as it reaches the house tokens', () => {
    const view = builtinView();
    const bundled: DesignSystemExport<TokenSet> = { name: view.name, tokens: view.tokens, resolveDsVars, officeThemeXml };
    const standard = exportDesign(bundled, {});
    const compact = exportDesign(bundled, {}, 'compact');
    const scaled = (value: string | null, by: number) => `${Math.round(parseFloat(value!) * by * 100) / 100}px`;
    expect(dsValue(compact, '--ds-type-body-size')).toBe(scaled(dsValue(standard, '--ds-type-body-size'), 0.9));
    expect(dsValue(compact, '--ds-space-3')).toBe(scaled(dsValue(standard, '--ds-space-3'), 0.75));
    expect(pageOf(compact).margin).toBe(pageOf(standard).margin);
  });

  it('is the house system when no system is given', () => {
    expect(dsValue(exportDesign(undefined, {}, 'compact'), '--ds-type-body-size')).toBe('14.4px');
    expect(exportDesign(undefined, {}).name).toBe('MAWS');
  });
});
