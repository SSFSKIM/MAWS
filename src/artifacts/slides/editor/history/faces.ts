// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11, D6; M8 fix waves 1 and 2, R2): the uploaded faces
// a version's preview draws with. Each state of the comparison (the version shown, and the earlier state its deleted
// elements are ghosted from) declares its own `faces`, each resolved against that state's assets (content-addressed and
// kept while a version references them), under a private family name of its own (`deck-face-…`, from the face's URL,
// which names the artifact and the revision, and the family), and the preview's canvases have their font-family values
// rewritten to those names. An @font-face rule is the whole window's: under the authored name a live editor of the same
// deck in the same window (a panel beside a main tab) and the preview, or the version and its earlier state, would
// compete for one family. D's design-system scopes alias their faces the same way (design-system/assets.ts). Display
// only: nothing is written to the model, and the live editor keeps the authored names.
import type { AssetUrl } from '../../canvas';
import type { DeckFace } from '../../deck';
import type { Doc } from '../../../yjs';
import { stableHash } from '../../../design-system/hash';
import { readDeckView } from '../deck-view';

/** Lower-cased authored family → the state's private name. */
export type FaceAliases = ReadonlyMap<string, string>;

export interface PreviewFaces {
  css: string;
  shown: FaceAliases;
  earlier: FaceAliases;
}

const quoted = (name: string) => JSON.stringify(name);

function declare(faces: Readonly<Record<string, DeckFace>>, assetUrl: AssetUrl): { rules: string[]; aliases: Map<string, string> } {
  const rules: string[] = [];
  const aliases = new Map<string, string>();
  for (const face of Object.values(faces)) {
    const url = typeof face.src === 'string' && face.src.startsWith('assets/') ? assetUrl(face.src) : null;
    if (!url || typeof face.family !== 'string') continue;
    const key = face.family.toLowerCase();
    const alias = aliases.get(key) ?? `deck-face-${stableHash(`${url}\n${key}`)}`;
    aliases.set(key, alias);
    rules.push(`@font-face { font-family: ${quoted(alias)}; src: url(${quoted(url)}); }`);
  }
  return { rules, aliases };
}

/** Both states' faces under their private names, and each state's names for the canvases' font-family values. */
export function previewFaces(docs: { shown: Doc; earlier: Doc }, assets: { shown: AssetUrl; earlier: AssetUrl }): PreviewFaces {
  const shown = declare(readDeckView(docs.shown).faces, assets.shown);
  const earlier = declare(readDeckView(docs.earlier).faces, assets.earlier);
  return { css: [...earlier.rules, ...shown.rules].join('\n'), shown: shown.aliases, earlier: earlier.aliases };
}

/** A CSS font-family list with each authored family the state declares replaced by its private name (`var()` left). */
export function aliasFamilyList(value: string, aliases: FaceAliases): string {
  if (aliases.size === 0 || value.includes('var(')) return value;
  const names: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      names.push(current.trim());
      current = '';
    } else current += ch;
  }
  names.push(current.trim());
  return names
    .map((name) => {
      const bare = /^(["']).*\1$/.test(name) ? name.slice(1, -1) : name.replace(/\s+/g, ' ');
      const alias = aliases.get(bare.toLowerCase());
      return alias ? quoted(alias) : name;
    })
    .join(', ');
}

/** Rewrites the font-family of a drawn slide (its section and every element) to the state's private names. */
export function aliasFaces(root: HTMLElement, aliases: FaceAliases): void {
  if (aliases.size === 0) return;
  for (const node of [root, ...root.querySelectorAll<HTMLElement>('[style]')]) {
    const value = node.style.getPropertyValue('font-family');
    if (!value) continue;
    const next = aliasFamilyList(value, aliases);
    if (next !== value) node.style.setProperty('font-family', next);
  }
}
