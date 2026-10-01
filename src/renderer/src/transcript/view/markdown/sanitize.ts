// sanitize.ts: three gates in pipeline order (residue *Streamdown configuration*). Raw HTML never reaches rehype as
// HTML; URLs are allowlisted twice (harden coarse, urlTransform exact). Streamdown's own `skipHtml` is inert behind
// its default rehype-raw and its `defaultUrlTransform` is the identity, so the posture is built from its exported
// parts. The renderer loads nothing by path (§4.1); C1's CSP stands behind these gates.
import { harden } from 'rehype-harden';
import { defaultRehypePlugins, defaultRemarkPlugins, type UrlTransform } from 'streamdown';
import type { Pluggable, Plugin, Processor } from 'unified';
import type { Node, Parent } from 'unist';
import { visit } from 'unist-util-visit';

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

type MdNode = Node & { url?: string; title?: string | null; alt?: string | null; value?: string };

// Raw HTML is shown as written and never deleted (W1, A3; the owner's ruling of 2026-10-01: tags such as an output
// style's `<to-human>` read literally until an extension handles them). CommonMark's HTML constructs are switched off
// in the parser, so a tag is text and what follows it parses as markdown: with them on, a tag alone on a line opened an
// HTML block (rule 7) that swallowed the lines up to the next blank one, and this gate then deleted the whole block.
// Autolinks (`<https://…>`) are a construct of their own and stay.
export const remarkLiteralHtml: Plugin = function (this: Processor) {
  const data = this.data() as { micromarkExtensions?: unknown[] };
  data.micromarkExtensions = [...(data.micromarkExtensions ?? []), { disable: { null: ['htmlFlow', 'htmlText'] } }];
};

const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

export const remarkTranscriptSources: Plugin = () => (tree) =>
  visit(tree, (node: MdNode, index, parent: Parent | undefined) => {
    if (!parent || typeof index !== 'number') return;
    if (node.type === 'html') {
      // Never deleted: an `html` node another plugin made is its literal text, escaped when rendered (in a paragraph
      // where it stood as a block).
      const text = { type: 'text', value: node.value ?? '' } as Node;
      parent.children[index] = FLOW_PARENTS.has(parent.type) ? ({ type: 'paragraph', children: [text] } as Node) : text;
      return;
    }
    if (node.type === 'link' && !SCHEME.test(node.url!)) node.url = `maws-path:${node.url}`; // a scheme-less href is a path chip, never a navigable link
    if (node.type === 'image' && !/^data:image\//i.test(node.url!)) {
      // a markdown image that is not inline data becomes a chip naming its source
      parent.children[index] = { type: 'link', url: `maws-image:${node.url}`, title: node.title, children: [{ type: 'text', value: node.alt ?? '' }] } as Node;
    }
  });

type Schema = { protocols?: Record<string, string[]> } & Record<string, unknown>;
const [sanitize, schema] = defaultRehypePlugins.sanitize as [Plugin, Schema]; // Streamdown's rehype-sanitize and schema, extended for the two chip schemes and data images
const protocols = schema.protocols ?? {};
export const transcriptSchema: Schema = {
  ...schema,
  protocols: { ...protocols, href: [...(protocols.href ?? []), 'maws-path', 'maws-image'], src: [...(protocols.src ?? []), 'data'] },
};
export const hardenOptions = {
  allowedLinkPrefixes: ['*'],
  allowedProtocols: ['maws-path:', 'maws-image:'],
  allowedImagePrefixes: [],
  allowDataImages: true,
  linkBlockPolicy: 'text-only',
  imageBlockPolicy: 'text-only',
} as const;
export const rehypePlugins: Pluggable[] = [
  [sanitize, transcriptSchema],
  [harden, { ...hardenOptions, allowedLinkPrefixes: [...hardenOptions.allowedLinkPrefixes], allowedProtocols: [...hardenOptions.allowedProtocols], allowedImagePrefixes: [] }],
]; // no rehype-raw: the default that makes skipHtml inert
export const remarkPlugins: Pluggable[] = [remarkLiteralHtml, ...Object.values(defaultRemarkPlugins), remarkTranscriptSources];

export const transcriptUrlTransform: UrlTransform = (url, key) => {
  // the exact gate; Streamdown applies it to every URL attribute after rehype
  const scheme = SCHEME.exec(url)?.[1].toLowerCase() ?? null;
  if (key === 'src') return /^data:image\//i.test(url) ? url : null; // images: inline data only
  return scheme !== null && ['https', 'http', 'mailto', 'maws-path', 'maws-image'].includes(scheme) ? url : null; // links: https, http, mailto and the chips; javascript:, file:, data:, vbscript: and anything else lose the href
};
