// The design system as the document exporters see it (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md;
// the ledger's X28 row): D's export helpers `resolveDsVars(cssText, tokens, medium, overrides?)` and
// `officeThemeXml(tokens, name, overrides?)` over a system's tokens, handed the document's own `dsOverrides`
// (TokenOverrides), which they set after the system's values (D's M6 signatures, so overrides reach the Word theme). D's
// `src/artifacts/design-system/apply.ts` and `office.ts` are not on this branch's base, so the exporters take the
// helpers through `DesignSystemExport`, whose two functions have the ledger's shapes, and default to a local system
// over a local token shape: the house system's resolved `--ds-*` properties of the document medium, mirrored from D's
// `defaults/maws/tokens.tokens.json` (p3-d-design-systems 257bcbd5), so an export before and after D's landing looks
// the same. When D lands, the caller passes `{name: view.name, tokens: view.tokens, resolveDsVars, officeThemeXml}`
// from D's apply API and this file's local half goes.
import type { TokenOverrides } from '../meta';

export type Medium = 'document' | 'deck';
export type DsName = `--ds-${string}`;

/** X28's export helpers bound to one system: what D's apply API hands an exporter. */
export interface DesignSystemExport<T = unknown> {
  name: string;
  tokens: T;
  /** CSS text with every `var(--ds-*)` the system defines, `overrides` after it, replaced by its value (X28, D's semantics). */
  resolveDsVars(cssText: string, tokens: T, medium: Medium, overrides?: TokenOverrides): string;
  /** The DrawingML theme part, `word/theme/theme1.xml` (X28's `officeThemeXml`), a colour or font override on its role's slots. */
  officeThemeXml(tokens: T, name: string, overrides?: TokenOverrides): string;
}

export interface OfficeFonts {
  latin: string;
  /** The face East Asian (Korean) text takes in Word. */
  ea?: string;
}

/** The local token shape until D lands: a system's properties in the document medium and its Office fonts. */
export interface LocalTokens {
  properties: Readonly<Record<DsName, string>>;
  /** `$extensions["dev.maws.office"].fonts`, as D's tokens carry them. */
  officeFonts?: { major?: OfficeFonts; minor?: OfficeFonts };
}

const DISPLAY = '"SF Pro Display", "Apple SD Gothic Neo", -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';
const BODY = '"SF Pro Text", "Apple SD Gothic Neo", -apple-system, "Segoe UI", "Malgun Gothic", sans-serif';
const type = (role: string, size: number, line: number, weight: number): Record<DsName, string> => ({
  [`--ds-type-${role}-size`]: `${size}px`,
  [`--ds-type-${role}-line`]: String(line),
  [`--ds-type-${role}-weight`]: String(weight),
});
const shadow = (layers: Array<[number, number, number, number, number]>) => layers.map(([x, y, blur, spread, alpha]) => `${x}px ${y}px ${blur}px ${spread}px rgb(0 0 0 / ${alpha})`).join(', ');

/** The house system (D's `maws` default) as resolved document-medium properties, page size included. */
export const HOUSE_TOKENS: LocalTokens = {
  properties: {
    '--ds-color-bg': '#faf9f6',
    '--ds-color-bg-raised': '#ffffff',
    '--ds-color-text': '#1f1e1b',
    '--ds-color-text-muted': '#72716e',
    '--ds-color-accent': '#c9663f',
    '--ds-color-accent-text': '#ffffff',
    '--ds-color-border': '#e3e2df',
    '--ds-color-status-ok': '#1f8f55',
    '--ds-color-status-warn': '#b86a1a',
    '--ds-color-status-error': '#c93b3b',
    '--ds-color-status-info': '#3b6fd1',
    '--ds-font-display': DISPLAY,
    '--ds-font-body': BODY,
    '--ds-font-mono': 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    ...type('title', 34, 1.3, 700),
    ...type('subtitle', 19, 1.55, 500),
    ...type('h1', 26, 1.35, 700),
    ...type('h2', 21, 1.45, 700),
    ...type('h3', 17, 1.55, 600),
    ...type('body', 16, 1.7, 400),
    ...type('caption', 13, 1.55, 400),
    ...type('quote', 17, 1.75, 400),
    ...Object.fromEntries([4, 8, 12, 16, 24, 32, 48, 64].map((px, i) => [`--ds-space-${i + 1}`, `${px}px`])),
    '--ds-radius-sm': '6px',
    '--ds-radius-md': '10px',
    '--ds-radius-lg': '14px',
    '--ds-radius-full': '9999px',
    '--ds-shadow-sm': shadow([
      [0, 0, 0, 1, 0.04],
      [0, 2, 6, 0, 0.08],
    ]),
    '--ds-shadow-md': shadow([
      [0, 0, 0, 1, 0.04],
      [0, 2, 8, 0, 0.04],
      [0, 4, 80, 8, 0.024],
    ]),
    '--ds-shadow-lg': shadow([
      [0, 0, 0, 1, 0.04],
      [0, 8, 24, 0, 0.1],
      [0, 24, 64, 0, 0.08],
    ]),
    '--ds-page-width': '8.5in',
    '--ds-page-height': '11in',
    '--ds-page-margin': '72px',
  },
  officeFonts: { major: { latin: 'Segoe UI', ea: 'Malgun Gothic' }, minor: { latin: 'Segoe UI', ea: 'Malgun Gothic' } },
};

