// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D11, D6; M8 fix wave 1, R2): the uploaded faces a
// version's preview draws with: the version's own `faces`, each resolved against the version's assets (content-addressed
// and kept while a version references them), so a face the deck re-mapped or replaced since draws as it was. A family
// only the earlier state of the comparison has (a deleted element ghosted in it) comes from that state's assets.
import type { AssetUrl } from '../../canvas';
import type { Doc } from '../../../yjs';
import { readDeckView } from '../deck-view';
import { faceRules } from '../page-styles';

export function previewFaceRules(docs: { shown: Doc; earlier: Doc }, assets: { shown: AssetUrl; earlier: AssetUrl }): string {
  const shown = readDeckView(docs.shown).faces;
  const families = new Set(Object.values(shown).map((face) => face.family));
  const earlierOnly = Object.fromEntries(Object.entries(readDeckView(docs.earlier).faces).filter(([, face]) => !families.has(face.family)));
  return [faceRules(earlierOnly, assets.earlier), faceRules(shown, assets.shown)].filter(Boolean).join('\n');
}
