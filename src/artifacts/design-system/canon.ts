// The canon (D6): `layouts/<name>.html` (one slide-dialect `<section id>` with `data-ph` placeholders),
// `components/<name>.html` (one root element in the dialect) and `components/document.css` (document blocks under
// `.ds-doc`). Two things live here: the structural validation D6 asks of canon (the dialect itself is C's parser's), and
// the adapters from canon files to the element stream the hard-don'ts check reads (`check.ts`). The HTML adapter takes
// the DOM parser as a parameter (the renderer's `DOMParser`, happy-dom in tests), so this module stays portable (§4.10).
import { parseDeclarations, parseStylesheet, splitTopLevel, urlsIn, varNamesIn, type Declaration } from './css-read';
import { resolveTokens } from './resolve';
import { cssNamesOf, ROLES } from './roles';
import type { TokenSet } from './tokens';

/**
 * One element of the stream the check reads: from canon HTML, from a stylesheet rule (its selector as `at`, tag
 * `rule`), and later from a deck's slides (C) and a document's rendered DOM (B).
 */
export interface CanonElement {
  /** Lower-case element name (`rule` for a stylesheet rule). */
  tag: string;
  /** Attributes as written, `style` excepted. */
  attrs: Readonly<Record<string, string>>;
  /** The inline style (or the rule's block), in order. */
  style: readonly Declaration[];
  /** The element's own text (its text nodes, not its children's), whitespace collapsed. */
  text: string;
  children: readonly CanonElement[];
  /** Where it is, as a selector a reader can follow: `section#title > h1:nth-child(1)`. */
  at: string;
}

/** What the check runs over: one slide, one component, one stylesheet or one document. */
export type CheckUnitKind = 'slide' | 'component' | 'stylesheet' | 'document';
export interface CheckUnit {
  /** The canon path, the slide's id or the document's title: how a violation names where it is. */
  name: string;
  kind: CheckUnitKind;
  elements: readonly CanonElement[];
}

// The part of the DOM the adapter reads; the renderer's `DOMParser` and happy-dom's both fit it.
export interface DomNodeLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<DomNodeLike>;
  attributes?: ArrayLike<{ name: string; value: string }>;
}
export interface HtmlParser {
  parseFromString(source: string, type: 'text/html'): { head: DomNodeLike | null; body: DomNodeLike | null };
}

export const PLACEHOLDER_ROLES = ['title', 'subtitle', 'body', 'image', 'caption', 'notes'] as const;
export const DOCUMENT_CSS_PATH = 'components/document.css';
/** D12's bounds: a system's canon readable in one `artifact_read`. */
export const CANON_LIMITS = { files: 64, fileBytes: 64 * 1024 } as const;

export type CanonFileKind = 'layout' | 'component' | 'stylesheet';
const NAME = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
/** What a path is in the canon; null for a path outside `layouts/` and `components/`, `'stray'` for a wrong one inside. */
export function canonKind(path: string): CanonFileKind | 'stray' | null {
  if (path === DOCUMENT_CSS_PATH) return 'stylesheet';
  if (new RegExp(`^layouts/${NAME}\\.html$`).test(path)) return 'layout';
  if (new RegExp(`^components/${NAME}\\.html$`).test(path)) return 'component';
  return path.startsWith('layouts/') || path.startsWith('components/') ? 'stray' : null;
}

// --- The adapters ----------------------------------------------------------------------------------------------------

// Elements a parser may hoist out of the root (into <head>, or before the root in <body>); canon has none of them.
const OUTSIDE_TAGS = new Set(['style', 'link', 'meta', 'base', 'title', 'script', 'noscript', 'template']);
const ELEMENT = 1;
const TEXT = 3;

function readElement(node: DomNodeLike, at: string): CanonElement {
  const attrs: Record<string, string> = {};
  let style: Declaration[] = [];
  for (const attr of Array.from(node.attributes ?? [])) {
    if (attr.name.toLowerCase() === 'style') style = parseDeclarations(attr.value);
    else attrs[attr.name] = attr.value;
  }
  const children: CanonElement[] = [];
  let text = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT) text += child.nodeValue ?? '';
    else if (child.nodeType === ELEMENT) children.push(readElement(child, `${at} > ${locator(child, children.length + 1)}`));
  }
  return { tag: node.nodeName.toLowerCase(), attrs, style, text: text.replace(/\s+/g, ' ').trim(), children, at };
}

function locator(node: DomNodeLike, nth: number | null): string {
  const tag = node.nodeName.toLowerCase();
  const id = Array.from(node.attributes ?? []).find((a) => a.name === 'id')?.value;
  if (id && /^[A-Za-z_][\w-]*$/.test(id)) return `${tag}#${id}`;
  return nth === null ? tag : `${tag}:nth-child(${nth})`;
}

