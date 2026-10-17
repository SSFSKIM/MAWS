// P3-E1 M2 (the parent's Decision Log 11 (1) and 13 (3)): the portable half of the legacy migration. A design made before
// E1 holds its files in the generic `files` root; `migrateDesign` builds the model from them in one transaction and
// empties the root only once the whole model validated, answering whether it wrote; a second run finds the model and
// writes nothing; malformed input refuses with every file kept. A retained version still reads as its files, and the
// projection (the mirror's, history's and export's view of a legacy state) never writes the state it is given.
import { describe, expect, it } from 'vitest';
import { FilesError, publishFiles, readFiles } from '../files';
import { slideOrder } from '../slides/model';
import { newDoc, onUpdate, stateV2, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { createDesignAdapter } from './adapter';
import { boardPath, CANVAS_PATH } from './canvas';
import { boardFrame, designFiles, isMissingSource, readCanvas } from './model';
import { isLegacyDesign, migrateDesign, withDesignModel } from './migrate';
import { design } from './fixtures/support';

const PHONE = '<section id="phone" style="background:#fff"><h1 id="t" style="font-size:32px">Sign in</h1></section>';
const POSTER = '<section id="poster"><h1 id="t" style="font-size:96px">Poster</h1></section>';
const LEGACY = {
  [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'Launch', boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, poster: { x: 500, y: 0, w: 1080, h: 10_000 } }, order: ['phone', 'poster'], brand: { tone: 'calm' } }),
  [boardPath('phone')]: PHONE,
  [boardPath('poster')]: POSTER,
};

/** A design as a build before E1 stored it: its files under the generic root, nothing else. */
function legacy(files: Record<string, string> = LEGACY): Doc {
  const doc = newDoc();
  publishFiles(doc, {}, files, false);
  return doc;
}
function updatesOf(doc: Doc, run: () => void): number {
  let n = 0;
  const off = onUpdate(doc, () => n++);
  try {
    run();
  } finally {
    off();
  }
  return n;
}

describe('the legacy migration (Decision Log 11 (1))', () => {
  it('builds the model from a generic-file design in one transaction and empties the generic root', () => {
    const doc = legacy();
    expect(isLegacyDesign(doc)).toBe(true);
    let wrote = false;
    expect(updatesOf(doc, () => (wrote = migrateDesign(doc)))).toBe(1);
    expect(wrote).toBe(true);
    expect(isLegacyDesign(doc)).toBe(false);
    expect(readFiles(doc)).toEqual({});
    expect(slideOrder(doc)).toEqual(['phone', 'poster']);
    expect(boardFrame(doc, 'poster')).toEqual({ x: 500, y: 0, w: 1080, h: 10_000 });
    expect(readCanvas(doc)).toMatchObject({ title: 'Launch', brand: { tone: 'calm' }, boards: { phone: { title: 'Phone' } } });
    expect(designFiles(doc)[boardPath('phone')]).toMatch(/<h1 id="t"/);
  });

  it('is idempotent: a migrated design and a model design write nothing and answer false', () => {
    const doc = legacy();
    migrateDesign(doc);
    expect(updatesOf(doc, () => expect(migrateDesign(doc)).toBe(false))).toBe(0);
    const model = design();
    expect(updatesOf(model, () => expect(migrateDesign(model)).toBe(false))).toBe(0);
    const empty = newDoc(); // a design created empty before E1: nothing to migrate
    expect(updatesOf(empty, () => expect(migrateDesign(empty)).toBe(false))).toBe(0);
  });

  it('keeps the warned defaults of a publish: a file without a manifest entry is placed, an entry without a file held as missing', () => {
    const doc = legacy({ [CANVAS_PATH]: JSON.stringify({ v: 1, boards: { ghost: { x: 0, y: 0, w: 390, h: 844 } }, order: ['ghost'] }), [boardPath('poster')]: POSTER });
    expect(migrateDesign(doc)).toBe(true);
    expect(isMissingSource(doc, 'ghost')).toBe(true);
    expect(boardFrame(doc, 'poster')).toEqual({ x: 490, y: 0, w: 1920, h: 1080 });
  });

  it('refuses malformed input naming the problem, writing nothing and keeping every file', () => {
    for (const files of [
      { ...LEGACY, [CANVAS_PATH]: '{"v":1,"boards":' }, // an unparseable manifest
      { ...LEGACY, [CANVAS_PATH]: JSON.stringify({ v: 1, boards: {}, order: [], sections: {} }) }, // the deck-only key
      { ...LEGACY, 'notes/readme.md': 'not a design file' }, // a path the model cannot hold
      { ...LEGACY, [CANVAS_PATH]: JSON.stringify({ v: 1, boards: { phone: { x: 0, y: 0, w: 20_000, h: 10 } }, order: ['phone'] }) }, // over the side cap
    ]) {
      const doc = legacy(files);
      const before = stateV2(doc);
      let error: unknown;
      expect(updatesOf(doc, () => {
        try {
          migrateDesign(doc);
        } catch (e) {
          error = e;
        }
      })).toBe(0);
      expect(error).toBeInstanceOf(FilesError);
      expect(stateV2(doc)).toEqual(before);
      expect(readFiles(doc)).toEqual(files);
    }
  });

  it('refuses a design holding both generic files and boards rather than choosing one', () => {
    const doc = design();
    publishFiles(doc, {}, { [boardPath('b1')]: PHONE.replace('phone', 'b1') }, false);
    expect(() => migrateDesign(doc)).toThrow(/b1/);
    expect(isLegacyDesign(doc)).toBe(true);
  });
});

describe('a legacy state read without migrating it', () => {
  it('the adapter reads a retained legacy version as the files it was, and its paths as theirs', () => {
    const adapter = createDesignAdapter();
    const doc = legacy();
    expect(adapter.readFiles!(doc)).toEqual(readFiles(doc));
    expect(adapter.paths!(doc)).toEqual(Object.keys(readFiles(doc)));
    expect(adapter.migrate!(doc)).toBe(true); // the adapter's hook is the migration
    expect(Object.keys(adapter.readFiles!(doc))).toEqual([CANVAS_PATH, boardPath('phone'), boardPath('poster')]);
  });

  it('projects a legacy state into the model on a temporary copy, leaving the given doc as it was', () => {
    const doc = legacy();
    const before = stateV2(doc);
    const seen = withDesignModel(doc, (model) => {
      expect(model).not.toBe(doc);
      return { order: slideOrder(model), files: designFiles(model) };
    });
    expect(seen.order).toEqual(['phone', 'poster']);
    expect(seen.files[CANVAS_PATH]).toMatch(/"Launch"/);
    expect(stateV2(doc)).toEqual(before);
    expect(Y.slideIds(doc)).toEqual([]);
  });

  it('hands a model doc through as it is, and throws for malformed legacy input before using it', () => {
    const model = design();
    expect(withDesignModel(model, (d) => d)).toBe(model);
    let used = false;
    expect(() => withDesignModel(legacy({ [CANVAS_PATH]: 'nope' }), () => (used = true))).toThrow(FilesError);
    expect(used).toBe(false);
  });
});
