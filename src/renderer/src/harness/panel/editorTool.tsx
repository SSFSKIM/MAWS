// P3-G (M3): the harness-only `harness-editor` tool, whose body registers a full X32 registration through the scope
// ToolBody provides, as P3-L, B and C will: a breadcrumb, a saved state, an open-comment count with its comments action,
// two more actions, two exports and a closeGuard. The e2e drives it through `window.__maws_harness.panel.editor`: what
// it registers (`set`), what the header invoked (`invoked`), and whether its guard lets the tab close.
import { useSyncExternalStore } from 'react';
import { Icon } from '../../app/IconButton';
import { useEditorHost, useEditorHostScope, type SavedState } from '../../panel/editor-host';
import type { PanelTool } from '../../panel/tool';
import type { PanelHarnessEditorProbe, PanelHarnessEditorView } from './api';

let view: PanelHarnessEditorView = { registered: true, saved: 'saving', unresolved: 3, allowClose: true };
const invoked: string[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const editorProbe: PanelHarnessEditorProbe = {
  set(patch) {
    view = { ...view, ...patch };
    listeners.forEach((listener) => listener());
  },
  invoked: () => [...invoked],
};

export const editorTool: PanelTool<null, unknown> = {
  id: 'harness-editor',
  title: 'Editor',
  icon: EditorIcon,
  pinnable: false,
  multiInstance: false,
  menu: false,
  createState: () => null,
  beforeClose: async () => true,
  dispose() {},
  render: EditorBody,
};

function EditorBody() {
  const current = useSyncExternalStore(subscribe, () => view);
  return (
    <div data-testid="editor-body" className="p-3 text-ui text-fg">
      Editor body
      <Registration registered={current.registered} saved={current.saved} unresolved={current.unresolved} />
    </div>
  );
}

// Unregistering withdraws through a null scope: a registration outlives its body's unmount (it lives as long as its tab).
function Registration({ registered, saved, unresolved }: { registered: boolean; saved: SavedState | null; unresolved: number }) {
  const log = (what: string) => () => void invoked.push(what);
  const scope = useEditorHostScope();
  useEditorHost(registered ? scope : null, {
    title: 'Q3 brief',
    breadcrumb: ['Docs', 'Planning'],
    saved,
    unresolved,
    actions: [
      { id: 'history', label: 'Version history', icon: HistoryIcon, onSelect: log('history') },
      { id: 'open-in-tab', label: 'Open in tab', icon: OpenInTabIcon, onSelect: log('open-in-tab') },
      { id: 'comments', label: 'Comments', onSelect: log('comments') },
    ],
    exports: [
      { id: 'pdf', label: 'PDF', onSelect: log('export:pdf') },
      { id: 'docx', label: 'Word document', onSelect: log('export:docx') },
    ],
    closeGuard: async () => view.allowClose,
  });
  return null;
}

function EditorIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 2.5h5.5L12 5v8.5H4zM6 8h4M6 10.5h4" />
    </Icon>
  );
}

function OpenInTabIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M7 3.5H3.5v9h9V9M9.5 2.5h4v4M13.5 2.5 8 8" />
    </Icon>
  );
}

function HistoryIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5" />
    </Icon>
  );
}
