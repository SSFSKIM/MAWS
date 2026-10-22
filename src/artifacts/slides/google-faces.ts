// P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the P4 spec's §4.4 "Google Fonts (row 176)" and
// R-8; the executor's Decision Log 9 amendment): a Google Fonts face a deck or a design names is fetched once by the
// engine host into the artifact's assets when its licence is OFL, then renders offline everywhere. This module is the
// portable half, the rules every reader shares; the host's fetch is src/engine-host/presentations/google-faces.ts.
//
// - The request. A face's `href` must name exactly one family, the entry's own, and no `text=` subset. Its canonical
//   form is that family with its axis tuple, every other parameter (`display`, anything else) dropped; it is the face's
//   identity for the licence check, the fetch, the host's in-flight dedupe, the host's record and its stale guard.
// - The licence comes from the family's directory in the google/fonts repository (`ofl/<dir>/METADATA.pb`, `<dir>`
//   the family lowercased with everything outside [a-z0-9] removed), never from the CSS2 endpoint, which serves Apache
//   families too. Only the file's top-level `name:` and `license:` are read (its nested `fonts {}` blocks repeat `name:`).
// - The files come from the CSS2 answer asked with a Firefox 40 user agent, the unsliced form (one file per style and
//   weight); a sliced answer (`unicode-range` blocks, what a modern browser gets) is refused, and the host then asks
//   without a user agent (the TTF form).
// - The state a reader shows: saved (the host's record answers the request), pending (no record yet), or refused by
//   name (the link, the licence, or the files).
import { parseStylesheet, urlsIn } from '../design-system/css-read';
import { FACE_DESCRIPTORS } from '../design-system/assets';

export const CSS2_URL = 'https://fonts.googleapis.com/css2';
export const GSTATIC_PREFIX = 'https://fonts.gstatic.com/s/';
export const REPOSITORY_URL = 'https://raw.githubusercontent.com/google/fonts/main';
/** The repository's licence directories, OFL first: a miss there probes the others only to name the refusal. */
export const LICENCE_DIRS = ['ofl', 'apache', 'ufl'] as const;
export type LicenceDir = (typeof LICENCE_DIRS)[number];
/** The CSS2 answer's bounds: its bytes, and its blocks (nine weights in two styles). */
export const CSS2_MAX_BYTES = 64 * 1024;
export const CSS2_MAX_BLOCKS = 18;
/** A family's files together; over it the family is refused by name (each file is also under the asset limit). */
export const FAMILY_MAX_BYTES = 32 * 1024 * 1024;
/** The user agent CSS2 answers in its unsliced woff2 form (the grounding's probe, 2026-10-21). */
export const UNSLICED_USER_AGENT = 'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:40.0) Gecko/20100101 Firefox/40.0';

// ---------------------------------------------------------------- the request

/** A face's canonical request: its family, the family's axis tuple as the link wrote it, and the URL MAWS fetches. */
export interface GoogleRequest {
  family: string;
  /** The axis tuple after `:` (`wght@400;700`, `ital,wght@0,400;1,400`), or null for the family's default. */
  axes: string | null;
  /** `https://fonts.googleapis.com/css2?family=<family>[:<axes>]`: the face's identity. */
  url: string;
  /** The family's directory in the google/fonts repository. */
  dir: string;
}

/** Why a face's link is refused before anything is fetched. */
export type LinkProblem = { kind: 'unreadable' } | { kind: 'subset' } | { kind: 'families'; named: string[] } | { kind: 'mismatch'; named: string };
export type RequestOf = { ok: true; request: GoogleRequest } | { ok: false; problem: LinkProblem };

// An axis tuple: tags (lower-case registered axes, upper-case custom ones), then values, ranges (`300..700`) and tuples.
const AXES_RE = /^[A-Za-z]{4}(?:,[A-Za-z]{4})*@[0-9.,;-]{1,200}$/;

/** The family's directory in the google/fonts repository: lowercased, everything outside [a-z0-9] removed. */
export const repositoryDir = (family: string): string => family.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The canonical request a face's `href` names for its `family`: exactly one `family=` parameter, naming the entry's own
 * family, and no `text=`; its axis tuple kept, every other parameter dropped. A link that breaks a rule is refused by
 * name: it is never fetched in another form (another family would pass the entry's licence and download a face it does
 * not hold; a subset is not a face for the deck's text).
 */
export function googleRequest(family: string, href: string): RequestOf {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { ok: false, problem: { kind: 'unreadable' } };
  }
  if (`${url.origin}${url.pathname}` !== CSS2_URL || url.username || url.password || url.port) return { ok: false, problem: { kind: 'unreadable' } };
  if (url.searchParams.has('text')) return { ok: false, problem: { kind: 'subset' } };
  const specs = url.searchParams.getAll('family');
  const names = specs.map((spec) => spec.split(':')[0]!.trim());
  if (specs.length === 0) return { ok: false, problem: { kind: 'unreadable' } };
  if (specs.length > 1) return { ok: false, problem: { kind: 'families', named: names } };
  const spec = specs[0]!;
  const colon = spec.indexOf(':');
  const named = names[0]!;
  if (named !== family) return { ok: false, problem: { kind: 'mismatch', named } };
  const axes = colon < 0 ? null : spec.slice(colon + 1);
  if (axes !== null && !AXES_RE.test(axes)) return { ok: false, problem: { kind: 'unreadable' } };
  return { ok: true, request: { family, axes, url: `${CSS2_URL}?family=${family.replace(/ /g, '+')}${axes === null ? '' : `:${axes}`}`, dir: repositoryDir(family) } };
}

