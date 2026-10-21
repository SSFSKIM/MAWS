// P3-C M3 fix wave 1 (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md D7): the mirror's token values are the
// ones a deck's stage draws with: P3-D's literal resolver over the system at the deck's scale with the deck's
// overrides, a cycle dropped whole (each member keeps its system value) and an override depending on a cycle member
// reading that member's system value.
import { describe, expect, it } from 'vitest';
import { tokenProperties } from '../design-system/css';
import { literalValues } from '../design-system/resolve-vars';
import { builtinView } from '../design-system/view';
import { isMirrorCopy, mirrorSlug, type MirrorCopy } from '../library/mirror';
import { newDoc, transact } from '../yjs';
import * as Y from '../yjs/slides';
import type { Artifact } from '@shared/artifacts/entity';
import { DECK_PATH, slidePath } from './deck';
import { FIXTURE_FILES, fixtureDoc } from './export/deck.test-support';
import { LORA_FILES, LORA_LICENCE, loraFace, robotoSlabFace, TODAYS_FACES } from './export/faces.test-support';
import { deckTokenValues, presentationMirrorWriter } from './mirror';
import { publishDeck } from './publish';

const tokens = builtinView().tokens;
const system = tokenProperties(tokens, 'deck');

/** Every name D's resolver sets, read through the mirror's lookup, equals D's value. */
function expectParity(overrides: Record<string, string>): void {
  const d = literalValues(tokens, 'deck', overrides);
  const mirror = deckTokenValues(tokens, overrides);
  for (const [name, value] of d) expect(mirror(name), name).toBe(value);
}

describe('the mirror’s token values (parity with P3-D’s resolver)', () => {
  it('drops a cycle whole: each member keeps its own system value', () => {
    const overrides = { '--ds-color-bg': 'var(--ds-color-text, #101010)', '--ds-color-text': 'var(--ds-color-bg)' };
    const values = deckTokenValues(tokens, overrides);
    expect(values('--ds-color-bg')).toBe(system.get('--ds-color-bg'));
    expect(values('--ds-color-text')).toBe(system.get('--ds-color-text'));
    expectParity(overrides);
  });

  it('gives an override outside a cycle that names a member the member’s system value', () => {
    const overrides = { '--ds-color-bg': 'var(--ds-color-text)', '--ds-color-text': 'var(--ds-color-bg)', '--ds-color-accent': 'var(--ds-color-bg)' };
    expect(deckTokenValues(tokens, overrides)('--ds-color-accent')).toBe(system.get('--ds-color-bg'));
    expectParity(overrides);
  });

  it('follows a chain of overrides and drops one that resolves to nothing', () => {
    const overrides = { '--ds-color-bg': '#101010', '--ds-color-text': 'var(--ds-color-bg)', '--ds-color-accent': 'var(--ds-nowhere)' };
    const values = deckTokenValues(tokens, overrides);
    expect([values('--ds-color-bg'), values('--ds-color-text'), values('--ds-color-accent')]).toEqual(['#101010', '#101010', system.get('--ds-color-accent')]);
    expectParity(overrides);
  });

  it('applies the overrides alone when there is no system to read', () => {
    expect(deckTokenValues(null, { '--ds-color-bg': '#101010' })('--ds-color-bg')).toBe('#101010');
    expect(deckTokenValues(null, {})('--ds-color-bg')).toBeUndefined();
  });
});

