// The document editor (D1's `editor/`, D3; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the tab strip,
// the formatting toolbar, find, and the page, a Tiptap editor bound to the active tab's body of an open replica. The
// handle is opened and owned by the caller (the tab's store handle, M8), so this component only binds and draws. One
// editor per active tab: switching tabs mounts a fresh editor on the other body, its undo history its own.
//
// The page carries `.ds-doc` and reads only the design system's `--ds-*` tokens, each falling back to the app's (D3):
// until D's `<DesignSystemScope>` wraps it, the document is MAWS's own look following the app theme. The chrome around
// the page (tabs, toolbar, find, the comments rail) is the app's, in its tokens.
//
// Comments (M4, D9): Comment (the toolbar, Mod-Alt-M) writes the thread and the mark and hands the passage to the
// `comments` surface, which opens P2's card for it (the renderer's; passed in so this directory stays portable) and is
// drawn over the page with the editor's reach (locate a passage, record what was sent, discard what was not, resolve,
// reopen). The threads rail beside the page lists every tab's threads, the editor's active one selected; a click on a
// highlighted passage activates its thread and opens the rail on it.
//
// History (M5, D10): with a `history` api, the History action (and Mod-Alt-Shift-H) opens the version history rail in
// the same place; a version shown from it replaces the page's content in place, read-only (the editor's `editable`
// follows the preview, Decision Log 22), with the preview's bar in place of the toolbar and the version's pinned
// tokens on the page. "See N new changes", the "Restored from …" banner and Show editors (a right-click over a
// selection) come with it. M9 (the scale gate): the version is drawn by an editor of its own, read-only, bound to the
// version's doc from its creation, while the live editor stays bound to the tab, hidden: entering and leaving history
// never re-binds (and re-renders) the live tab, and leaving keeps its undo. Awareness (D11): the other replicas' cursors and an agent's editing blocks.
// P3-F1: the rail beside the page in a body 720 px wide or more, a drawer over the page's right side below (rail-layout.ts).
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model'; // P3-E
import { EditorContent, useEditor } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { JointHold, TypingPause, type VersionView } from '../collab';
import { isDarkGround } from '../export/highlight';
import { isBindingTransaction, type Carry, type Doc } from '../../yjs'; // P3-E: Doc
import { ySyncPluginKey } from '../../yjs/prosemirror';
import { coreExtensionOptions } from '../ids';
import { nanoid8 } from '../schema';
import { tabBody } from '../tabs';
import { discardThread, getThread, isBlockAnchor /* P3-E */, reopen, reply, resolve } from '../threads';
import type { ExtraChange } from '../history'; // P3-E
import { activeThread, COMMENTS_ORIGIN, commentBlock /* P3-E */, commentSelection, liveRanges, type CommentsOptions /* P3-E */ } from './comments/plugins';
import type { CommentAuthor, CommentOverlayProps, DocumentComments, PassageRect } from './comments/surface';
import { ThreadsRail } from './comments/ThreadsRail';
import { useOpenThreadCount } from './comments/use-threads';
import { editorExtensions } from './extensions';
import { FindBar } from './Find';
import type { HistoryApi } from './history/api';
import type { HistoryController, HistorySnapshot, Preview } from './history/controller';
import { HistoryBar } from './history/HistoryBar';
import { HistoryRail } from './history/HistoryRail';
import { goToChange, setCarried, setExtra /* P3-E */ } from './history/paint';
import { ShowEditorsMenu, useShowEditors } from './history/ShowEditors';
import { useHistoryController, useHistorySnapshot } from './history/use-history';
import { cssColor, type DocumentHandle, type EditorHost } from './host-types';
import { displayedDocument, type ViewEnvironment } from './nodes/views'; // P3-E: displayedDocument
import { Tabs } from './Tabs';
import { useTabs } from './tabs-store';
import type { MentionSource } from './MentionPicker';
import { Toolbar } from './Toolbar';
import { Suggestions, type SuggestionHost } from './Suggestions';
import { useReadOnly } from './read-only';
import { useRailLayout } from './rail-layout'; // P3-F1
import './chrome.css';
import './theme.css';

