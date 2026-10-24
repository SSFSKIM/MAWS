// The document's tab strip (§4.4's tabs; M3 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; P3-F, the owner's
// observation 3: the browser's pattern): select, add, rename (double-click, or the tab's menu), reorder (drag, or Move
// left and right in the menu) and delete (the tab's ×, or its menu; a tab with content only once the owner confirms, and
// History's Restore brings it back). Each tab has its own context menu, acting on that tab. A focused tab takes them
// from the keyboard too (P4, tracker L300; a Mac has no context-menu key and the × is outside the tab order): F2
// renames, Delete or ⌫ deletes, ⌥⇧← and ⌥⇧→ move it, Shift+F10 opens its menu; the keys and the menu alike leave the
// focus on the tab acted on, or after a deletion on its neighbour. Every change writes the tabs map
// (tabs.ts), so the other replicas see it at once; none of it is in a body's undo history.
import { AlertDialog, ContextMenu } from 'radix-ui';
import { useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import type { Doc } from '../../yjs';
import { ynodeToPmnode } from '../../yjs/prosemirror';
import { DOCUMENT_LIMITS } from '@shared/maws/document-tools';
import { schemaFor } from '../schema';
import { TAB_LIMIT_REFUSAL, addTab, deleteTab, moveTab, renameTab, tabBody, type TabInfo } from '../tabs';
import { useOpenThreadCounts } from './comments/use-threads'; // P4-B1

const DRAG_TYPE = 'application/x-maws-document-tab';

// P3-F (tracker S-DOC-TAB-DRAG-SOURCE): the tab dragged and its document, from the drag's start to its end. A copy of a
// document (Duplicate, Make a copy) holds every tab id of its source, so a strip takes a drop only from its own document.
let dragging: { doc: Doc; id: string } | null = null;
function dragStarted(doc: Doc, id: string): void {
  dragging = { doc, id };
}
function dragEnded(): void {
  dragging = null;
}

// Whether deleting the tab loses anything: its body holds more than one empty paragraph.
function hasContent(doc: Doc, tabId: string): boolean {
  const body = tabBody(doc, tabId);
  if (!body) return false;
  const node = ynodeToPmnode(body, schemaFor());
  const only = node.childCount === 1 ? node.firstChild : null;
  return !(only?.type.name === 'paragraph' && only.content.size === 0);
}

/** `readOnly`: the store is read-only, so the tabs can be selected but not added, renamed, moved or deleted. */
export function Tabs({ doc, tabs, active, readOnly = false, onSelect }: { doc: Doc; tabs: TabInfo[]; active: string | null; readOnly?: boolean; onSelect(tabId: string, focusPage?: boolean): void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [asking, setAsking] = useState<TabInfo | null>(null); // the tab with content whose deletion waits for the owner
  const renameFromMenu = useRef(false); // the menu's focus return, which would end the rename it starts
  // the tab the keys or its menu acted on (renamed, moved) or the neighbour of one they deleted, focused once it is
  // drawn unless the focus went elsewhere meanwhile (a rename ended by a click away); after the owner was asked, once
  // the question has gone (its close)
  const strip = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const confirming = useRef(false);
  const tabElement = (id: string | null) => (id === null ? null : (strip.current?.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${CSS.escape(id)}"]`) ?? null));
  useLayoutEffect(() => {
    const element = confirming.current ? null : tabElement(refocus.current);
    if (!element) return;
    refocus.current = null;
    const held = element.ownerDocument.activeElement;
    if (!held || held === element.ownerDocument.body) element.focus();
  });
  // P4-B1 (the prior art's Z6): a tab with open comment threads carries a dot, named by their count
  const openCounts = useOpenThreadCounts(doc);
  const openComments = (tabId: string) => {
    const count = openCounts.get(tabId) ?? 0;
    return count === 0 ? undefined : `${count} open ${count === 1 ? 'comment' : 'comments'}`;
  };
  const dot = (tabId: string) => {
    const label = openComments(tabId);
    return label && <span className="doc-tab-dot" role="img" aria-label={label} />;
  };
  // the guide's limit (P3-F, tracker L155): Add tab is refused with the reason on it; a tab another replica added since
  // this render is refused by the writer itself, which writes nothing
  const full = tabs.length >= DOCUMENT_LIMITS.tabs;
  const deletable = !readOnly && tabs.length > 1; // a document keeps its last tab

  const add = () => {
    if (readOnly || full) return;
    let id: string;
    try {
      id = addTab(doc, { title: `Tab ${tabs.length + 1}`, ...(active ? { after: active } : {}) });
    } catch {
      return;
    }
    onSelect(id);
  };
  const move = (tab: TabInfo, by: -1 | 1) => {
    const neighbour = tabs[tabs.findIndex((other) => other.id === tab.id) + by];
    if (!readOnly && neighbour) moveTab(doc, tab.id, by < 0 ? { before: neighbour.id } : { after: neighbour.id });
  };
  const remove = (tab: TabInfo) => {
    if (!deletable) return;
    const at = tabs.findIndex((other) => other.id === tab.id);
    try {
      deleteTab(doc, tab.id); // throws when another replica deleted it, or every other tab, while the owner was asked
    } catch {
      return;
    }
    const next = tabs[at + 1] ?? tabs[at - 1];
    if (refocus.current === tab.id) refocus.current = next?.id ?? null;
    if (next && (tab.id === active || tabs.length === 2)) onSelect(next.id, tabs.length === 2);
  };
  const askToRemove = (tab: TabInfo) => {
    if (!deletable) return;
    if (hasContent(doc, tab.id)) {
      confirming.current = true;
      setAsking(tab);
    } else remove(tab);
  };
  const onTabKey = (event: KeyboardEvent<HTMLElement>, tab: TabInfo) => {
    if (event.target !== event.currentTarget) return;
    const { key, altKey, shiftKey, metaKey, ctrlKey } = event;
    const plain = !altKey && !shiftKey && !metaKey && !ctrlKey;
    if (key === 'Enter' || key === ' ') onSelect(tab.id);
    else if (key === 'F2' && plain) {
      if (readOnly) return;
      refocus.current = tab.id;
      setRenaming(tab.id);
    } else if ((key === 'Delete' || key === 'Backspace') && plain) {
      if (!deletable) return;
      refocus.current = tab.id; // remove() hands it to the neighbour
      askToRemove(tab);
    } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && altKey && shiftKey && !metaKey && !ctrlKey) {
      refocus.current = tab.id;
      move(tab, key === 'ArrowLeft' ? -1 : 1);
    } else if ((key === 'F10' && shiftKey && !altKey && !metaKey && !ctrlKey) || (key === 'ContextMenu' && plain)) {
      // the tab's own menu, opened where a right-click on its lower left would
      const box = event.currentTarget.getBoundingClientRect();
      event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom }));
    } else return;
    event.preventDefault();
  };
  // P3-F: a drag from another document's strip (its copy's included), a dragged tab deleted mid-drag, or another kind
  // of drag is not this strip's drop
  const drop = (event: DragEvent, target: TabInfo) => {
    const source = dragging;
    if (!source || source.doc !== doc || event.dataTransfer.getData(DRAG_TYPE) !== source.id) return;
    const from = tabs.findIndex((tab) => tab.id === source.id);
    if (from < 0 || source.id === target.id) return;
    event.preventDefault();
    const to = tabs.findIndex((tab) => tab.id === target.id);
    moveTab(doc, source.id, from < to ? { after: target.id } : { before: target.id });
  };

  return (
    <div className="doc-tabs">
      <div ref={strip} role="tablist" aria-label="Tabs" className="doc-tablist">
        {tabs.map((tab, index) => {
          const title = tab.title || 'Untitled';
          if (renaming === tab.id && !readOnly)
            return (
              <TitleInput
                key={tab.id}
                title={tab.title}
                onDone={(next) => {
                  if (!readOnly && next !== null && next.trim() && next !== tab.title) renameTab(doc, tab.id, next.trim());
                  setRenaming(null);
                }}
              />
            );
          return (
            <ContextMenu.Root key={tab.id} modal={false}>
              <ContextMenu.Trigger asChild>
                <div
                  role="tab"
                  aria-selected={tab.id === active}
                  aria-label={title}
                  aria-description={openComments(tab.id) /* P4-B1: a tab's children are presentational, so its dot is said here */}
                  data-tab-id={tab.id}
                  tabIndex={0}
                  className="doc-tab"
                  draggable={!readOnly}
                  onClick={() => onSelect(tab.id)}
                  onKeyDown={(event) => onTabKey(event, tab)}
                  onDoubleClick={() => !readOnly && setRenaming(tab.id)}
                  onDragStart={(event) => {
                    dragStarted(doc, tab.id);
                    event.dataTransfer.setData(DRAG_TYPE, tab.id);
                  }}
                  onDragEnd={dragEnded}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => !readOnly && drop(event, tab)}
                >
                  <span className="doc-tab-label">{title}</span>
                  {dot(tab.id)}
                  {deletable && (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="doc-tab-close"
                      aria-label={`Delete ${title}`}
                      title="Delete tab"
                      onClick={(event) => {
                        event.stopPropagation();
                        askToRemove(tab);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <svg viewBox="0 0 10 10" aria-hidden="true">
                        <path d="M2.5 2.5l5 5m0-5l-5 5" />
                      </svg>
                    </button>
                  )}
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content
                  className="doc-tab-menu"
                  onCloseAutoFocus={(event) => {
                    if (!renameFromMenu.current) return;
                    renameFromMenu.current = false;
                    event.preventDefault();
                  }}
                >
                  <ContextMenu.Item
                    className="doc-tab-menu-item"
                    disabled={readOnly}
                    onSelect={() => {
                      renameFromMenu.current = true;
                      refocus.current = tab.id;
                      setRenaming(tab.id);
                    }}
                  >
                    Rename
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="doc-tab-menu-item"
                    disabled={readOnly || index === 0}
                    onSelect={() => {
                      refocus.current = tab.id;
                      move(tab, -1);
                    }}
                  >
                    Move left
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className="doc-tab-menu-item"
                    disabled={readOnly || index === tabs.length - 1}
                    onSelect={() => {
                      refocus.current = tab.id;
                      move(tab, 1);
                    }}
                  >
                    Move right
                  </ContextMenu.Item>
                  <ContextMenu.Separator className="doc-tab-menu-separator" />
                  <ContextMenu.Item
                    className="doc-tab-menu-item"
                    data-danger
                    disabled={!deletable}
                    onSelect={() => {
                      refocus.current = tab.id; // remove() hands it to the neighbour
                      askToRemove(tab);
                    }}
                  >
                    Delete
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
      <button type="button" className="doc-icon-button" aria-label="Add tab" disabled={readOnly || full} title={full ? TAB_LIMIT_REFUSAL : undefined} onClick={add}>
        +
      </button>
      <AlertDialog.Root open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="doc-confirm-overlay" />
          <AlertDialog.Content
            className="doc-confirm"
            onCloseAutoFocus={(event) => {
              // the tab deleted is gone: its neighbour, or the tab the strip has focused already
              const element = tabElement(refocus.current);
              refocus.current = null;
              confirming.current = false;
              if (element) element.focus();
              if (element || strip.current?.contains(document.activeElement)) event.preventDefault();
            }}
          >
            <AlertDialog.Title className="doc-confirm-title">{`Delete “${asking?.title || 'Untitled'}”?`}</AlertDialog.Title>
            <AlertDialog.Description className="doc-confirm-description">The tab goes with everything in it. History can bring it back.</AlertDialog.Description>
            <div className="doc-confirm-actions">
              <AlertDialog.Cancel className="doc-confirm-button">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action className="doc-confirm-button" data-danger onClick={() => asking && remove(asking)}>
                Delete tab
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
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
