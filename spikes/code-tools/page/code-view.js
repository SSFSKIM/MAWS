// The CodeMirror 6 read-only view R8 weighs and drives: the configuration C8c's CodeView plans (Interfaces, *Viewer kinds
// and caps*): readOnly, not editable, line numbers, the active line, search, a HighlightStyle over lezer tags whose colours
// are CSS variables (the product's `--code-*` tokens), an EditorView.theme, and the language loaded lazily by filename.
import { EditorState } from '@codemirror/state';
import { EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';

const style = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--code-keyword, #cf222e)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--code-string, #0a3069)' },
  { tag: tags.comment, color: 'var(--code-comment, #6e7781)' },
  { tag: tags.number, color: 'var(--code-number, #0550ae)' },
  { tag: [tags.typeName, tags.className], color: 'var(--code-type, #953800)' },
  { tag: tags.function(tags.variableName), color: 'var(--code-function, #8250df)' },
  { tag: tags.variableName, color: 'var(--code-variable, #24292f)' },
  { tag: tags.propertyName, color: 'var(--code-property, #0550ae)' },
  { tag: tags.operator, color: 'var(--code-operator, #cf222e)' },
  { tag: tags.punctuation, color: 'var(--code-punctuation, #24292f)' },
  { tag: tags.meta, color: 'var(--code-meta, #6e7781)' },
  { tag: tags.invalid, color: 'var(--code-invalid, #82071e)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
  '.cm-gutters': { color: 'var(--code-gutter-fg, #8c959f)', border: 'none' },
  '.cm-activeLine': { background: 'var(--code-line-active-bg, rgba(0,0,0,0.04))' },
  '.flash': { background: 'var(--code-selection-bg, rgba(255,200,0,0.35))' },
});

export function createCodeView(parent, text, language) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        highlightActiveLine(),
        search(),
        highlightSelectionMatches(),
        keymap.of(searchKeymap),
        syntaxHighlighting(style),
        theme,
        ...(language ? [language] : []),
      ],
    }),
  });
}

export function jumpTo(view, lineNumber) {
  const line = view.state.doc.line(lineNumber);
  view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
}
