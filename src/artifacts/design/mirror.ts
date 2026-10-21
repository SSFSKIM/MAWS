// P3-E1 M2 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md; the parent's §1 "Mirror and library" and
// Decision Log 13 (3)): the design's linked-directory mirror (P3-L's `registerMirrorWriter`): `<slug>/canvas.json` and
// `<slug>/boards/<id>.html`, readable on disk. As C's deck writer does, every design-system token is replaced by its
// value in the governing system, with the design's own overrides over it and then left out of the manifest; but in the
// `document` medium the workbench draws boards in, not the deck's scale. A held board is its held source; its markup did
// not load, so what it references cannot be told, and while any board is held every upload is kept beside the boards
// (M2 fix wave: a board turning held never loses a picture its source still draws; the copies are lazy, so nothing is
// reread); once every board loads, only the uploads they name are. A board whose
// source never arrived has no file (its manifest entry stays). The uploaded assets the design names (pictures, CSS
// backgrounds, faces; a Google Fonts face the host fetched is the files it saved and their licence, P4-B2 D19's
// `faceAssetRefs`) are copied into `<slug>/assets/`. A legacy generic-file state (a design no actor has opened since
// E1, read at startup) is written as its migration would build it, on a temporary copy, never migrating the store's
// state; malformed legacy input throws, before the host replaces or removes any file. Portable: the host's design
// module gives it the governing system's tokens.
import type { Artifact } from '@shared/artifacts/entity';
import { tokenProperties } from '../design-system/css';
import { overrideLiterals } from '../design-system/resolve-vars';
import type { TokenSet } from '../design-system/tokens';
import type { TokenOverrides } from '../design-system/view';
import { mirrorSlug, type MirrorOutput, type MirrorWriter } from '../library/mirror';
import { slideAssetRefs } from '../slides/asset-refs';
import { faceAssetRefs } from '../slides/deck';
import { heldOf, readSlide } from '../slides/model';
import { serializeSlide } from '../slides/serialize';
import { serializeCanvasJson } from './canvas';
import { withDesignModel } from './migrate';
import { boardOrder, isMissingSource, readCanvas } from './model';

/**
 * The value of each `--ds-*` name on a board, as the workbench draws it: P3-D's literal resolver over the system's
 * document-medium values (none when the tokens do not resolve, or there is no system), the design's overrides on top.
 */
export function designTokenValues(tokens: TokenSet | null, overrides?: TokenOverrides): (name: string) => string | undefined {
  let system = new Map<string, string>();
  try {
    if (tokens) system = tokenProperties(tokens, 'document');
  } catch {
    // a system mid-edit whose tokens do not resolve: every token takes its fallback
  }
  const values = overrideLiterals(system, overrides);
  return (name) => values.get(name);
}

/** The writer, over `tokensOf`: the tokens of the system governing an artifact, null when none can be read. */
export function designMirrorWriter(tokensOf: (artifact: Artifact) => TokenSet | null): MirrorWriter {
  return ({ artifact, doc, assets = [], readAsset }) => {
    if (!doc) return { files: {} };
    return withDesignModel(doc, (model) => {
      const folder = mirrorSlug(artifact);
      const { dsOverrides, ...canvas } = readCanvas(model);
      const resolveVar = designTokenValues(tokensOf(artifact), dsOverrides);
      const files: MirrorOutput['files'] = { [`${folder}/canvas.json`]: serializeCanvasJson(canvas) };
      const used = new Set<string>();
      let anyHeld = false;
      for (const face of Object.values(canvas.faces ?? {})) for (const ref of faceAssetRefs(face)) used.add(ref);
      for (const id of boardOrder(model)) {
        if (isMissingSource(model, id)) continue;
        const held = heldOf(model, id);
        const board = held ? null : readSlide(model, id);
        if (board) for (const ref of slideAssetRefs(board)) used.add(ref);
        else anyHeld = true;
        files[`${folder}/boards/${id}.html`] = held?.source ?? serializeSlide(board!, { resolveVar });
      }
      if (readAsset) for (const { ref } of assets) if (anyHeld || used.has(ref)) files[`${folder}/${ref}`] = { read: () => readAsset(ref) };
      return { files };
    });
  };
}
