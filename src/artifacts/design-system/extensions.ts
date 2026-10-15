// MAWS's own `$extensions` in a token file (the format lets a tool keep vendor data under a reverse-domain key; every
// other key is preserved untouched). Read leniently and written canonically, like the values:
//   - `dev.maws.office` on the file's root: the 12 DrawingML theme slots and the major and minor fonts (D4);
//   - `dev.maws.deck` on a `type.<role>` token: the deck's larger scale for that role (D2);
//   - `dev.maws.css` on the file's root: `wordBreak` for the type classes (D3; `keep-all` when absent);
//   - `dev.maws.page` on the file's root: the documents' default page, `{size: 'letter' | 'a4', margin?: dimension}`
//     (the spec's Decision Log 6; a document setting B's print path and DOCX section and C's PDF read, not a CSS name).
import { FAIL, normalizeValue, type RefHandler } from './values';

export const OFFICE_KEY = 'dev.maws.office';
export const DECK_KEY = 'dev.maws.deck';
export const CSS_KEY = 'dev.maws.css';
export const PAGE_KEY = 'dev.maws.page';
export const PAGE_SIZES = ['letter', 'a4'] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
/** The page size's CSS names (X28; Decision Log 15): `tokens.css` writes them from `dev.maws.page`, never from a token. */
export const PAGE_CSS_NAMES = ['--ds-page-width', '--ds-page-height', '--ds-page-margin'] as const;

export const OFFICE_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'] as const;
export type OfficeSlot = (typeof OFFICE_SLOTS)[number];
export const OFFICE_FACES = ['latin', 'ea', 'cs'] as const;
export const WORD_BREAKS = ['normal', 'keep-all', 'break-all', 'break-word', 'auto-phrase'] as const;
export type WordBreak = (typeof WORD_BREAKS)[number];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function unknownKeys(value: Record<string, unknown>, known: readonly string[], at: string, h: RefHandler): boolean {
  const extra = Object.keys(value).filter((key) => !known.includes(key));
  for (const key of extra) h.problem(`${at}: unknown property "${key}"`);
  return extra.length > 0;
}

/** `{theme?: {<slot>: colour | alias}, fonts?: {major?, minor?: {latin?, ea?, cs?}}}`, each part optional (the rest derives). */
function office(raw: unknown, at: string, h: RefHandler): unknown {
  if (!isObject(raw)) {
    h.problem(`${at}: must be an object with "theme" and/or "fonts"`);
    return FAIL;
  }
  let failed = unknownKeys(raw, ['theme', 'fonts'], at, h);
  const out: Record<string, unknown> = {};
  if ('theme' in raw) {
    const theme = raw.theme;
    if (!isObject(theme)) {
      h.problem(`${at}.theme: must be an object of slots`);
      failed = true;
    } else {
      failed = unknownKeys(theme, OFFICE_SLOTS, `${at}.theme`, h) || failed;
      const slots: Record<string, unknown> = {};
      for (const slot of OFFICE_SLOTS) {
        if (!(slot in theme)) continue;
        const value = normalizeValue('color', theme[slot], `${at}.theme.${slot}`, h);
        if (value === FAIL) failed = true;
        else slots[slot] = value;
      }
      out.theme = slots;
    }
  }
  if ('fonts' in raw) {
    const fonts = raw.fonts;
    if (!isObject(fonts)) {
      h.problem(`${at}.fonts: must be an object with "major" and/or "minor"`);
      failed = true;
    } else {
      failed = unknownKeys(fonts, ['major', 'minor'], `${at}.fonts`, h) || failed;
      const sets: Record<string, unknown> = {};
      for (const role of ['major', 'minor'] as const) {
        if (!(role in fonts)) continue;
        const faces = fonts[role];
        if (!isObject(faces)) {
          h.problem(`${at}.fonts.${role}: must be an object of faces (latin, ea, cs)`);
          failed = true;
          continue;
        }
        failed = unknownKeys(faces, OFFICE_FACES, `${at}.fonts.${role}`, h) || failed;
        const set: Record<string, string> = {};
        for (const face of OFFICE_FACES) {
          if (!(face in faces)) continue;
          const name = faces[face];
          if (typeof name === 'string' && name.trim()) set[face] = name.trim();
          else {
            h.problem(`${at}.fonts.${role}.${face}: must be a face name`);
            failed = true;
          }
        }
        sets[role] = set;
      }
      out.fonts = sets;
    }
  }
  return failed ? FAIL : out;
}

