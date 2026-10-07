// The naming side of a browser anchor (E4d execution document, Design §4; A-37): what the person pointed at, named so an
// agent can find it again. `css` is the key (a selector unique in the document, E0b S2e's round trip), `role` and `name`
// narrow it the way E4c resolves a locator (`locator('css=' + css).and(getByRole(role, {name, exact: true}))`, its
// Design §6), and `a11y` is a human label. A role or name Playwright computes differently would make a correct css fail
// to resolve, so the rules below follow Playwright's `roleUtils` where that is cheap and answer null or `''` (omitted
// from the anchor) wherever they cannot be sure. Lifted from `spikes/browser-probe/shared/locator.cjs`.
//
// DOM-only and dependency-free: the browser preload bundles it alone (no zod, nothing under `@shared/ipc/`). The DOM is
// typed structurally (`DomElement`) because `src/shared` also compiles under the Node program, which has no DOM lib.

// The slice of the DOM this module reads; a real `Element` (and happy-dom's) satisfies it.
export interface DomNode {
  readonly nodeType: number;
  readonly textContent: string | null;
}
export interface DomElement extends DomNode {
  readonly localName: string;
  readonly id: string;
  readonly parentElement: DomElement | null;
  readonly children: ArrayLike<DomElement>;
  readonly childNodes: ArrayLike<DomNode>;
  readonly previousElementSibling: DomElement | null;
  readonly nextElementSibling: DomElement | null;
  readonly ownerDocument: DomDocument;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}
interface DomStyle {
  readonly display: string;
  readonly visibility: string;
  readonly content: string;
}
export interface DomDocument {
  readonly documentElement: DomElement | null;
  readonly defaultView: { getComputedStyle(element: DomElement, pseudoElement?: string | null): DomStyle } | null;
  querySelectorAll(selectors: string): ArrayLike<DomElement>;
  getElementById(elementId: string): DomElement | null;
}

export type ElementDescription = { css: string; role: string | null; name: string; a11y: string; tag: string; confident: boolean };

export const CSS_PATH_MAX = 2000;
export const A11Y_SEGMENT_NAME_MAX = 40; // E2's `TEXT_MAX` for page text
export const A11Y_PATH_MAX = 300;

// --- text helpers (E2's `oneLine` and `fit`, `src/renderer/src/tools/deliverables/comment/pick.ts`) ---

// eslint-disable-next-line no-control-regex -- the control characters are what is matched
const CONTROL = /[\x00-\x1f\x7f]/g;
// eslint-disable-next-line no-control-regex -- the control characters are what is matched
const HAS_CONTROL = /[\x00-\x1f\x7f]/;
export const oneLine = (text: string): string => text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();

// At most `max` UTF-16 units (what a schema's `max` counts), an ellipsis marking a cut, never half a surrogate pair.
export function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(0, Math.max(0, max - 1));
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return `${kept}…`;
}

// The same from the other end: the last `max - 1` units after an ellipsis (the innermost segments of a path).
export function fitEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = text.slice(text.length - Math.max(0, max - 1));
  if (/^[\uDC00-\uDFFF]/.test(kept)) kept = kept.slice(1);
  return `…${kept}`;
}

// Playwright's `asFlatString` with its matcher's whitespace rule: soft hyphens and zero-width spaces dropped, runs of
// whitespace one space, trimmed.
const INVISIBLE = new RegExp(`[${String.fromCharCode(0x200b, 0xad)}]`, 'g'); // zero-width space, soft hyphen
const flat = (text: string): string => text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

// --- the CSS selector ---

// `CSS.escape` (CSSOM §2.1.1), with the specification's algorithm for a context that lacks it.
function escapeIdentifier(value: string): string {
  const units = [...value];
  return units
    .map((char, index) => {
      const code = char.codePointAt(0)!;
      if (code === 0) return String.fromCodePoint(0xfffd);
      const digit = code >= 0x30 && code <= 0x39;
      if ((code >= 0x01 && code <= 0x1f) || code === 0x7f || (index === 0 && digit) || (index === 1 && digit && units[0] === '-')) return `\\${code.toString(16)} `;
      if (index === 0 && char === '-' && units.length === 1) return '\\-';
      if (code >= 0x80 || char === '-' || char === '_' || digit || /[A-Za-z]/.test(char)) return char;
      return `\\${char}`;
    })
    .join('');
}

