// P3-E1 M2 (the parent's §1 "Mirror and library", Decision Log 13 (3)): the design's linked-directory writer. A design is
// mirrored as `<slug>/canvas.json` (its manifest, the design's overrides left out) and `<slug>/boards/<id>.html` (each
// board's file with every token resolved in the governing system's document medium, the overrides over it), a held
// board as its source, no file for a board whose source never arrived, and the uploaded assets it names copied beside
// them. A legacy generic-file state is mirrored as its migration would build it, without writing the state; malformed
// legacy input throws before the mirror replaces anything.
import { describe, expect, it } from 'vitest';
import type { Artifact } from '@shared/artifacts/entity';
import { tokenProperties } from '../design-system/css';
import { literalValues } from '../design-system/resolve-vars';
import { builtinView } from '../design-system/view';
import { FilesError, publishFiles } from '../files';
import { isMirrorCopy, mirrorSlug, type MirrorCopy } from '../library/mirror';
import { LORA_FILES, LORA_LICENCE, loraFace, robotoSlabFace, TODAYS_FACES } from '../slides/export/faces.test-support';
import { newDoc, stateV2, transact, type Doc } from '../yjs';
import * as Y from '../yjs/slides';
import { boardPath, CANVAS_PATH } from './canvas';
import { designMirrorWriter, designTokenValues } from './mirror';
import { publishCanvas } from './publish';

const tokens = builtinView().tokens;
const documentMedium = tokenProperties(tokens, 'document');
const ARTIFACT = { id: '0f0e0d0c-0b0a-4908-8706-050403020100', kind: 'design', title: 'Launch' } as Artifact;
const FOLDER = mirrorSlug(ARTIFACT);

const HELD = '<section id="broken" style="background:#ffffff">\n<div id="box">loose text</div>\n</section>';
const FILES = {
  [CANVAS_PATH]: JSON.stringify({
    v: 1,
    title: 'Launch',
    boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, broken: { x: 500, y: 0, w: 390, h: 844 }, ghost: { x: 1000, y: 0, w: 390, h: 844 } },
    order: ['phone', 'broken', 'ghost'],
    faces: { brand: { family: 'Brand', src: 'assets/brand.woff2' } },
    dsOverrides: { '--ds-color-bg': '#101010' },
  }),
  [boardPath('phone')]: '<section id="phone" style="background:var(--ds-color-bg, #ffffff)"><img id="logo" src="assets/logo.png" alt="Logo"><p id="p" style="font-size:var(--ds-type-body-size, 16px); color:var(--ds-color-text, #000000)">Sign in</p></section>',
  [boardPath('broken')]: HELD,
};
const ASSETS = ['logo.png', 'brand.woff2', 'unused.png'].map((name) => ({ ref: `assets/${name}`, name, mime: 'application/octet-stream', size: 1 }));

function model(files: Record<string, string> = FILES): Doc {
  const doc = newDoc();
  publishCanvas(doc, {}, files, false);
  return doc;
}
function legacy(files: Record<string, string> = FILES): Doc {
  const doc = newDoc();
  publishFiles(doc, {}, files, false);
  return doc;
}
const write = (doc: Doc, reads: string[] = []) =>
  designMirrorWriter(() => tokens)({ artifact: ARTIFACT, doc, assets: ASSETS, readAsset: (ref) => (reads.push(ref), new Uint8Array([ref.length])) }).files;