export interface DocumentEditorProps {
  artifactId: string;
  handle: DocumentHandle;
  host: EditorHost;
  /** Draws a diagram; mermaid, loaded on first use, by default. */
  renderDiagram?: ViewEnvironment['renderDiagram'];
  /** Receives the active tab's editor, and null when it goes (the harness's and the tests' reach). */
  onEditor?: (editor: Editor | null) => void;
  /** Where a comment goes (P2's card); without it, commenting is not offered. */
  comments?: DocumentComments;
  /** The document's versions and history actions (M5); without it, version history is not offered. */
  history?: HistoryApi;
  /** The host service that opens and settles the artifact’s proposal replica (D14). */
  suggestions?: SuggestionHost;
  /**
   * The rail beside the page, when the caller holds it (M8: the X32 header toggles History and Comments from outside the
   * body, and the rail stays open across a remount); the editor's own toggles then ask through `onRailChange`. Without
   * it the editor holds its rail itself.
   */
  rail?: DocumentRail;
  onRailChange?(rail: DocumentRail): void;
  /** A new value opens the history rail on its Save version form (the header's Save version); the value at mount is not new. */
  saveVersionRequest?: number;
  /** What the page is drawn in: the governing design system's scope (D's `<DesignSystemScope>`); the page alone without. */
  pageScope?: ComponentType<{ children: ReactNode }>;
  /** The page's element as it appears and goes (the shell's Mark-up surface). */
  onPage?(element: HTMLElement | null): void;
  /** Whether a version is shown in place of the live document (the header says read-only meanwhile). */
  onPreviewChange?(previewing: boolean): void;
  /** Who and what Insert › Mention can name (people, sessions, artifacts); without it, a mention names the owner. */
  mentions?: MentionSource;
  // P3-E start (E2 M3; E's Decision Log 19): a dashboard's charts drawn by E (absent: B's placeholder), and the document
  // the editor shows told as it changes: the live one, a previewed version's with its revision, the suggestion replica's
  renderChart?: ViewEnvironment['renderChart'];
  onDisplayedDocument?(doc: Doc, revision?: number): void;
  /** E2 M4 (E's Decision Log 28): the quote of a selected block commented whole (a dashboard's chart); absent, text only. */
  blockCommentQuote?(node: PMNode): string | undefined;
  // P3-E end
}

export type DocumentRail = 'comments' | 'history' | null;
type Rail = DocumentRail;
const NO_CARRIES: ReadonlyMap<string, Carry['kind']> = new Map();
const NO_EXTRAS: readonly ExtraChange[] = []; // P3-E

