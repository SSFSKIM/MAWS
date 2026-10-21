// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11, D6; M8 fix waves 1 and 2, R2): the faces a
// version's preview draws with (an upload's file, or the files the host saved for a Google Fonts face: P4-B2 D19). Each
// state of the comparison (the version shown, and the earlier state its deleted elements are ghosted from) declares its
// own `faces`, each resolved against that state's assets (content-addressed and kept while a version references them),
// under a private family name of its own (`deck-face-…`, from the face's URLs, which name the artifact and the
// revision, and the family), and the preview's canvases have their font-family values
// rewritten to those names. An @font-face rule is the whole window's: under the authored name a live editor of the same
// deck in the same window (a panel beside a main tab) and the preview, or the version and its earlier state, would
// compete for one family. D's design-system scopes alias their faces the same way (design-system/assets.ts). Display
// only: nothing is written to the model, and the live editor keeps the authored names.
import type { AssetUrl } from '../../canvas';
import { aliasFamilyList, type FaceAliases } from '../../canvas/faces';
import type { Doc } from '../../../yjs';
import { readDeckView } from '../deck-view';
import { declareFaces } from '../page-styles';

export type { FaceAliases } from '../../canvas/faces';
export { aliasFamilyList } from '../../canvas/faces';

export interface PreviewFaces {
  css: string;
  shown: FaceAliases;
  earlier: FaceAliases;
}

/** Both states' faces under their private names, and each state's names for the canvases' font-family values. */
export function previewFaces(docs: { shown: Doc; earlier: Doc }, assets: { shown: AssetUrl; earlier: AssetUrl }): PreviewFaces {
  const shown = declareFaces(readDeckView(docs.shown).faces, assets.shown);
  const earlier = declareFaces(readDeckView(docs.earlier).faces, assets.earlier);
  return { css: [...earlier.rules, ...shown.rules].join('\n'), shown: shown.aliases, earlier: earlier.aliases };
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

/**
 * Fix wave 3: the state's design-system overrides with each font token (`--ds-font-*`: the Theme's Body and Display
 * faces, which may name a deck-uploaded family) mapped through the same private names, so text reading the token draws
 * the upload the preview declared.
 */
export function aliasOverrides(overrides: Readonly<Record<string, string>>, aliases: FaceAliases): Record<string, string> {
  return Object.fromEntries(Object.entries(overrides).map(([name, value]) => [name, name.startsWith('--ds-font-') ? aliasFamilyList(value, aliases) : value]));
}