describe('the design mirror writer', () => {
  it('writes the manifest without the overrides and each board with its tokens resolved in the document medium', () => {
    const files = write(model());
    // a held board (`broken`) keeps every upload in the mirror, `unused.png` too, until all boards load
    expect(Object.keys(files).sort()).toEqual([`${FOLDER}/assets/brand.woff2`, `${FOLDER}/assets/logo.png`, `${FOLDER}/assets/unused.png`, `${FOLDER}/boards/broken.html`, `${FOLDER}/boards/phone.html`, `${FOLDER}/canvas.json`]);
    const canvas = JSON.parse(files[`${FOLDER}/canvas.json`] as string) as Record<string, unknown>;
    expect(canvas).toMatchObject({ v: 1, title: 'Launch', order: ['phone', 'broken', 'ghost'], boards: { phone: { x: 0, y: 0, w: 390, h: 844, title: 'Phone' }, ghost: { w: 390 } } });
    expect(canvas.dsOverrides).toBeUndefined();
    const phone = files[`${FOLDER}/boards/phone.html`] as string;
    expect(phone).not.toContain('var(');
    expect(phone).toContain('background:#101010'); // the design's override over the system
    expect(phone).toContain(`font-size:${documentMedium.get('--ds-type-body-size')}`); // the document medium, not the deck's scale
    expect(phone).toContain(`color:${documentMedium.get('--ds-color-text')}`);
    expect(files[`${FOLDER}/boards/broken.html`]).toBe(HELD); // a held board as its source
    expect(files[`${FOLDER}/boards/ghost.html`]).toBeUndefined(); // no HTML invented for a missing source
  });

  it('copies only the assets the design names, each read when the mirror asks', () => {
    const reads: string[] = [];
    const files = write(model(), reads);
    expect(reads).toEqual([]);
    const copy = files[`${FOLDER}/assets/logo.png`];
    expect(isMirrorCopy(copy)).toBe(true);
    expect([...(copy as MirrorCopy).read()]).toEqual(['assets/logo.png'.length]);
    expect(reads).toEqual(['assets/logo.png']);
  });

  it('keeps every upload while a board is held, however its source spells a reference; only named ones once all boards load (M2 fix wave)', () => {
    const held = String.raw`<section id="broken" style="background:url(assets/unused\2e png)"><div id="box">loose text</div><img id="logo" src="assets/logo&#46;png"></section>`;
    const files = write(model({ ...FILES, [boardPath('broken')]: held }));
    expect(files[`${FOLDER}/boards/broken.html`]).toBe(held);
    expect(Object.keys(files).filter((file) => file.includes('/assets/')).sort()).toEqual([`${FOLDER}/assets/brand.woff2`, `${FOLDER}/assets/logo.png`, `${FOLDER}/assets/unused.png`]);
    const loaded = write(model({ ...FILES, [boardPath('broken')]: '<section id="broken"><p id="t">Fixed</p></section>' }));
    expect(Object.keys(loaded).filter((file) => file.includes('/assets/')).sort()).toEqual([`${FOLDER}/assets/brand.woff2`, `${FOLDER}/assets/logo.png`]);
  });

  // P4-B2 D19 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): a Google Fonts face the host fetched is its
  // saved files and their licence, copied as the boards' uploads are
  it('copies a fetched face’s files and its licence once every board loads; a refused face copies nothing', () => {
    const doc = model({ ...FILES, [boardPath('broken')]: '<section id="broken"><p id="t">Fixed</p></section>' });
    transact(doc, () => {
      Y.setDeckEntry(doc, 'faces', 'lora', loraFace() as Y.Json);
      Y.setDeckEntry(doc, 'faces', 'roboto-slab', robotoSlabFace() as Y.Json);
    });
    const gf = [...LORA_FILES.map((file) => file.src), LORA_LICENCE, 'assets/gf-robotoslab-400.woff2'].map((ref) => ({ ref, name: ref.slice('assets/'.length), mime: 'application/octet-stream', size: 1 }));
    const files = designMirrorWriter(() => tokens)({ artifact: ARTIFACT, doc, assets: [...ASSETS, ...gf], readAsset: () => new Uint8Array([1]) }).files;
    const saved = [...LORA_FILES.map((file) => file.src), LORA_LICENCE].map((ref) => `${FOLDER}/${ref}`);
    expect(Object.keys(files).filter((file) => file.includes('/assets/')).sort()).toEqual([`${FOLDER}/assets/brand.woff2`, `${FOLDER}/assets/logo.png`, ...saved].sort());
  });

  // the architect's condition: a design whose faces are today's shape mirrors exactly as before (pinned from the pre-D19 code)
  it('copies today’s faces as before: the upload, and nothing for a link with no record or a blob', () => {
    const doc = model({
      [CANVAS_PATH]: JSON.stringify({ v: 1, title: 'Launch', boards: { phone: { x: 0, y: 0, w: 390, h: 844 } }, order: ['phone'], faces: TODAYS_FACES }),
      [boardPath('phone')]: '<section id="phone" style="background:#ffffff"><img id="logo" src="assets/logo.png" alt="Logo"></section>',
    });
    expect(Object.keys(write(doc)).sort()).toEqual([`${FOLDER}/assets/brand.woff2`, `${FOLDER}/assets/logo.png`, `${FOLDER}/boards/phone.html`, `${FOLDER}/canvas.json`]);
  });

  it('mirrors a legacy generic-file state as its migration would build it, writing nothing to the state', () => {
    const doc = legacy();
    const before = stateV2(doc);
    const files = write(doc);
    expect(Object.keys(files).sort()).toEqual(Object.keys(write(model())).sort());
    expect(files[`${FOLDER}/boards/phone.html`]).toBe(write(model())[`${FOLDER}/boards/phone.html`]);
    expect(stateV2(doc)).toEqual(before);
  });

  it('throws for malformed legacy input, so the host keeps every file it mirrored before', () => {
    expect(() => write(legacy({ ...FILES, [CANVAS_PATH]: '{"v":' }))).toThrow(FilesError);
  });

  it('writes nothing for an artifact the host read no document for', () => {
    expect(designMirrorWriter(() => tokens)({ artifact: ARTIFACT }).files).toEqual({});
  });
});

describe('the design mirror’s token values (parity with P3-D’s resolver, document medium)', () => {
  it('resolves an override chain and a cycle as D’s resolver does', () => {
    const cases: Record<string, string>[] = [{ '--ds-color-bg': 'var(--ds-color-text)', '--ds-color-text': 'var(--ds-color-bg)' }, { '--ds-color-bg': '#101010', '--ds-color-accent': 'var(--ds-color-bg)' }];
    for (const overrides of cases) {
      const values = designTokenValues(tokens, overrides);
      for (const [name, value] of literalValues(tokens, 'document', overrides)) expect(values(name), name).toBe(value);
    }
  });

  it('applies the overrides alone when no system can be read', () => {
    expect(designTokenValues(null, { '--ds-color-bg': '#101010' })('--ds-color-bg')).toBe('#101010');
  });
});