/** `{fontSize: dimension | alias, lineHeight?: number | alias}`. */
function deck(raw: unknown, at: string, h: RefHandler): unknown {
  if (!isObject(raw)) {
    h.problem(`${at}: must be an object with "fontSize" and optionally "lineHeight"`);
    return FAIL;
  }
  let failed = unknownKeys(raw, ['fontSize', 'lineHeight'], at, h);
  const out: Record<string, unknown> = {};
  if (!('fontSize' in raw)) {
    h.problem(`${at}: needs "fontSize"`);
    failed = true;
  } else {
    const size = normalizeValue('dimension', raw.fontSize, `${at}.fontSize`, h);
    if (size === FAIL) failed = true;
    else out.fontSize = size;
  }
  if ('lineHeight' in raw) {
    const line = normalizeValue('number', raw.lineHeight, `${at}.lineHeight`, h);
    if (line === FAIL) failed = true;
    else out.lineHeight = line;
  }
  return failed ? FAIL : out;
}

function css(raw: unknown, at: string, h: RefHandler): unknown {
  if (!isObject(raw)) {
    h.problem(`${at}: must be an object`);
    return FAIL;
  }
  let failed = unknownKeys(raw, ['wordBreak'], at, h);
  if ('wordBreak' in raw && !(WORD_BREAKS as readonly unknown[]).includes(raw.wordBreak)) {
    h.problem(`${at}.wordBreak: must be one of ${WORD_BREAKS.join(', ')}`);
    failed = true;
  }
  return failed ? FAIL : { ...raw };
}

/** `{size: 'letter' | 'a4', margin?: dimension | alias}`. */
function page(raw: unknown, at: string, h: RefHandler): unknown {
  if (!isObject(raw)) {
    h.problem(`${at}: must be an object with "size" and optionally "margin"`);
    return FAIL;
  }
  let failed = unknownKeys(raw, ['size', 'margin'], at, h);
  const out: Record<string, unknown> = {};
  if (!('size' in raw)) {
    h.problem(`${at}: needs "size"`);
    failed = true;
  } else if (!(PAGE_SIZES as readonly unknown[]).includes(raw.size)) {
    h.problem(`${at}.size: must be one of ${PAGE_SIZES.join(', ')}`);
    failed = true;
  } else out.size = raw.size;
  if ('margin' in raw) {
    const margin = normalizeValue('dimension', raw.margin, `${at}.margin`, h);
    if (margin === FAIL) failed = true;
    else out.margin = margin;
  }
  return failed ? FAIL : out;
}

const READERS: Record<string, (raw: unknown, at: string, h: RefHandler) => unknown> = { [OFFICE_KEY]: office, [DECK_KEY]: deck, [CSS_KEY]: css, [PAGE_KEY]: page };

/**
 * Validates and canonicalizes MAWS's keys inside an `$extensions` object; every other key is kept as written. Keys are
 * written sorted, recursively (key order carries no meaning in JSON, so equal meaning writes equal bytes).
 */
export function readExtensions(raw: Record<string, unknown>, h: RefHandler): Record<string, unknown> | typeof FAIL {
  const out: Record<string, unknown> = {};
  let failed = false;
  for (const key of Object.keys(raw).sort()) {
    const reader = Object.hasOwn(READERS, key) ? READERS[key] : undefined;
    const value = reader ? reader(raw[key], `$extensions["${key}"]`, h) : raw[key];
    if (value === FAIL) failed = true;
    else out[key] = value;
  }
  return failed ? FAIL : out;
}
