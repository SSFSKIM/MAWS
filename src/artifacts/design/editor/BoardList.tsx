// P3-E1 M3 (docs/doperpowers/plans/2026-10-16-p3-e1-design-workbench.md, M3; the parent's §1 "The workbench"): the board
// list in the rail where C's deck has its filmstrip. The boards back to front (the manifest's order) by name and size,
// held and missing ones marked; a click selects a board's frame (and makes it the board C's overlay acts on), a double
// click zooms to it; drag reorders with @dnd-kit/sortable as C's filmstrip does (the keyboard too: Space, arrows,
// Space), and each board's options zoom to it, rename it, duplicate it, move it up or down and delete it. Add board
// offers the size presets. Every gesture is one transaction and one undo step (the session's `edit`), read-only offers
// none.
import { memo, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { moveSlide } from '../../slides/model';
import { useReorderAccessibility } from '../../slides/editor/announcements';
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

const POINTER_SENSOR = { activationConstraint: { distance: 4 } };
const KEYBOARD_SENSOR = { coordinateGetter: sortableKeyboardCoordinates };

/** What a row asks of the list, by board id: one object for the list's life, so an unchanged row renders nothing. */
interface RowActions {
  select(boardId: string): void;
  zoomTo(boardId: string): void;
  duplicate(boardId: string): void;
  remove(boardId: string): void;
  rename(boardId: string, title: string): void;
  move(boardId: string, by: 1 | -1): void;
}

export function BoardList(props: BoardListProps) {
  const { session, boards, current, frame, readOnly, onAdd } = props;
  // the sensors' options one object each for the list's life: new ones would make every row's listeners new, and so
  // render every row (DL39's bounded wave)
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR), useSensor(KeyboardSensor, KEYBOARD_SENSOR));
  // DL39's bounded wave: the order's ids the same array while the order is the same (a frame write leaves it), so the
  // sortable context, and with it every row, stays as it was; each row renders on its own board's change alone
  const order = boards.map((b) => b.id).join('\u0000');
  const ids = useMemo(() => (order === '' ? [] : order.split('\u0000')), [order]);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const moveTo = (id: string, to: number) => {
    const now = latest.current.boards.map((b) => b.id);
    const from = now.indexOf(id);
    if (from < 0 || to < 0 || to >= now.length || from === to) return;
    const after = to === 0 ? null : arrayMove(now, from, to)[to - 1]!;
    session.edit((origin) => moveSlide(session.doc, id, after, origin));
  };
  const latestMove = useRef(moveTo);
  useLayoutEffect(() => {
    latestMove.current = moveTo;
  });
  const actions = useMemo<RowActions>(
    () => ({
      select: (id) => latest.current.onSelect(id),
      zoomTo: (id) => latest.current.onZoomTo(id),
      duplicate: (id) => latest.current.onDuplicate(id),
      remove: (id) => latest.current.onRemove(id),
      rename: (id, title) => latest.current.onRename(id, title),
      move: (id, by) => latestMove.current(id, latest.current.boards.findIndex((b) => b.id === id) + by),
    }),
    [],
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || readOnly) return;
    moveTo(String(active.id), ids.indexOf(String(over.id)));
  };
  // a reorder as assistive technology hears it (the filmstrip's): the boards by position and name, over the boards last
  // drawn; one object for the list's life, like the sensors' options
  const accessibility = useReorderAccessibility(ids, (id, n) => C.reorderItem(n, boards.find((b) => b.id === id)?.title ?? ''));
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={accessibility}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={readOnly}>
            <ol className="design-boards-list" aria-label={C.boardsInOrder}>
              {boards.map((b, index) => (
                <Row key={b.id} board={b} current={b.id === current} framed={b.id === frame} readOnly={readOnly} first={index === 0} last={index === boards.length - 1} full={full} actions={actions} />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {!readOnly && full && <p className="deck-filmstrip-note">{C.full(CANVAS_LIMITS.boards)}</p>}
    </nav>
  );
}

const Row = memo(function Row(props: { board: BoardView; current: boolean; framed: boolean; readOnly: boolean; first: boolean; last: boolean; full: boolean; actions: RowActions }) {
  const { board, current, framed, readOnly, first, last, full, actions } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: board.id, disabled: readOnly });
  const [renaming, setRenaming] = useState<string | null>(null);
  const editable = board.held === null && !board.missing;

  const commit = () => {
    if (renaming === null) return;
    const title = renaming.trim();
    setRenaming(null);
    // M6 final review: the board and the replica as they stand at the commit, not as they stood when the field opened
    if (readOnly || !editable) return;
    if (title !== board.title) actions.rename(board.id, title);
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
      <RowContent board={board} current={current} readOnly={readOnly} first={first} last={last} full={full} actions={actions} attributes={attributes} listeners={listeners} onRename={setRenaming} />
    </li>
  );
});

/**
 * A row's button and options (DL39's bounded wave: memoized apart from the sortable shell, which the drag-and-drop
 * context may render again; this renders on its own board's change alone).
 */
const RowContent = memo(function RowContent(props: {
  board: BoardView;
  current: boolean;
  readOnly: boolean;
  first: boolean;
  last: boolean;
  full: boolean;
  actions: RowActions;
  attributes: ReturnType<typeof useSortable>['attributes'];
  listeners: ReturnType<typeof useSortable>['listeners'];
  onRename: (title: string) => void;
}) {
  const { board, current, readOnly, first, last, full, actions, attributes, listeners, onRename } = props;
  const label = boardLabel(board);
  const editable = board.held === null && !board.missing;
  const onSelect = () => actions.select(board.id);
  const onZoomTo = () => actions.zoomTo(board.id);
  const onDuplicate = () => actions.duplicate(board.id);
  const onRemove = () => actions.remove(board.id);
  const onMove = (by: 1 | -1) => actions.move(board.id, by);

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
    <>
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
                <DropdownMenu.Item className="deck-menu-item" disabled={!editable} onSelect={() => onRename(board.title)}>
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
    </>
  );
});
