// CodeMirror 6 (C8c execution document, Interfaces *Viewer kinds and caps*; ruled 2026-09-29, O2): loaded on first use
// through React.lazy behind FileViewer, so the main chunk carries none of CodeMirror. It shows the viewer store's text
// for a tab: extended in place as continuation chunks arrive (CodeMirror's `Text` is a rope), replaced whole by a
// follow-the-file re-read with the scroll kept, and left behind in the store with its scroll when the tab is hidden, so
// returning to it restores both. A pending line is landed, centred and flashed for two seconds, once it is loaded; past
// the end of a complete document the view scrolls to the end and flashes nothing.
//
// E5 (E5 execution document, Interfaces *The code view's modes*): an editable entry's view edits (`editor/editing.ts`).
// The view keeps `clean`, the store's text as a CodeMirror `Text`, and reports `dirty` (`!doc.eq(clean)`) on every edit
// and after every text it applies. Two counters say what a new store text means: a new `epoch` replaces the document,
// a new `baseline` (a save, Keep mine) leaves the document standing and only moves `clean`. `docOf` reads the document
// as the file's text, live while mounted and from the state left behind once hidden, so a hidden tab saves too.
//
// E5 M3: three more modes, each a compartment. `merging` holds the unified merge view over the disk's version while
// the entry's `theirs.view` is 'merge' (`editor/merge.ts`), reconfigured only for another version, so the chunks kept
// survive a hidden tab; `conflicts` holds the conflict-marker blocks (`editor/conflicts.ts`) and is empty while the
// merge view is open, so the two never stack; `comments` holds the comment gutter (`editor/comment-gutter.ts`),
// always. The view reports the chunks and blocks it holds to its bar and steps through them for it
// (`editor/navigation.ts`).
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, StateEffect, StateField, Text, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { fileLineAnchor, openCommentComposer } from '../anchor/anchor';
import { EDITOR_COPY } from '../copy';
import { commentGutter, comments } from '../editor/comment-gutter';
import { conflictBlocks, conflicts, conflictsOf, stepConflict } from '../editor/conflicts';
import { documentText, editing, editingExtensions, fromStore } from '../editor/editing';
import { changeCount, mergedWith, mergeView, merging, stepChange } from '../editor/merge';
import { attachNavigation, reportCounts } from '../editor/navigation';
import { codeHighlightStyle, codeThemeDark, codeThemeLight } from './code-theme';
import { jumpTarget } from './kinds';
import { languageFor, languageNameFor } from './languages';
import { existingViewState, readOnlyReason, useViewer, viewState, type ViewerEntry } from './viewer-store';

export const FLASH_MS = 2000;
export const FLASH_CLASS = 'cm-flash-line';

// Module-level, so an EditorState a view left behind reconfigures under the next view of the same tab.
const wrapping = new Compartment();
const language = new Compartment();
const theming = new Compartment();

// The page's theme, as the shell and the harness set it on the root element (C9's terminal reads it the same way).
const pageTheme = () => (document.documentElement.dataset.theme === 'dark' ? codeThemeDark : codeThemeLight);

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

// E5: the owner's edit, against the clean text the view last set; any edit clears the last save's failure.
const onEdit = (tabId: string) => (doc: Text) => {
  const clean = existingViewState(tabId)?.clean;
  if (!(clean instanceof Text)) return;
  const viewer = useViewer.getState();
  viewer.setDirty(tabId, !doc.eq(clean));
  viewer.setSaveError(tabId, null);
};

// E5 M3: a gutter mark's line as X10's anchor, for the tab's file and session as they are at the click.
const onComment = (tabId: string) => (line: number) => {
  const entry = useViewer.getState().entries.get(tabId);
  if (entry) openCommentComposer(fileLineAnchor(entry.path, line), { appSessionId: entry.appSessionId });
};

// E5 M3: what the bar counts, from the state as it now is.
const report = (tabId: string, state: EditorState) => reportCounts(tabId, { changes: changeCount(state), conflicts: conflictsOf(state).length });

const extensions = (tabId: string, wrap: boolean): Extension[] => [
  editing.of(editingExtensions(false, null, onEdit(tabId))), // E5: ahead of the search keymap
  lineNumbers(),
  comments.of(commentGutter(onComment(tabId))), // E5 M3: after the line numbers
  highlightActiveLine(),
  highlightActiveLineGutter(),
  search({ top: true }),
  highlightSelectionMatches(),
  keymap.of(searchKeymap),
  syntaxHighlighting(codeHighlightStyle),
  theming.of(pageTheme()),
  flashField,
  wrapping.of(wrap ? EditorView.lineWrapping : []),
  language.of([]),
  merging.of([]), // E5 M3
  conflicts.of(conflictBlocks),
  EditorView.updateListener.of((update) => report(tabId, update.state)),
];

const ratioOf = (el: HTMLElement) => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);

function scrollTo(view: EditorView, top: (el: HTMLElement) => number) {
  view.requestMeasure({ read: () => null, write: () => void (view.scrollDOM.scrollTop = top(view.scrollDOM)) });
}

// The offset a whole-document replacement must keep. CodeMirror anchors the scroll to the line at the top, and that
// anchor maps through a replacement of everything to the document's start, so its measure scrolls to the top after any
// measure request's write (M4: the e2e's follow-the-file case). The offset is put back in the frame after that measure,
// which CodeMirror scheduled first.
function keepOffset(view: EditorView, top: number) {
  requestAnimationFrame(() => {
    if (view.dom.isConnected) view.scrollDOM.scrollTop = top;
  });
}

