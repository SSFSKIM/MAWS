// The design system's linked-directory mirror writer (Decision Log 18; L's `MirrorInput` with M6b's assets): a folder
// named by the system's slug holding the agent's file view and, under `assets/`, every asset the store lists for the
// system, its faces included, read through `readAsset`.
import { describe, expect, it } from 'vitest';
import type { Artifact } from '@shared/artifacts/entity';
import { newDoc } from '../yjs';
import { defaultAssetNames } from '../types/design_system/default-assets';
import { defaultSystem } from '../types/design_system/defaults';
import complete from './fixtures/complete.tokens.json';
import { designSystemMirrorWriter } from './mirror';
import { readFiles, writeSystem } from './model';
import { parseTokens, serializeTokens } from './tokens';

const ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const artifact = { id: ID, kind: 'design_system', title: 'Harbor' } as Artifact;
const FOLDER = `Harbor-${ID.slice(0, 8)}`;
const TOKENS = serializeTokens(parseTokens(complete).tokens!);
const DOCUMENT_CSS = '@font-face { font-family: "Iowan Old Style"; src: url("assets/iowan.woff2") format("woff2"); }\n';

function systemDoc() {
  const doc = newDoc();
  writeSystem(doc, { 'DESIGN.md': '# Harbor\n', 'tokens.tokens.json': TOKENS, 'components/document.css': DOCUMENT_CSS }, { route: 'derived', at: 0 });
  return doc;
}
const held: Record<string, Uint8Array> = {
  'assets/iowan.woff2': new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
  'assets/OFL.txt': new TextEncoder().encode('SIL OPEN FONT LICENSE'),
  'assets/brand-guide.pdf': new TextEncoder().encode('%PDF'), // named by none of the system's files
};
const listed = Object.entries(held).map(([ref, bytes]) => ({ ref, name: ref.slice('assets/'.length), mime: 'application/octet-stream', size: bytes.length }));

describe('the design system’s mirror writer', () => {
  it('writes the file view and every listed asset, faces included, under the system’s folder', () => {
    const doc = systemDoc();
    const read: string[] = [];
    const { files } = designSystemMirrorWriter({
      artifact,
      doc,
      assets: listed,
      readAsset: (ref) => {
        read.push(ref);
        return held[ref]!;
      },
    });
    const view = Object.keys(readFiles(doc)).map((path) => `${FOLDER}/${path}`);
    expect(Object.keys(files).sort()).toEqual([...view, ...Object.keys(held).map((ref) => `${FOLDER}/${ref}`)].sort());
    for (const [ref, bytes] of Object.entries(held)) expect(files[`${FOLDER}/${ref}`]).toEqual(bytes);
    expect(read.sort()).toEqual(Object.keys(held).sort());
  });

  it('writes the file view alone when the host gives no assets, and nothing for a document that holds no system', () => {
    const doc = systemDoc();
    expect(Object.keys(designSystemMirrorWriter({ artifact, doc }).files).sort()).toEqual(Object.keys(readFiles(doc)).map((path) => `${FOLDER}/${path}`).sort());
    expect(designSystemMirrorWriter({ artifact, doc: newDoc(), assets: listed, readAsset: (ref) => held[ref]! })).toEqual({ files: {} });
  });
});

// scalpel-3#1: canon names an asset as `assets/<name>` from the system's root, and a browser resolves a relative URL from
// the file that holds it, so a mirrored canon file one directory down reads `../assets/<name>`.
describe('the mirror’s canon references', () => {
  const OFFICIAL = defaultSystem('official')!;
  const officialAssets = defaultAssetNames('official').map((name) => ({ ref: `assets/${name}`, name, mime: 'application/octet-stream', size: 1 }));
  const mirrorOf = (files: Record<string, string>, assets = officialAssets) => {
    const doc = newDoc();
    writeSystem(doc, files, { route: 'derived', at: 0 });
    return designSystemMirrorWriter({ artifact, doc, assets, readAsset: () => new Uint8Array([1]) }).files;
  };

  it('the bundled Official’s document.css loads its faces from the mirrored assets', () => {
    const files = mirrorOf(OFFICIAL.files);
    const path = `${FOLDER}/components/document.css`;
    const css = files[path] as string;
    const urls = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]!);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const resolved = decodeURIComponent(new URL(url, `file:///linked/${path}`).pathname).slice('/linked/'.length);
      expect(Object.keys(files), url).toContain(resolved);
    }
    expect(css.replace(/\.\.\/assets\//g, 'assets/')).toBe(OFFICIAL.files['components/document.css']); // only the references move
  });

  it('moves every asset reference of canon HTML as the in-app frames rewrite them, and nothing else', () => {
    const card = [
      `<div style="background: url('assets/paper.png') repeat"><img src=" assets/logo.svg#mark" srcset="assets/logo.svg 1x, assets/logo@2x.png 2x" alt="url(assets/logo.svg)">`,
      `<svg><use xlink:href="assets/icons.svg#star"/><rect fill="url(#grad)" stroke="url(assets/ink.svg#line)"/></svg>`,
      `<a href="https://example.com/assets/x" title="a &amp; b">assets/x and url(assets/x)</a><img src='assets/a&amp;b.png'></div>`,
    ].join('');
    const mirrored = mirrorOf({ 'DESIGN.md': '# Harbor\n', 'tokens.tokens.json': TOKENS, 'components/card.html': card, 'layouts/cover.html': '<section id="cover" style="background:url(assets/cover.png)"></section>' });
    expect(mirrored[`${FOLDER}/components/card.html`]).toBe(
      [
        `<div style="background: url('../assets/paper.png') repeat"><img src=" ../assets/logo.svg#mark" srcset="../assets/logo.svg 1x, ../assets/logo@2x.png 2x" alt="url(assets/logo.svg)">`,
        `<svg><use xlink:href="../assets/icons.svg#star"/><rect fill="url(#grad)" stroke="url(../assets/ink.svg#line)"/></svg>`,
        `<a href="https://example.com/assets/x" title="a &amp; b">assets/x and url(assets/x)</a><img src="../assets/a&amp;b.png"></div>`,
      ].join(''),
    );
    expect(mirrored[`${FOLDER}/layouts/cover.html`]).toBe('<section id="cover" style="background:url(../assets/cover.png)"></section>');
    expect(mirrored[`${FOLDER}/tokens.tokens.json`]).toBe(TOKENS); // a file at the root is written as it is
  });
});
