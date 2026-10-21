// P4-B2 D19: the portable half of a Google Fonts face's fetch, over the answers the grounding's live probes recorded
// (2026-10-21, e2e/fixtures/google-fonts/): the canonical request, the repository directory rule, the METADATA.pb reader,
// the CSS2 parser, the magic bytes, and the model's record (deck.ts): what validates, what a reader draws, what the loader
// drops.
import { describe, expect, it } from 'vitest';
import chromeLora from '../../../e2e/fixtures/google-fonts/lora-chrome.css.txt?raw';
import badRequest from '../../../e2e/fixtures/google-fonts/css2-400.html?raw';
import loraUnsliced from '../../../e2e/fixtures/google-fonts/lora-ff40.css.txt?raw';
import loraItalic from '../../../e2e/fixtures/google-fonts/lora-ital-ff40.css.txt?raw';
import loraTtf from '../../../e2e/fixtures/google-fonts/lora-wght-noua.css.txt?raw';
import loraMetadata from '../../../e2e/fixtures/google-fonts/ofl-lora-METADATA.pb?raw';
import robotoSlabMetadata from '../../../e2e/fixtures/google-fonts/apache-robotoslab-METADATA.pb?raw';
import sourceSerifRange from '../../../e2e/fixtures/google-fonts/sourceserif4-range-ff40.css.txt?raw';
import { carryRecord, faceAssetRefs, faceFiles, googleFaceState, googleRecord, parseDeckJson, serializeDeckJson, withoutRecord, type DeckFace } from './deck';
import { fontType, googleRequest, licenceName, parseCss2, readMetadata, refusalMessage, repositoryDir } from './google-faces';

const LORA = 'https://fonts.googleapis.com/css2?family=Lora';
const saved = (request = LORA) => ({ request, licence: 'OFL', licenceSrc: 'assets/gf-lora-OFL.txt', files: [{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }] });

describe('the canonical request', () => {
  it('keeps the entry’s one family with its axis tuple and drops every other parameter', () => {
    expect(googleRequest('Source Serif 4', 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700&display=swap')).toEqual({
      ok: true,
      request: { family: 'Source Serif 4', axes: 'wght@300..700', url: 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700', dir: 'sourceserif4' },
    });
    expect(googleRequest('Lora', 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;1,400&display=swap')).toMatchObject({ ok: true, request: { url: 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;1,400' } });
    expect(googleRequest('Lora', 'https://fonts.googleapis.com/css2?display=swap&family=Lora')).toMatchObject({ ok: true, request: { url: LORA, axes: null } });
  });

  it('refuses by name a link naming another family, several families or a text= subset (amendment, Decision Log 9)', () => {
    expect(googleRequest('Lora', 'https://fonts.googleapis.com/css2?family=Roboto+Slab')).toEqual({ ok: false, problem: { kind: 'mismatch', named: 'Roboto Slab' } });
    expect(googleRequest('Lora', 'https://fonts.googleapis.com/css2?family=Lora&family=Inter:wght@400')).toEqual({ ok: false, problem: { kind: 'families', named: ['Lora', 'Inter'] } });
    expect(googleRequest('Lora', 'https://fonts.googleapis.com/css2?family=Lora&text=Hello')).toEqual({ ok: false, problem: { kind: 'subset' } });
    for (const href of ['https://fonts.googleapis.com/css?family=Lora', 'https://fonts.googleapis.com/css2?display=swap', 'https://fonts.googleapis.com/css2?family=Lora:wght@400%3Cscript', 'https://u:p@fonts.googleapis.com/css2?family=Lora', 'not a url'])
      expect(googleRequest('Lora', href)).toEqual({ ok: false, problem: { kind: 'unreadable' } });
    expect(refusalMessage('Lora', { kind: 'mismatch', named: 'Roboto Slab' })).toContain('names Roboto Slab, not Lora');
    expect(refusalMessage('Lora', { kind: 'subset' })).toContain('text=');
  });

  it('maps a family to its repository directory', () => {
    const table: [string, string][] = [
      ['Noto Sans KR', 'notosanskr'],
      ['M PLUS 1p', 'mplus1p'],
      ['Source Serif 4', 'sourceserif4'],
      ['Roboto Slab', 'robotoslab'],
      ['IBM Plex Sans KR', 'ibmplexsanskr'],
      ['Lora', 'lora'],
    ];
    for (const [family, dir] of table) expect(repositoryDir(family)).toBe(dir);
  });
});

