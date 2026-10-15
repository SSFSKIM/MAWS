// A tab body as static HTML (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): each node drawn with the
// classes the editor's theme.css styles (its node views' `doc-*` names) and the attributes the schema's parse rules
// read back, so the file looks like the page and re-imports as the content. Math is KaTeX's MathML (Chromium, Safari
// and Firefox draw it with no stylesheet or font to embed); code carries shiki's tokens as inline colours; a diagram
// is its mermaid source (mermaid needs a live DOM to lay out; a capture window may draw it from `pre[data-diagram]`);
// a chart and a pending block are their labelled placeholders, as in the editor. Comment marks are not drawn: a
// thread lives in the document, and a file read back carries none. Pure: no DOM, so it runs in main.
import katex from 'katex';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import type { ThemedToken } from 'shiki';
import { chipText } from './values';

export interface RenderedImage {
  /** What the page shows (a data: URL or an address it may load); absent when the image cannot be shown. */
  src: string | null;
}

export interface RenderEnvironment {
  /** Code tokens per (language, code), prepared before rendering (highlighting is asynchronous); null for plain. */
  tokens(code: string, language: unknown): ThemedToken[][] | null;
  /** The token colour to use: shiki's light or dark one, by the system's ground. */
  dark: boolean;
  image(node: PMNode): RenderedImage;
}

export const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (text: string): string => escapeText(text).replace(/"/g, '&quot;');
const attrs = (pairs: Array<[string, unknown]>): string =>
  pairs
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`))
    .join('');

const math = (latex: unknown, displayMode: boolean): string => katex.renderToString(String(latex ?? ''), { displayMode, output: 'mathml', throwOnError: false });

function wrapMark(mark: Mark, inner: string): string {
  switch (mark.type.name) {
    case 'bold':
      return `<strong>${inner}</strong>`;
    case 'italic':
      return `<em>${inner}</em>`;
    case 'underline':
      return `<u>${inner}</u>`;
    case 'strike':
      return `<s>${inner}</s>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'link':
      return `<a${attrs([
        ['href', mark.attrs.href],
        ['title', mark.attrs.title],
      ])}>${inner}</a>`;
    case 'highlight': {
      const color = typeof mark.attrs.color === 'string' && mark.attrs.color ? mark.attrs.color : null;
      return `<mark${attrs([
        ['data-color', color],
        ['style', color && `background-color: ${color}`],
      ])}>${inner}</mark>`;
    }
    default:
      return inner; // comments and the render-only attribution marks
  }
}

// An inline node without its marks.
function bare(node: PMNode, env: RenderEnvironment): string {
  switch (node.type.name) {
    case 'text':
      return escapeText(node.text ?? '');
    case 'hardBreak':
      return '<br>';
    case 'image': {
      const { src } = env.image(node);
      return `<img${attrs([
        ['class', 'doc-image'],
        ['src', src],
        ['data-src', src === node.attrs.src ? null : node.attrs.src],
        ['alt', node.attrs.alt ?? ''],
        ['data-asset-id', node.attrs.assetId],
      ])}>`;
    }
    case 'math':
      return `<span${attrs([
        ['class', 'doc-math'],
        ['data-math', ''],
        ['data-latex', node.attrs.latex],
      ])}>${math(node.attrs.latex, false)}</span>`;
    case 'date':
      return `<span${attrs([
        ['class', 'doc-chip'],
        ['data-chip', 'date'],
        ['data-iso', node.attrs.iso],
      ])}>${escapeText(chipText(node))}</span>`;
    case 'mention':
      return `<span${attrs([
        ['class', 'doc-chip'],
        ['data-chip', 'mention'],
        ['data-kind', node.attrs.kind],
        ['data-ref', node.attrs.ref],
      ])}>${escapeText(chipText(node))}</span>`;
    case 'dropdown':
      return `<span${attrs([
        ['class', 'doc-chip'],
        ['data-chip', 'dropdown'],
        ['data-options', JSON.stringify(node.attrs.options ?? [])],
        ['data-value', node.attrs.value],
      ])}>${escapeText(chipText(node))}</span>`;
    default:
      return escapeText(node.textContent);
  }
}

// Every inline node with its marks, atoms as text: a bold linked date is `<a><strong><span data-chip…>`, so the import
// reads the marks back. The link outermost, so adjacent runs of one link read as one address.
function inline(node: PMNode, env: RenderEnvironment): string {
  const marks = [...node.marks].sort((a, b) => Number(b.type.name === 'link') - Number(a.type.name === 'link'));
  return marks.reduceRight((inner, mark) => wrapMark(mark, inner), bare(node, env));
}

