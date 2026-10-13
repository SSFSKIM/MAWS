// The DOCX import (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): `mammoth` turns the file into HTML
// (headings by their Word style, lists by their numbering, tables, bold and italic runs, links) and the HTML import
// reads that, so a DOCX and a pasted page take one path into the schema. Pictures are uploaded as the artifact's assets
// as mammoth reads them (`uploadAsset`); without an uploader they are left out. The style map also reads back what the
// DOCX export writes beyond Word's built-ins: its `Code` paragraphs as one code block, `Quote` as a quote, and the
// four `Callout <Tone>` styles as callouts of that tone. Word comments are not imported (mammoth drops them).
//
// mammoth's package maps its Node-only modules (`fs`, `os`, `path`) away under the `browser` field, so the renderer's
// bundle is portable; its Node build reads `{buffer}` and its browser build `{arrayBuffer}`, and both are given.
import mammoth from 'mammoth';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CALLOUT_TONES } from '../schema';
import { importHtml, type HtmlImportOptions } from './html';

const STYLE_MAP = [
  "p[style-name='Code'] => pre:separator('\\n')",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  ...CALLOUT_TONES.map((tone) => `p[style-name='Callout ${tone[0].toUpperCase()}${tone.slice(1)}'] => aside.doc-callout-${tone} > p:fresh`),
];

export interface DocxImport {
  body: PMNode;
  /** mammoth's warnings (styles it did not map, content it skipped), for the importer to show or log. */
  messages: string[];
}

/** A DOCX file as a tab body. */
export async function importDocx(bytes: Uint8Array, options: HtmlImportOptions = {}): Promise<DocxImport> {
  const { uploadAsset } = options;
  let pictures = 0;
  const convertImage = mammoth.images.imgElement(async (image) => {
    if (!uploadAsset) return { src: '' };
    const mime = image.contentType.toLowerCase();
    const data = new Uint8Array(await image.readAsArrayBuffer());
    const { assetId, ref } = await uploadAsset(data, { name: `image-${++pictures}.${mime.split('/')[1] ?? 'bin'}`, mime });
    return { src: ref, 'data-asset-id': assetId } as { src: string };
  });
  const input = { arrayBuffer: bytes, buffer: bytes } as unknown as Parameters<typeof mammoth.convertToHtml>[0];
  const result = await mammoth.convertToHtml(input, { styleMap: STYLE_MAP, convertImage });
  // mammoth writes a class, never an attribute: the callout's tone moves to the attribute the schema reads
  const html = result.value.replace(/<aside class="doc-callout-(\w+)">/g, (_, tone: string) => `<aside data-callout-tone="${tone}">`);
  const body = await importHtml(html, { generateID: options.generateID });
  return { body, messages: result.messages.map((message) => message.message) };
}
