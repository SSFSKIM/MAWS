// Show editors (D10 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; §4.7 of the parent: Google Docs' right-click
// "Show editors"): a right-click over a selection of the live document opens a small menu; "Show editors" lists who
// edited the selection and when each last did, from provenance (so an edit older than a compaction is named too). A
// right-click with nothing selected keeps the system's menu.
import type { Editor } from '@tiptap/core';
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { HistoryController, ShownEditor } from './controller';

interface Open {
  x: number;
  y: number;
  from: number;
  to: number;
  /** Show editors was chosen: the list (null while it is read) replaces the menu. */
  asked: boolean;
  editors: ShownEditor[] | null;
  error: string | null;
}

/** The context menu's state and its handler for the page frame's `contextmenu`. */
export function useShowEditors(editor: Editor, controller: HistoryController | null, tabId: string, enabled: boolean) {
  const [open, setOpen] = useState<Open | null>(null);
  const onContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const { from, to, empty } = editor.state.selection;
    if (!controller || !enabled || empty || editor.isDestroyed) return;
    event.preventDefault();
    const frame = event.currentTarget.getBoundingClientRect();
    setOpen({ x: event.clientX - frame.left, y: event.clientY - frame.top, from, to, asked: false, editors: null, error: null });
  };
  const show = () => {
    if (!open || !controller) return;
    const asked: Open = { ...open, asked: true, editors: null, error: null };
    setOpen(asked);
    controller
      .editorsOf({ doc: editor.state.doc, from: asked.from, to: asked.to, tabId })
      .then((editors) => setOpen((now) => (now === asked ? { ...asked, editors } : now)))
      .catch((error: unknown) => setOpen((now) => (now === asked ? { ...asked, editors: [], error: error instanceof Error ? error.message : String(error) } : now)));
  };
  return { open, onContextMenu, show, close: () => setOpen(null) };
}

export function ShowEditorsMenu({ open, onShow, onClose }: { open: Open; onShow(): void; onClose(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const style = { left: open.x, top: open.y };
  if (!open.asked)
    return (
      <div className="doc-menu doc-context-menu" role="menu" aria-label="Selection" style={style} data-markup-occluder>
        <button type="button" role="menuitem" className="doc-menu-item" onClick={onShow}>
          Show editors
        </button>
      </div>
    );
  return (
    <div className="doc-popover doc-editors" role="dialog" aria-label="Editors" style={style} data-markup-occluder>
      <header className="doc-editors-header">
        <span>Editors of the selection</span>
        <button type="button" className="doc-tool" aria-label="Close editors" onClick={onClose}>
          ×
        </button>
      </header>
      {open.editors === null ? (
        <p className="doc-editors-empty">Reading the history…</p>
      ) : open.error ? (
        <p className="doc-editors-empty">{open.error}</p>
      ) : open.editors.length === 0 ? (
        <p className="doc-editors-empty">No edits recorded for this selection.</p>
      ) : (
        <ul className="doc-editors-list">
          {open.editors.map((who) => (
            <li key={`${who.name}-${who.at}`} className="doc-editors-row">
              <span className="doc-author-chip" style={{ background: `var(${who.color})` }} aria-hidden />
              {who.name} · {who.when}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