const inlines = (node: PMNode, env: RenderEnvironment): string => {
  let out = '';
  node.forEach((child) => (out += inline(child, env)));
  return out;
};
const blocks = (node: PMNode, env: RenderEnvironment): string => {
  let out = '';
  node.forEach((child) => (out += block(child, env)));
  return out;
};

function code(node: PMNode, env: RenderEnvironment): string {
  const text = node.textContent;
  const lines = env.tokens(text, node.attrs.language);
  if (!lines) return escapeText(text);
  return lines
    .map((line) =>
      line
        .map((token) => {
          const color = env.dark ? (token.htmlStyle?.['--shiki-dark'] ?? token.color) : (token.htmlStyle?.color ?? token.color);
          return color ? `<span style="color:${escapeAttr(color.toUpperCase())}">${escapeText(token.content)}</span>` : escapeText(token.content);
        })
        .join(''),
    )
    .join('\n');
}

function cell(node: PMNode, env: RenderEnvironment): string {
  const tag = node.type.name === 'tableHeader' ? 'th' : 'td';
  const { colspan, rowspan, colwidth, align } = node.attrs as { colspan: number; rowspan: number; colwidth: number[] | null; align: string | null };
  return `<${tag}${attrs([
    ['colspan', colspan > 1 ? colspan : null],
    ['rowspan', rowspan > 1 ? rowspan : null],
    ['colwidth', colwidth?.length ? colwidth.join(',') : null],
    ['style', align ? `text-align: ${align}` : null],
  ])}>${blocks(node, env)}</${tag}>`;
}

function block(node: PMNode, env: RenderEnvironment): string {
  const a = node.attrs;
  switch (node.type.name) {
    case 'paragraph':
      return `<p>${inlines(node, env)}</p>`;
    case 'heading':
      return `<h${a.level}>${inlines(node, env)}</h${a.level}>`;
    case 'blockquote':
      return `<blockquote>${blocks(node, env)}</blockquote>`;
    case 'bulletList':
      return `<ul>${blocks(node, env)}</ul>`;
    case 'orderedList':
      return `<ol${attrs([
        ['start', a.start !== 1 ? a.start : null],
        ['type', a.type],
      ])}>${blocks(node, env)}</ol>`;
    case 'listItem':
      return `<li>${blocks(node, env)}</li>`;
    case 'taskList':
      return `<ul data-type="taskList">${blocks(node, env)}</ul>`;
    case 'taskItem':
      return `<li data-type="taskItem" data-checked="${a.checked ? 'true' : 'false'}"><label><input type="checkbox"${a.checked ? ' checked' : ''} disabled></label><div>${blocks(node, env)}</div></li>`;
    case 'codeBlock':
      return `<pre><code${attrs([['class', a.language ? `language-${a.language}` : null]])}>${code(node, env)}</code></pre>`;
    case 'horizontalRule':
      return '<hr>';
    case 'table':
      return `<table><tbody>${blocks(node, env)}</tbody></table>`;
    case 'tableRow': {
      let out = '';
      node.forEach((child) => (out += cell(child, env)));
      return `<tr>${out}</tr>`;
    }
    case 'callout':
      return `<aside${attrs([
        ['class', 'doc-callout'],
        ['data-callout-tone', a.tone],
      ])}>${blocks(node, env)}</aside>`;
    case 'mathBlock':
      return `<div${attrs([
        ['class', 'doc-mathBlock'],
        ['data-math-block', ''],
        ['data-latex', a.latex],
      ])}>${math(a.latex, true)}</div>`;
    case 'diagram':
      return `<pre${attrs([
        ['class', 'doc-diagram-source'],
        ['data-diagram', ''],
      ])}>${escapeText(String(a.source ?? ''))}</pre>`;
    case 'chart':
      return `<div${attrs([
        ['class', 'doc-chart'],
        ['data-chart', ''],
        ['data-source', a.source],
        ['data-spec', typeof a.spec === 'string' ? a.spec : null],
        ['data-spec-json', a.spec != null && typeof a.spec !== 'string' ? JSON.stringify(a.spec) : null],
      ])}><span class="doc-placeholder-label">Chart</span> <span>${escapeText(String(a.source ?? ''))}</span></div>`;
    case 'pending':
      return `<div${attrs([
        ['class', 'doc-pending'],
        ['data-pending', ''],
        ['data-intent', a.intent],
      ])}><span class="doc-placeholder-label">Pending</span> <span>${escapeText(String(a.intent ?? ''))}</span></div>`;
    default:
      return node.isTextblock ? `<p>${inlines(node, env)}</p>` : blocks(node, env);
  }
}

/** A tab body's blocks as HTML. */
export const renderBody = (body: PMNode, env: RenderEnvironment): string => blocks(body, env);
