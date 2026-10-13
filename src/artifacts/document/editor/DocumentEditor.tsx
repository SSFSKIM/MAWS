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
// selection) come with it. Awareness (D11): the other replicas' cursors and an agent's editing blocks.
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { inHistory, type VersionView } from '../collab';
import type { Carry } from '../../yjs';
import { coreExtensionOptions } from '../ids';
import { nanoid8 } from '../schema';
import { tabBody } from '../tabs';
import { discardThread, getThread, reopen, reply, resolve } from '../threads';
import { activeThread, COMMENTS_ORIGIN, commentSelection, liveRanges } from './comments/plugins';
import type { CommentAuthor, CommentOverlayProps, DocumentComments, PassageRect } from './comments/surface';
import { ThreadsRail } from './comments/ThreadsRail';
import { useOpenThreadCount } from './comments/use-threads';
import { editorExtensions } from './extensions';
import { FindBar } from './Find';
import type { HistoryApi } from './history/api';
import type { HistoryController, HistorySnapshot, Preview } from './history/controller';
import { HistoryBar } from './history/HistoryBar';
import { HistoryRail } from './history/HistoryRail';
import { goToChange, setCarried } from './history/paint';
import { ShowEditorsMenu, useShowEditors } from './history/ShowEditors';
import { useHistoryController, useHistorySnapshot } from './history/use-history';
import { cssColor, type DocumentHandle, type EditorHost } from './host-types';
import type { ViewEnvironment } from './nodes/views';
import { Tabs } from './Tabs';
import { useTabs } from './tabs-store';
import { Toolbar } from './Toolbar';
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
}

type Rail = 'comments' | 'history' | null;
const NO_CARRIES: ReadonlyMap<string, Carry['kind']> = new Map();

/** A request to show a thread's passage: a new serial for each ask, so asking twice shows twice. */
interface Showing {
  threadId: string;
  serial: number;
}

export function DocumentEditor(props: DocumentEditorProps) {
  const { doc } = props.handle;
  const tabs = useTabs(doc);
  const [selected, setSelected] = useState<string | null>(null);
  const [rail, setRail] = useState<Rail>(null);
  const [showing, setShowing] = useState<Showing | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0] ?? null;
  const { host } = props;
  const author = useMemo<CommentAuthor>(() => ({ actor: host.identity().actor, now: () => Date.now() }), [host]);
  const history = useHistoryController(props.handle, props.history);
  const snapshot = useHistorySnapshot(history);
  const preview = snapshot?.preview ?? null;
  useEffect(() => history?.setLiveTab(active?.id ?? null), [history, active?.id]);
  // Leaving the history rail leaves history: the page shows the live document again.
  const openRail = (next: Rail) => {
    if (rail === 'history' && next !== 'history') history?.close();
    setRail(next);
  };
  return (
    <div className="doc-editor" data-document-editor="">
      {!preview && <Tabs doc={doc} tabs={tabs} active={active?.id ?? null} onSelect={setSelected} />}
      {snapshot?.banner && (
        <div className="doc-banner" role="status" aria-label="Restored">
          <span>{snapshot.banner}</span>
          <button type="button" className="doc-tool" onClick={() => history?.dismissBanner()}>
            Dismiss
          </button>
        </div>
      )}
      <div className="doc-editor-body">
        {active ? (
          <TabEditor
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
            {...props}
          />
        ) : (
          <div className="doc-editor-loading" role="status">
            Loading…
          </div>
        )}
        {rail === 'comments' && (
          <ThreadsRail
            doc={doc}
            tabs={tabs}
            activeTab={active?.id ?? null}
            activeThread={activeThreadId}
            author={author}
            onShow={(thread) => {
              if (tabs.some((tab) => tab.id === thread.tabId)) setSelected(thread.tabId);
              setShowing({ threadId: thread.id, serial: (showing?.serial ?? 0) + 1 });
            }}
            onClose={() => openRail(null)}
          />
        )}
        {rail === 'history' && history && snapshot && <HistoryRail controller={history} snapshot={snapshot} sessionTitle={props.history?.sessionTitle?.bind(props.history)} onClose={() => openRail(null)} />}
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
  showing: Showing | null;
  onShown(): void;
  /** The editor's active thread, as it changes (the rail selects it). */
  onActiveThread(threadId: string | null): void;
  /** A click on a highlighted passage activated its thread. */
  onPassageClick(): void;
}

