// A session's sheet in the page (frame 3, frame 6; §P, "How SessionSheet is laid out"; F9). C3's `SessionSheet` at full
// density, given the whole width the outline leaves and the height under the bar, so its foot's band and its scrollbar
// reach the window's edge, while the page's stylesheet keeps its cards and its foot's content one centred column (by
// the two attributes `[data-sheet-scroll]` and `[data-sheet-foot]`, app.css). The memory is the session's stored one
// (T19), every change an update bound to the session. What stands in Send's place is availability.ts's. The outline
// stands beside the column on a wide window and is a drawer over the whole sheet under the bar on a narrow one, the sheet
// under it inert while it is open; a line chosen focuses its card, and Escape gives focus back to the outline's button. A
// `null` model (no record, or a path that names none) is the page's own empty state; until a read is applied nothing is
// drawn. A draft too long for the browser's storage, held in this tab alone, is said once, at the sheet's head where its
// notes stand, and there too a press the storage had no room to keep, which was therefore not sent.
import { useEffect, useRef, useState } from 'react';
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetModel } from '@shared/sheet/model';
import { reconcile, SessionSheet, type SheetHost, type SheetMemory } from '../../../../src/renderer/src/sheet';
import { writeReconciled, type StoredBaseline } from '../memory';
import { sendUnavailable } from '../availability';
import { PAGE, SEND, VIEWS } from '../copy';
import type { Connection } from '../live';
import { SheetOutline } from '../outline/SheetOutline';
import type { Outline } from '../outline/state';
import { pathOf, type Place } from '../route';
import type { StoreState } from '../store';
import { against, useSessionMemory } from './useMemory';

export interface SheetViewProps {
  shown: NonNullable<StoreState['shown']>;
  door: DoorState | null;
  connection: Connection;
  host: SheetHost;
  outline: Outline;
  navigate(place: Place): void;
  adopted(session: string): void; // this tab adopted another tab's write of the session's memory (the store reads again)
}

export function SheetView({ shown, navigate, ...rest }: SheetViewProps) {
  if (shown.model === undefined) return null;
  if (shown.model === null) {
    const overview: Place = { at: 'overview' };
    return (
      <div data-sheet-empty="" className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center text-fg-muted">
        <p className="m-0">{VIEWS.noSession}</p>
        <a
          href={pathOf(overview)}
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate(overview);
          }}
          className="rounded-sm text-accent underline underline-offset-2 outline-accent focus-visible:outline-2"
        >
          {PAGE.allSessions}
        </a>
      </div>
    );
  }
  return <Sheet key={shown.model.session} model={shown.model} fresh={shown.fresh} settled={shown.settled} baseline={shown.baseline ?? null} {...rest} />;
}

function Sheet({ model, fresh, settled, baseline, door, connection, host, outline, adopted }: Omit<SheetViewProps, 'shown' | 'navigate'> & { model: SheetModel; fresh: boolean; settled: boolean; baseline: StoredBaseline | null }) {
  const { memory: stored, elsewhereSince, unkept, noRoom, update } = useSessionMemory(model.session);
  // What the tab shows is its own reconcile of the stored memory against its model, so SessionSheet's finds nothing to
  // do and every change it asks for is the person's or a Send's, applied to that view and written as what it changes;
  // reconcile's own changes are written only while the model was read after this tab last adopted another tab's write
  // (§P, "What a tab writes of `reconcile`"; T19)
  const memory = reconcile(stored, model);
  const onMemory = (change: (current: SheetMemory) => SheetMemory) => update(change, against(model));
  useEffect(() => {
    if (memory === stored) return;
    // what the view changed of the memory it was made from; an entry another tab changed since, not yet adopted, is
    // left, and the model is read again. A removal is judged against the memory stored when the model's read started
    // (the store's baseline), never only against what the view read at render (B1)
    const { conflict } = writeReconciled(model.session, stored, memory, settled, { known: against(model).known, baseline });
    if (conflict) adopted(model.session);
  }, [memory, stored, model, settled, baseline, adopted]);
  const [now, setNow] = useState(() => Date.now()); // moved on by the timer below; an older `now` only holds Send back until it fires
  const { text, until } = sendUnavailable({ connection, fresh, door, elsewhereSince, now });
  useEffect(() => {
    if (until === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()));
    return () => clearTimeout(timer);
  }, [until]);

  const holder = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<{ id: string; request: number } | null>(null);
  const choose = (id: string) => {
    setFocus((was) => ({ id, request: (was?.request ?? 0) + 1 }));
    outline.close();
  };
  const drawer = !outline.wide && outline.open;
  useEffect(() => {
    if (!drawer) return;
    // Escape closes the drawer and gives focus back to the button that opened it
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      outline.close();
      document.querySelector<HTMLElement>('[data-outline-toggle]')?.focus();
    };
    addEventListener('keydown', escape);
    return () => removeEventListener('keydown', escape);
  }, [drawer, outline]);

  const panel = (inDrawer: boolean) => <SheetOutline model={model} memory={memory} sheet={holder} onChoose={choose} drawer={inDrawer} />;
  return (
    <div data-sheet-page="" className="relative flex min-h-0 flex-1">
      {outline.wide && outline.open && panel(false)}
      <div ref={holder} inert={drawer} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {(noRoom || unkept) && (
          <div data-sheet-page-note="" className="shrink-0 pt-3">
            <p role="status" className="m-0 rounded-sm border border-border-strong bg-bg-raised px-2.5 py-1 text-fg">
              {noRoom ? SEND.noRoom : SEND.tooLong}
            </p>
          </div>
        )}
        <SessionSheet model={model} memory={memory} onMemory={onMemory} host={host} focus={focus} unavailable={text} />
      </div>
      {drawer && (
        <>
          <div data-sheet-scrim="" aria-hidden="true" onClick={outline.close} className="absolute inset-0 z-10 bg-fg/24" />
          {panel(true)}
        </>
      )}
    </div>
  );
}