/** The repository file a licence check reads: `METADATA.pb` or `OFL.txt` under a licence directory. */
export const repositoryUrl = (licence: LicenceDir, dir: string, file: 'METADATA.pb' | 'OFL.txt'): string => `${REPOSITORY_URL}/${licence}/${dir}/${file}`;

// ---------------------------------------------------------------- the licence

/**
 * A `METADATA.pb`'s top-level `name:` and `license:` (text protobuf): only fields outside every `{}` block are read,
 * since the nested `fonts {}` blocks repeat `name:` with each file's family.
 */
export function readMetadata(text: string): { name?: string; license?: string } {
  const out: { name?: string; license?: string } = {};
  let depth = 0;
  for (const line of text.split('\n')) {
    const field = depth === 0 ? /^\s*(name|license)\s*:\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line) : null;
    if (field && out[field[1] as 'name' | 'license'] === undefined) out[field[1] as 'name' | 'license'] = field[2]!.replace(/\\(.)/g, '$1');
    // the braces outside strings move the depth
    for (const ch of line.replace(/"(?:[^"\\]|\\.)*"/g, '')) {
      if (ch === '{') depth++;
      else if (ch === '}' && depth > 0) depth--;
    }
  }
  return out;
}

/** A `license:` value as a refusal names it (`APACHE2` is Apache-2.0); anything else verbatim, bounded. */
export function licenceName(license: string): string {
  const named: Record<string, string> = { OFL: 'OFL', APACHE2: 'Apache-2.0', UFL: 'UFL-1.0' };
  return named[license] ?? (license.replace(/[^\w .+-]/g, '').slice(0, 40) || 'unknown');
}

// ---------------------------------------------------------------- the CSS2 answer

/** One file of a family as the CSS2 answer names it. */
export interface Css2File {
  url: string;
  weight: string;
  style: 'normal' | 'italic';
}
export type Css2Answer = { ok: true; files: Css2File[] } | { ok: false; sliced: boolean; problem: string };

const GSTATIC_RE = /^https:\/\/fonts\.gstatic\.com\/s\/[A-Za-z0-9._~/-]+$/;
const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/s, '$2');

/**
 * The files of `family` in a CSS2 answer, or why it is refused: every node an `@font-face` block of the family alone,
 * its descriptors on design-system's allowlist, one `src` naming one `fonts.gstatic.com/s/` file, a style normal or
 * italic, one numeric weight, no `font-stretch` but normal, at most 18 blocks and one per style and weight. A block with
 * `unicode-range` makes the answer sliced (the host asks again for the unsliced form).
 */
