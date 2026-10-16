// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench"): the board
// list in the rail where C's deck has its filmstrip. The boards back to front (the manifest's order) by name and size,
// held and missing ones marked; a click selects a board's frame (and makes it the board C's overlay acts on), a double
// click zooms to it; drag reorders with @dnd-kit/sortable as C's filmstrip does (the keyboard too: Space, arrows,
// Space), and each board's options zoom to it, rename it, duplicate it, move it up or down and delete it. Add board
// offers the size presets. Every gesture is one transaction and one undo step (the session's `edit`), read-only offers
// none.
import { useState, type KeyboardEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { moveSlide } from '../../slides/model';
import type { DeckSession } from '../../slides/editor/session';
import { CANVAS_LIMITS } from '../canvas';
import { boardLabel, type BoardView } from './boards';
import { BOARD_PRESETS, DESIGN_COPY as C, type BoardPreset } from './copy';

export interface BoardListProps {
  session: DeckSession;
  boards: readonly BoardView[];
  current: string | null;
  frame: string | null;
  readOnly: boolean;
  onSelect: (boardId: string) => void;
  onZoomTo: (boardId: string) => void;
  onAdd: (preset: BoardPreset) => void;
  onDuplicate: (boardId: string) => void;
  onRemove: (boardId: string) => void;
  onRename: (boardId: string, title: string) => void;
}

export function BoardList({ session, boards, current, frame, readOnly, onSelect, onZoomTo, onAdd, onDuplicate, onRemove, onRename }: BoardListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = boards.map((b) => b.id);
  const moveTo = (id: string, to: number) => {
    const from = ids.indexOf(id);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    const after = to === 0 ? null : arrayMove(ids, from, to)[to - 1]!;
    session.edit((origin) => moveSlide(session.doc, id, after, origin));
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || readOnly) return;
    moveTo(String(active.id), ids.indexOf(String(over.id)));
  };
  const full = boards.length >= CANVAS_LIMITS.boards;

  return (
    <nav className="design-boards" aria-label={C.boards} data-design-rail="boards">
      <div className="design-boards-header">
        <span>{C.boards}</span>
        {!readOnly && (
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="deck-button" aria-label={C.addBoard} title={C.addBoard} disabled={full}>
                +
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="deck-menu">
                {BOARD_PRESETS.map((p) => (
                  <DropdownMenu.Item key={p.id} className="deck-menu-item" onSelect={() => onAdd(p)}>
                    {C.preset(p.label, p.w, p.h)}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
      {boards.length === 0 ? (
        <p className="deck-quiet">{C.noBoards}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={readOnly}>
            <ol className="design-boards-list" aria-label={C.boardsInOrder}>
              {boards.map((b, index) => (
                <Row
                  key={b.id}
                  board={b}
                  current={b.id === current}
                  framed={b.id === frame}
                  readOnly={readOnly}
                  first={index === 0}
                  last={index === boards.length - 1}
                  full={full}
                  onSelect={() => onSelect(b.id)}
                  onZoomTo={() => onZoomTo(b.id)}
                  onDuplicate={() => onDuplicate(b.id)}
                  onRemove={() => onRemove(b.id)}
                  onRename={(title) => onRename(b.id, title)}
                  onMove={(by) => moveTo(b.id, index + by)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {!readOnly && full && <p className="deck-filmstrip-note">{C.full(CANVAS_LIMITS.boards)}</p>}
    </nav>
  );
}

function Row(props: {
  board: BoardView;
  current: boolean;
  framed: boolean;
  readOnly: boolean;
  first: boolean;
  last: boolean;
  full: boolean;
  onSelect: () => void;
  onZoomTo: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onRename: (title: string) => void;
  onMove: (by: 1 | -1) => void;
}) {
  const { board, current, framed, readOnly, first, last, full, onSelect, onZoomTo, onDuplicate, onRemove, onRename, onMove } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: board.id, disabled: readOnly });
  const [renaming, setRenaming] = useState<string | null>(null);
  const label = boardLabel(board);
  const editable = board.held === null && !board.missing;

  const commit = () => {
    if (renaming === null) return;
    const title = renaming.trim();
    setRenaming(null);
    // M6 final review: the board and the replica as they stand at the commit, not as they stood when the field opened
    if (readOnly || !editable) return;
    if (title !== board.title) onRename(title);
  };
  if (renaming !== null) {
    return (
      <li className="design-board-item" data-board-row={board.id}>
        <input
          className="deck-section-input design-board-rename"
          aria-label={C.renameBoard}
          value={renaming}
          autoFocus
          onChange={(event) => setRenaming(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            else if (event.key === 'Escape') setRenaming(null);
            event.stopPropagation();
          }}
        />
      </li>
    );
  }

  // a held or missing board keeps its frame and name as they are (nothing written to it) but may be deleted or
  // reordered, as C's filmstrip treats a held slide
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (readOnly) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove();
    } else if (event.key === 'd' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (editable && !full) onDuplicate();
    }
  };

  return (
    <li
      ref={setNodeRef}
      className="design-board-item"
      data-board-row={board.id}
      data-current={current || undefined}
      data-frame-selected={framed || undefined}
      data-held={board.held ? '' : undefined}
      data-missing={board.missing || undefined}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        className="design-board-row"
        aria-label={C.boardRow(label, board.frame?.w ?? null, board.frame?.h ?? null, board.held !== null, board.missing)}
        aria-current={current ? 'true' : undefined}
        onClick={onSelect}
        onDoubleClick={onZoomTo}
        {...attributes}
        {...listeners}
        onKeyDown={(event) => {
          onKeyDown(event);
          if (!event.defaultPrevented) (listeners?.onKeyDown as ((e: KeyboardEvent<HTMLElement>) => void) | undefined)?.(event);
        }}
      >
        <span className="design-board-name">{label}</span>
        {board.held && <span className="design-board-badge">{C.held}</span>}
        {board.missing && <span className="design-board-badge">{C.missing}</span>}
        {board.frame && <span className="design-board-size">{C.size(board.frame.w, board.frame.h)}</span>}
      </button>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="deck-thumb-menu design-board-menu" aria-label={C.boardOptions(label)}>
            <span aria-hidden>⋯</span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="deck-menu">
            <DropdownMenu.Item className="deck-menu-item" disabled={board.frame === null} onSelect={onZoomTo}>
              {C.zoomToBoard}
            </DropdownMenu.Item>
            {!readOnly && (
              <>
                <DropdownMenu.Item className="deck-menu-item" disabled={!editable} onSelect={() => setRenaming(board.title)}>
                  {C.rename}
                </DropdownMenu.Item>
                <DropdownMenu.Item className="deck-menu-item" disabled={!editable || full} onSelect={onDuplicate}>
                  {C.duplicate}
                </DropdownMenu.Item>
                <DropdownMenu.Item className="deck-menu-item" disabled={first} onSelect={() => onMove(-1)}>
                  {C.moveUp}
                </DropdownMenu.Item>
                <DropdownMenu.Item className="deck-menu-item" disabled={last} onSelect={() => onMove(1)}>
                  {C.moveDown}
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="deck-menu-separator" />
                <DropdownMenu.Item className="deck-menu-item" data-danger onSelect={onRemove}>
                  {C.deleteBoard}
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}
