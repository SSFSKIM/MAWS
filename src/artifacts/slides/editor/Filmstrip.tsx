// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Filmstrip"; M4): the deck's slides as live
// thumbnails (each a SlideCanvas patched from the same change records as the stage), the outline's sections as headers
// (rename in place, add at a slide, remove), drag reorder with @dnd-kit/sortable (the keyboard reorders too: Space to
// lift, arrows to move, Space to drop), and the slide gestures: new (blank, after the current slide), duplicate, hide,
// delete. Hidden slides are dimmed; held slides badged with their reasons. Every gesture is one transaction and one
// undo step (the session's `edit`).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { DropdownMenu } from 'radix-ui';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AssetUrl, SlideCanvas } from '../canvas';
import { insertSlide, moveSlide, setAttrs, ROOT } from '../model';
import { blankSlide, duplicateSlide, mintSectionKey, mintSlideId, removeSlide, setSection } from '../writers';
import type { DeckView, SectionHeader, SlideEntry } from './deck-view';
import type { DeckSession } from './session';
import { SLIDE_W, SlideView } from './SlideView';
import { DECK_COPY as C } from './copy';

export interface FilmstripProps {
  session: DeckSession;
  view: DeckView;
  current: string | null;
  assetUrl: AssetUrl;
  /** The thumbnail's width in px (1/8 of the slide in a main tab, narrower in the panel). */
  width: number;
  readOnly: boolean;
  /** Once, when every thumbnail of the first showing is drawn (how many). */
  onDrawn?: (thumbnails: number) => void;
}