function cssEscape(value: string): string {
  const escape = (globalThis as unknown as { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  return typeof escape === 'function' ? escape(value) : escapeIdentifier(value);
}

// The grammar `cssPath` writes: an optional first `#<escaped id>` step, then `<tag>` steps with an optional
// `:nth-of-type(<n>)`, joined by ` > `. An escaped id admits a hex escape (maximal, so a run of hex digits has one
// reading and the match stays linear), an escaped non-hex printable ASCII character, `[\w-]`, and any code point at or
// above U+0080, which `CSS.escape` leaves as it is. No other combinator, no attribute selector, no pseudo-class but
// `:nth-of-type`, no comma: main validates a page-supplied css against it, and E4c passes it to Playwright as `css=`.
const ID = String.raw`#(?:\\[0-9a-fA-F]{1,6}(?![0-9a-fA-F]) ?|\\[\x20-\x2f\x3a-\x40\x47-\x60\x67-\x7e]|[\w-]|[^\x00-\x7f])+`;
const TAG = String.raw`[A-Za-z][\w-]*(?::nth-of-type\([1-9][0-9]*\))?`;
export const CSS_PATH = new RegExp(`^(?:${ID}|${TAG})(?: > ${TAG})*$`, 'u');
const ID_STEP = new RegExp(`^${ID}$`, 'u');

// `#<id>` when the id is the only one in the document and its escape stays inside the grammar; else null, and the path
// continues with tag steps as if the element had no id.
function uniqueIdStep(el: DomElement): string | null {
  if (el.id === '') return null;
  const step = `#${cssEscape(el.id)}`;
  if (step.length > CSS_PATH_MAX || !ID_STEP.test(step)) return null;
  try {
    const found = el.ownerDocument.querySelectorAll(step);
    return found.length === 1 && found[0] === el ? step : null; // not a shadow tree's element that shares a light-DOM id
  } catch {
    return null;
  }
}

function tagStep(el: DomElement): string {
  const parent = el.parentElement;
  if (parent === null) return el.localName;
  const same = Array.from(parent.children).filter((sibling) => sibling.localName === el.localName);
  return same.length > 1 ? `${el.localName}:nth-of-type(${same.indexOf(el) + 1})` : el.localName;
}

// A selector unique in the document (E0b's `cssPath`): the nearest ancestor-or-self with a unique id, else
// `tag:nth-of-type(k)` steps up to the root's child. Null for an element outside the document's tree (detached, or
// inside a shadow root: its host is what can be named) and for a path past `CSS_PATH_MAX`.
export function cssPath(el: DomElement): string | null {
  const root = el.ownerDocument.documentElement;
  if (el === root) return el.localName;
  const steps: string[] = [];
  let node: DomElement | null = el;
  while (node !== null && node !== root) {
    const id = uniqueIdStep(node);
    if (id !== null) {
      steps.unshift(id);
      break;
    }
    steps.unshift(tagStep(node));
    node = node.parentElement;
  }
  if (node === null) return null;
  const css = steps.join(' > ');
  return css.length <= CSS_PATH_MAX && CSS_PATH.test(css) ? css : null;
}

// --- the role (Playwright's `getAriaRole`, roleUtils.ts, as of playwright-core 1.63.0) ---

const VALID_ROLES: ReadonlySet<string> = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption', 'cell', 'checkbox', 'code', 'columnheader', 'combobox',
  'complementary', 'contentinfo', 'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure', 'form', 'generic', 'grid',
  'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'mark', 'marquee', 'math', 'meter', 'menu',
  'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'paragraph', 'presentation', 'progressbar', 'radio',
  'radiogroup', 'region', 'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong',
  'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox', 'time', 'timer', 'toolbar', 'tooltip', 'tree',
  'treegrid', 'treeitem',
]);
const PRESENTATIONAL: ReadonlySet<string> = new Set(['none', 'presentation']);

