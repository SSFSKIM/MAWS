import { Window, type Document, type Element } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import complete from './fixtures/complete.tokens.json';
import { edited, type Edit } from './fixtures/edit';
import lenient from './fixtures/lenient.tokens.json';
import { OFFICE_SLOTS, officeTheme, officeThemeXml } from './office';
import { parseTokens, type TokenSet } from './tokens';

const set = (input: unknown): TokenSet => {
  const result = parseTokens(input);
  expect(result.problems).toEqual([]);
  return result.tokens!;
};
const withoutOffice = (file: unknown, ...edits: Edit[]) => edited(file, ['$extensions/dev.maws.office', undefined], ...edits);
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
// DrawingML elements by local name in the `a:` namespace (happy-dom's getElementsByTagNameNS finds nothing; a query does).
const parser = new new Window().DOMParser();
const all = (node: Document | Element, local: string) => [...node.querySelectorAll('*')].filter((e) => e.localName === local && e.namespaceURI === A);
const one = (node: Document | Element, local: string) => all(node, local)[0]!;

describe('the Office mapping (Acceptance 3)', () => {
  it('reads the 12 theme slots and the fonts from dev.maws.office, resolving aliases', () => {
    const theme = officeTheme(set(complete));
    expect(Object.keys(theme.colors)).toEqual([...OFFICE_SLOTS]);
    expect(theme.colors).toEqual({
      dk1: '1F1E1B',
      lt1: 'FAF9F6',
      dk2: '2C2B28',
      lt2: 'F2EFE9',
      accent1: 'C9663F',
      accent2: '3B6FD1',
      accent3: '1F8F55',
      accent4: 'B86A1A',
      accent5: 'C93B3B',
      accent6: theme.colors.accent6, // oklch(0.86 0.12 90), checked below
      hlink: 'C9663F',
      folHlink: '6B6A66',
    });
    expect(theme.colors.accent6).toMatch(/^[0-9A-F]{6}$/);
    expect(theme.fonts).toEqual({ major: { latin: 'Georgia', ea: 'Batang' }, minor: { latin: 'Inter', ea: 'Malgun Gothic', cs: 'Arial' } });
  });

  it('derives every slot from the roles when the extension is absent, flattening translucent ones onto the ground', () => {
    const theme = officeTheme(set(withoutOffice(complete)));
    expect(theme.colors).toEqual({
      dk1: '1F1E1B', // text
      lt1: 'FAF9F6', // bg
      dk2: '72716E', // text-muted (#1f1e1b at 0.62) on #faf9f6
      lt2: 'FFFFFF', // bg-raised
      accent1: 'C9663F', // accent
      accent2: '3B6FD1', // info
      accent3: '1F8F55', // ok
      accent4: 'B86A1A', // warn
      accent5: 'C93B3B', // error
      accent6: 'E3E2DF', // border (#14120e at 0.1) on #faf9f6
      hlink: 'C9663F',
      folHlink: '72716E',
    });
    // The fonts: the first face of font.display and of font.body that Office can name (generic families skipped).
    expect(theme.fonts).toEqual({ major: { latin: 'Iowan Old Style' }, minor: { latin: 'Inter' } });
    const generic = withoutOffice(complete, ['font/display/$value', ['-apple-system', 'system-ui', 'serif']]);
    expect(officeTheme(set(generic)).fonts.major).toEqual({ latin: 'Times New Roman' });
  });

  it('derives what a partial extension leaves out, slot by slot and face by face', () => {
    const file = edited(complete, ['$extensions/dev.maws.office', { theme: { accent1: '#123456' }, fonts: { minor: { ea: 'Malgun Gothic' } } }]);
    const theme = officeTheme(set(file));
    expect(theme.colors.accent1).toBe('123456');
    expect(theme.colors.hlink).toBe('C9663F'); // derived from the accent role, not from the slot
    expect(theme.colors.dk1).toBe('1F1E1B');
    expect(theme.fonts).toEqual({ major: { latin: 'Iowan Old Style' }, minor: { latin: 'Inter', ea: 'Malgun Gothic' } });
  });

  it('resolves the lenient fixture too', () => {
    expect(officeTheme(set(lenient)).colors.accent2).toBe('3B6FD1');
  });

  it('writes a DrawingML theme part that parses as XML, with the slots, the fonts and a complete format scheme', () => {
    const xml = officeThemeXml(set(complete), 'School & "Staff" <2026>');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
    const doc = parser.parseFromString(xml, 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    const root = doc.documentElement;
    expect(root.namespaceURI).toBe(A);
    expect(root.localName).toBe('theme');
    expect(root.getAttribute('name')).toBe('School & "Staff" <2026>');
    const scheme = one(doc, 'clrScheme');
    expect([...scheme.children].map((slot) => slot.localName)).toEqual([...OFFICE_SLOTS]);
    expect(one(scheme, 'accent1').firstElementChild!.getAttribute('val')).toBe('C9663F');
    const major = one(doc, 'majorFont');
    expect([...major.children].map((face) => [face.localName, face.getAttribute('typeface')])).toEqual([['latin', 'Georgia'], ['ea', 'Batang'], ['cs', '']]);
    const format = one(doc, 'fmtScheme');
    for (const list of ['fillStyleLst', 'lnStyleLst', 'effectStyleLst', 'bgFillStyleLst']) {
      expect(one(format, list).children.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('escapes a face name in the XML', () => {
    const file = edited(complete, ['$extensions/dev.maws.office/fonts/major/latin', 'A&B "<Face>"']);
    const doc = parser.parseFromString(officeThemeXml(set(file), 'x'), 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(one(doc, 'latin').getAttribute('typeface')).toBe('A&B "<Face>"');
  });

  it('refuses a token set that lacks a role it needs', () => {
    const file = withoutOffice(complete, ['color/text', undefined]);
    expect(() => officeTheme(set(file))).toThrow(/color\.text\.\$root/);
  });
});

describe('overrides reach Office (Decision Log 25; B’s `dsOverrides`)', () => {
  it('replaces a role’s colour before mapping, so the slots derived from it follow', () => {
    const base = set(withoutOffice(complete));
    const theme = officeTheme(base, { '--ds-color-accent': '#123456', '--ds-color-text': 'rgb(16, 32, 48)', '--ds-color-status-ok': 'hsl(120 100% 25%)' });
    expect(theme.colors.accent1).toBe('123456');
    expect(theme.colors.hlink).toBe('123456');
    expect(theme.colors.dk1).toBe('102030');
    expect(theme.colors.accent3).toBe('008000');
    expect(theme.colors.accent2).toBe('3B6FD1'); // untouched roles stay
  });

  it('flattens onto an overridden ground', () => {
    const theme = officeTheme(set(withoutOffice(complete)), { '--ds-color-bg': '#000000' });
    expect(theme.colors.lt1).toBe('000000');
    expect(theme.colors.dk2).not.toBe('72716E'); // text-muted (translucent) now sits on black
    expect(theme.colors.dk2).toBe(officeTheme(set(withoutOffice(complete, ['color/bg/$root/$value', '#000000']))).colors.dk2);
  });

  it('a dev.maws.office slot aliasing the overridden token follows it; a slot written as a literal stays', () => {
    const theme = officeTheme(set(complete), { '--ds-color-accent': '#123456', '--ds-color-text-muted': '#00ff00', '--ds-color-status-info': '#abcdef', '--ds-color-highlight': '#fedcba' });
    expect(theme.colors.accent1).toBe('123456'); // "{color.accent.$root}"
    expect(theme.colors.hlink).toBe('123456');
    expect(theme.colors.accent2).toBe('ABCDEF'); // "{color.status.info}"
    expect(theme.colors.accent6).toBe('FEDCBA'); // "{color.highlight}", a system's extra token
    expect(theme.colors.dk2).toBe('2C2B28'); // a literal slot
    expect(theme.colors.folHlink).toBe('6B6A66');
  });

  it('ignores an override that is not a plain colour or font, and names that are not --ds-*', () => {
    const plain = officeTheme(set(withoutOffice(complete)));
    for (const value of ['var(--brand)', 'linear-gradient(red, blue)', 'color-mix(in srgb, red, blue)', 'not a colour', '']) {
      expect(officeTheme(set(withoutOffice(complete)), { '--ds-color-accent': value }).colors).toEqual(plain.colors);
    }
    expect(officeTheme(set(withoutOffice(complete)), { 'color-accent': '#123456', '--ds-font-display': 'var(--ds-font-body)' })).toEqual(plain);
  });

  it('replaces a font role with an override that reads as a font stack, unless the extension names the face', () => {
    const theme = officeTheme(set(withoutOffice(complete)), { '--ds-font-display': '"Source Serif 4", Georgia, serif', '--ds-font-body': 'system-ui, sans-serif' });
    expect(theme.fonts).toEqual({ major: { latin: 'Source Serif 4' }, minor: { latin: 'Arial' } });
    expect(officeTheme(set(complete), { '--ds-font-display': '"Source Serif 4", serif' }).fonts.major).toEqual({ latin: 'Georgia', ea: 'Batang' });
  });

  it('carries the overrides into the theme part', () => {
    const doc = parser.parseFromString(officeThemeXml(set(complete), 'x', { '--ds-color-accent': '#123456', '--ds-font-display': 'Avenir' }), 'application/xml');
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(one(one(doc, 'clrScheme'), 'accent1').firstElementChild!.getAttribute('val')).toBe('123456');
    expect(one(one(doc, 'majorFont'), 'latin').getAttribute('typeface')).toBe('Georgia'); // the extension's face stays
  });
});
