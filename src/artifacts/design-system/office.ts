// The Office mapping (D4): the 12 DrawingML theme colours and the major and minor fonts a PPTX or DOCX export writes,
// from the token file's `$extensions["dev.maws.office"]`, each slot or face it leaves out derived from the roles. One
// generator for both exporters (X31: P3-B's DOCX, P3-C's PPTX), so a deck and a document of one system match in Office.
import { flatten, rgbToHex, type ColorValue, type Rgb } from './color';
import { OFFICE_FACES, OFFICE_KEY, OFFICE_SLOTS, type OfficeSlot } from './extensions';
import { resolveTokens, resolveValueAgainst } from './resolve';
import type { TokenSet } from './tokens';

export { OFFICE_SLOTS, type OfficeSlot } from './extensions';

export interface OfficeFonts {
  latin: string;
  ea?: string;
  cs?: string;
}

export interface OfficeTheme {
  /** Each slot as six uppercase hex digits (DrawingML's `srgbClr val`), opaque. */
  colors: Record<OfficeSlot, string>;
  /** major: headings; minor: body. `ea` is the face East Asian (Korean) text takes in Word and PowerPoint. */
  fonts: { major: OfficeFonts; minor: OfficeFonts };
}

interface OfficeExtension {
  theme?: Partial<Record<OfficeSlot, unknown>>;
  fonts?: Partial<Record<'major' | 'minor', Partial<OfficeFonts>>>;
}

// Names Office cannot resolve to a face: CSS generic families and the platform's system-font aliases.
const NOT_A_FACE = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'BlinkMacSystemFont']);

/** The first face in a family list Office can name; else a common face for the list's generic family. */
function officeFace(family: string | readonly string[]): string {
  const names = typeof family === 'string' ? [family] : family;
  const face = names.find((name) => !NOT_A_FACE.has(name));
  if (face) return face;
  if (names.some((name) => name === 'serif' || name === 'ui-serif')) return 'Times New Roman';
  if (names.some((name) => name === 'monospace' || name === 'ui-monospace')) return 'Courier New';
  return 'Arial';
}

const WHITE: Rgb = { r: 1, g: 1, b: 1, alpha: 1 };

/** The resolved Office theme of a token set. Throws when a slot needs a role the set does not resolve. */
export function officeTheme(tokens: TokenSet): OfficeTheme {
  const resolved = resolveTokens(tokens);
  const extension = (tokens.groups.get('')?.$extensions?.[OFFICE_KEY] ?? {}) as OfficeExtension;

  const role = (path: string): ColorValue => {
    const token = resolved.tokens.get(path);
    if (token?.type !== 'color') throw new Error(`officeTheme: the role ${path} does not resolve to a colour`);
    return token.value;
  };
  const DERIVED: Record<OfficeSlot, string> = {
    dk1: 'color.text.$root',
    lt1: 'color.bg.$root',
    dk2: 'color.text.muted',
    lt2: 'color.bg.raised',
    accent1: 'color.accent.$root',
    accent2: 'color.status.info',
    accent3: 'color.status.ok',
    accent4: 'color.status.warn',
    accent5: 'color.status.error',
    accent6: 'color.border',
    hlink: 'color.accent.$root',
    folHlink: 'color.text.muted',
  };
  const slot = (name: OfficeSlot): ColorValue => {
    const raw = extension.theme?.[name];
    if (raw === undefined) return role(DERIVED[name]);
    const { value, problems } = resolveValueAgainst(resolved, 'color', raw, `${OFFICE_KEY}.theme.${name}`);
    if (!value) throw new Error(`officeTheme: ${problems.join('; ')}`);
    return value;
  };

  // Theme colours are opaque: lt1 is flattened onto white, every other slot onto lt1.
  const ground = flatten(slot('lt1'), WHITE);
  const hex = (color: ColorValue | Rgb) => rgbToHex(flatten(color, ground)).slice(1).toUpperCase();
  const colors = Object.fromEntries(OFFICE_SLOTS.map((name) => [name, hex(name === 'lt1' ? ground : slot(name))])) as Record<OfficeSlot, string>;

  const faces = (which: 'major' | 'minor', rolePath: string): OfficeFonts => {
    const given = extension.fonts?.[which] ?? {};
    let latin = given.latin;
    if (latin === undefined) {
      const token = resolved.tokens.get(rolePath);
      if (token?.type !== 'fontFamily') throw new Error(`officeTheme: the role ${rolePath} does not resolve to a font family`);
      latin = officeFace(token.value);
    }
    const out: OfficeFonts = { latin };
    for (const face of OFFICE_FACES) if (face !== 'latin' && given[face] !== undefined) out[face] = given[face];
    return out;
  };
  return { colors, fonts: { major: faces('major', 'font.display'), minor: faces('minor', 'font.body') } };
}

// XML 1.0 attribute text: the five entities, and no character the format forbids.
const xmlAttr = (text: string) =>
  text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const SOLID = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const line = (width: number) => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr">${SOLID}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;

/**
 * The DrawingML theme part (`ppt/theme/theme1.xml`, `word/theme/theme1.xml`) of a token set: the colour scheme, the
 * font scheme and a plain format scheme (solid fills and lines, no effects; the schema requires three of each).
 */
export function officeThemeXml(tokens: TokenSet, name: string): string {
  const theme = officeTheme(tokens);
  const title = xmlAttr(name);
  const fonts = (set: OfficeFonts) => OFFICE_FACES.map((face) => `<a:${face} typeface="${xmlAttr(set[face] ?? '')}"/>`).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${title}">`,
    '<a:themeElements>',
    `<a:clrScheme name="${title}">${OFFICE_SLOTS.map((slot) => `<a:${slot}><a:srgbClr val="${theme.colors[slot]}"/></a:${slot}>`).join('')}</a:clrScheme>`,
    `<a:fontScheme name="${title}"><a:majorFont>${fonts(theme.fonts.major)}</a:majorFont><a:minorFont>${fonts(theme.fonts.minor)}</a:minorFont></a:fontScheme>`,
    `<a:fmtScheme name="${title}">`,
    `<a:fillStyleLst>${SOLID.repeat(3)}</a:fillStyleLst>`,
    `<a:lnStyleLst>${[6350, 12700, 19050].map(line).join('')}</a:lnStyleLst>`,
    `<a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst>`,
    `<a:bgFillStyleLst>${SOLID.repeat(3)}</a:bgFillStyleLst>`,
    '</a:fmtScheme>',
    '</a:themeElements>',
    '<a:objectDefaults/>',
    '<a:extraClrSchemeLst/>',
    '</a:theme>',
  ].join('\n');
}