/**
 * Every `var(name, fallback?)` in `cssText` replaced through `lookup`: a name it answers takes the answer; a `--ds-*`
 * name it does not answer takes its fallback, resolved the same way, else stays as written (`fallbacks: 'take'`, D's
 * `resolveDsVars`), or stays with its fallback resolved (`fallbacks: 'keep'`, a partial pass such as the overrides');
 * any other `var()` stays, its fallback resolved.
 */
export function substituteVars(cssText: string, lookup: (name: string) => string | undefined, fallbacks: 'take' | 'keep'): string {
  const resolve = (text: string): string => {
    let out = '';
    let i = 0;
    for (let at = text.indexOf('var(', i); at >= 0; at = text.indexOf('var(', i)) {
      let depth = 1;
      let end = at + 4;
      for (; end < text.length && depth > 0; end++) {
        if (text[end] === '(') depth++;
        else if (text[end] === ')') depth--;
      }
      if (depth > 0) break; // unclosed: left as written
      const inner = text.slice(at + 4, end - 1);
      const comma = inner.indexOf(',');
      const name = (comma < 0 ? inner : inner.slice(0, comma)).trim();
      const fallback = comma < 0 ? null : inner.slice(comma + 1);
      const value = name.startsWith('--ds-') ? lookup(name) : undefined;
      out += text.slice(i, at);
      if (value !== undefined) out += value;
      else if (fallback !== null && name.startsWith('--ds-') && fallbacks === 'take') out += resolve(fallback).trim();
      else out += fallback === null ? `var(${inner})` : `var(${name},${resolve(fallback)})`;
      i = end;
    }
    return out + text.slice(i);
  };
  return resolve(cssText);
}

/** The local `resolveDsVars`: D's semantics over `LocalTokens`, which hold the document medium's values only. */
export function resolveDsVarsLocal(cssText: string, tokens: LocalTokens, _medium: Medium = 'document', overrides: TokenOverrides = {}): string {
  const values = { ...(tokens.properties as Record<string, string>), ...(overrides as Record<string, string>) };
  return substituteVars(cssText, (name) => (Object.hasOwn(values, name) ? values[name] : undefined), 'take');
}

// XML 1.0 attribute text: the five entities, and no character the format forbids.
export const xmlAttr = (text: string): string =>
  text
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Six uppercase hex digits for a CSS colour this module can read (hex, `rgb()`), alpha dropped; else null. */
export function hexOf(css: string | null | undefined): string | null {
  const text = (css ?? '').trim().toLowerCase();
  let match = /^#([0-9a-f]{3,4})$/.exec(text);
  if (match) return [...match[1].slice(0, 3)].map((d) => d + d).join('').toUpperCase();
  match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(text);
  if (match) return match[1].toUpperCase();
  match = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(text);
  if (!match) return null;
  return match
    .slice(1, 4)
    .map((part) => {
      const value = part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part);
      return Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, '0');
    })
    .join('')
    .toUpperCase();
}

// The Office slot each role fills (D's `office.ts`, the same table, so a document matches D's DOCX and PPTX mapping).
const OFFICE_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const;
const SLOT_ROLE: Record<(typeof OFFICE_SLOTS)[number], DsName> = {
  dk1: '--ds-color-text',
  lt1: '--ds-color-bg',
  dk2: '--ds-color-text-muted',
  lt2: '--ds-color-bg-raised',
  accent1: '--ds-color-accent',
  accent2: '--ds-color-status-info',
  accent3: '--ds-color-status-ok',
  accent4: '--ds-color-status-warn',
  accent5: '--ds-color-status-error',
  accent6: '--ds-color-border',
  hlink: '--ds-color-accent',
  folHlink: '--ds-color-text-muted',
};
// Names Office cannot resolve to a face: CSS generic families and the platform's system-font aliases (D's list).
const NOT_A_FACE = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong', '-apple-system', 'BlinkMacSystemFont']);

/** The first face in a CSS family list Office can name; else a common face for the list's generic family. */
export function officeFace(familyCss: string | null | undefined): string {
  const names = (familyCss ?? '')
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  const face = names.find((name) => !NOT_A_FACE.has(name));
  if (face) return face;
  if (names.some((name) => name === 'serif' || name === 'ui-serif')) return 'Times New Roman';
  if (names.some((name) => name === 'monospace' || name === 'ui-monospace')) return 'Courier New';
  return 'Arial';
}

const SOLID = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const line = (width: number) => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr">${SOLID}<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;

