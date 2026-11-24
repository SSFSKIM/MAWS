// The outline (F9, as settled once drawn): a panel that lists a session's open questions at a glance and leads to each
// card. It shows and leads; it holds no answer, takes no draft and sends nothing: its only controls are its lines. It
// takes the model and the memory `SessionSheet` takes and draws lines alone (lines.ts). It finds the sheet's scroller by
// `[data-sheet-scroll]` and a card by `[data-sheet-question]`, and marks as current the line of the card nearest the
// column's top as the column scrolls; choosing a line is `onChoose`, which the page hands to `SessionSheet`'s `focus`,
// which brings the card into view and puts the keyboard on it.
import { useEffect, useState, type RefObject } from 'react';
import type { SheetModel } from '@shared/sheet/model';
import { SHEET_WORDS, type SheetMemory } from '../../../../src/renderer/src/sheet';
import { OUTLINE } from '../copy';
import { countLine, outlineLines, type OutlineLine } from './lines';

export interface SheetOutlineProps {
  model: SheetModel;
  memory: SheetMemory;
  sheet: RefObject<HTMLElement | null>; // what holds the session's sheet
  onChoose(id: string): void;
  drawer?: boolean;
}

// The card nearest the scroller's top: the first whose lower edge is below it
function currentOf(scroller: HTMLElement): string | null {
  const top = scroller.getBoundingClientRect().top;
  for (const card of scroller.querySelectorAll<HTMLElement>('[data-sheet-question]')) if (card.getBoundingClientRect().bottom > top + 8) return card.dataset.sheetQuestion ?? null;
  return null;
}

function Line({ line, current, onChoose }: { line: OutlineLine; current: boolean; onChoose(): void }) {
  return (
    <button
      type="button"
      data-outline-line={line.id}
      aria-current={current ? 'true' : undefined}
      onClick={onChoose}
      className="flex w-full min-w-0 flex-col rounded-sm px-2 py-1.5 text-left leading-[18px] outline-accent hover:bg-bg-hover focus-visible:outline-2 aria-[current=true]:bg-bg-active"
    >
      <span className="flex w-full min-w-0 items-baseline gap-1.5">
        <span className="w-6 flex-none text-ui-sm text-fg-faint tabular-nums">{line.id}</span>
        {line.header !== null && <span className="min-w-0 truncate font-medium text-fg">{line.header}</span>}
        {line.from !== null && <span className="shrink-0 text-ui-sm whitespace-nowrap text-fg-muted">· {SHEET_WORDS.from(line.from)}</span>}
        {line.updated && <span className="transcript-badge ml-auto shrink-0">{SHEET_WORDS.updated}</span>}
      </span>
      <span className="flex w-full min-w-0 items-baseline gap-1.5 pl-[30px] text-ui-sm text-fg-muted" data-outline-second={line.second.kind}>
        {line.second.kind === 'queued' && <span className="shrink-0">{OUTLINE.queued}</span>}
        {line.second.kind !== 'question' && (
          <span aria-hidden="true" className="shrink-0 text-fg-faint">
            →
          </span>
        )}
        <span className={`min-w-0 truncate ${line.second.kind === 'question' ? '' : 'text-fg'}`}>{line.second.text}</span>
      </span>
    </button>
  );
}

export function SheetOutline({ model, memory, sheet, onChoose, drawer = false }: SheetOutlineProps) {
  const lines = outlineLines(model, memory);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    const scroller = sheet.current?.querySelector<HTMLElement>('[data-sheet-scroll]');
    if (!scroller) return;
    let frame = 0;
    const mark = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCurrent(currentOf(scroller)));
    };
    mark();
    scroller.addEventListener('scroll', mark, { passive: true });
    addEventListener('resize', mark);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', mark);
      removeEventListener('resize', mark);
    };
  }, [sheet, model]);
  return (
    <nav
      aria-label={OUTLINE.name}
      data-sheet-outline={drawer ? 'drawer' : 'beside'}
      className={`flex w-[300px] flex-none flex-col overflow-y-auto border-r border-border bg-bg ${drawer ? 'absolute inset-y-0 left-0 z-20 shadow-float' : 'min-h-0'}`}
    >
      <p className="m-0 px-4 pt-3 pb-1.5 text-ui-sm text-fg-muted">{countLine(lines)}</p>
      <div className="flex flex-col gap-0.5 px-2 pb-3">
        {lines.map((line) => (
          <Line key={line.id} line={line} current={line.id === current} onChoose={() => onChoose(line.id)} />
        ))}
      </div>
    </nav>
  );
}