const GLOBAL_ARIA = ['aria-atomic', 'aria-busy', 'aria-controls', 'aria-current', 'aria-describedby', 'aria-details', 'aria-dropeffect', 'aria-flowto', 'aria-grabbed', 'aria-hidden', 'aria-keyshortcuts', 'aria-label', 'aria-labelledby', 'aria-live', 'aria-owns', 'aria-relevant', 'aria-roledescription'];
const INPUT_TYPES: ReadonlySet<string> = new Set(['button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'file', 'hidden', 'image', 'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url', 'week']);
const INPUT_ROLE: Record<string, string> = { button: 'button', checkbox: 'checkbox', image: 'button', number: 'spinbutton', radio: 'radio', range: 'slider', reset: 'button', submit: 'button' };
// `header` and `footer` are landmarks only outside these (Playwright's `kAncestorPreventingLandmark`)
const LANDMARK_SCOPES: ReadonlySet<string> = new Set(['article', 'aside', 'main', 'nav', 'section']);
const LANDMARK_SCOPE_ROLES: ReadonlySet<string> = new Set(['article', 'complementary', 'main', 'navigation', 'region']);
// an implicit role an explicit `none` or `presentation` on these parents takes away (`kPresentationInheritanceParents`)
const PRESENTATION_PARENTS: Record<string, readonly string[]> = { dd: ['dl', 'div'], div: ['dl'], dt: ['dl', 'div'], li: ['ol', 'ul'], tbody: ['table'], td: ['tr'], tfoot: ['table'], th: ['tr'], thead: ['table'], tr: ['thead', 'tbody', 'tfoot', 'table'] };

// The `type` property's value: the attribute lowercased when it is a known type, else `text`.
function inputType(el: DomElement): string {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  return INPUT_TYPES.has(type) ? type : 'text';
}

function closest(el: DomElement, matches: (ancestor: DomElement) => boolean): DomElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) if (matches(node)) return node;
  return null;
}

function explicitRole(el: DomElement): string | null {
  return (el.getAttribute('role') ?? '').split(' ').map((token) => token.trim()).find((token) => VALID_ROLES.has(token)) ?? null;
}

const hasExplicitName = (el: DomElement) => el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
const hasTabIndex = (el: DomElement) => !Number.isNaN(Number(String(el.getAttribute('tabindex'))));

function tableRows(table: DomElement): number {
  let rows = 0;
  for (const child of Array.from(table.children)) {
    if (child.localName === 'tr') rows++;
    else if (['thead', 'tbody', 'tfoot'].includes(child.localName)) rows += Array.from(child.children).filter((row) => row.localName === 'tr').length;
  }
  return rows;
}

function thRole(el: DomElement): string | null {
  const scope = el.getAttribute('scope');
  if (scope === 'col' || scope === 'colgroup') return 'columnheader';
  if (scope === 'row' || scope === 'rowgroup') return 'rowheader';
  const next = el.nextElementSibling;
  const previous = el.previousElementSibling;
  if (next === null && previous === null) {
    const row = el.parentElement?.localName === 'tr' ? el.parentElement : null;
    const table = row && closest(row, (node) => node.localName === 'table');
    return table && tableRows(table) <= 1 ? null : 'columnheader';
  }
  if (next?.localName === 'th' && previous?.localName === 'th') return 'columnheader';
  const dataCell = (cell: DomElement | null) => cell?.localName === 'td' && ((cell.textContent ?? '').trim() !== '' || cell.children.length > 0);
  return dataCell(next) || dataCell(previous) ? 'rowheader' : 'columnheader';
}

const FIXED_ROLE: Record<string, string> = {
  article: 'article', aside: 'complementary', blockquote: 'blockquote', button: 'button', caption: 'caption', code: 'code', datalist: 'listbox',
  dd: 'definition', del: 'deletion', details: 'group', dfn: 'term', dialog: 'dialog', dt: 'term', em: 'emphasis', fieldset: 'group', figure: 'figure',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', hr: 'separator', html: 'document', ins: 'insertion',
  li: 'listitem', main: 'main', mark: 'mark', math: 'math', menu: 'list', meter: 'meter', nav: 'navigation', ol: 'list', optgroup: 'group',
  option: 'option', output: 'status', p: 'paragraph', progress: 'progressbar', search: 'search', strong: 'strong', sub: 'subscript',
  sup: 'superscript', svg: 'img', table: 'table', tbody: 'rowgroup', textarea: 'textbox', tfoot: 'rowgroup', thead: 'rowgroup', time: 'time',
  tr: 'row', ul: 'list',
};

