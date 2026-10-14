// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D1, D6, D10, D14), from S6's `serializeDeckJson`. The
// deck's index, `project/deck.json` (Claude's v4, `T/slides/SKILL.md:26-40`; research/p3-claude-type-formats.md): its
// paths, its limits, and its loader and canonical serializer. Claude's rule for the index is "keep every key you are
// not changing, named here or not", so every key is kept: the known ones checked (an entry that breaks its rule is
// dropped with a warning, as Claude ignores it), unknown ones verbatim. MAWS adds one key, `dsOverrides` (X28's
// `TokenOverrides`, the deck's design-system overrides; D10), which the Claude-facing writers leave out.
import { isAssetRef } from './css';
import { ID_RE } from './parse';

export const DECK_PATH = 'project/deck.json';
const SLIDE_PATH_RE = /^project\/slides\/([^/]+)\.html$/;
/** A slide's file path. */
export const slidePath = (id: string): string => `project/slides/${id}.html`;
/** The slide id a path names, or null when it is not a slide file with a valid id. */
export function slideIdOf(path: string): string | null {
  const id = SLIDE_PATH_RE.exec(path)?.[1];
  return id !== undefined && ID_RE.test(id) ? id : null;
}

/** The publish's and the index's limits (Claude's `deck-files.md`; D14). */
export const DECK_LIMITS = {
  slides: 500,
  files: 512,
  publishBytes: 16 * 1024 * 1024,
  faces: 4,
  designSystems: 4,
} as const;

export interface DeckSection {
  description: string;
  /** The section's first slide. */
  start?: string;
  /** An empty section: the slide it sits before. */
  before?: string;
  [key: string]: unknown;
}
export interface DeckFace {
  family: string;
  /** A Google Fonts css2 link (named in MAWS, never fetched; D6). */
  href?: string;
  /** An uploaded face (`assets/<name>`, `/_blob/<id>`) or an installed system's (`project/ds/<folder>/<file>`). */
  src?: string;
  [key: string]: unknown;
}
export interface DeckJson {
  v?: unknown;
  createdOnFiles?: unknown;
  lists?: unknown;
  title?: string;
  cover?: string;
  /** Slide ids in deck order; a slide file it leaves out shows last. */
  order: string[];
  sections?: Record<string, DeckSection>;
  faces?: Record<string, DeckFace>;
  /** Claude's install records, kept verbatim (at most four). */
  designSystems?: unknown;
  /** MAWS: the deck's design-system overrides, `--ds-*` name → CSS value (X28's `TokenOverrides`). */
  dsOverrides?: Record<string, string>;
  [key: string]: unknown;
}

/** What the index's loader dropped or changed; `property` is the key path (`faces.lora`, `order`). */
export interface DeckDiagnostic {
  severity: 'warning' | 'note';
  property: string;
  message: string;
}
export type DeckParse = { ok: true; deck: DeckJson; diagnostics: DeckDiagnostic[] } | { ok: false; problems: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FAMILY_RE = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;
const GOOGLE_FONTS_RE = /^https:\/\/fonts\.googleapis\.com\/css2\?\S+$/;
const DS_OVERRIDE_RE = /^--ds-[a-z0-9-]+$/;
/** The face key Claude asks for: the family lowercased, spaces as `-`. */
export const faceKey = (family: string): string => family.toLowerCase().replace(/ /g, '-');

/** Load `project/deck.json`. Not JSON, not an object or an order that is not a list refuses it whole. */
export function parseDeckJson(text: string): DeckParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, problems: [`${DECK_PATH} is not JSON: ${(e as Error).message}`] };
  }
  if (!isRecord(raw)) return { ok: false, problems: [`${DECK_PATH} is not a JSON object`] };
  if (raw.order !== undefined && !Array.isArray(raw.order)) return { ok: false, problems: [`${DECK_PATH}'s order is not a list of slide ids`] };
  const diagnostics: DeckDiagnostic[] = [];
  const warn = (property: string, message: string) => diagnostics.push({ severity: 'warning', property, message });
  const note = (property: string, message: string) => diagnostics.push({ severity: 'note', property, message });

  const deck: DeckJson = { order: [] };
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'order': {
        const seen = new Set<string>();
        for (const id of value as unknown[]) {
          if (typeof id !== 'string' || !ID_RE.test(id)) warn('order', `${JSON.stringify(id)} is not a slide id; dropped`);
          else if (seen.has(id)) warn('order', `slide ${id} is listed twice; the second dropped`);
          else {
            seen.add(id);
            deck.order.push(id);
          }
        }
        if (deck.order.length > DECK_LIMITS.slides) return { ok: false, problems: [`${DECK_PATH}'s order lists ${deck.order.length} slides (over ${DECK_LIMITS.slides})`] };
        break;
      }
      case 'title':
        if (typeof value === 'string') deck.title = value;
        else warn(key, 'title is not a string; dropped');
        break;
      case 'cover':
        if (typeof value === 'string' && ID_RE.test(value)) deck.cover = value;
        else warn(key, `cover ${JSON.stringify(value)} is not a slide id; dropped`);
        break;
      case 'sections':
        if (isRecord(value)) deck.sections = sections(value, warn);
        else warn(key, 'sections is not an object of {description, start}; dropped');
        break;
      case 'faces':
        if (isRecord(value)) deck.faces = faces(value, warn, note);
        else warn(key, 'faces is not an object of {family, href | src}; dropped');
        break;
      case 'designSystems':
        if (Array.isArray(value) && value.length > DECK_LIMITS.designSystems) {
          warn(key, `${value.length} design-system records (over ${DECK_LIMITS.designSystems}); the ones after the fourth dropped`);
          deck.designSystems = value.slice(0, DECK_LIMITS.designSystems);
        } else deck.designSystems = value;
        break;
      case 'dsOverrides':
        if (isRecord(value)) deck.dsOverrides = overrides(value, warn);
        else warn(key, 'dsOverrides is not an object of --ds-* names to CSS values; dropped');
        break;
      default:
        deck[key] = value; // v, createdOnFiles, lists and every key the index carries that MAWS does not read
    }
  }
  return { ok: true, deck, diagnostics };
}

