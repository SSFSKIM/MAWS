// The HTML import (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): ProseMirror's DOMParser over the one
// schema, the path paste takes, run on inert markup (a `<template>`'s content runs no script and loads nothing) after
// sanitising it: scripts, styles, frames and embeds removed, every `on*` handler dropped, and only
// addresses a document may hold kept. An image loads, so its `src` must be `https:` or `maws-artifact:` (a `data:`
// picture is uploaded as an asset when the caller can, else dropped); a link only navigates, so it may also be
// `http:` or `mailto:`; anything else (`javascript:`, `file:`, relative) loses its address and keeps its text. A
// GitHub-style task list (`li > input[type=checkbox]`) reads as a task list. Every block gets a fresh id: a pasted
// or imported page's ids mean nothing here. Needs a DOM (`document`): the renderer, or happy-dom in tests.
import { DOMParser as PMDOMParser, type Node as PMNode } from '@tiptap/pm/model';
import { BLOCK_TYPES, nanoid8, schemaFor } from '../schema';

export type UploadAsset = (bytes: Uint8Array, meta: { name: string; mime: string }) => Promise<{ assetId: string; ref: string }>;

export interface HtmlImportOptions {
  generateID?: () => string;
  /** Stores an inline picture as one of the artifact's assets (`ArtifactHost.uploadAsset` bound to the artifact). */
  uploadAsset?: UploadAsset;
}

const DROP = 'script, style, link, meta, base, title, iframe, frame, frameset, object, embed, noscript, template, canvas, audio, video, source, track, input, button, select, textarea';
const IMAGE_SRC = /^(?:https:|maws-artifact:)/i;
const LINK_HREF = /^(?:https?:|mailto:|maws-artifact:)/i;
const DATA_IMAGE = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=\s]*)$/i;

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}
const extension = (mime: string) => mime.split('/')[1].replace(/\+.*$/, '').replace('jpeg', 'jpg');

// A GitHub- or Markdown-rendered task list: every item opens with a checkbox.
function taskLists(root: DocumentFragment): void {
  for (const list of root.querySelectorAll('ul')) {
    const items = [...list.children].filter((child) => child.tagName === 'LI');
    const boxes = items.map((item) => item.querySelector(':scope > input[type="checkbox"], :scope > p:first-child > input[type="checkbox"]'));
    if (!items.length || boxes.some((box) => box === null)) continue;
    list.setAttribute('data-type', 'taskList');
    items.forEach((item, i) => {
      const box = boxes[i]!;
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', box.hasAttribute('checked') ? 'true' : 'false');
      box.remove();
    });
  }
}

async function sanitize(root: DocumentFragment, uploadAsset: UploadAsset | undefined): Promise<void> {
  for (const element of root.querySelectorAll(DROP)) if (!(element.tagName === 'INPUT' && element.getAttribute('type') === 'checkbox')) element.remove();
  for (const element of root.querySelectorAll('*'))
    for (const { name } of [...element.attributes]) if (/^on/i.test(name) || name === 'srcset') element.removeAttribute(name);
  for (const link of root.querySelectorAll('a[href]')) if (!LINK_HREF.test(link.getAttribute('href')!.trim())) link.removeAttribute('href');
  let pictures = 0;
  for (const image of [...root.querySelectorAll('img')]) {
    // the export writes the stored address in `data-src` beside an inlined `src`
    const stored = image.getAttribute('data-src')?.trim();
    const src = stored && IMAGE_SRC.test(stored) ? stored : (image.getAttribute('src')?.trim() ?? '');
    image.removeAttribute('data-src');
    if (IMAGE_SRC.test(src)) {
      image.setAttribute('src', src);
      continue;
    }
    const data = DATA_IMAGE.exec(src);
    if (data && uploadAsset) {
      const mime = data[1].toLowerCase();
      const { assetId, ref } = await uploadAsset(decodeBase64(data[2]), { name: `image-${++pictures}.${extension(mime)}`, mime });
      image.setAttribute('src', ref);
      image.setAttribute('data-asset-id', assetId);
      continue;
    }
    image.remove();
  }
  taskLists(root);
  // checkboxes outside a task list are not content
  for (const box of root.querySelectorAll('input')) box.remove();
}

// A MAWS export marks the region whose text's whitespace is content (`data-whitespace="preserve"`, export/html.ts);
// anywhere else a page's whitespace is layout and is normalised. The whole fragment is parsed once; the marker only
// changes how whitespace inside it is read: a textblock (paragraph, heading, code) inside a marked region keeps its
// text exactly (ProseMirror's `preserveWhitespace: 'full'` on that block's rule), and the region itself reads as
// `white-space: pre-wrap`, which ProseMirror honours for spaces in its subtree. So whitespace between blocks stays
// layout even inside a region, and a marker on an inline element keeps its spaces while the paragraph around it is
// parsed as usual (newlines there read as ProseMirror reads them under pre-wrap).
const PRESERVE = '[data-whitespace="preserve"]';
function parseKeepingMarkedWhitespace(content: DocumentFragment): PMNode {
  const schema = schemaFor();
  const parser = PMDOMParser.fromSchema(schema);
  for (const region of content.querySelectorAll<HTMLElement>(PRESERVE)) region.style.whiteSpace = 'pre-wrap';
  return parser.parse(content, {
    ruleFromNode: (dom) => {
      if (!(dom instanceof Element) || dom.closest(PRESERVE) === null) return null;
      // no tag rule of the schema has a `context` (html.dom.test.tsx pins it), so matching needs no parse context
      const rule = parser.matchTag(dom, undefined as never);
      return rule?.node && schema.nodes[rule.node]?.isTextblock ? { ...rule, preserveWhitespace: 'full' } : null;
    },
  });
}

const ID_TYPES = new Set<string>(BLOCK_TYPES);
function freshIds(node: PMNode, generateID: () => string): unknown {
  const json = node.toJSON() as { type: string; attrs?: Record<string, unknown>; content?: unknown[] };
  const visit = (value: typeof json): typeof json => ({
    ...value,
    ...(value.attrs ? { attrs: ID_TYPES.has(value.type) ? { ...value.attrs, id: generateID() } : value.attrs } : {}),
    ...(value.content ? { content: (value.content as (typeof json)[]).map(visit) } : {}),
  });
  return visit(json);
}

/** An HTML page or fragment as a tab body: a checked `doc` of the schema with a fresh id on every block. */
export async function importHtml(html: string, { generateID = nanoid8, uploadAsset }: HtmlImportOptions = {}): Promise<PMNode> {
  const schema = schemaFor();
  // a template's content is inert: parsing it runs no script and loads nothing (a page's html, head and body tags
  // are dropped by the fragment parser, their children kept and sanitised)
  const template = document.createElement('template');
  template.innerHTML = html;
  await sanitize(template.content, uploadAsset);
  const parsed = parseKeepingMarkedWhitespace(template.content);
  const body = schema.nodeFromJSON(freshIds(parsed.childCount ? parsed : schema.node('doc', null, [schema.node('paragraph')]), generateID));
  body.check();
  return body;
}