// Playwright's implicit table, except `input[type=file]` (Playwright's `button`, named "Choose File"), which answers
// null here: an omitted role is always safe, and a file input is not what a comment names.
function implicitRole(el: DomElement): string | null {
  const tag = el.localName;
  const fixed = FIXED_ROLE[tag];
  if (fixed !== undefined) return fixed;
  switch (tag) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : null;
    case 'header':
    case 'footer': {
      const scoped = closest(el, (node) => (LANDMARK_SCOPES.has(node.localName) && !node.hasAttribute('role')) || LANDMARK_SCOPE_ROLES.has(node.getAttribute('role') ?? ''));
      return scoped !== null ? null : tag === 'header' ? 'banner' : 'contentinfo';
    }
    case 'form':
      return hasExplicitName(el) ? 'form' : null;
    case 'section':
      return hasExplicitName(el) ? 'region' : null;
    case 'img':
      return el.getAttribute('alt') === '' && !el.getAttribute('title') && !GLOBAL_ARIA.some((name) => el.hasAttribute(name)) && !hasTabIndex(el) ? 'presentation' : 'img';
    case 'input': {
      const type = inputType(el);
      if (['email', 'search', 'tel', 'text', 'url'].includes(type)) {
        const list = el.getAttribute('list');
        if (list && el.ownerDocument.getElementById(list)?.localName === 'datalist') return 'combobox';
        return type === 'search' ? 'searchbox' : 'textbox';
      }
      if (type === 'hidden' || type === 'file') return null;
      return INPUT_ROLE[type] ?? 'textbox';
    }
    case 'select': {
      const size = Number.parseInt(el.getAttribute('size') ?? '', 10);
      return el.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox';
    }
    case 'td': {
      const table = closest(el, (node) => node.localName === 'table');
      const role = table && explicitRole(table);
      return role === 'grid' || role === 'treegrid' ? 'gridcell' : 'cell';
    }
    case 'th':
      return thRole(el);
    default:
      return null;
  }
}

// The role Playwright computes, `none` and `presentation` included; an explicit `none` on a focusable element (which
// Playwright resolves back to the implicit role) stays `none` here, which `roleOf` then omits.
function ariaRole(el: DomElement): string | null {
  const explicit = explicitRole(el);
  if (explicit !== null) return explicit;
  const implicit = implicitRole(el);
  if (implicit === null) return null;
  for (let node = el; ; ) {
    const parent = node.parentElement;
    if (parent === null || !(PRESENTATION_PARENTS[node.localName] ?? []).includes(parent.localName)) break;
    const parentRole = explicitRole(parent);
    if (parentRole !== null && PRESENTATIONAL.has(parentRole)) return parentRole;
    node = parent;
  }
  return implicit;
}

// The element's ARIA role as Playwright's `getByRole` reads it, or null: no role, or a presentational one (which
// `getByRole` is never asked for).
export function roleOf(el: DomElement): string | null {
  const role = ariaRole(el);
  return role === null || PRESENTATIONAL.has(role) ? null : role;
}

// --- the accessible name (Playwright's `getElementAccessibleName`, the common cases) ---