describe('METADATA.pb', () => {
  it('reads the top-level name and license, past the fonts blocks that repeat name', () => {
    expect(readMetadata(loraMetadata)).toEqual({ name: 'Lora', license: 'OFL' });
    expect(readMetadata(robotoSlabMetadata)).toEqual({ name: 'Roboto Slab', license: 'APACHE2' });
    expect(readMetadata('fonts {\n  name: "Inner"\n}\nname: "Outer"\nlicense: "OFL"\n')).toEqual({ name: 'Outer', license: 'OFL' });
    expect(readMetadata('copyright: "a { brace"\nname: "Top"\n')).toEqual({ name: 'Top' });
    expect(readMetadata('404: Not Found')).toEqual({});
  });

  it('names a licence as a refusal says it', () => {
    expect(licenceName('APACHE2')).toBe('Apache-2.0');
    expect(licenceName('UFL')).toBe('UFL-1.0');
    expect(refusalMessage('Roboto Slab', licenceName('APACHE2'))).toBe('Roboto Slab is Apache-2.0 on Google Fonts; MAWS fetches only OFL faces, so it draws as its fallback; upload a font file to use it');
  });
});

describe('the CSS2 answer', () => {
  it('reads the unsliced answer: one gstatic file per style and weight', () => {
    expect(parseCss2(loraUnsliced, 'Lora')).toEqual({ ok: true, files: [{ url: 'https://fonts.gstatic.com/s/lora/v37/0QI6MX1D_JOuGQbT0gvTJPa787weuyJD.woff2', weight: '400', style: 'normal' }] });
    const italic = parseCss2(loraItalic, 'Lora');
    expect(italic.ok && italic.files.map((f) => `${f.style} ${f.weight}`)).toEqual(['italic 400', 'normal 400', 'normal 700']);
  });

  it('reads a weight range as the static weights the answer lists', () => {
    const range = parseCss2(sourceSerifRange, 'Source Serif 4');
    expect(range.ok && range.files.map((f) => f.weight)).toEqual(['300', '400', '500', '600', '700']);
  });

  it('reads the TTF form the host falls back to', () => {
    const ttf = parseCss2(loraTtf, 'Lora');
    expect(ttf.ok && ttf.files.map((f) => f.url.endsWith('.ttf'))).toEqual([true, true]);
  });

  it('refuses the sliced answer a modern browser gets, saying it is sliced', () => {
    expect(parseCss2(chromeLora, 'Lora')).toMatchObject({ ok: false, sliced: true });
  });

  it('refuses Google’s HTTP 400 page, another family’s block, and a block that loads anything but one gstatic file', () => {
    expect(parseCss2(badRequest, 'Not A Real Family')).toMatchObject({ ok: false, sliced: false, problem: expect.stringContaining('not a stylesheet') });
    expect(parseCss2(loraUnsliced, 'Lora Italic')).toMatchObject({ ok: false, problem: expect.stringContaining('font-family is Lora') });
    const block = (src: string, extra = '') => `@font-face { font-family: 'Lora'; font-style: normal; font-weight: 400; src: ${src};${extra} }`;
    expect(parseCss2(block("url(https://evil.example/s/x.woff2) format('woff2')"), 'Lora')).toMatchObject({ ok: false });
    expect(parseCss2(block("local(Lora), url(https://fonts.gstatic.com/s/lora/x.woff2)"), 'Lora')).toMatchObject({ ok: false });
    expect(parseCss2(block("url(https://fonts.gstatic.com/s/lora/x.woff2)", ' font-weight: 700;'), 'Lora')).toMatchObject({ ok: false });
    expect(parseCss2(block("url(https://fonts.gstatic.com/s/lora/x.woff2)").replace('font-weight: 400', 'font-weight: 400 700'), 'Lora')).toMatchObject({ ok: false });
    expect(parseCss2(block("url(https://fonts.gstatic.com/s/lora/x.woff2)").replace('normal', 'oblique 10deg'), 'Lora')).toMatchObject({ ok: false });
    expect(parseCss2(`${block("url(https://fonts.gstatic.com/s/lora/x.woff2)")}\n.x { color: red }`, 'Lora')).toMatchObject({ ok: false });
    expect(parseCss2(Array.from({ length: 19 }, (_, i) => block(`url(https://fonts.gstatic.com/s/lora/${i}.woff2)`).replace('400', String(100 + i))).join('\n'), 'Lora')).toMatchObject({ ok: false });
  });

  it('tells font files by their first bytes', () => {
    const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    expect(fontType(bytes('wOF2....'))).toEqual({ mime: 'font/woff2', ext: 'woff2' });
    expect(fontType(new Uint8Array([0, 1, 0, 0, 0, 16]))).toEqual({ mime: 'font/ttf', ext: 'ttf' });
    expect(fontType(bytes('OTTO'))).toEqual({ mime: 'font/otf', ext: 'otf' });
    expect(fontType(bytes('<!DOCTYPE html>'))).toBeNull();
  });
});

