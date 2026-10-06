// The code view's editing mode (E5 execution document, Interfaces *The code view's modes*): one compartment holding
// either the read-only set (focusable for ⌘F, the reason as the content's title) or CodeMirror's editing set (history,
// the default and history keymaps with Tab indenting, bracket matching, the drawn selection) and the dirty listener.
// Loaded with CodeView, never in the main chunk. No keymap here binds Mod-s: ⌘S is the application menu's `file.save`.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { Annotation, Compartment, EditorState, type Extension, type Text } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, keymap } from '@codemirror/view';
import { lineBreakOf } from '../viewer/viewer-store';

// Module-level, as CodeView's other compartments, so a state left behind reconfigures under the tab's next view.
export const editing = new Compartment();

// A transaction that applies the viewer store's text rather than the owner's edit: the dirty listener ignores it (the
// view then compares against the clean text it just set).
export const fromStore = Annotation.define<boolean>();

// What the listener reports on the owner's every edit: the document as it now stands.
export type EditListener = (doc: Text) => void;

export function editingExtensions(editable: boolean, readOnlyTitle: string | null, onEdit: EditListener): Extension {
  if (!editable) {
    return [
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      // focusable though not editable, so ⌘F reaches the search keymap
      EditorView.contentAttributes.of(readOnlyTitle ? { tabindex: '0', title: readOnlyTitle } : { tabindex: '0' }),
    ];
  }
  return [
    EditorState.readOnly.of(false),
    EditorView.editable.of(true),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    indentOnInput(),
    bracketMatching(),
    drawSelection(),
    dropCursor(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromStore))) onEdit(update.state.doc);
    }),
  ];
}

// The document as the file's text: CodeMirror splits at every line break and joins with "\n", so the text is joined
// with the baseline's dominant break, and a CRLF file is written back CRLF.
export const documentText = (state: EditorState, baselineText: string): string => state.doc.sliceString(0, state.doc.length, lineBreakOf(baselineText));
