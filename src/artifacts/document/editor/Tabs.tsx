// The document's tab strip (§4.4's tabs; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): select, add,
// rename (double-click or the tab's menu), reorder (drag, or Move left and right in the menu) and delete. Every change
// writes the tabs map (tabs.ts), so the other replicas see it at once; none of it is in a body's undo history.
import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { Doc } from '../../yjs';
import { addTab, deleteTab, moveTab, renameTab, type TabInfo } from '../tabs';

const DRAG_TYPE = 'application/x-maws-document-tab';

/** `readOnly`: the store is read-only, so the tabs can be selected but not added, renamed, moved or deleted. */
export function Tabs({ doc, tabs, active, readOnly = false, onSelect }: { doc: Doc; tabs: TabInfo[]; active: string | null; readOnly?: boolean; onSelect(tabId: string): void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const index = tabs.findIndex((tab) => tab.id === active);

  const add = () => {
    const id = addTab(doc, { title: `Tab ${tabs.length + 1}`, ...(active ? { after: active } : {}) });
    onSelect(id);
  };
  const move = (by: -1 | 1) => {
    const neighbour = tabs[index + by];
    if (active && neighbour) moveTab(doc, active, by < 0 ? { before: neighbour.id } : { after: neighbour.id });
    setMenu(false);
  };
  const remove = () => {
    if (!active || tabs.length < 2) return;
    const next = tabs[index + 1] ?? tabs[index - 1];
    deleteTab(doc, active);
    onSelect(next.id);
    setMenu(false);
  };
  const drop = (event: DragEvent, target: TabInfo) => {
    const dragged = event.dataTransfer.getData(DRAG_TYPE);
    if (!dragged || dragged === target.id) return;
    event.preventDefault();
    const from = tabs.findIndex((tab) => tab.id === dragged);
    const to = tabs.findIndex((tab) => tab.id === target.id);
    moveTab(doc, dragged, from < to ? { after: target.id } : { before: target.id });
  };

  return (
    <div className="doc-tabs">
      <div role="tablist" aria-label="Tabs" className="doc-tablist">
        {tabs.map((tab) =>
          renaming === tab.id && !readOnly ? (
            <TitleInput
              key={tab.id}
              title={tab.title}
              onDone={(title) => {
                if (title !== null && title.trim() && title !== tab.title) renameTab(doc, tab.id, title.trim());
                setRenaming(null);
              }}
            />
          ) : (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active}
              className="doc-tab"
              draggable={!readOnly}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => !readOnly && setRenaming(tab.id)}
              onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, tab.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => !readOnly && drop(event, tab)}
            >
              {tab.title || 'Untitled'}
            </button>
          ),
        )}
      </div>
      {active && (
        <div className="doc-tab-menu-anchor">
          <button type="button" className="doc-icon-button" aria-label="Tab options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            ⋯
          </button>
          {menu && (
            <div role="menu" className="doc-menu">
              <button type="button" role="menuitem" disabled={readOnly} onClick={() => {
                  setRenaming(active);
                  setMenu(false);
                }}
              >
                Rename
              </button>
              <button type="button" role="menuitem" disabled={readOnly || index <= 0} onClick={() => move(-1)}>
                Move left
              </button>
              <button type="button" role="menuitem" disabled={readOnly || index >= tabs.length - 1} onClick={() => move(1)}>
                Move right
              </button>
              <button type="button" role="menuitem" disabled={readOnly || tabs.length < 2} onClick={remove}>
                Delete
              </button>
            </div>
          )}
        </div>
      )}
      <button type="button" className="doc-icon-button" aria-label="Add tab" disabled={readOnly} onClick={add}>
        +
      </button>
    </div>
  );
}

// The title field of a tab being renamed: Enter or leaving it keeps the title, Escape drops it.
function TitleInput({ title, onDone }: { title: string; onDone(title: string | null): void }) {
  const [value, setValue] = useState(title);
  const done = useRef(false); // the blur that follows Enter or Escape as the field goes
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') finish(value);
    if (event.key === 'Escape') finish(null);
  };
  return <input className="doc-tab-title" aria-label="Tab title" autoFocus value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} onBlur={() => finish(value)} />;
}