function TabEditor({ tabId, tabTitle, artifactId, handle, host, renderDiagram, onEditor, comments, author, rail, openRail, historyController, historySnapshot, showing, onShown, onActiveThread, onPassageClick }: TabEditorProps) {
  const [findOpen, setFindOpen] = useState(false);
  const preview = historySnapshot?.preview ?? null;
  const openCount = useOpenThreadCount(handle.doc);
  // What Comment reads when it runs (a keystroke or a click after any render), kept current after each render.
  const latest = useRef({ comments, author, tabTitle, onPassageClick });
  useLayoutEffect(() => {
    latest.current = { comments, author, tabTitle, onPassageClick };
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
          hold: handle,
          onRestored: (listener) => handle.onRestored(listener),
        },
        comments: { doc: handle.doc, tabId, onComment: () => commentRef.current(), onActivate: () => latest.current.onPassageClick() },
        env: { artifactId, host, ...(renderDiagram ? { renderDiagram } : {}) },
      }),
      editorProps: { attributes: { 'aria-label': 'Document', class: 'doc-content' } },
      shouldRerenderOnTransaction: false,
      // from history state, not `setEditable` alone: a StrictMode remount sets the surviving editor's options again
      editable: preview === null,
    },
    [tabId, handle, host, artifactId],
  );
  usePreview(editor, preview?.view ?? null, preview?.carried ?? NO_CARRIES, preview?.focus ?? null, handle, tabId, historyController);

  // Comment the selection: the thread and the mark, the passage drawn active, then the surface opens its card.
  useLayoutEffect(() => {
    commentRef.current = () => {
      const { comments: surface, author: by, tabTitle: title } = latest.current;
      if (!surface || editor.isDestroyed || !editor.isEditable) return false;
      const threadId = nanoid8();
      const made = commentSelection(editor, handle.doc, { threadId, tabId, by: by.actor, at: by.now() });
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
      if (!range) return false;
      editor.chain().setTextSelection(range).setActiveThread(showing.threadId).scrollIntoView().run();
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
  }, [showing, editor, onShown]);

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
      {preview && historyController ? (
        <HistoryBar editor={editor} preview={preview} controller={historyController} onBack={() => historyController.close()} />
      ) : (
        <Toolbar
          editor={editor}
          artifactId={artifactId}
          host={host}
          onFind={() => setFindOpen(true)}
          comments={{ comment: comments ? () => commentRef.current() : null, railOpen: rail === 'comments', openCount, toggleRail: () => openRail(rail === 'comments' ? null : 'comments') }}
          history={historyController ? { open: rail === 'history', toggle: toggleHistory } : undefined}
        />
      )}
      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      <PageFrame
        editor={editor}
        handle={handle}
        author={author}
        comments={comments}
        tabId={tabId}
        preview={preview}
        history={historyController}
        pill={preview ? null : (historySnapshot?.pill ?? null)}
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
  editor: Editor;
  handle: DocumentHandle;
  author: CommentAuthor;
  comments: DocumentComments | undefined;
  tabId: string;
  preview: Preview | null;
  history: HistoryController | null;
  pill: HistorySnapshot['pill'];
  onNewChanges(): void;
}

function PageFrame({ editor, handle, author, comments, tabId, preview, history, pill, onNewChanges }: PageFrameProps) {
  const editors = useShowEditors(editor, history, tabId, preview === null);
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
    return {
      doc,
      locate: (threadId) => passageRect(editor, frame.current, threadId),
      setActive: (threadId) => void (!editor.isDestroyed && editor.commands.setActiveThread(threadId)),
      resolve: (threadId) => {
        if (getThread(doc, threadId)) resolve(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN);
      },
      reopen: (threadId) => {
        if (getThread(doc, threadId)) reopen(doc, threadId, author.actor, author.now(), COMMENTS_ORIGIN);
      },
      record: (threadId, body) => {
        if (getThread(doc, threadId)) reply(doc, threadId, { id: `${threadId}:${nanoid8()}`, by: author.actor, at: author.now(), body }, COMMENTS_ORIGIN);
      },
      discard: (threadId) => void discardThread(doc, threadId, COMMENTS_ORIGIN),
      focus: () => void (!editor.isDestroyed && editor.commands.focus()),
    };
  }, [editor, handle, author]);

  // a version is drawn with the design-system tokens it pinned (and its own overrides)
  const tokens = preview ? (preview.tokens as CSSProperties) : undefined;
  return (
    <div ref={frame} className="doc-page-frame" onContextMenu={editors.onContextMenu}>
      <div className="ds-doc" style={tokens} data-preview={preview ? '' : undefined} onScroll={comments ? moved : undefined}>
        <div className="ds-doc-page">
          <EditorContent editor={editor} />
        </div>
      </div>
      {comments?.overlay({ ...reach, layoutKey: `${editor.instanceId}:${layout}` })}
      {pill && (
        <div className="doc-pill">
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

const SAFE_ID = /^[\w-]+$/;

// The first line box of a thread's live passage in the shown tab, in the frame's coordinates; null when no live text
// of the thread is drawn here.
function passageRect(editor: Editor, frame: HTMLElement | null, threadId: string): PassageRect | null {
  if (!frame || editor.isDestroyed || !SAFE_ID.test(threadId)) return null;
  const span = editor.view.dom.querySelector(`[data-thread="${threadId}"]`);
  if (!span) return null;
  const line = span.getClientRects()[0] ?? span.getBoundingClientRect();
  const origin = frame.getBoundingClientRect();
  return { x: line.left - origin.left, y: line.top - origin.top, width: line.width, height: line.height };
}

// Puts the editor on the preview's view (or back on the live tab), labels its moved and retyped blocks, reaches the
// change ↑ ↓ asked for there, and tells the controller what is shown so the docs of what is not can go.
function usePreview(editor: Editor, view: VersionView | null, carried: ReadonlyMap<string, Carry['kind']>, focus: number | 'tab' | null, handle: DocumentHandle, tabId: string, controller: HistoryController | null) {
  const shown = useRef<VersionView | null>(null);
  useEffect(() => {
    if (editor.isDestroyed) return;
    if (view) editor.commands.showVersion(view);
    else if (shown.current && inHistory(editor.state, tabBody(handle.doc, tabId) ?? null)) editor.commands.leaveHistory();
    shown.current = view;
    setCarried(editor, view ? carried : NO_CARRIES);
    if (view && focus !== null) goToChange(editor, focus === 'tab' ? null : focus);
    controller?.applied(view);
  }, [editor, view, carried, focus, handle, tabId, controller]);
}
