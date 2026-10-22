// P4-B2 (docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md, D15): what the editor calls an element, in one place:
// the inspector's title (W1-C's L281: a text element by the type class it is set in, as the toolbar's Text style menu
// names it, else its kind), the stage's element nodes as assistive technology reads them (A1), and the text box's name (A4).
import { TEXT_TAGS, type Attrs, type Style } from '../ir';
import { DECK_COPY as C } from './copy';
import { INSPECTOR_COPY } from './inspector/copy';
import { ROLE_LABELS, roleOfStyle } from './menus/TextStyle';

/** What an element's name is read from: its tag (the slide's own section too), its style and its attributes. */
export interface Nameable {
  tag: string;
  style: Readonly<Style>;
  attrs: Readonly<Attrs>;
}

const TAG_NAMES: Record<string, string> = {
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', p: 'Text', ul: 'Bulleted list', ol: 'Numbered list', div: 'Box', img: 'Image',
  table: 'Table', tr: 'Table row', th: 'Header cell', td: 'Cell', hr: 'Line', svg: 'Drawing', 'x-shape': 'Shape', 'x-icon': 'Icon',
  'x-connector': 'Connector', 'x-embed': 'Embed',
};

const isGroup = (e: { tag: string; attrs: Readonly<Attrs> }) => e.tag === 'div' && e.attrs['data-group'] !== undefined;

/** An element's name: the type class a text element is set in, else its kind by the tag (a group as a group). */
export function elementName(e: Nameable): string {
  const role = e.tag !== 'section' && TEXT_TAGS.has(e.tag as never) ? roleOfStyle(e.style) : null;
  if (role !== null) return ROLE_LABELS[role];
  if (isGroup(e)) return INSPECTOR_COPY.group;
  return TAG_NAMES[e.tag] ?? e.tag;
}

/**
 * A1: what an element that is not text, a table or a picture with its own alt is called on the stage: a shape by its
 * shape, an icon by its glyph, any other by its kind; a container by its kind and how many elements it holds.
 */
export function kindName(e: { tag: string; attrs: Readonly<Attrs> }, children: number): string {
  if (e.tag === 'div' && (isGroup(e) || children > 0)) return C.items(isGroup(e) ? INSPECTOR_COPY.group : TAG_NAMES.div!, children);
  if (e.tag === 'x-shape') return C.shapeName(e.attrs.kind ?? 'rect');
  if (e.tag === 'x-icon' && e.attrs.name) return C.iconName(e.attrs.name);
  return TAG_NAMES[e.tag] ?? e.tag;
}
