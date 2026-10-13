// The document editor (D1's `editor/`, D3; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the tab strip,
// the formatting toolbar, find, and the page, a Tiptap editor bound to the active tab's body of an open replica. The
// handle is opened and owned by the caller (the tab's store handle, M8), so this component only binds and draws. One
// editor per active tab: switching tabs mounts a fresh editor on the other body, its undo history its own.
//
// The page carries `.ds-doc` and reads only the design system's `--ds-*` tokens, each falling back to the app's (D3):
// until D's `<DesignSystemScope>` wraps it, the document is MAWS's own look following the app theme. The chrome around
// the page (tabs, toolbar, find) is the app's, in its tokens.
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import 'katex/dist/katex.min.css';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { coreExtensionOptions } from '../ids';
import { tabBody } from '../tabs';
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
}

export function DocumentEditor(props: DocumentEditorProps) {
  const tabs = useTabs(props.handle.doc);
  const [selected, setSelected] = useState<string | null>(null);
  const active = tabs.find((tab) => tab.id === selected) ?? tabs[0] ?? null;
  return (
    <div className="doc-editor" data-document-editor="">
      <Tabs doc={props.handle.doc} tabs={tabs} active={active?.id ?? null} onSelect={setSelected} />
      {active ? (
        <TabEditor key={active.id} tabId={active.id} {...props} />
      ) : (
        <div className="doc-editor-loading" role="status">
          Loading…
        </div>
      )}
    </div>
  );
}

function TabEditor({ tabId, artifactId, handle, host, renderDiagram, onEditor }: DocumentEditorProps & { tabId: string }) {
  const [findOpen, setFindOpen] = useState(false);
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
        env: { artifactId, host, ...(renderDiagram ? { renderDiagram } : {}) },
      }),
      editorProps: { attributes: { 'aria-label': 'Document', class: 'doc-content' } },
      shouldRerenderOnTransaction: false,
    },
    [tabId, handle, host, artifactId],
  );

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setFindOpen(true);
    }
  };

  return (
    <div className="doc-tab-editor" onKeyDown={onKeyDown}>
      <Toolbar editor={editor} artifactId={artifactId} host={host} onFind={() => setFindOpen(true)} />
      {findOpen && <FindBar editor={editor} onClose={() => setFindOpen(false)} />}
      <div className="ds-doc">
        <div className="ds-doc-page">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