describe('the face’s host record (X27 as amended)', () => {
  const lora: DeckFace = { family: 'Lora', href: `${LORA}&display=swap`, google: saved() };

  it('draws a saved record’s files, with their weight and style, and keeps its licence beside them', () => {
    expect(faceFiles(lora)).toEqual([{ src: 'assets/gf-lora-400.woff2', weight: '400', style: 'normal' }]);
    expect(faceAssetRefs(lora)).toEqual(['assets/gf-lora-400.woff2', 'assets/gf-lora-OFL.txt']);
    expect(googleFaceState(lora)).toEqual({ state: 'saved' });
  });

  it('draws an uploaded face as before, and a face with no record as pending', () => {
    expect(faceFiles({ family: 'Brand', src: 'assets/brand.woff2' })).toEqual([{ src: 'assets/brand.woff2' }]);
    expect(faceFiles({ family: 'Brand', src: '/_blob/abc' })).toEqual([]);
    expect(googleFaceState({ family: 'Brand', src: 'assets/brand.woff2' })).toBeNull();
    expect(faceFiles({ family: 'Lora', href: LORA })).toEqual([]);
    expect(googleFaceState({ family: 'Lora', href: LORA })).toEqual({ state: 'pending' });
  });

  it('answers only the request it was made for, and only in its own shape', () => {
    expect(googleRecord({ ...lora, href: 'https://fonts.googleapis.com/css2?family=Lora:wght@700' })).toBeNull();
    const forged = [
      { ...saved(), files: [{ src: 'https://evil.example/x.woff2', weight: '400', style: 'normal' }] },
      { ...saved(), files: [{ src: 'assets/../x', weight: '400', style: 'normal' }] },
      { ...saved(), licence: 'Apache-2.0' },
      { ...saved(), files: [] },
      { ...saved(), files: [saved().files[0], saved().files[0]] },
      { ...saved(), extra: true },
      { request: LORA, refused: 'x'.repeat(80) },
    ];
    for (const google of forged) expect(googleRecord({ ...lora, google })).toBeNull();
    const refused = { family: 'Roboto Slab', href: 'https://fonts.googleapis.com/css2?family=Roboto+Slab', google: { request: 'https://fonts.googleapis.com/css2?family=Roboto+Slab', refused: 'Apache-2.0' } };
    expect(faceFiles(refused)).toEqual([]);
    expect(googleFaceState(refused)).toEqual({ state: 'refused', message: 'Roboto Slab is Apache-2.0 on Google Fonts; MAWS fetches only OFL faces, so it draws as its fallback; upload a font file to use it' });
  });

  it('holds any ref the store answers (an earlier upload of the same bytes keeps its name), and nothing outside the assets', () => {
    const at = (src: string) => googleRecord({ ...lora, google: { ...saved(), files: [{ src, weight: '400', style: 'normal' }] } });
    expect(at('assets/Lora Regular.woff2')).not.toBeNull();
    expect(at('assets/lora?.woff2')).not.toBeNull();
    for (const src of ['assets/..', 'assets/.', 'assets/a/b.woff2', 'assets/a\\b.woff2', 'assets/a\u0001.woff2', 'assets/', 'x/assets/a.woff2']) expect(at(src), src).toBeNull();
  });

  it('is dropped from every index the loader reads, so an agent can neither forge nor send one', () => {
    const parsed = parseDeckJson(JSON.stringify({ order: [], faces: { lora } }));
    expect(parsed.ok && parsed.deck.faces).toEqual({ lora: { family: 'Lora', href: `${LORA}&display=swap` } });
    // the serializer writes it last among a face's fields, where the host's read shows it
    expect(Object.keys(JSON.parse(serializeDeckJson({ order: [], faces: { lora: { google: saved(), href: LORA, family: 'Lora' } } })).faces.lora)).toEqual(['family', 'href', 'google']);
  });

  it('is carried forward under an agent’s face edit while it answers the edit’s request, and dropped when the link changes', () => {
    expect(withoutRecord(lora)).toEqual({ family: 'Lora', href: `${LORA}&display=swap` });
    expect(carryRecord({ family: 'Lora', href: LORA, note: 1 }, lora)).toEqual({ family: 'Lora', href: LORA, note: 1, google: saved() });
    expect(carryRecord({ family: 'Lora', href: 'https://fonts.googleapis.com/css2?family=Lora:wght@700' }, lora)).toEqual({ family: 'Lora', href: 'https://fonts.googleapis.com/css2?family=Lora:wght@700' });
    expect(carryRecord(undefined, lora)).toBeUndefined();
  });
});