/** The roots of a canon HTML file, and what sits outside them (hoisted elements, loose text). */
function readHtml(html: string, parser: HtmlParser): { roots: CanonElement[]; outside: string[] } {
  const doc = parser.parseFromString(html, 'text/html');
  const outside: string[] = [];
  const roots: CanonElement[] = [];
  for (const node of Array.from(doc.head?.childNodes ?? [])) if (node.nodeType === ELEMENT) outside.push(`<${node.nodeName.toLowerCase()}>`);
  for (const node of Array.from(doc.body?.childNodes ?? [])) {
    if (node.nodeType === TEXT) {
      const text = (node.nodeValue ?? '').trim();
      if (text) outside.push(`"${text}"`);
    } else if (node.nodeType === ELEMENT) {
      if (OUTSIDE_TAGS.has(node.nodeName.toLowerCase())) outside.push(`<${node.nodeName.toLowerCase()}>`);
      else roots.push(readElement(node, locator(node, null)));
    }
  }
  return { roots, outside };
}

/** A canon HTML file as the element stream (its root elements). */
export function canonElements(html: string, parser: HtmlParser): CanonElement[] {
  return readHtml(html, parser).roots;
}

/** A stylesheet as the element stream: one element per rule (and per `@font-face`-like block), at its selector. */
export function stylesheetElements(css: string): CanonElement[] {
  return parseStylesheet(css).nodes.flatMap((node): CanonElement[] => {
    if (node.kind === 'at' && node.declarations === null) return [];
    const selector = node.kind === 'rule' ? node.selector : `@${node.name}${node.prelude ? ` ${node.prelude}` : ''}`;
    return [{ tag: 'rule', attrs: {}, style: node.declarations ?? [], text: '', children: [], at: [...node.within, selector].join(' ') }];
  });
}

/** Every canon file of a system as a check unit, in path order. */
export function canonUnits(files: Readonly<Record<string, string>>, parser: HtmlParser): CheckUnit[] {
  return Object.keys(files)
    .sort()
    .flatMap((path): CheckUnit[] => {
      const kind = canonKind(path);
      const text = files[path]!;
      if (kind === 'layout') return [{ name: path, kind: 'slide', elements: canonElements(text, parser) }];
      if (kind === 'component') return [{ name: path, kind: 'component', elements: canonElements(text, parser) }];
      if (kind === 'stylesheet') return [{ name: path, kind: 'stylesheet', elements: stylesheetElements(text) }];
      return [];
    });
}

// --- Validation ------------------------------------------------------------------------------------------------------

export interface CanonProblem {
  /** The canon path (`''` for the canon as a whole). */
  path: string;
  message: string;
}

