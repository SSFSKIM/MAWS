// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D2, D8 "Text in place"; M5): the slide-text schema as
// Tiptap extensions, S6's `binding-v14` made the product's: a text element's lines are one `p` block (h1-h3, p, th, td)
// or `li` items (ul, ol) of text and `br` line breaks, with Claude's inline marks and no wider (an https link, a colour
// span, b, i, u, nested in the dialect's order). Names and attributes are the model's (`{a:{href}}`, `{span:{color}}`,
// `{b}`), so the binding stores exactly what the loader reads; pasted HTML enters through the same rules, so a link
// that is not https or a colour the dialect refuses never reaches the model.
import { Extension, Mark, Node, type Extensions } from '@tiptap/core';
import { normValue } from '../css';
import type { TextBlock } from '../ir';

type TextKind = TextBlock['type'];

/** An https URL as written (the loader keeps only `https://` links), or null. */
export function httpsHref(raw: string): string | null {
  const href = raw.trim();
  if (!/^https:\/\/\S+$/i.test(href)) return null;
  try {
    return new URL(href).protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/** A colour a span may carry, as the loader normalizes it (`#rrggbb`, a `var(--ds-*)`, a named or functional colour), or null. */
export function spanColor(raw: string): string | null {
  return raw.trim() ? normValue('color', raw.trim()) : null;
}

/** The free colour field's form: `#rrggbb` only, lower-cased. */
export function hexColor(raw: string): string | null {
  const v = raw.trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? spanColor(v.toLowerCase()) : null;
}

// a paste's strong and em are the dialect's b and i
const inlineMark = (name: 'b' | 'i' | 'u', ...alias: string[]) => Mark.create({ name, parseHTML: () => [name, ...alias].map((tag) => ({ tag })), renderHTML: () => [name, 0] });

/** Runs a command as a gesture of its own (the text box makes a format change its own undo step). */
export type Gesture = (command: () => boolean) => boolean;

function keys(kind: TextKind, gesture: Gesture) {
  return Extension.create({
    name: 'slideTextKeys',
    priority: 200, // over Tiptap's core keymap
    addKeyboardShortcuts() {
      const editor = this.editor;
      const lineBreak = () =>
        editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) tr.replaceSelectionWith(editor.schema.nodes.br!.create(), false).scrollIntoView();
          return true;
        });
      return {
        'Mod-b': () => gesture(() => editor.commands.toggleMark('b')),
        'Mod-i': () => gesture(() => editor.commands.toggleMark('i')),
        'Mod-u': () => gesture(() => editor.commands.toggleMark('u')),
        'Shift-Enter': lineBreak,
        Enter: kind === 'p' ? lineBreak : () => editor.commands.splitBlock(),
        Backspace: () => {
          const { selection } = editor.state;
          // a later item's start joins it to the item before
          if (kind !== 'li' || !selection.empty || selection.$from.parentOffset > 0 || selection.$from.index(0) === 0) return false;
          return editor.commands.joinBackward();
        },
      };
    },
  });
}

/** The extensions of a text box over `kind` blocks. */
export function slideTextExtensions(kind: TextKind, gesture: Gesture = (command) => command()): Extensions {
  return [
    Node.create({ name: 'doc', topNode: true, content: kind === 'p' ? 'p' : 'li+' }),
    Node.create({ name: kind, content: 'inline*', parseHTML: () => [{ tag: kind }], renderHTML: () => [kind, 0] }),
    Node.create({ name: 'text', group: 'inline' }),
    Node.create({ name: 'br', group: 'inline', inline: true, selectable: false, parseHTML: () => [{ tag: 'br' }], renderHTML: () => ['br'] }),
    // the schema's mark order is the nesting order: a, span, b, i, u (the dialect's MARK_ORDER)
    Mark.create({
      name: 'a',
      inclusive: false,
      addAttributes: () => ({ href: { default: null } }),
      parseHTML: () => [{ tag: 'a[href]', getAttrs: (el) => (httpsHref((el as HTMLElement).getAttribute('href') ?? '') ? { href: httpsHref((el as HTMLElement).getAttribute('href')!) } : false) }],
      renderHTML: ({ mark }) => ['a', { href: mark.attrs.href as string }, 0],
    }),
    Mark.create({
      name: 'span',
      addAttributes: () => ({ color: { default: null } }),
      parseHTML: () => [
        {
          tag: 'span[style]',
          getAttrs: (el) => {
            const color = spanColor((el as HTMLElement).style.getPropertyValue('color'));
            return color ? { color } : false;
          },
        },
      ],
      renderHTML: ({ mark }) => ['span', { style: `color:${mark.attrs.color as string}` }, 0],
    }),
    inlineMark('b', 'strong'),
    inlineMark('i', 'em'),
    inlineMark('u'),
    keys(kind, gesture),
  ];
}