export function Filmstrip({ session, view, current, assetUrl, width, readOnly, onDrawn }: FilmstripProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = view.slides.map((s) => s.id);
  const scale = width / SLIDE_W;

  // every thumbnail of the first showing laid out: reported once
  const canvases = useRef(new Map<string, SlideCanvas>());
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current || !onDrawn) return;
    reported.current = true;
    const shown = [...canvases.current.values()];
    void Promise.all(shown.map((c) => c.whenLaidOut())).then(() => onDrawn(shown.length));
  }, [onDrawn]);

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || readOnly) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    const after = to === 0 ? null : arrayMove(ids, from, to)[to - 1]!;
    session.edit((origin) => moveSlide(session.doc, String(active.id), after, origin));
  };

  const addSlide = () => {
    const id = mintSlideId(session.doc);
    session.edit((origin) => insertSlide(session.doc, blankSlide(id), current ?? ids.at(-1) ?? null, origin));
    session.show(id);
  };

  const headersBefore = (id: string) => view.sections.filter((s) => s.before === id);
  return (
    <nav className="deck-filmstrip" aria-label={C.filmstrip} style={{ width: width + 40 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={readOnly}>
          <ol className="deck-filmstrip-list" aria-label={C.slides}>
            {view.slides.map((slide, index) => (
              <li key={slide.id} className="deck-filmstrip-item">
                {headersBefore(slide.id).map((header) => (
                  <SectionTitle key={header.key} session={session} header={header} readOnly={readOnly} />
                ))}
                <Thumbnail
                  session={session}
                  slide={slide}
                  index={index}
                  current={slide.id === current}
                  scale={scale}
                  assetUrl={assetUrl}
                  readOnly={readOnly}
                  startsSection={view.sections.some((s) => s.before === slide.id && !s.empty)}
                  onCanvas={(canvas) => (canvas ? canvases.current.set(slide.id, canvas) : canvases.current.delete(slide.id))}
                />
              </li>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {!readOnly && (
        <button type="button" className="deck-button deck-new-slide" onClick={addSlide}>
          {C.newSlide}
        </button>
      )}
    </nav>
  );
}

function Thumbnail(props: {
  session: DeckSession;
  slide: SlideEntry;
  index: number;
  current: boolean;
  scale: number;
  assetUrl: AssetUrl;
  readOnly: boolean;
  startsSection: boolean;
  onCanvas: (canvas: SlideCanvas | null) => void;
}) {
  const { session, slide, index, current, scale, assetUrl, readOnly, startsSection, onCanvas } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id, disabled: readOnly });
  const doc = session.doc;
  const label = C.slideLabel(index + 1, slide.hidden, slide.held !== null);

  const duplicate = () => {
    if (slide.held) return;
    const id = mintSlideId(doc);
    session.edit((origin) => duplicateSlide(doc, slide.id, id, origin));
    session.show(id);
  };
  const toggleHidden = () => session.edit((origin) => setAttrs(doc, slide.id, ROOT, { hidden: slide.hidden ? null : '' }, origin));
  const remove = () => session.edit((origin) => removeSlide(doc, slide.id, origin));
  const addSection = () => session.edit((origin) => setSection(doc, mintSectionKey(doc), { description: C.newSection, start: slide.id }, origin));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (readOnly) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
    } else if (event.key === 'd' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      duplicate();
    }
  };

  return (
    <div
      ref={setNodeRef}
      className="deck-thumb"
      data-slide-thumb={slide.id}
      data-current={current || undefined}
      data-hidden={slide.hidden || undefined}
      data-held={slide.held ? '' : undefined}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <span className="deck-thumb-number" aria-hidden>
        {index + 1}
      </span>
      <button
        type="button"
        className="deck-thumb-button"
        aria-label={label}
        aria-current={current ? 'true' : undefined}
        title={slide.held ? C.heldTitle(slide.held) : undefined}
        onClick={() => session.show(slide.id)}
        onFocus={() => session.show(slide.id)}
        {...attributes}
        {...listeners}
        onKeyDown={(event) => {
          onKeyDown(event);
          if (!event.defaultPrevented) (listeners?.onKeyDown as ((e: KeyboardEvent<HTMLElement>) => void) | undefined)?.(event);
        }}
      >
        <SlideView doc={doc} slideId={slide.id} token={slide.token} assetUrl={assetUrl} scale={scale} onCanvas={onCanvas} />
        {slide.held && <span className="deck-thumb-badge">{C.held}</span>}
        {slide.hidden && <span className="deck-thumb-badge deck-thumb-badge-quiet">{C.hiddenBadge}</span>}
      </button>
      {!readOnly && (
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="deck-thumb-menu" aria-label={C.slideOptions(index + 1)}>
              <span aria-hidden>⋯</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="start" sideOffset={4} className="deck-menu">
              <DropdownMenu.Item className="deck-menu-item" disabled={slide.held !== null} onSelect={duplicate}>
                {C.duplicate}
              </DropdownMenu.Item>
              <DropdownMenu.Item className="deck-menu-item" onSelect={toggleHidden}>
                {slide.hidden ? C.show : C.hide}
              </DropdownMenu.Item>
              {!startsSection && (
                <DropdownMenu.Item className="deck-menu-item" onSelect={addSection}>
                  {C.addSection}
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Separator className="deck-menu-separator" />
              <DropdownMenu.Item className="deck-menu-item" data-danger onSelect={remove}>
                {C.deleteSlide}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

function SectionTitle({ session, header, readOnly }: { session: DeckSession; header: SectionHeader; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(header.description);
  const commit = () => {
    setEditing(false);
    const description = draft.trim();
    if (description === header.description || description === '') return;
    const entry = header.empty ? { description, before: header.before } : { description, start: header.before };
    session.edit((origin) => setSection(session.doc, header.key, entry, origin));
  };
  if (editing) {
    return (
      <input
        className="deck-section-input"
        aria-label={C.sectionName}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          else if (event.key === 'Escape') setEditing(false);
          event.stopPropagation();
        }}
      />
    );
  }
  return (
    <div className="deck-section" data-section-key={header.key} data-empty={header.empty || undefined}>
      <span className="deck-section-title">{header.description || C.untitledSection}</span>
      {!readOnly && (
        <span className="deck-section-actions">
          <button
            type="button"
            className="deck-icon-button"
            aria-label={C.renameSection(header.description)}
            onClick={() => {
              setDraft(header.description);
              setEditing(true);
            }}
          >
            {C.rename}
          </button>
          <button type="button" className="deck-icon-button" aria-label={C.removeSection(header.description)} onClick={() => session.edit((origin) => setSection(session.doc, header.key, null, origin))}>
            ×
          </button>
        </span>
      )}
    </div>
  );
}
