// The design system's linked-directory mirror writer (Decision Log 18; L's `MirrorInput` with M6b's assets): a folder
// named by the system's slug holding the agent's file view and, under `assets/`, every asset the store lists for the
// system, its faces included, read through `readAsset`.
import { describe, expect, it } from 'vitest';
import type { Artifact } from '@shared/artifacts/entity';
import { newDoc } from '../yjs';
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
