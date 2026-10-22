// MAWS's grouped palette and list keyboard, adapted to the desk's textarea (no Tiptap dependency).
import { useLayoutEffect, useRef } from 'react';
import { ORIGIN_LABEL, ORIGIN_ORDER, type SlashItem } from '../../conversation/catalog';
import { latency } from '../../latency/latency';
export function groupedItems(ranked: SlashItem[]): SlashItem[] { return ORIGIN_ORDER.flatMap((origin) => ranked.filter((item) => item.origin === origin)); }
export function SlashPalette({ id, rows, active, setActive, pick, stamp, note, opened }: {
  id: string; rows: SlashItem[]; active: number; setActive(index: number): void; pick(item: SlashItem): void;
  stamp: string | null; note: string | null; opened: number | null;
}) {
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (opened !== null) latency.record('palette.open', performance.now() - opened);
  }, [opened]);
  useLayoutEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !list.current) return;
    const box = list.current.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < box.top) list.current.scrollTop -= box.top - at.top;
    else if (at.bottom > box.bottom) list.current.scrollTop += at.bottom - box.bottom;
  }, [active, rows]);
  return <div className="absolute inset-x-4 bottom-full z-20 mb-1 max-w-[32rem] rounded-md border border-border-strong bg-bg-overlay p-1 text-ui text-fg shadow-lg" data-testid="slash-palette">
    {(stamp || note) && <p className="m-0 border-b border-border px-2 py-1 text-ui-sm text-fg-muted">{[stamp, note].filter(Boolean).join(' · ')}</p>}
    <div ref={list} id={id} role="listbox" aria-label="Commands" className="max-h-[min(24rem,45vh)] overflow-y-auto" onMouseDown={(event) => event.preventDefault()}>
      {ORIGIN_ORDER.map((origin) => {
        const entries = rows.map((item, index) => ({ item, index })).filter(({ item }) => item.origin === origin);
        if (!entries.length) return null;
        return <div key={origin} role="group" aria-label={ORIGIN_LABEL[origin]}>
          <div className="px-2 pb-0.5 pt-1.5 text-ui-sm text-fg-muted">{ORIGIN_LABEL[origin]}</div>
          {entries.map(({ item, index }) => <div key={item.name} id={`${id}-${index}`} role="option" aria-selected={active === index} aria-disabled={item.action.kind === 'unavailable' || undefined} data-origin={origin}
            onMouseEnter={() => setActive(index)} onMouseDown={(event) => { event.preventDefault(); pick(item); }}
            className={`min-h-10 cursor-default rounded-sm px-2 py-1 ${active === index ? 'bg-bg-active outline outline-1 outline-accent' : ''}`}>
            <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{item.title}</span>{item.argumentHint && <span className="text-ui-sm text-fg-muted">{item.argumentHint}</span>}</div>
            <div className="text-ui-sm text-fg-muted">{item.description}</div>
            {item.action.kind === 'unavailable' && <div className="text-ui-sm text-fg-muted">{item.action.hint}</div>}
            {item.note && <div className="text-ui-sm text-fg-muted">{item.note}</div>}
          </div>)}
        </div>;
      })}
      {rows.length === 0 && <p className="m-0 px-2 py-2 text-ui-sm text-fg-muted">No matching commands</p>}
    </div>
  </div>;
}
