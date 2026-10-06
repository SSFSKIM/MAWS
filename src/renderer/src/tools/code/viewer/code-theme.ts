// The code view's look from X7 tokens only (C8c execution document, Interfaces *The `--code-*` tokens*): syntax colours
// are the `--code-*` tokens (tokens.css, both themes), the editor's surfaces the shell's. Loaded with CodeView, on first
// use, never in the main chunk.
import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier, t.self, t.null], color: 'var(--code-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape, t.character, t.url], color: 'var(--code-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom, t.constant(t.variableName), t.unit], color: 'var(--code-number)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName), t.tagName], color: 'var(--code-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: 'var(--code-function)' },
  { tag: [t.variableName, t.definition(t.variableName), t.local(t.variableName)], color: 'var(--code-variable)' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--code-property)' },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.typeOperator, t.controlOperator], color: 'var(--code-operator)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket, t.squareBracket, t.paren, t.brace], color: 'var(--code-punctuation)' },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.documentMeta], color: 'var(--code-meta)' },
  { tag: t.invalid, color: 'var(--code-invalid)' },
  // Markdown in Source
  { tag: t.heading, color: 'var(--code-keyword)', fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.link, color: 'var(--code-string)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--code-string)' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
]);

// Every colour CodeMirror's base themes set for what the code view uses (the view, search, the gutters, selection,
// panels) is restated from tokens, at the base rule's specificity or above: a base rule wins over a theme rule of lower
// specificity (`.cm-button:active`, the focused selection layer), and ties go to the theme, which is mounted later.
// Built twice, light and dark, so CodeMirror's `&light`/`&dark` base rules follow the page's theme too.
const spec = {
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--bg)', fontSize: 'var(--text-code)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--code-gutter-fg)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { paddingLeft: '12px', paddingRight: '8px' },
  '.cm-activeLine': { backgroundColor: 'var(--code-line-active-bg)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-line-active-bg)', color: 'var(--fg-muted)' },
  '.cm-specialChar': { color: 'var(--code-invalid)' },
  '.cm-placeholder': { color: 'var(--fg-faint)' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--code-selection-bg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--code-selection-bg)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--border-strong)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--code-selection-bg)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--diff-del-bg)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--fg-muted)' },
  '.cm-panels': { backgroundColor: 'var(--bg-raised)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui-sm)', padding: '4px 8px' },
  '.cm-textfield': { backgroundColor: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg-raised)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--bg-active)' },
  '.cm-textfield:focus, .cm-button:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-1px' }, // not the UA's ring
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--accent)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--fg-muted)' },
  // E5 M3 start: the merge view. Every colour `@codemirror/merge` 6.12.2's base theme sets, restated: its rules are one
  // class of scope (`&light`, `&dark` or the base's own) plus the selector, as these are, so each tie goes to this theme.
  // Mine's lines (the editor's, `cm-merge-b`) in the diff's added ground, theirs' deleted chunks in its removed ground,
  // the changed text within either in the accent's tint; the unified view never draws side a, restated all the same.
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': { backgroundColor: 'var(--diff-add-bg)' },
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: 'var(--diff-del-bg)' },
  '&.cm-merge-a .cm-changedText, &.cm-merge-b .cm-changedText, .cm-deletedChunk .cm-deletedText': { background: 'var(--accent-soft)' },
  '&.cm-merge-b .cm-deletedText': { background: 'var(--diff-del-bg)' },
  '.cm-collapsedLines': { color: 'var(--fg-muted)', background: 'var(--bg-hover)', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui-sm)' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: 'var(--danger)' },
  '&.cm-merge-b .cm-changedLineGutter': { background: 'var(--success)' },
  '.cm-inlineChangedLineGutter': { background: 'var(--accent)' },
  // The chunk controls: MAWS's own buttons (merge.ts), drawn as the editor's other buttons; the library's default ones
  // (never drawn here) restated too.
  '.cm-deletedChunk .cm-chunkButtons': { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui-sm)' },
  '.cm-deletedChunk .cm-merge-control, .cm-deletedChunk button[name=accept], .cm-deletedChunk button[name=reject]': {
    backgroundColor: 'var(--bg-raised)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 6px', margin: '0 2px', cursor: 'pointer',
  },
  '.cm-deletedChunk .cm-merge-control:hover': { backgroundColor: 'var(--bg-hover)' },
  '.cm-deletedChunk .cm-merge-control:active': { backgroundColor: 'var(--bg-active)' },
  '.cm-deletedChunk .cm-merge-control:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  // Conflict blocks (conflicts.ts): the marker lines muted, the three sections in their own grounds (after the active
  // line's rule, so a section keeps its ground under the cursor), and the actions above each block.
  '.cm-conflict-marker': { backgroundColor: 'var(--bg-active)', color: 'var(--fg-muted)' },
  '.cm-conflict-mine': { backgroundColor: 'var(--code-conflict-mine-bg)' },
  '.cm-conflict-base': { backgroundColor: 'var(--code-conflict-base-bg)' },
  '.cm-conflict-theirs': { backgroundColor: 'var(--code-conflict-theirs-bg)' },
  '.cm-conflict-actions': { display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 6px 2px', fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui-sm)', color: 'var(--fg-muted)' },
  '.cm-conflict-action': { backgroundColor: 'var(--bg-raised)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0 6px', cursor: 'pointer' },
  '.cm-conflict-action:hover': { backgroundColor: 'var(--bg-hover)' },
  '.cm-conflict-action:active': { backgroundColor: 'var(--bg-active)' },
  '.cm-conflict-action:disabled': { color: 'var(--fg-faint)', cursor: 'default', backgroundColor: 'var(--bg-raised)' },
  '.cm-conflict-action:focus-visible': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  '.cm-conflict-label': { padding: '0 6px', borderRadius: 'var(--radius-sm)', color: 'var(--fg-muted)' },
  '.cm-conflict-label-mine': { marginLeft: '8px', backgroundColor: 'var(--code-conflict-mine-bg)' },
  '.cm-conflict-label-base': { backgroundColor: 'var(--code-conflict-base-bg)' },
  '.cm-conflict-label-theirs': { backgroundColor: 'var(--code-conflict-theirs-bg)' },
  // The comment gutter (comment-gutter.ts): a narrow column whose mark shows while its line's gutter element is hovered.
  '.cm-commentGutter': { width: '18px' },
  '.cm-commentGutter .cm-gutterElement': { display: 'flex', alignItems: 'flex-start', justifyContent: 'center', cursor: 'pointer' },
  '.cm-comment-mark': {
    visibility: 'hidden', width: '14px', lineHeight: '14px', marginTop: '3px', textAlign: 'center', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-ui)',
    color: 'var(--bg-raised)', backgroundColor: 'var(--accent)',
  },
  '.cm-commentGutter .cm-gutterElement:hover .cm-comment-mark': { visibility: 'visible' },
  // E5 M3 end
};

export const codeThemeLight = EditorView.theme(spec);
export const codeThemeDark = EditorView.theme(spec, { dark: true });