function sections(value: Record<string, unknown>, warn: (p: string, m: string) => void): Record<string, DeckSection> {
  const out: Record<string, DeckSection> = {};
  for (const [key, entry] of Object.entries(value)) {
    const anchor = isRecord(entry) ? [entry.start, entry.before].filter((v) => v !== undefined) : [];
    if (!isRecord(entry) || typeof entry.description !== 'string' || anchor.length !== 1 || typeof anchor[0] !== 'string' || !ID_RE.test(anchor[0])) {
      warn(`sections.${key}`, 'a section is {description, start} (or {description, before} when empty) with a slide id; dropped');
      continue;
    }
    out[key] = entry as DeckSection;
  }
  return out;
}

function faces(value: Record<string, unknown>, warn: (p: string, m: string) => void, note: (p: string, m: string) => void): Record<string, DeckFace> {
  const out: Record<string, DeckFace> = {};
  for (const [key, entry] of Object.entries(value)) {
    const where = `faces.${key}`;
    if (!isRecord(entry) || typeof entry.family !== 'string' || !FAMILY_RE.test(entry.family)) {
      warn(where, 'a face is {family, href | src} with a family of a letter, then letters, digits, spaces, _ and - (40 at most); dropped');
      continue;
    }
    const { href, src } = entry;
    const linked = typeof href === 'string' && GOOGLE_FONTS_RE.test(href);
    const uploaded = typeof src === 'string' && isAssetRef(src);
    if ((href === undefined) === (src === undefined) || (href !== undefined && !linked) || (src !== undefined && !uploaded)) {
      warn(where, 'a face takes either href (a https://fonts.googleapis.com/css2?… link) or src (assets/<name>, /_blob/<id> or project/ds/<folder>/<file>); dropped');
      continue;
    }
    if (Object.keys(out).length === DECK_LIMITS.faces) {
      warn(where, `more than ${DECK_LIMITS.faces} faces; dropped`);
      continue;
    }
    if (key !== faceKey(entry.family)) note(where, `a face is keyed by its family lowercased with spaces as -: "${faceKey(entry.family)}"`);
    out[key] = entry as DeckFace;
  }
  return out;
}

function overrides(value: Record<string, unknown>, warn: (p: string, m: string) => void): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, css] of Object.entries(value)) {
    if (!DS_OVERRIDE_RE.test(name) || name.startsWith('--ds-page-') || typeof css !== 'string') {
      warn(`dsOverrides.${name}`, 'an override is a --ds-* name (not --ds-page-*) to a CSS value; dropped');
      continue;
    }
    out[name] = css;
  }
  return out;
}

/** Claude's key order, then MAWS's `dsOverrides`, then every other key sorted (S6; D1). */
const DECK_KEYS = ['v', 'createdOnFiles', 'lists', 'title', 'cover', 'order', 'sections', 'faces', 'designSystems', 'dsOverrides'];
const rank = (key: string, order: readonly string[]) => (order.includes(key) ? order.indexOf(key) : order.length);
const byRank = (order: readonly string[]) => (a: string, b: string) => rank(a, order) - rank(b, order) || (a < b ? -1 : a > b ? 1 : 0);

function ordered<T extends Record<string, unknown>>(value: T, order: readonly string[]): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(byRank(order))) out[key] = value[key];
  return out as T;
}
/** A map's entries by key, each entry's fields in the given order then sorted: its meaning, not its bytes. */
function orderedMap<T extends Record<string, unknown>>(map: Record<string, T>, fields: readonly string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(map).sort()) out[key] = ordered(map[key]!, fields);
  return out;
}

/** The index's canonical file: a fixed point of `serializeDeckJson(parseDeckJson(x).deck)` after one pass. */
export function serializeDeckJson(deck: DeckJson): string {
  const out: Record<string, unknown> = { ...deck };
  if (deck.sections) out.sections = orderedMap(deck.sections, ['description', 'start', 'before']);
  if (deck.faces) out.faces = orderedMap(deck.faces, ['family', 'href', 'src']);
  if (deck.dsOverrides) out.dsOverrides = Object.fromEntries(Object.entries(deck.dsOverrides).sort(([a], [b]) => (a < b ? -1 : 1)));
  return JSON.stringify(ordered(out, DECK_KEYS), null, 2) + '\n';
}