// Roles ARIA names from their content (Playwright's `allowsNameFromContent` for the element itself). A container
// (`list`, `region`, `main`) is never named by its text.
export const NAME_FROM_CONTENT_ROLES: ReadonlySet<string> = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row',
  'rowheader', 'switch', 'tab', 'tooltip', 'treeitem',
]);
// ...and the roles whose text a descendant contributes to an ancestor's content name (the `targetDescendant` list).
const CONTENT_OF_DESCENDANT: ReadonlySet<string> = new Set(['', 'caption', 'code', 'contentinfo', 'definition', 'deletion', 'emphasis', 'insertion', 'list', 'listitem', 'mark', 'none', 'paragraph', 'presentation', 'region', 'row', 'rowgroup', 'section', 'strong', 'subscript', 'superscript', 'table', 'term', 'time']);
const PROHIBITS_NAMING: ReadonlySet<string> = new Set(['caption', 'code', 'definition', 'deletion', 'emphasis', 'generic', 'insertion', 'mark', 'paragraph', 'presentation', 'strong', 'subscript', 'suggestion', 'superscript', 'term', 'time']);
const IGNORED: ReadonlySet<string> = new Set(['script', 'style', 'noscript', 'template']);
const LABELABLE: ReadonlySet<string> = new Set(['button', 'input', 'meter', 'output', 'progress', 'select', 'textarea']);
const PLACEHOLDER_TYPES: ReadonlySet<string> = new Set(['text', 'password', 'number', 'search', 'tel', 'email', 'url']);

// A text that cannot be computed here the way Playwright would (a select's chosen option, CSS-generated content, an
// `aria-owns`): the name it would be part of answers `''`.
const DOUBT = null;
type Text = string | typeof DOUBT;
type Walk = { visited: Set<DomElement>; inLabelledBy: boolean };

function styleOf(el: DomElement, pseudo?: string): DomStyle | null {
  try {
    return el.ownerDocument.defaultView?.getComputedStyle(el, pseudo) ?? null;
  } catch {
    return null;
  }
}

function hiddenForAria(el: DomElement): boolean {
  if (el.hasAttribute('hidden') || (el.getAttribute('aria-hidden') ?? '').toLowerCase() === 'true') return true;
  const style = styleOf(el);
  return style !== null && (style.display === 'none' || (style.visibility !== '' && style.visibility !== 'visible'));
}

// CSS `content` on `::before`/`::after` is part of a content name (icon fonts put glyphs there); only an empty one is safe.
function hasGeneratedContent(el: DomElement): boolean {
  return ['::before', '::after'].some((pseudo) => {
    const content = styleOf(el, pseudo)?.content ?? '';
    return !['', 'none', 'normal', '""', "''"].includes(content);
  });
}

