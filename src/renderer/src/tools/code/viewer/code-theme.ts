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

export const codeTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--bg)', fontSize: 'var(--text-code)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--code-gutter-fg)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { paddingLeft: '12px', paddingRight: '8px' },
  '.cm-activeLine': { backgroundColor: 'var(--code-line-active-bg)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--code-line-active-bg)', color: 'var(--fg-muted)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--code-selection-bg)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--border-strong)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--code-selection-bg)' },
  '.cm-panels': { backgroundColor: 'var(--bg-raised)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': { fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui-sm)', padding: '4px 8px' },
  '.cm-textfield': { backgroundColor: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg-raised)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--fg-muted)' },
});