// An override the theme part takes (D's rule, X28): a colour it can read, or a font stack (no function in it).
const colourOverride = (value: string | undefined): string | null => (value === undefined ? null : hexOf(value));
const fontOverride = (value: string | undefined): string | undefined => (value !== undefined && value.trim() !== '' && !value.includes('(') ? value : undefined);

/**
 * The local `officeThemeXml`: D's part, written from the local tokens (colours by role, the Office fonts), with the
 * document's overrides on the roles they name: a readable colour replaces every slot of its role, a font stack the face
 * Office derives from the role; anything else, and the system's own Office fonts (literals), stay.
 */
export function officeThemeXmlLocal(tokens: LocalTokens, name: string, overrides: TokenOverrides = {}): string {
  const properties = tokens.properties as Record<string, string | undefined>;
  const own = overrides as Record<string, string | undefined>;
  const title = xmlAttr(name);
  const colour = (slot: (typeof OFFICE_SLOTS)[number]) =>
    colourOverride(own[SLOT_ROLE[slot]]) ?? hexOf(properties[SLOT_ROLE[slot]]) ?? (slot.startsWith('lt') ? 'FFFFFF' : '000000');
  const fonts = (given: OfficeFonts | undefined, role: DsName): string => {
    const latin = given?.latin ?? officeFace(fontOverride(own[role]) ?? properties[role]);
    return `<a:latin typeface="${xmlAttr(latin)}"/><a:ea typeface="${xmlAttr(given?.ea ?? '')}"/><a:cs typeface=""/>`;
  };
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${title}">`,
    '<a:themeElements>',
    `<a:clrScheme name="${title}">${OFFICE_SLOTS.map((slot) => `<a:${slot}><a:srgbClr val="${colour(slot)}"/></a:${slot}>`).join('')}</a:clrScheme>`,
    `<a:fontScheme name="${title}"><a:majorFont>${fonts(tokens.officeFonts?.major, '--ds-font-display')}</a:majorFont><a:minorFont>${fonts(tokens.officeFonts?.minor, '--ds-font-body')}</a:minorFont></a:fontScheme>`,
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

/** The local system: the house tokens through the local helpers (the default until D's apply API is on the base). */
export const houseSystem: DesignSystemExport<LocalTokens> = { name: 'MAWS', tokens: HOUSE_TOKENS, resolveDsVars: resolveDsVarsLocal, officeThemeXml: officeThemeXmlLocal };

/** A system bound with the document's overrides on top: what every exporter resolves through. */
export interface ExportDesign {
  name: string;
  /** CSS text with the document's overrides, then the system, resolved into it. */
  resolveCss(cssText: string): string;
  /** The system's Word theme part. */
  officeThemeXml(): string;
}

export function exportDesign<T>(system: DesignSystemExport<T>, overrides: TokenOverrides): ExportDesign {
  return {
    name: system.name,
    resolveCss: (cssText) => system.resolveDsVars(cssText, system.tokens, 'document', overrides),
    officeThemeXml: () => system.officeThemeXml(system.tokens, system.name, overrides),
  };
}

/** One `--ds-*` value as the export resolves it, or null when neither the overrides nor the system define it. */
export function dsValue(design: ExportDesign, name: DsName): string | null {
  const value = design.resolveCss(`var(${name})`).trim();
  return value.startsWith('var(') ? null : value;
}

export type PageSize = 'letter' | 'a4';
const PAGE: Record<PageSize, { width: string; height: string }> = { letter: { width: '8.5in', height: '11in' }, a4: { width: '210mm', height: '297mm' } };

/**
 * The page an export prints on (the owner's Decision Log 43): the size chosen in the Export menu or the
 * `artifact_export` call; else the system's `--ds-page-width`/`--ds-page-height` (D's `dev.maws.page`); else Letter.
 * The margin is the system's `--ds-page-margin`, else 1in.
 */
export function pageOf(design: ExportDesign, choice?: PageSize): { width: string; height: string; margin: string } {
  const margin = dsValue(design, '--ds-page-margin') ?? '1in';
  if (choice) return { ...PAGE[choice], margin };
  const width = dsValue(design, '--ds-page-width');
  const height = dsValue(design, '--ds-page-height');
  return width && height ? { width, height, margin } : { ...PAGE.letter, margin };
}

/** A CSS length in twentieths of a point (Word's dxa); null for what this cannot read (percentages, `calc()`). */
export function twipsOf(css: string | null | undefined): number | null {
  const match = /^\s*(-?[\d.]+)\s*(px|pt|in|mm|cm|pc)?\s*$/.exec(css ?? '');
  if (!match) return null;
  const value = parseFloat(match[1]);
  const perUnit: Record<string, number> = { px: 15, pt: 20, in: 1440, mm: 1440 / 25.4, cm: 1440 / 2.54, pc: 240 };
  return Math.round(value * perUnit[match[2] ?? 'px']);
}