// P3-F1: the input types the owner types text into (an unknown type reads as 'text')
const TEXT_ENTRY_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);
// P3-F1: a text-entry control (a text field, a text area, an editable region) with text in it
function holdsTypedText(element: Element): boolean {
  if (element instanceof HTMLTextAreaElement) return element.value !== '';
  if (element instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.has(element.type) && element.value !== '';
  return element instanceof HTMLElement && element.isContentEditable && (element.textContent ?? '') !== '';
}

/** A request to show a thread's passage: a new serial for each ask, so asking twice shows twice. */
interface Showing {
  threadId: string;
  serial: number;
}

export function DocumentEditor(props: DocumentEditorProps) {
  const { doc } = props.handle;
  const tabs = useTabs(doc);
  const readOnly = useReadOnly(props.handle); // a store a newer MAWS wrote: nothing here writes the document
  const [selected, setSelected] = useState<string | null>(null);
  const [ownRail, setOwnRail] = useState<Rail>(null);
  const held = props.rail !== undefined;
  const rail = held ? (props.rail ?? null) : ownRail;
  const [saving, setSaving] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState(false);
  const hold = useMemo(() => new JointHold(props.handle), [props.handle]); // the live editor's, the suggestion replica's too
  const typing = useMemo(() => new TypingPause(hold), [hold]); // the review waits for the person's pause
  const [showing, setShowing] = useState<Showing | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0] ?? null;
  const { host } = props;
  const author = useMemo<CommentAuthor>(() => ({ actor: host.identity().actor, now: () => Date.now() }), [host]);
  const history = useHistoryController(props.handle, props.history);
  const snapshot = useHistorySnapshot(history);
  const preview = snapshot?.preview ?? null;
  useEffect(() => history?.setLiveTab(active?.id ?? null), [history, active?.id]);
  // Leaving the history rail leaves history: the page shows the live document again (whoever closed the rail).
  const { onRailChange, saveVersionRequest, onPreviewChange } = props;
  const previewing = preview !== null || pendingSuggestions;
  useEffect(() => {
    onPreviewChange?.(previewing);
  }, [previewing, onPreviewChange]);
  // P3-E start (E2 M3): the document shown, told as it changes (a preview with no tab to show tells nothing new)
  const [suggestionDoc, setSuggestionDoc] = useState<Doc | null>(null);
  const shownVersion = previewRevision(preview, snapshot?.versions ?? null);
  const shownDoc = preview ? (preview.view?.ytype.doc ?? null) : pendingSuggestions && suggestionDoc ? suggestionDoc : doc;
  const { onDisplayedDocument } = props;
  const shownRevision = preview ? shownVersion : undefined;
  useEffect(() => {
    if (shownDoc) onDisplayedDocument?.(shownDoc, shownRevision);
  }, [shownDoc, shownRevision, onDisplayedDocument]);
  // P3-E end
  const openRail = (next: Rail) => {
    if (!held) setOwnRail(next);
    onRailChange?.(next);
  };
  useEffect(() => {
    if (rail !== 'history') {
      history?.close();
      setSaving(false);
    }
  }, [rail, history]);
  // Save version asked from outside: the history rail on its form. A request already made when the editor mounted is
  // not new (the body remounts on a tab switch).
  const seenSaveRequest = useRef(saveVersionRequest);
  useEffect(() => {
    if (saveVersionRequest === seenSaveRequest.current) return;
    seenSaveRequest.current = saveVersionRequest;
    if (!history) return;
    setSaving(true);
    if (!held) setOwnRail('history');
    onRailChange?.('history');
  }, [saveVersionRequest, history, held, onRailChange]);
  // P3-F1: the rail beside the page in a wide body, a drawer over the page's right side in a narrow one (rail-layout.ts)
  const body = useRef<HTMLDivElement>(null);
  const railShown = rail === 'comments' || (rail === 'history' && Boolean(history && snapshot));
  const railLayout = useRailLayout(body, railShown);
  const drawer = railShown && railLayout.mode === 'drawer';
  // Escape inside the drawer closes it, and the keyboard goes back to the page; one the rail's own control took is its
  // own, and one in a text field holding text (a reply or a version name being written) is the field's, so the draft is
  // not lost. A checkbox, a radio or a button holds no draft, whatever its value.
  const onBodyKeyDown = (event: KeyboardEvent) => {
    const { target } = event;
    if (!drawer || event.key !== 'Escape' || event.defaultPrevented || !(target instanceof Element) || !target.closest('.doc-rail')) return;
    if (holdsTypedText(target)) return;
    event.preventDefault();
    event.stopPropagation();
    const pages = body.current?.querySelectorAll<HTMLElement>('.doc-page-frame .ProseMirror') ?? [];
    [...pages].find((page) => page.checkVisibility())?.focus({ preventScroll: true }); // the page shown (a preview's, a review's)
    openRail(null);
  };
  return (
    <div className="doc-editor" data-document-editor="">
      {!preview && <Tabs doc={doc} tabs={tabs} active={active?.id ?? null} readOnly={readOnly} onSelect={setSelected} />}
      {snapshot?.banner && (
        <div className="doc-banner" role="status" aria-label="Restored">
          <span>{snapshot.banner}</span>
          <button type="button" className="doc-tool" onClick={() => history?.dismissBanner()}>
            Dismiss
          </button>
        </div>
      )}
      <div ref={body} className="doc-editor-body" data-rail-layout={railShown ? railLayout.mode : undefined} style={drawer ? ({ '--doc-drawer-top': `${railLayout.top}px` } as CSSProperties) : undefined} onKeyDown={onBodyKeyDown}>
        {active && props.suggestions && (
          <div className="doc-tab-editor" style={{ display: preview ? 'none' : pendingSuggestions ? undefined : 'contents' }}>
            <Suggestions artifactId={props.artifactId} tabId={active.id} base={props.handle} hold={hold} typing={typing} host={props.suggestions} editorHost={props.host} onPending={setPendingSuggestions} pageScope={props.pageScope} renderChart={props.renderChart} onDisplayedDocument={setSuggestionDoc} /* P3-E */ />
          </div>
        )}
        <div className="doc-tab-editor" style={{ display: pendingSuggestions && !preview ? 'none' : undefined }} onKeyDown={() => typing.keystroke()}>
          {active ? (
            <TabEditor
              {...props}
              key={active.id}
              tabId={active.id}
              tabTitle={active.title}
              author={author}
              rail={rail}
              openRail={openRail}
              showing={showing}
              onShown={() => setShowing(null)}
              onActiveThread={setActiveThreadId}
              onPassageClick={() => !preview && openRail('comments')}
              historyController={history}
              historySnapshot={snapshot}
              hold={hold}
              readOnly={readOnly}
              previewRevision={shownVersion} /* P3-E */
            />
          ) : (
            <div className="doc-editor-loading" role="status">
              Loading…
            </div>
          )}
        </div>
        {rail === 'comments' && (
          <ThreadsRail
            doc={doc}
            tabs={tabs}
            activeTab={active?.id ?? null}
            activeThread={activeThreadId}
            author={author}
            readOnly={readOnly}
            onShow={(thread) => {
              if (tabs.some((tab) => tab.id === thread.tabId)) setSelected(thread.tabId);
              setShowing({ threadId: thread.id, serial: (showing?.serial ?? 0) + 1 });
            }}
            onClose={() => openRail(null)}
          />
        )}
        {rail === 'history' && history && snapshot && (
          <HistoryRail controller={history} snapshot={snapshot} sessionTitle={props.history?.sessionTitle?.bind(props.history)} saving={saving} onSaving={setSaving} onClose={() => openRail(null)} />
        )}
      </div>
    </div>
  );
}

