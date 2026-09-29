// CodeMirror 6, read-only (C8c execution document, Interfaces *Viewer kinds and caps*; ruled 2026-09-29, O2): loaded on
// first use through React.lazy behind FileViewer, so the main chunk carries none of CodeMirror. It shows the viewer
// store's text for a tab: extended in place as continuation chunks arrive (CodeMirror's `Text` is a rope), replaced
// whole by a follow-the-file re-read with the scroll kept, and left behind in the store with its scroll when the tab
// is hidden, so returning to it restores both. A pending line is landed, centred and flashed for two seconds, once it
// is loaded; past the end of a complete document the view scrolls to the end and flashes nothing.
import { syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { codeHighlightStyle, codeTheme } from './code-theme';
import { jumpTarget } from './kinds';
import { languageFor, languageNameFor } from './languages';
import { useViewer, viewState, type ViewerEntry } from './viewer-store';

export const FLASH_MS = 2000;
export const FLASH_CLASS = 'cm-flash-line';

// Module-level, so an EditorState a view left behind reconfigures under the next view of the same tab.
const wrapping = new Compartment();
const language = new Compartment();

const flash = StateEffect.define<number | null>(); // a line's start, or null to clear
const flashLine = Decoration.line({ class: FLASH_CLASS });
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(flash)) next = effect.value === null ? Decoration.none : Decoration.set([flashLine.range(effect.value)]);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const extensions = (wrap: boolean): Extension[] => [
  EditorState.readOnly.of(true),
  EditorView.editable.of(false),
  EditorView.contentAttributes.of({ tabindex: '0' }), // focusable though not editable, so ⌘F reaches the search keymap
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  search({ top: true }),
  highlightSelectionMatches(),
  keymap.of(searchKeymap),
  syntaxHighlighting(codeHighlightStyle),
  codeTheme,
  flashField,
  wrapping.of(wrap ? EditorView.lineWrapping : []),
  language.of([]),
];

const ratioOf = (el: HTMLElement) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);

function scrollTo(view: EditorView, top: (el: HTMLElement) => number) {
  view.requestMeasure({ read: () => null, write: () => void (view.scrollDOM.scrollTop = top(view.scrollDOM)) });
}

export default function CodeView({ entry, wrap }: { entry: ViewerEntry; wrap: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const applied = useRef<{ epoch: number; length: number }>({ epoch: -1, length: 0 });
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { tabId, path, text, epoch, complete, pendingJump } = entry;

  // The editor, from the state this tab left behind when it still holds the store's text, else empty (the sync below
  // fills it); on unmount the state and the scroll go back to the store.
  useEffect(() => {
    const saved = viewState(tabId);
    const reuse = saved.editor instanceof EditorState ? saved.editor : null;
    const view = new EditorView({ state: reuse ?? EditorState.create({ doc: '', extensions: extensions(useViewer.getState().wrap) }), parent: host.current! });
    editor.current = view;
    applied.current = reuse && saved.editorAt ? saved.editorAt : { epoch: -1, length: 0 };
    if (saved.ratioPending && saved.ratio !== null) {
      const ratio = saved.ratio;
      scrollTo(view, (el) => ratio * Math.max(0, el.scrollHeight - el.clientHeight));
    } else if (saved.codeScroll > 0) {
      const top = saved.codeScroll;
      scrollTo(view, () => top);
    }
    saved.ratioPending = false;
    return () => {
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = null;
      const state = view.state.update({ effects: flash.of(null) }).state; // a flash does not outlive its view
      Object.assign(viewState(tabId), { editor: state, editorAt: applied.current, codeScroll: view.scrollDOM.scrollTop, ratio: ratioOf(view.scrollDOM) });
      view.destroy();
      editor.current = null;
    };
  }, [tabId]);

  // The language arrives after the first paint, in its own chunk.
  useEffect(() => {
    const view = editor.current;
    let current = true;
    void languageFor(path).then((support) => {
      if (current && support && editor.current === view && view) view.dispatch({ effects: language.reconfigure(support) });
    });
    return () => void (current = false);
  }, [path, tabId]);

  useEffect(() => {
    editor.current?.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap, tabId]);

  // The store's text into the document: appended while it grows under one epoch, replaced whole (scroll kept) when it
  // was re-read.
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const was = applied.current;
    if (was.epoch === epoch && text.length === was.length) return;
    if (was.epoch === epoch && text.length > was.length) {
      view.dispatch({ changes: { from: view.state.doc.length, insert: text.slice(was.length) } });
    } else {
      const top = view.scrollDOM.scrollTop;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      if (was.epoch !== -1) scrollTo(view, () => top);
    }
    applied.current = { epoch, length: text.length };
  }, [text, epoch, tabId]);

  // The pending line, against what is loaded so far: retried after each chunk until it exists or the file is complete.
  useEffect(() => {
    const view = editor.current;
    if (!view || pendingJump === null) return;
    const target = jumpTarget({ line: pendingJump, lines: view.state.doc.lines, complete });
    if (target.kind === 'wait' || target.kind === 'none') return;
    if (target.kind === 'end') {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }) });
    } else {
      const from = view.state.doc.line(target.line).from;
      view.dispatch({ selection: { anchor: from }, effects: [EditorView.scrollIntoView(from, { y: 'center' }), flash.of(from)] });
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        if (editor.current === view) view.dispatch({ effects: flash.of(null) });
      }, FLASH_MS);
    }
    useViewer.getState().jumped(tabId);
  }, [pendingJump, complete, text, epoch, tabId]);

  return <div ref={host} data-code-view data-language={languageNameFor(path) ?? ''} className="h-full min-h-0 overflow-hidden" />;
}