// The final review's A14 (Decision Log 37 (1)): the mirror copies the assets the deck references into `<slug>/assets/`,
// where the deck-root references (`assets/<name>`) name them; each copy is read only when the mirror lacks it.
describe('the deck mirror’s assets', () => {
  const ARTIFACT = { id: '0f0e0d0c-0b0a-4908-8706-050403020100', kind: 'presentation', title: 'Kickoff' } as Artifact;
  const files = {
    [DECK_PATH]: JSON.stringify({ v: 4, order: ['s1'], faces: { brand: { family: 'Brand', src: 'assets/brand.woff2' } } }),
    [slidePath('s1')]: '<section id="s1" style="background:url(assets/bg.png) center / cover"><img id="logo" src="assets/logo.png" alt="Logo"><h1 id="t" style="background:url(assets/gold.png); background-clip:text; -webkit-text-fill-color:transparent">Gold</h1></section>',
  };
  const listed = ['brand.woff2', 'bg.png', 'logo.png', 'gold.png', 'unused.png'].map((name) => ({ ref: `assets/${name}`, name, mime: 'application/octet-stream', size: 1 }));
  const bytesOf = (ref: string) => new TextEncoder().encode(ref);

  it('copies every referenced asset (picture, CSS background, face) and no other, reading none while it writes', () => {
    const doc = newDoc();
    publishDeck(doc, {}, files, false);
    const reads: string[] = [];
    const readAsset = (ref: string) => {
      reads.push(ref);
      return bytesOf(ref);
    };
    const out = presentationMirrorWriter(() => null)({ artifact: ARTIFACT, doc, assets: listed, readAsset }).files;
    const slug = mirrorSlug(ARTIFACT);
    const copies = Object.keys(out).filter((path) => path.startsWith(`${slug}/assets/`)).sort();
    expect(copies).toEqual(['bg.png', 'brand.woff2', 'gold.png', 'logo.png'].map((name) => `${slug}/assets/${name}`));
    expect(reads).toEqual([]);
    const copy = out[`${slug}/assets/logo.png`];
    expect(isMirrorCopy(copy)).toBe(true);
    expect(new TextDecoder().decode((copy as MirrorCopy).read())).toBe('assets/logo.png');
    // the references are the deck root's, which the folder is
    expect(out[`${slug}/slides/s1.html`]).toContain('src="assets/logo.png"');
    expect(out[`${slug}/slides/s1.html`]).toContain('url(assets/bg.png)');
    expect((JSON.parse(out[`${slug}/deck.json`] as string) as { faces: Record<string, { src: string }> }).faces.brand!.src).toBe('assets/brand.woff2');
  });

  it('copies nothing the artifact does not hold (a reference ahead of its upload), and nothing without a reader', () => {
    const doc = newDoc();
    publishDeck(doc, {}, files, false);
    const out = presentationMirrorWriter(() => null)({ artifact: ARTIFACT, doc, assets: listed.filter((a) => a.name !== 'logo.png'), readAsset: bytesOf }).files;
    expect(Object.keys(out)).not.toContain(`${mirrorSlug(ARTIFACT)}/assets/logo.png`);
    expect(Object.keys(presentationMirrorWriter(() => null)({ artifact: ARTIFACT, doc }).files).some((path) => path.includes('/assets/'))).toBe(false);
  });

  // P4-B2 D19: a Google Fonts face the host fetched is its saved files and their licence, copied beside the slides
  it('copies a fetched face’s files and its licence; a refused face copies nothing', () => {
    const doc = newDoc();
    publishDeck(doc, {}, files, false);
    transact(doc, () => {
      Y.setDeckEntry(doc, 'faces', 'lora', loraFace() as Y.Json);
      Y.setDeckEntry(doc, 'faces', 'roboto-slab', robotoSlabFace() as Y.Json);
    });
    const gf = [...LORA_FILES.map((file) => file.src), LORA_LICENCE, 'assets/gf-robotoslab-400.woff2'].map((ref) => ({ ref, name: ref.slice('assets/'.length), mime: 'application/octet-stream', size: 1 }));
    const out = presentationMirrorWriter(() => null)({ artifact: ARTIFACT, doc, assets: [...listed, ...gf], readAsset: bytesOf }).files;
    const slug = mirrorSlug(ARTIFACT);
    const copies = Object.keys(out).filter((path) => path.startsWith(`${slug}/assets/gf-`)).sort();
    expect(copies).toEqual([...LORA_FILES.map((file) => file.src), LORA_LICENCE].map((ref) => `${slug}/${ref}`).sort());
  });

  // the architect's condition: a deck whose faces are today's shape mirrors exactly as before (pinned from the pre-D19 code)
  it('mirrors today’s faces byte for byte as before', () => {
    const doc = fixtureDoc({ ...FIXTURE_FILES, [DECK_PATH]: JSON.stringify({ ...JSON.parse(FIXTURE_FILES[DECK_PATH]!), faces: TODAYS_FACES }) });
    const assets = ['brand.woff2', 'logo.png', 'unused.png'].map((name) => ({ ref: `assets/${name}`, name, mime: 'application/octet-stream', size: 1 }));
    const out = presentationMirrorWriter(() => null)({ artifact: ARTIFACT, doc, assets, readAsset: bytesOf }).files;
    const slug = mirrorSlug(ARTIFACT);
    expect(Object.keys(out).sort()).toEqual(['assets/brand.woff2', 'assets/logo.png', 'deck.json', 'slides/body.html', 'slides/cover.html', 'slides/gone.html'].map((path) => `${slug}/${path}`));
    expect(out[`${slug}/deck.json`]).toBe(
      '{\n  "v": 4,\n  "title": "Quarterly",\n  "cover": "cover",\n  "order": [\n    "cover",\n    "body",\n    "gone"\n  ],\n  "faces": {\n    "blob": {\n      "family": "Blob",\n      "src": "/_blob/abc"\n    },\n    "brand-sans": {\n      "family": "Brand Sans",\n      "src": "assets/brand.woff2"\n    },\n    "source-serif-4": {\n      "family": "Source Serif 4",\n      "href": "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@300..700&display=swap"\n    }\n  }\n}\n',
    );
  });
});