function idRefs(el: DomElement, attribute: string): DomElement[] {
  const ids = (el.getAttribute(attribute) ?? '').split(' ').filter((id) => id !== '');
  const refs: DomElement[] = [];
  for (const id of ids) {
    const ref = el.ownerDocument.getElementById(id);
    if (ref !== null && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

const joined = (parts: Text[]): Text => (parts.includes(DOUBT) ? DOUBT : (parts as string[]).filter((part) => part !== '').join(' '));

// The labels Playwright's `element.labels` lists: `label[for=<id>]` when the id leads to this element, and the nearest
// wrapping label without `for` whose first labelable descendant is this element.
function labelsOf(el: DomElement): DomElement[] {
  const labels: DomElement[] = [];
  const doc = el.ownerDocument;
  if (el.id !== '' && doc.getElementById(el.id) === el) {
    try {
      labels.push(...Array.from(doc.querySelectorAll(`label[for="${cssEscape(el.id)}"]`)));
    } catch {
      // an id no selector can quote: no `for` labels
    }
  }
  const wrapping = closest(el, (node) => node.localName === 'label');
  if (wrapping !== null && !wrapping.hasAttribute('for') && firstLabelable(wrapping) === el && !labels.includes(wrapping)) labels.push(wrapping);
  return labels;
}

function firstLabelable(root: DomElement): DomElement | null {
  for (const child of Array.from(root.children)) {
    if (LABELABLE.has(child.localName) && !(child.localName === 'input' && inputType(child) === 'hidden')) return child;
    const inner = firstLabelable(child);
    if (inner !== null) return inner;
  }
  return null;
}

// The rules for an element whose markup names it (inputs, images, fieldsets, tables, SVG): a string (possibly empty)
// when one applies, `undefined` when none does.
function nativeName(el: DomElement, role: string, labelledBy: boolean, walk: Walk): Text | undefined {
  if (PRESENTATIONAL.has(role)) return undefined;
  const tag = el.localName;
  const title = () => flat(el.getAttribute('title') ?? '');
  const fromLabels = (): Text | undefined => {
    const labels = labelsOf(el);
    if (labels.length === 0) return undefined;
    const text = joined(labels.map((label) => embeddedText(label, walk, true)));
    return text === DOUBT ? DOUBT : flat(text);
  };
  const firstChild = (name: string) => Array.from(el.children).find((child) => child.localName === name);
  if (tag === 'input') {
    const type = inputType(el);
    if (type === 'button' || type === 'submit' || type === 'reset') return flat(el.getAttribute('value') ?? '') || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : title());
    if (type === 'file') return fromLabels() ?? 'Choose File';
    if (type === 'image') return fromLabels() ?? (flat(el.getAttribute('alt') ?? '') || title() || 'Submit');
  }
  if (!labelledBy && tag === 'button') return fromLabels();
  if (!labelledBy && tag === 'output') return fromLabels() ?? title();
  if (!labelledBy && ['textarea', 'select', 'input', 'meter', 'progress'].includes(tag)) {
    const fromLabel = fromLabels();
    if (fromLabel !== undefined) return fromLabel;
    const placeholder = (tag === 'input' && PLACEHOLDER_TYPES.has(inputType(el))) || tag === 'textarea';
    return !placeholder || title() !== '' ? title() : flat(el.getAttribute('placeholder') ?? '');
  }
  if (!labelledBy && (tag === 'fieldset' || tag === 'figure')) {
    const caption = firstChild(tag === 'fieldset' ? 'legend' : 'figcaption');
    return caption !== undefined ? embeddedText(caption, walk, true) : title();
  }
  if (tag === 'img' || tag === 'area') return flat(el.getAttribute('alt') ?? '') || title();
  if (tag === 'table') {
    const caption = firstChild('caption');
    if (caption !== undefined) return embeddedText(caption, walk, true);
    const summary = flat(el.getAttribute('summary') ?? '');
    if (summary !== '') return summary;
  }
  if (tag === 'svg') {
    const svgTitle = firstChild('title');
    if (svgTitle !== undefined) return contentText(svgTitle, walk);
  }
  return undefined;
}

// What an element contributes to a name it is part of: a descendant of the named element, or an element the name
// references (`referenced`: a labelledby target, a label, a legend, a caption), whose content always counts.
function embeddedText(el: DomElement, walk: Walk, referenced: boolean): Text {
  if (walk.visited.has(el)) return '';
  if (!walk.inLabelledBy) {
    const refs = idRefs(el, 'aria-labelledby');
    if (refs.length > 0) {
      const text = labelledByText(refs, walk);
      if (text !== '') return text;
    }
  }
  const role = ariaRole(el) ?? '';
  if (role === 'textbox' || role === 'searchbox') {
    const value = (el as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : (el.textContent ?? '');
  }
  if (['combobox', 'listbox', 'progressbar', 'scrollbar', 'slider', 'spinbutton', 'meter'].includes(role)) return DOUBT;
  if (role === 'menu') return '';
  const label = el.getAttribute('aria-label') ?? '';
  if (flat(label) !== '') return label;
  const native = nativeName(el, role, el.hasAttribute('aria-labelledby'), walk);
  if (native !== undefined) return native;
  if (referenced || walk.inLabelledBy || NAME_FROM_CONTENT_ROLES.has(role) || CONTENT_OF_DESCENDANT.has(role)) {
    const content = contentText(el, walk);
    if (content === DOUBT || content.trim() !== '') return content;
  }
  return PRESENTATIONAL.has(role) ? '' : (el.getAttribute('title') ?? '');
}

// The labelledby targets' texts joined (their own labelledby is not followed, as the specification says).
function labelledByText(refs: DomElement[], walk: Walk): Text {
  return joined(refs.map((ref) => embeddedText(ref, { ...walk, inLabelledBy: true }, true)));
}

// The element's text as a content name: its text nodes and its visible descendants' contributions, a block-level
// descendant set off by spaces.
function contentText(el: DomElement, walk: Walk): Text {
  if (walk.visited.has(el)) return ''; // a reference cycle (Playwright's `visitedElements`)
  if (el.hasAttribute('aria-owns') || hasGeneratedContent(el)) return DOUBT;
  walk.visited.add(el);
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) parts.push(node.textContent ?? '');
    if (node.nodeType !== 1) continue;
    const child = node as DomElement;
    if (IGNORED.has(child.localName) || hiddenForAria(child)) continue;
    const text = embeddedText(child, walk, false);
    if (text === DOUBT) return DOUBT;
    const display = styleOf(child)?.display || 'inline';
    parts.push(display !== 'inline' || child.localName === 'br' ? ` ${text} ` : text);
  }
  return parts.join('');
}

// The accessible name Playwright's `getByRole(role, {name, exact: true})` compares, or `''` when it is empty or this
// module cannot be sure of it: `aria-labelledby`, `aria-label`, the markup's own rules (labels, `alt`, a button input's
// value, a placeholder), the content for a role named from content, then `title`. A name holding a control character
// is one X10's one-line fields cannot carry as Playwright reads it, so it answers `''` too.
export function accessibleNameOf(el: DomElement): string {
  const name = computeName(el);
  return HAS_CONTROL.test(name) ? '' : name;
}

function computeName(el: DomElement): string {
  const role = ariaRole(el) ?? '';
  if (PROHIBITS_NAMING.has(role)) return '';
  const walk: Walk = { visited: new Set(), inLabelledBy: false };
  const refs = idRefs(el, 'aria-labelledby');
  if (refs.length > 0) {
    const text = labelledByText(refs, walk);
    if (text === DOUBT) return '';
    if (flat(text) !== '') return flat(text);
  }
  const label = flat(el.getAttribute('aria-label') ?? '');
  if (label !== '') return label;
  const native = nativeName(el, role, refs.length > 0, walk);
  if (native !== undefined) return native === DOUBT ? '' : flat(native);
  if (NAME_FROM_CONTENT_ROLES.has(role) || el.localName === 'summary') {
    const content = contentText(el, walk);
    if (content === DOUBT) return '';
    if (flat(content) !== '') return flat(content);
  }
  return PRESENTATIONAL.has(role) && el.localName !== 'iframe' ? '' : flat(el.getAttribute('title') ?? '');
}

// --- the path and the description ---

// Roles whose name the path leaves out (E0b's choice: a list's or a form's name is noise there).
const UNNAMED_IN_PATH: ReadonlySet<string> = new Set(['list', 'listitem', 'main', 'form']);

// `role “name”` segments from the outermost role-bearing ancestor down to the element (the document's root left out),
// each name cut to 40 and the whole cut to 300 from the start: the innermost segments are the useful ones. A human
// label, never the key (E0b S2e: it differs textually from Playwright's snapshot).
export function a11yPath(el: DomElement): string {
  const root = el.ownerDocument.documentElement;
  const segments: string[] = [];
  for (let node: DomElement | null = el; node !== null && node !== root; node = node.parentElement) {
    const role = roleOf(node);
    if (role === null) continue;
    const name = UNNAMED_IN_PATH.has(role) ? '' : accessibleNameOf(node);
    segments.unshift(name === '' ? role : `${role} “${fit(name, A11Y_SEGMENT_NAME_MAX)}”`);
  }
  return fitEnd(segments.join(' > '), A11Y_PATH_MAX);
}

// Playwright's `getByRole` skips an element under `aria-hidden="true"`, so a role and name sent for one would only make
// E4c's lookup fail; the anchor then keeps its css alone.
function underAriaHidden(el: DomElement): boolean {
  for (let node: DomElement | null = el; node !== null; node = node.parentElement) if ((node.getAttribute('aria-hidden') ?? '').toLowerCase() === 'true') return true;
  return false;
}

// What a pick reports about its element, or null when no css can name it.
export function describeElement(el: DomElement): ElementDescription | null {
  const css = cssPath(el);
  if (css === null) return null;
  return { css, role: roleOf(el), name: accessibleNameOf(el), a11y: a11yPath(el), tag: el.localName, confident: !underAriaHidden(el) };
}