// The fixed names (X28), the only ones slides and components may read (the spec's Decision Log 3).
const FIXED_NAMES = new Set(ROLES.flatMap((role) => cssNamesOf(role.path, role.type)));
const FORBIDDEN_TAGS = new Set([...OUTSIDE_TAGS, 'iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'applet']);
const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href', 'background', 'cite', 'ping']);
const OUTSIDE_ASSETS = 'points outside assets/; canon reads only its own assets/ files';

/** A canon file reads only its own `assets/` (no `..`), or a fragment of itself. */
const localUrl = (url: string): boolean => url.startsWith('#') || (url.startsWith('assets/') && !url.split('/').includes('..'));

/** The problems of a declaration list: a custom property set, a foreign or unknown `var()`, a URL outside assets/. */
function declarationProblems(style: readonly Declaration[], allowed: (name: string) => string | null): string[] {
  const out: string[] = [];
  for (const { property, value } of style) {
    if (property.startsWith('--')) out.push(`declares ${property}; canon reads tokens, it never sets them`);
    for (const name of varNamesIn(value)) {
      const refusal = name.startsWith('--ds-') ? allowed(name) : `var(${name}) is not a design-system name (--ds-*)`;
      if (refusal) out.push(refusal);
    }
    for (const url of urlsIn(value)) if (!localUrl(url)) out.push(`url(${url}) ${OUTSIDE_ASSETS}`);
  }
  return out;
}

function htmlProblems(kind: 'layout' | 'component', html: string, parser: HtmlParser): string[] {
  const out: string[] = [];
  const { roots, outside } = readHtml(html, parser);
  for (const what of outside) {
    out.push(what.startsWith('<') ? `${what} sits outside the root element; canon styles inline, with var(--ds-*) values` : `text sits outside the root element: ${what}`);
  }
  if (roots.length !== 1) out.push(`a canon file is one root element; this one has ${roots.length || 'none'}`);
  else if (kind === 'layout') {
    const root = roots[0]!;
    if (root.tag !== 'section') out.push(`a layout is one <section id>; its root is <${root.tag}>`);
    else if (!/^[A-Za-z0-9_-]{1,64}$/.test(root.attrs.id ?? '')) out.push('the layout’s <section> needs an id of 1 to 64 letters, digits, - or _');
  }
  const fixedOnly = (name: string) =>
    FIXED_NAMES.has(name) ? null : `var(${name}) is not one of X28’s names; a system’s extra tokens are for documents, not slides or components`;
  const walk = (element: CanonElement) => {
    const here: string[] = [];
    if (FORBIDDEN_TAGS.has(element.tag)) here.push(`<${element.tag}> is not allowed in canon`);
    for (const [name, value] of Object.entries(element.attrs)) {
      const lower = name.toLowerCase();
      if (lower.startsWith('on')) here.push(`the event handler ${name} runs script; canon holds no script`);
      else if (lower === 'srcset') {
        for (const candidate of splitTopLevel(value, ',')) {
          const url = candidate.split(/\s+/)[0]!;
          if (!localUrl(url)) here.push(`srcset="${url}" ${OUTSIDE_ASSETS}`);
        }
      } else if (URL_ATTRS.has(lower) && !localUrl(value.trim())) here.push(`${name}="${value}" ${OUTSIDE_ASSETS}`);
      else if (lower === 'data-ph' && !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
        here.push(`data-ph="${value}" is not a placeholder role (${PLACEHOLDER_ROLES.join(', ')}, or a lower-case name)`);
      }
    }
    here.push(...declarationProblems(element.style, fixedOnly));
    out.push(...here.map((p) => `${element.at}: ${p}`));
    element.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

const SELECTOR_ROOT = /^\.ds-doc(?![\w-])/;
const STATEMENTS_REFUSED: Record<string, string> = {
  import: '@import loads another stylesheet; document.css stands alone',
  namespace: '@namespace is not allowed in document.css',
};
const BLOCKS_ALLOWED = new Set(['font-face']);

function stylesheetProblems(css: string, names: ReadonlySet<string> | null): string[] {
  const out: string[] = [];
  if (/<\/style/i.test(css)) out.push('the stylesheet holds "</style", which would end the <style> it is inlined into');
  const { nodes, problems } = parseStylesheet(css);
  out.push(...problems);
  const known = (name: string) => (!names || names.has(name) ? null : `var(${name}) names no token of this system`);
  for (const node of nodes) {
    if (node.kind === 'at') {
      if (node.declarations === null) {
        const refusal = STATEMENTS_REFUSED[node.name];
        if (refusal) out.push(refusal);
        continue;
      }
      if (!BLOCKS_ALLOWED.has(node.name)) {
        out.push(`@${node.name} is not allowed in document.css; it reaches outside .ds-doc`);
        continue;
      }
      out.push(...declarationProblems(node.declarations, known).map((p) => `@${node.name}: ${p}`));
      continue;
    }
    for (const selector of splitTopLevel(node.selector, ',')) {
      const rest = selector.replace(SELECTOR_ROOT, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '').replace(/\[[^\]]*\]/g, '');
      if (!SELECTOR_ROOT.test(selector) || /[.#]/.test(rest)) {
        out.push(`the selector "${selector}" must sit under .ds-doc and use element and attribute selectors only`);
      }
    }
    out.push(...declarationProblems(node.declarations, known).map((p) => `${node.selector}: ${p}`));
  }
  return out;
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

/**
 * The structural check of a system's canon (D6): each canon file's shape, no script, no URL outside `assets/`, `var()`
 * only of `--ds-*` names (X28's fixed names in layouts and components; in `document.css` any name the system writes,
 * when `tokens` is given), and D12's limits. Files outside `layouts/` and `components/` are not canon and pass.
 */
export function validateCanon(files: Readonly<Record<string, string>>, parser: HtmlParser, tokens?: TokenSet): CanonProblem[] {
  const paths = Object.keys(files)
    .filter((path) => canonKind(path) !== null)
    .sort();
  const problems: CanonProblem[] = [];
  if (paths.length > CANON_LIMITS.files) problems.push({ path: '', message: `${paths.length} canon files; a system holds at most ${CANON_LIMITS.files}` });
  let names: Set<string> | null = null;
  if (tokens) {
    names = new Set();
    for (const token of resolveTokens(tokens).tokens.values()) for (const name of cssNamesOf(token.path, token.type)) names.add(name);
  }
  for (const path of paths) {
    const text = files[path]!;
    const kind = canonKind(path)!;
    const size = byteLength(text);
    if (size > CANON_LIMITS.fileBytes) problems.push({ path, message: `${size} bytes; a canon file holds at most ${CANON_LIMITS.fileBytes}` });
    const messages =
      kind === 'stray'
        ? ['not a canon path: layouts are layouts/<name>.html, components components/<name>.html or components/document.css']
        : kind === 'stylesheet'
          ? stylesheetProblems(text, names)
          : htmlProblems(kind, text, parser);
    for (const message of messages) problems.push({ path, message });
  }
  return problems;
}
