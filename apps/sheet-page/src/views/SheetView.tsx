// A session's sheet in the page (frame 3, frame 6; §P, "How SessionSheet is laid out"; F9). C3's `SessionSheet` at full
// density, given the whole width the outline leaves and the height under the bar, so its foot's band and its scrollbar
// reach the window's edge, while the page's stylesheet keeps its cards and its foot's content one centred column (by
// the two attributes `[data-sheet-scroll]` and `[data-sheet-foot]`, app.css). The memory is the session's stored one
// (T19), every change an update bound to the session. What stands in Send's place is availability.ts's. The outline
// stands beside the column on a wide window and is a drawer over the whole sheet under the bar on a narrow one, the sheet
// under it inert while it is open; a line chosen focuses its card, and Escape gives focus back to the outline's button. A
// `null` model (no record, or a path that names none) is the page's own empty state; until a read is applied nothing is
// drawn.
import { useEffect, useRef, useState } from 'react';
import type { DoorState } from '@shared/ipc/schema/sheet';
import type { SheetModel } from '@shared/sheet/model';
import { SessionSheet, type SheetHost, type SheetMemory } from '../../../../src/renderer/src/sheet';
import { sendUnavailable } from '../availability';
import { PAGE, VIEWS } from '../copy';
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
  return <Sheet key={shown.model.session} model={shown.model} fresh={shown.fresh} {...rest} />;
}

function Sheet({ model, fresh, door, connection, host, outline }: Omit<SheetViewProps, 'shown' | 'navigate'> & { model: SheetModel; fresh: boolean }) {
  const { memory, elsewhereSince, update } = useSessionMemory(model.session);
  // every change is made against this model: a removal only of what it knows, and its reconcile only while no tab has
  // reconciled against a newer one (T19)
  const onMemory = (change: (current: SheetMemory) => SheetMemory) => update(change, against(model));
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