export function parseCss2(text: string, family: string): Css2Answer {
  const refuse = (problem: string, sliced = false): Css2Answer => ({ ok: false, sliced, problem });
  if (new TextEncoder().encode(text).length > CSS2_MAX_BYTES) return refuse(`the answer is over ${CSS2_MAX_BYTES} bytes`);
  const { nodes, problems } = parseStylesheet(text);
  if (problems.length > 0) return refuse(`the answer is not a stylesheet MAWS reads (${problems[0]})`);
  if (nodes.length === 0) return refuse('the answer names no face');
  if (nodes.length > CSS2_MAX_BLOCKS) return refuse(`the answer has ${nodes.length} blocks (over ${CSS2_MAX_BLOCKS})`, nodes.some(hasRange));
  if (nodes.some(hasRange)) return refuse('the answer is sliced by unicode-range', true);
  const files: Css2File[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.kind !== 'at' || node.name !== 'font-face' || node.within.length > 0 || !node.declarations) return refuse('the answer holds something other than @font-face blocks');
    const declared = new Map<string, string[]>();
    for (const d of node.declarations) {
      if (!FACE_DESCRIPTORS.has(d.property)) return refuse(`a block carries ${d.property}`);
      declared.set(d.property, [...(declared.get(d.property) ?? []), d.value]);
    }
    const one = (property: string) => (declared.get(property)?.length === 1 ? declared.get(property)![0]! : null);
    const named = one('font-family');
    if (named === null || unquote(named) !== family) return refuse(`a block's font-family is ${named === null ? 'missing' : unquote(named)}, not ${family}`);
    const src = one('src');
    const urls = src === null ? [] : urlsIn(src);
    if (urls.length !== 1 || !GSTATIC_RE.test(urls[0]!) || src!.replace(/url\([^)]*\)/i, '').replace(/format\(\s*["'][a-z0-9-]+["']\s*\)/i, '').trim() !== '') return refuse('a block does not load exactly one fonts.gstatic.com/s/ file');
    const style = one('font-style') ?? 'normal';
    if (style !== 'normal' && style !== 'italic') return refuse(`a block's font-style is ${style}`);
    const weight = one('font-weight');
    if (weight === null || !/^\d{1,4}$/.test(weight) || Number(weight) < 1 || Number(weight) > 1000) return refuse(`a block's font-weight is ${weight ?? 'missing'}, not one number`);
    const stretch = one('font-stretch');
    if (declared.has('font-stretch') && stretch !== 'normal' && stretch !== '100%') return refuse(`a block's font-stretch is ${stretch}`);
    const key = `${style} ${weight}`;
    if (seen.has(key)) return refuse(`two blocks are ${key}`);
    seen.add(key);
    files.push({ url: urls[0]!, weight, style });
  }
  return { ok: true, files };
}
const hasRange = (node: ReturnType<typeof parseStylesheet>['nodes'][number]) => node.declarations?.some((d) => d.property === 'unicode-range') ?? false;

/** A font file's type from its first bytes (woff2, woff, TrueType, OpenType), or null when it is none of them. */
export function fontType(bytes: Uint8Array): { mime: string; ext: string } | null {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  if (tag === 'wOF2') return { mime: 'font/woff2', ext: 'woff2' };
  if (tag === 'wOFF') return { mime: 'font/woff', ext: 'woff' };
  if (tag === 'OTTO') return { mime: 'font/otf', ext: 'otf' };
  if (tag === '\u0000\u0001\u0000\u0000' || tag === 'true') return { mime: 'font/ttf', ext: 'ttf' };
  return null;
}

/** The asset name a fetched file is stored under (the store may make it unique): `gf-<dir>-<weight>[-italic].<ext>`. */
export const fileAssetName = (dir: string, file: Pick<Css2File, 'weight' | 'style'>, ext: string): string => `gf-${dir}-${file.weight}${file.style === 'italic' ? '-italic' : ''}.${ext}`;
export const licenceAssetName = (dir: string): string => `gf-${dir}-OFL.txt`;

// ---------------------------------------------------------------- what a reader shows

/** Why the host refused a family it reached (its record's `refused`, beside a licence's name). */
export const REFUSED_REASONS = { unlisted: 'unlisted', unserved: 'unserved', tooLarge: 'too-large', unreadable: 'unreadable' } as const;

/** A refusal in words, after the face's key: the licence, the link, or the files (the agent's answer and Theme ▸ Faces). */
export function refusalMessage(family: string, refused: string | LinkProblem): string {
  const fallback = 'so it draws as its fallback; upload a font file to use it';
  if (typeof refused !== 'string') {
    if (refused.kind === 'subset') return `${family}'s link carries text= (a subset of glyphs, not a face for the deck's text), so MAWS does not fetch it; it draws as its fallback; name the family without text=, or upload a font file`;
    if (refused.kind === 'families') return `${family}'s link names ${refused.named.length} families (${refused.named.join(', ')}); a face's link names one family, its own, so MAWS does not fetch it and it draws as its fallback`;
    if (refused.kind === 'mismatch') return `${family}'s link names ${refused.named || 'no family'}, not ${family}, so MAWS does not fetch it; it draws as its fallback`;
    return `${family}'s link is not a https://fonts.googleapis.com/css2?family=… link MAWS reads, ${fallback}`;
  }
  switch (refused) {
    case REFUSED_REASONS.unlisted:
      return `${family} is not in the Google Fonts repository (ofl/, apache/ or ufl/), so MAWS cannot read its licence, ${fallback}`;
    case REFUSED_REASONS.unserved:
      return `Google Fonts does not serve ${family} in the styles its link asks for, ${fallback}`;
    case REFUSED_REASONS.tooLarge:
      return `${family}'s files are over ${FAMILY_MAX_BYTES / 1024 / 1024} MB, more than a deck keeps, ${fallback}`;
    case REFUSED_REASONS.unreadable:
      return `Google Fonts answered ${family} in a form MAWS does not read, ${fallback}`;
    default:
      return `${family} is ${refused} on Google Fonts; MAWS fetches only OFL faces, ${fallback}`;
  }
}
