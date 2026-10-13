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
// reopen). The threads rail beside the page lists every tab's threads.
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { coreExtensionOptions } from '../ids';
import { nanoid8 } from '../schema';
import { tabBody } from '../tabs';
import { discardThread, getThread, reopen, reply, resolve } from '../threads';
import { COMMENTS_ORIGIN, commentSelection, liveRanges } from './comments/plugins';
import type { CommentAuthor, CommentOverlayProps, DocumentComments, PassageRect } from './comments/surface';
import { ThreadsRail } from './comments/ThreadsRail';
import { useOpenThreadCount } from './comments/use-threads';
import { editorExtensions } from './extensions';
import { FindBar } from './Find';
import { cssColor, type DocumentHandleWithHold, type EditorHost } from './host-types';
import type { ViewEnvironment } from './nodes/views';
import { Tabs } from './Tabs';
import { useTabs } from './tabs-store';
import { Toolbar } from './Toolbar';
import './chrome.css';
import './theme.css';

export interface DocumentEditorProps {
  artifactId: string;
  handle: DocumentHandleWithHold;
  host: EditorHost;
  /** Draws a diagram; mermaid, loaded on first use, by default. */
  renderDiagram?: ViewEnvironment['renderDiagram'];
  /** Receives the active tab's editor, and null when it goes (the harness's and the tests' reach). */
  onEditor?: (editor: Editor | null) => void;
  /** Where a comment goes (P2's card); without it, commenting is not offered. */
  comments?: DocumentComments;
}

/** A request to show a thread's passage: a new serial for each ask, so asking twice shows twice. */
interface Showing {
  threadId: string;
  serial: number;
}

export function DocumentEditor(props: DocumentEditorProps) {
  const { doc } = props.handle;
  const tabs = useTabs(doc);
  const [selected, setSelected] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [showing, setShowing] = useState<Showing | null>(null);
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0] ?? null;
  const { host } = props;
  const author = useMemo<CommentAuthor>(() => ({ actor: host.identity().actor, now: () => Date.now() }), [host]);
  return (
    <div className="doc-editor" data-document-editor="">
      <Tabs doc={doc} tabs={tabs} active={active?.id ?? null} onSelect={setSelected} />
      <div className="doc-editor-body">
        {active ? (
          <TabEditor
            key={active.id}
            tabId={active.id}
            tabTitle={active.title}
            author={author}
            railOpen={railOpen}
            toggleRail={() => setRailOpen(!railOpen)}
            showing={showing}
            onShown={() => setShowing(null)}
            {...props}
          />
        ) : (
          <div className="doc-editor-loading" role="status">
            Loading…
          </div>
        )}
        {railOpen && (
          <ThreadsRail
            doc={doc}
            tabs={tabs}
            activeTab={active?.id ?? null}
            author={author}
            onShow={(thread) => {
              if (tabs.some((tab) => tab.id === thread.tabId)) setSelected(thread.tabId);
              setShowing({ threadId: thread.id, serial: (showing?.serial ?? 0) + 1 });
            }}
            onClose={() => setRailOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

interface TabEditorProps extends DocumentEditorProps {
  tabId: string;
  tabTitle: string;
  author: CommentAuthor;
  railOpen: boolean;
  toggleRail(): void;
  showing: Showing | null;
  onShown(): void;
}

function TabEditor({ tabId, tabTitle, artifactId, handle, host, renderDiagram, onEditor, comments, author, railOpen, toggleRail, showing, onShown }: TabEditorProps) {
  const [findOpen, setFindOpen] = useState(false);
  const openCount = useOpenThreadCount(handle.doc);
  // What Comment reads when it runs (a keystroke or a click after any render), kept current after each render.
  const latest = useRef({ comments, author, tabTitle });
  useLayoutEffect(() => {
    latest.current = { comments, author, tabTitle };
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
        comments: { doc: handle.doc, tabId, onComment: () => commentRef.current() },
        env: { artifactId, host, ...(renderDiagram ? { renderDiagram } : {}) },
      }),
      editorProps: { attributes: { 'aria-label': 'Document', class: 'doc-content' } },
      shouldRerenderOnTransaction: false,
    },
    [tabId, handle, host, artifactId],
  );

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

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setFindOpen(true);
    }
  };

  return (
    <div className="doc-tab-editor" onKeyDown={onKeyDown}>
      <Toolbar
        editor={editor}
        artifactId={artifactId}
        host={host}
        onFind={() => setFindOpen(true)}
        comments={{ comment: comments ? () => commentRef.current() : null, railOpen, openCount, toggleRail }}
      />
      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      <PageFrame editor={editor} handle={handle} author={author} comments={comments} />
    </div>
  );
}

// The page's scroll box and, over it, the comment surface's overlay with the editor's reach. The overlay re-renders at
// most once a frame as the passages move (an edit, a scroll, a resize); the page does not.
function PageFrame({ editor, handle, author, comments }: { editor: Editor; handle: DocumentHandleWithHold; author: CommentAuthor; comments: DocumentComments | undefined }) {
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

  return (
    <div ref={frame} className="doc-page-frame">
      <div className="ds-doc" onScroll={comments ? moved : undefined}>
        <div className="ds-doc-page">
          <EditorContent editor={editor} />
        </div>
      </div>
      {comments?.overlay({ ...reach, layoutKey: `${editor.instanceId}:${layout}` })}
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
