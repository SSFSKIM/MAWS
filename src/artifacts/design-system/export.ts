// The `claude` export of a design system (D12 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md): Claude's
// files from the system's document as it stands: `tokens.json` in Claude's list grammar and `README.md` from the law
// (`toClaude`), the system's faces (the `@font-face` blocks of `components/document.css` a scope declares) as Claude's
// `type.fonts` with their files under `fonts/`, and every other asset the store holds for the system under `assets/`.
// What main's exporter (`src/main/design-systems/`) writes for `artifact_export {format: 'claude'}` and the page's
// "Export for Claude", zipped. Portable (§4.10).
import type { Doc } from '../yjs';
import { systemFaces } from './assets';
import { DOCUMENT_CSS_PATH } from './canon';
import { toClaude, type ClaudeFont } from './claude';
import { readSystem } from './model';

/** A file of Claude's shape: text, or an asset's bytes. */
export type ClaudeExportFile = string | Uint8Array;

function readExportable(doc: Doc) {
  const system = readSystem(doc);
  if (!system.meta) throw new Error('the document holds no design system yet');
  return { ...system, meta: system.meta };
}

const nameOf = (ref: string) => ref.slice('assets/'.length);

/** A face's `font-weight` as Claude's descriptor: a weight or a range; `normal` and `bold` as numbers; absent, 400. */
function weightOf(value: string | undefined): string {
  const words = (value ?? 'normal').trim().toLowerCase().split(/\s+/).map((word) => (word === 'normal' ? '400' : word === 'bold' ? '700' : word));
  return words.join(' ');
}
const styleOf = (value: string | undefined): ClaudeFont['style'] => {
  const style = value?.trim().toLowerCase().split(/\s+/)[0];
  return style === 'italic' || style === 'oblique' ? style : 'normal';
};

/**
 * Claude's files for the system in `doc`; `assets` are the bytes of the system's assets by ref (`assets/<name>`), every
 * one the store lists for it (main's exporter reads them through the export context's `assets.list()`). A face's entry
 * names the first of its sources the store holds, and each of its sources goes under `fonts/`; a face none of whose
 * files are held is left out. Throws `ClaudeShapeError` when Claude's grammar cannot hold the system, and an error when
 * the document holds no system.
 */
export function claudeExportFiles(doc: Doc, assets: Readonly<Record<string, Uint8Array>> = {}): Record<string, ClaudeExportFile> {
  const { meta, law, tokens, files: canon } = readExportable(doc);
  const held = (ref: string) => Object.hasOwn(assets, ref);
  const fonts: ClaudeFont[] = [];
  const fontRefs = new Set<string>();
  for (const face of systemFaces(canon[DOCUMENT_CSS_PATH], tokens)) {
    const file = face.refs.find(held);
    if (!file) continue;
    const descriptor = (property: string) => face.declarations.find((d) => d.property === property)?.value;
    const name = nameOf(file);
    fonts.push({ family: face.family, file: name.includes('/') ? `fonts/${name}` : name, weight: weightOf(descriptor('font-weight')), style: styleOf(descriptor('font-style')) });
    for (const ref of face.refs) fontRefs.add(ref);
  }
  const files: Record<string, ClaudeExportFile> = toClaude({ name: meta.name, law, tokens, fonts });
  for (const [ref, bytes] of Object.entries(assets)) {
    if (!ref.startsWith('assets/')) continue;
    files[fontRefs.has(ref) ? `fonts/${nameOf(ref)}` : ref] = bytes;
  }
  return files;
}