// E5: the document as the file's text, its line breaks the store's current baseline's.
const baselineText = (tabId: string) => useViewer.getState().entries.get(tabId)?.text ?? '';

export default function CodeView({ entry, wrap }: { entry: ViewerEntry; wrap: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const applied = useRef<{ epoch: number; baseline: number; length: number }>({ epoch: -1, baseline: -1, length: 0 });
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { tabId, path, text, epoch, baseline, complete, pendingJump, editable } = entry;
  const reason = readOnlyReason(entry);
  const readOnlyTitle = reason ? EDITOR_COPY.readOnly[reason] : null;

  // The editor, from the state this tab left behind when it still holds the store's text, else empty (the sync below
  // fills it); on unmount the state and the scroll go back to the store.
  useEffect(() => {
    const saved = viewState(tabId);
    const reuse = saved.editor instanceof EditorState ? saved.editor : null;
    const view = new EditorView({ state: reuse ?? EditorState.create({ doc: '', extensions: extensions(tabId, useViewer.getState().wrap) }), parent: host.current! });
    editor.current = view;
    applied.current = reuse && saved.editorAt ? saved.editorAt : { epoch: -1, baseline: -1, length: 0 };
    if (!reuse) saved.clean = view.state.doc;
    saved.docOf = () => documentText(view.state, baselineText(tabId));
    if (saved.ratioPending && saved.ratio !== null) {
      const ratio = saved.ratio;
      scrollTo(view, (el) => ratio * Math.max(0, el.scrollHeight - el.clientHeight));
    } else if (saved.codeScroll > 0) {
      const top = saved.codeScroll;
      scrollTo(view, () => top);
    }
    saved.ratioPending = false;
    // A state left behind under the other theme, and every later switch, take the page's theme.
    view.dispatch({ effects: theming.reconfigure(pageTheme()) });
    const themes = new MutationObserver(() => view.dispatch({ effects: theming.reconfigure(pageTheme()) }));
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // E5 M3: the bar's counts and its arrows, which leave the editor focused at the chunk or block they reach.
    report(tabId, view.state);
    const detach = attachNavigation(tabId, (kind, direction) => {
      if (kind === 'change' ? stepChange(view, direction) : stepConflict(view, direction)) view.focus();
    });
    return () => {
      detach();
      themes.disconnect();
      if (flashTimer.current !== null) clearTimeout(flashTimer.current);
      flashTimer.current = null;
      const saved = existingViewState(tabId);
      if (saved) {
        const state = view.state.update({ effects: flash.of(null) }).state; // a flash does not outlive its view
        Object.assign(saved, { editor: state, editorAt: applied.current, codeScroll: view.scrollDOM.scrollTop, ratio: ratioOf(view.scrollDOM) });
        saved.docOf = () => documentText(state, baselineText(tabId));
      }
      view.destroy();
      editor.current = null;
    };
  }, [tabId]);

  // E5: read-only or editing, as the entry allows; the history and the document stand across the switch.
  useEffect(() => {
    editor.current?.dispatch({ effects: editing.reconfigure(editingExtensions(editable, readOnlyTitle, onEdit(tabId))) });
  }, [editable, readOnlyTitle, tabId]);

  // E5 M3: the merge view while the entry shows the disk's version as one, the conflict blocks otherwise; rebuilt only
  // for another version than the one it holds (the hash names it), so the chunks already kept stand.
  const merge = entry.theirs?.view === 'merge' ? entry.theirs : null;
  const mergeHash = merge?.hash ?? null;
  const mergeText = merge?.text ?? null;
  useEffect(() => {
    const view = editor.current;
    if (!view || mergedWith(view.state) === mergeHash) return;
    const theirs = mergeHash !== null && mergeText !== null ? { text: mergeText, hash: mergeHash } : null;
    view.dispatch({ effects: [merging.reconfigure(theirs ? mergeView(theirs) : []), conflicts.reconfigure(theirs ? [] : conflictBlocks)] });
  }, [mergeHash, mergeText, tabId]);

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

  // The store's text into the document: replaced whole (scroll kept) when it was re-read (a new epoch), appended while
  // it grows under one epoch. E5: a new baseline leaves the document standing and moves only the clean text; after any
  // of them the view reports whether the document still differs from it.
  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    const was = applied.current;
    if (was.epoch === epoch && was.baseline === baseline && text.length === was.length) return;
    const saved = viewState(tabId);
    if (was.epoch === epoch && was.baseline !== baseline) {
      saved.clean = view.state.toText(text);
    } else if (was.epoch === epoch && text.length > was.length) {
      view.dispatch({ changes: { from: view.state.doc.length, insert: text.slice(was.length) }, annotations: [fromStore.of(true), Transaction.addToHistory.of(false)] });
      saved.clean = view.state.doc;
    } else {
      // A fresh view's first text is no step to undo; a re-read or a Reload under a shown document is (CodeMirror's default).
      const top = view.scrollDOM.scrollTop;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: [fromStore.of(true), Transaction.addToHistory.of(was.epoch !== -1)] });
      if (was.epoch !== -1) keepOffset(view, top);
      saved.clean = view.state.doc;
    }
    applied.current = { epoch, baseline, length: text.length };
    useViewer.getState().setDirty(tabId, !view.state.doc.eq(saved.clean as Text));
  }, [text, epoch, baseline, tabId]);

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