interface TabEditorProps extends DocumentEditorProps {
  tabId: string;
  tabTitle: string;
  author: CommentAuthor;
  rail: Rail;
  openRail(rail: Rail): void;
  historyController: HistoryController | null;
  historySnapshot: HistorySnapshot | null;
  /** The composition hold: the base replica's, and the suggestion replica's beside it. */
  hold: JointHold;
  /** The store is read-only: the page is not editable. */
  readOnly: boolean;
  showing: Showing | null;
  onShown(): void;
  /** The editor's active thread, as it changes (the rail selects it). */
  onActiveThread(threadId: string | null): void;
  /** A click on a highlighted passage activated its thread. */
  onPassageClick(): void;
  /** P3-E: the previewed version's revision, its charts' displayed one. */
  previewRevision?: number;
}

function TabEditor({ tabId, tabTitle, artifactId, handle, host, renderDiagram, onEditor, comments, author, rail, openRail, historyController, historySnapshot, hold, readOnly, showing, onShown, onActiveThread, onPassageClick, pageScope, onPage, mentions, renderChart, previewRevision: shownRevision, blockCommentQuote /* P3-E */ }: TabEditorProps) {
  const [findOpen, setFindOpen] = useState(false);
  const preview = historySnapshot?.preview ?? null;
  const openCount = useOpenThreadCount(handle.doc);
  // What Comment reads when it runs (a keystroke or a click after any render), kept current after each render.
  const latest = useRef({ comments, author, tabTitle, onPassageClick, blockCommentQuote /* P3-E */ });
  useLayoutEffect(() => {
    latest.current = { comments, author, tabTitle, onPassageClick, blockCommentQuote /* P3-E */ };
  });
  const commentRef = useRef<() => boolean>(() => false);

  const editor = useEditor(
    {
      coreExtensionOptions,
      extensions: editorExtensions({
        collaboration: {
          ytype: tabBody(handle.doc, tabId) ?? null,
          awareness: handle.awareness,
          user: { name: host.identity().name, color: cssColor(host.identity().color) },
          hold,
          onRestored: (listener) => handle.onRestored(listener),
        },
        comments: { doc: handle.doc, tabId, onComment: () => commentRef.current(), onActivate: () => latest.current.onPassageClick(), blockQuote: (node) => latest.current.blockCommentQuote?.(node), artifactId /* P3-E */ },
        env: { artifactId, host, ...(renderDiagram ? { renderDiagram } : {}), ...(renderChart ? { renderChart, displayed: displayedDocument(handle.doc) } : {}) /* P3-E */ },
      }),
      editorProps: { attributes: { 'aria-label': 'Document', class: 'doc-content', 'data-editor': 'live' } },
      shouldRerenderOnTransaction: false,
      editable: !readOnly,
    },
    [tabId, handle, host, artifactId, hold],
  );
  // the store turning read-only (or writable again, after a reconnect) does not re-create the editor
  useEffect(() => {
    if (!editor.isDestroyed && editor.isEditable === readOnly) editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  // the preview's own editor while a version shows (null until it exists); the live one is never put on a version
  const [previewEditor, setPreviewEditor] = useState<Editor | null>(null);
  const shown = preview && previewEditor ? previewEditor : editor;
  // the editor showed something else: every other preview's docs can go, once a closed preview's editor is gone too
  useEffect(() => {
    if (preview) return;
    const timer = setTimeout(() => historyController?.applied(null), PREVIEW_GONE_MS);
    return () => clearTimeout(timer);
  }, [preview, historyController]);

  // Comment the selection: the thread and the mark, the passage drawn active, then the surface opens its card.
  useLayoutEffect(() => {
    commentRef.current = () => {
      const { comments: surface, author: by, tabTitle: title } = latest.current;
      if (!surface || editor.isDestroyed || !editor.isEditable) return false;
      const threadId = nanoid8();
      const comment = { threadId, tabId, by: by.actor, at: by.now() };
      // P3-E: a selected block the comments' `blockQuote` names is commented whole; otherwise B's passage
      const { blockQuote } = (editor.extensionManager.extensions.find((extension) => extension.name === 'comments')?.options ?? {}) as Partial<CommentsOptions>;
      const made = (blockQuote && commentBlock(editor, handle.doc, comment, blockQuote)) || commentSelection(editor, handle.doc, comment);
      if (!made) return false;
      editor.commands.setActiveThread(threadId);
      surface.opened({ threadId, tabId, tabTitle: title, quote: made.quote });
      return true;
    };
  }, [editor, handle, tabId]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  // The active thread (a card's, a shown one's, a clicked passage's) as the rail selects it.
  useEffect(() => {
    const report = () => onActiveThread(activeThread(editor.state));
    report();
    editor.on('transaction', report);
    return () => {
      editor.off('transaction', report);
    };
  }, [editor, onActiveThread]);

  // Show a thread the rail asked for, once its passage is in this tab's editor (a switched tab binds a moment later).
  useEffect(() => {
    if (!showing) return;
    const show = () => {
      const range = liveRanges(editor.state.doc).get(showing.threadId)?.[0];
      // P3-E: a block thread's block, selected whole
      const block = range ? -1 : blockPos(editor, handle.doc, showing.threadId);
      if (!range && block < 0) return false;
      (range ? editor.chain().setTextSelection(range) : editor.chain().setNodeSelection(block)).setActiveThread(showing.threadId).scrollIntoView().run();
      onShown();
      return true;
    };
    if (show()) return;
    const retry = () => {
      if (show()) editor.off('transaction', retry);
    };
    editor.on('transaction', retry);
    return () => {
      editor.off('transaction', retry);
    };
  }, [showing, editor, onShown, handle]);

  const toggleHistory = () => openRail(rail === 'history' ? null : 'history');
  const onKeyDown = (event: KeyboardEvent) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setFindOpen(true);
    } else if (mod && event.altKey && event.shiftKey && event.code === 'KeyH' && historyController) {
      event.preventDefault(); // Google Docs' chord for version history
      toggleHistory();
    }
  };

  return (
    <div className="doc-tab-editor" onKeyDown={onKeyDown}>
      {preview?.view && (
        <PreviewEditor
          view={preview.view}
          carried={preview.carried ?? NO_CARRIES}
          focus={preview.focus}
          handle={handle}
          tabId={tabId}
          artifactId={artifactId}
          host={host}
          renderDiagram={renderDiagram}
          controller={historyController}
          onEditor={setPreviewEditor}
          renderChart={renderChart} /* P3-E */
          revision={shownRevision}
          extras={preview.extras}
        />
      )}
      {preview && historyController ? (
        <HistoryBar editor={shown} preview={preview} controller={historyController} onBack={() => historyController.close()} />
      ) : (
        <Toolbar
          editor={editor}
          artifactId={artifactId}
          host={host}
          onFind={() => setFindOpen(true)}
          comments={{ comment: comments ? () => commentRef.current() : null, railOpen: rail === 'comments', openCount, toggleRail: () => openRail(rail === 'comments' ? null : 'comments') }}
          history={historyController ? { open: rail === 'history', toggle: toggleHistory } : undefined}
          mentions={mentions}
        />
      )}
      {findOpen && <FindBar editor={shown} onClose={() => setFindOpen(false)} />}
      <PageFrame
        editor={shown}
        live={editor}
        previewEditor={preview ? previewEditor : null}
        handle={handle}
        author={author}
        comments={comments}
        tabId={tabId}
        preview={preview}
        history={historyController}
        pill={preview ? null : (historySnapshot?.pill ?? null)}
        pageScope={pageScope}
        onPage={onPage}
        onNewChanges={() => {
          openRail('history');
          void historyController?.openNewChanges();
        }}
      />
    </div>
  );
}

// The page's scroll box and, over it, the comment surface's overlay with the editor's reach. The overlay re-renders at
// most once a frame as the passages move (an edit, a scroll, a resize); the page does not.
interface PageFrameProps {
  /** The editor on screen: the preview's while a version shows, else the live one. */
  editor: Editor;
  live: Editor;
  previewEditor: Editor | null;
  handle: DocumentHandle;
  author: CommentAuthor;
  comments: DocumentComments | undefined;
  tabId: string;
  preview: Preview | null;
  history: HistoryController | null;
  pill: HistorySnapshot['pill'];
  pageScope: DocumentEditorProps['pageScope'];
  onPage: DocumentEditorProps['onPage'];
  onNewChanges(): void;
}

function PageFrame({ editor, live, previewEditor, handle, author, comments, tabId, preview, history, pill, pageScope: Scope, onPage, onNewChanges }: PageFrameProps) {
  const editors = useShowEditors(live, history, tabId, preview === null);
  const frame = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(0);
  const pending = useRef<number | null>(null);
  const moved = useMemo(
    () => () => {
      if (pending.current !== null) return;
      pending.current = requestAnimationFrame(() => {
        pending.current = null;
        setLayout((n) => n + 1);
      });
    },
    [],
  );
  useEffect(() => {
    if (!comments) return;
    editor.on('update', moved);
    const box = frame.current;
    const observer = typeof ResizeObserver === 'undefined' || !box ? null : new ResizeObserver(moved);
    if (box) observer?.observe(box);
    return () => {
      editor.off('update', moved);
      observer?.disconnect();
      if (pending.current !== null) cancelAnimationFrame(pending.current);
      pending.current = null;
    };
  }, [editor, comments, moved]);

  const reach = useMemo<Omit<CommentOverlayProps, 'layoutKey'>>(() => {
    const { doc } = handle;
    // read when the overlay writes, not when it was drawn: the store may have turned read-only since
    const writable = () => !handle.state().readOnly;
    return {
      doc,
      locate: (threadId) => passageRect(editor, frame.current, threadId, doc /* P3-E */),
      setActive: (threadId) => void (!editor.isDestroyed && editor.commands.setActiveThread(threadId)),
      resolve: (threadId) => {
        if (writable() && getThread(doc, threadId)) resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN);
      },
      reopen: (threadId) => {
        if (writable() && getThread(doc, threadId)) reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN);
      },
      record: (threadId, body) => {
        if (writable() && getThread(doc, threadId)) reply(doc, threadId, { id: `${threadId}:${nanoid8()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN);
      },
      discard: (threadId) => void (writable() && discardThread(doc, threadId, COMMENTS_ORIGIN)),
      focus: () => void (!editor.isDestroyed && editor.commands.focus()),
    };
  }, [editor, handle, author]);

  // a version is drawn with the design-system tokens it pinned (and its own overrides)
  const tokens = preview ? (preview.tokens as CSSProperties) : undefined;
  const page = useRef<HTMLDivElement>(null);
  const ground = usePageGround(page, tokens);
  useLayoutEffect(() => {
    onPage?.(page.current);
    return () => onPage?.(null);
  }, [onPage]);
  const sheet = (
    <div ref={page} className="ds-doc" style={tokens} data-ground={ground} data-preview={preview ? '' : undefined} onScroll={comments ? moved : undefined}>
      <div className="ds-doc-page">
        <div className="doc-live" hidden={previewEditor !== null}>
          <EditorContent editor={live} />
        </div>
        {previewEditor && <PreviewMount editor={previewEditor} />}
      </div>
    </div>
  );
  return (
    <div ref={frame} className="doc-page-frame" onContextMenu={editors.onContextMenu}>
      <div className="doc-page-scope">{Scope ? <Scope>{sheet}</Scope> : sheet}</div>
      {comments?.overlay({ ...reach, layoutKey: `${editor.instanceId}:${layout}` })}
      {pill && (
        <div className="doc-pill" data-markup-occluder>
          <button type="button" className="doc-pill-open" onClick={onNewChanges}>
            {pill.count === null ? 'See new changes' : `See ${pill.count} new ${pill.count === 1 ? 'change' : 'changes'}`}
          </button>
          {pill.failed !== null && (
            <button type="button" className="doc-pill-retry" aria-label="Count the new changes again" title={`Counting failed: ${pill.failed}`} onClick={() => void history?.recount()}>
              ↻
            </button>
          )}
          <button type="button" className="doc-pill-dismiss" aria-label="Dismiss new changes" onClick={() => history?.dismissPill()}>
            ×
          </button>
        </div>
      )}
      {editors.open && <ShowEditorsMenu open={editors.open} onShow={editors.show} onClose={editors.close} />}
    </div>
  );
}

// The page's ground, light or dark, as its computed background reads (the system's `--ds-color-bg`, the app's without
// a system; Decision Log 22): what the code highlighting keys its colours to. Read again when the app's theme, a
// stylesheet (a design-system scope's) or the page's own tokens change.
function usePageGround(page: RefObject<HTMLElement | null>, tokens: CSSProperties | undefined): 'light' | 'dark' {
  const [ground, setGround] = useState<'light' | 'dark'>('light');
  useLayoutEffect(() => {
    const element = page.current;
    if (!element) return;
    const read = () => {
      const background = getComputedStyle(element).backgroundColor;
      const clear = background === '' || background === 'transparent' || /^rgba\(.*,\s*0\)$/.test(background);
      setGround(!clear && isDarkGround(background) ? 'dark' : 'light');
    };
    read();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    observer.observe(document.head, { childList: true, subtree: true }); // a stylesheet added, removed or rewritten
    if (element.parentElement) observer.observe(element.parentElement, { attributes: true });
    return () => observer.disconnect();
  }, [page, tokens]);
  return ground;
}

const SAFE_ID = /^[\w-]+$/;

// The first line box of a thread's live passage in the shown tab, in the frame's coordinates; null when no live text
// of the thread is drawn here.
function passageRect(editor: Editor, frame: HTMLElement | null, threadId: string, doc: Doc /* P3-E */): PassageRect | null {
  if (!frame || editor.isDestroyed || !SAFE_ID.test(threadId)) return null;
  // P3-E: a block thread's block, its top line box (resolved or open: the card stays on it)
  const block = blockPos(editor, doc, threadId);
  const span = block >= 0 ? editor.view.nodeDOM(block) : editor.view.dom.querySelector(`[data-thread="${threadId}"]`);
  if (!(span instanceof Element)) return null;
  const line = span.getClientRects()[0] ?? span.getBoundingClientRect();
  const origin = frame.getBoundingClientRect();
  return { x: line.left - origin.left, y: line.top - origin.top, width: line.width, height: line.height };
}

// P3-E (E2 M4): where a block thread's block is in the editor's doc, or -1 (not a block thread, or no such block here).
function blockPos(editor: Editor, doc: Doc, threadId: string): number {
  const thread = getThread(doc, threadId);
  if (!thread || !isBlockAnchor(thread.anchor) || thread.blockId === null) return -1;
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.attrs.id === thread.blockId) at = pos;
    return !node.isTextblock;
  });
  return at;
}

// The preview's own editor (M9): read-only, bound to the version's view from its creation (the binding's microtask),
// put on another view when the preview changes (a comparison, Show changes), its moved and retyped blocks labelled and
// the change ↑ ↓ asked for reached once it draws, the controller told what is shown. It never touches the live editor.
//
// Its view is drawn detached (`element` a no-op placer) and put in the page by `PreviewMount`, not `EditorContent`:
// EditorContent's unmount clears the node views, which makes ProseMirror redraw the whole document (32,000 nodes of
// garbage at 200 pages, and a leave's time) a millisecond before the editor is destroyed; a plain mount just takes it out.
const PREVIEW_GONE_MS = 10; // past Tiptap's deferred destruction of an unmounted editor (1 ms)
const detached = (): void => {};

function PreviewMount({ editor }: { editor: Editor }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (editor.isDestroyed || !box.current) return;
    const dom = editor.view.dom;
    box.current.appendChild(dom);
    return () => dom.remove();
  }, [editor]);
  return <div ref={box} className="doc-preview" />;
}

interface PreviewEditorProps {
  view: VersionView;
  carried: ReadonlyMap<string, Carry['kind']>;
  focus: Preview['focus']; // P3-E: an unbound extra's too
  handle: DocumentHandle;
  tabId: string;
  artifactId: string;
  host: EditorHost;
  renderDiagram: DocumentEditorProps['renderDiagram'];
  controller: HistoryController | null;
  onEditor(editor: Editor | null): void;
  renderChart?: DocumentEditorProps['renderChart']; // P3-E
  revision?: number; // P3-E: the version's
  extras?: readonly ExtraChange[]; // P3-E (E2 M4): the comparison's extra changes, the shown tab's merged into its list
}

function PreviewEditor({ view, carried, focus, handle, tabId, artifactId, host, renderDiagram, controller, onEditor, renderChart, revision, extras }: PreviewEditorProps) {
  // P3-E: this tab's extra changes, as a value that changes only when they do
  const tabExtras = useMemo(() => extras?.filter((extra) => extra.tabId === tabId && extra.blockId !== null) ?? NO_EXTRAS, [extras, tabId]);
  // P3-E: the version shown, for its charts; this editor is put on other versions without being made again, so it moves
  const [displayed] = useState(() => displayedDocument(view.ytype.doc!, revision));
  useLayoutEffect(() => displayed.set(view.ytype.doc!, revision), [displayed, view, revision]);
  const editor = useEditor(
    {
      coreExtensionOptions,
      extensions: editorExtensions({
        collaboration: { ytype: tabBody(handle.doc, tabId) ?? null, awareness: null, user: null, hold: null, onRestored: null, version: view },
        comments: { doc: handle.doc, tabId, onComment: () => false },
        env: { artifactId, host, ...(renderDiagram ? { renderDiagram } : {}), ...(renderChart ? { renderChart, displayed } : {}) /* P3-E */ },
      }),
      element: detached,
      editorProps: { attributes: { 'aria-label': 'Document', class: 'doc-content', 'data-editor': 'preview' } },
      shouldRerenderOnTransaction: false,
      editable: false,
    },
    [tabId, handle, host, artifactId],
  );
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);
  useEffect(() => {
    if (editor.isDestroyed) return;
    const sync = () => ySyncPluginKey.getState(editor.state) as { ytype?: unknown; renderer?: unknown } | undefined;
    const bound = () => sync()?.ytype === view.ytype && (sync()?.renderer ?? null) === view.renderer;
    // a view other than the one the editor is on (or being bound to at its creation)
    if (sync()?.ytype != null && !bound()) editor.commands.showVersion(view);
    setCarried(editor, carried);
    if (extras) setExtra(editor, tabExtras); // P3-E: only with the hook, so B's preview dispatches nothing new
    const drawn = () => {
      if (focus !== null) goToChange(editor, typeof focus === 'number' ? focus : null); // P3-E: an extra's focus is the bar's
      controller?.applied(view);
    };
    if (bound()) return void drawn();
    const once = ({ transaction }: { transaction: { docChanged: boolean; getMeta(key: string): unknown } }) => {
      if (!isBindingTransaction(transaction) || !bound()) return;
      editor.off('transaction', once);
      drawn();
    };
    editor.on('transaction', once);
    return () => {
      editor.off('transaction', once);
    };
  }, [editor, view, carried, focus, controller, extras, tabExtras]);
  return null;
}

// P3-E (E2 M3): the revision of the version a preview shows (the later one of a comparison); none for the live state.
function previewRevision(preview: Preview | null, versions: readonly { id: number; seq: number }[] | null): number | undefined {
  const target = preview?.target;
  if (!target || target.kind === 'since') return undefined;
  const ids = target.kind === 'version' ? [target.versionId] : target.versionIds;
  const seqs = ids.map((id) => versions?.find((version) => version.id === id)?.seq).filter((seq): seq is number => seq !== undefined);
  return seqs.length > 0 ? Math.max(...seqs) : undefined;
}
