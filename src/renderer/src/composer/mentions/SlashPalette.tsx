// The `/` palette (C7 execution document, "Mentions, palette and the "+" menu"; UX wave U4a, l3-input-06 and decision
// 17): the session's catalogue and the declared widget catalogue, a row an icon for its kind and the name, under no
// heading, in `slashItems`' order, ranked by `rank.ts`, at most 40 rows. The highlighted row, by the pointer or the arrow
// keys, shows its description, argument hint and where it comes from, or why it is greyed, in a popover beside the
// list. Choosing a row follows the one dispatch rule: a registered widget opens; a headless command is inserted as
// `/<name> ` for the engine to parse from the prompt; an unavailable row stays put.
import type { Editor, Range } from '@tiptap/core';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useRemoteUnavailable } from '../../lane-b/remote-unavailable';
import { slashItems, type SlashItem, type SlashOrigin } from './items';
import { Listbox, useListKeys, type PopupItem, type PopupProps } from './popup';
import { paletteRows, rememberChosen } from './rank';

type Row = PopupItem & { item: SlashItem };

function rowOf(item: SlashItem, openWidget: (name: string) => void): Row {
  const key = `${item.origin}:${item.name}`;
  const chosen = (then: (editor: Editor, range: Range) => void) => (editor: Editor, range: Range) => {
    rememberChosen(item.name);
    then(editor, range);
  };
  switch (item.action.kind) {
    case 'text':
      return { key, item, disabled: false, apply: chosen((editor, range) => void editor.chain().focus().insertContentAt(range, `/${item.name} `).run()) };
    case 'widget':
      return {
        key,
        item,
        disabled: false,
        apply: chosen((editor, range) => {
          editor.chain().focus().deleteRange(range).run();
          openWidget(item.name);
        }),
      };
    case 'unavailable':
      return { key, item, disabled: true, apply: () => {} };
  }
}

// One glyph per kind, each one the app already draws (transcript/view/rows/icons.tsx): a window for a panel MAWS draws
// (the anchored prompt's browser window), a terminal for a built-in command, a book for a skill, a plug for a plugin's
// command, a file for a custom command.
const KIND_PATHS: Record<SlashOrigin, string> = {
  widget: 'M2 3h12v10H2zM2 6h12M4 4.5h.01M6 4.5h.01',
  engine: 'M2 3h12v10H2zM4.5 6.5 6.5 8l-2 1.5M8 10h3',
  skills: 'M3 3h4a2 2 0 0 1 2 2v8a2 2 0 0 0-2-2H3zM13 3H9a2 2 0 0 0-2 2v8a2 2 0 0 1 2-2h4z',
  plugins: 'M6 2v3M10 2v3M4 5h8v3a4 4 0 0 1-8 0zM8 12v2',
  custom: 'M3 2h7l3 3v9H3zM10 2v4h3M5 9h6M5 11h4',
};

const KindIcon = ({ origin, muted }: { origin: SlashOrigin; muted: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" data-icon={origin} className={`size-3.5 shrink-0 ${muted ? 'text-fg-muted' : ''}`}>
    <path d={KIND_PATHS[origin]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DETAIL_ID = 'composer-slash-detail';
const FROM_MAWS = 'MAWS';
const GAP = 6; // between the list and the popover
const MARGIN = 8; // between the popover and the window's edges

// Where a row comes from, as its popover says it: MAWS for a panel, the plugin for a plugin's command; null otherwise.
const fromOf = (item: SlashItem): string | null => (item.origin === 'widget' ? FROM_MAWS : item.origin === 'plugins' ? item.name.slice(0, item.name.indexOf(':')) : null);
const reasonOf = (item: SlashItem): string | null => (item.action.kind === 'unavailable' ? item.action.hint : null);
const hasDetail = (item: SlashItem): boolean => item.description !== '' || item.argumentHint !== null || fromOf(item) !== null || reasonOf(item) !== null;

const DETAIL_WIDTH = 256; // the popover's own width (w-64), given up only where neither side of the list has it

// Which side of the list the popover opens on, and its width: the right where it fits, else the left where it fits, else
// the side with more room, narrowed to that room. `list` is the overlay's box in the window; widths and offsets in px.
export function detailSide(list: { left: number; right: number }, viewportWidth: number): { side: 'right' | 'left'; width: number } {
  const right = viewportWidth - MARGIN - (list.right + GAP);
  const left = list.left - GAP - MARGIN;
  if (right >= DETAIL_WIDTH) return { side: 'right', width: DETAIL_WIDTH };
  if (left >= DETAIL_WIDTH) return { side: 'left', width: DETAIL_WIDTH };
  return right >= left ? { side: 'right', width: Math.max(0, right) } : { side: 'left', width: Math.max(0, left) };
}

// The popover's top in the overlay: at the row's height, kept inside the window's height.
export function detailTop(listTop: number, rowTop: number, height: number, viewportHeight: number): number {
  return Math.max(MARGIN - listTop, Math.min(rowTop - listTop, viewportHeight - MARGIN - height - listTop));
}

// The popover of the highlighted row, beside the list at that row's height (decision 17 g). It is a child of the popup's
// own fixed overlay (popup.tsx), positioned absolutely in it, so it takes no place in any layout and moves with the list;
// it opens on the side of the list that has room (`detailSide`) and stays inside the window. Placed again when the list
// scrolls and once the overlay itself has been placed.
function Detail({ item, rowId }: { item: SlashItem; rowId: string }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const detail = box.current;
    const row = document.getElementById(rowId);
    const list = row?.closest<HTMLElement>('[role="listbox"]');
    const overlay = list?.parentElement;
    if (!detail || !row || !list || !overlay) return;
    const place = () => {
      const frame = overlay.getBoundingClientRect();
      const { side, width } = detailSide(frame, window.innerWidth);
      const beside = `calc(100% + ${GAP}px)`;
      Object.assign(detail.style, { width: `${width}px`, left: side === 'right' ? beside : 'auto', right: side === 'left' ? beside : 'auto' });
      // the height read once the width is set, since a narrower popover wraps to more lines
      detail.style.top = `${detailTop(frame.top, row.getBoundingClientRect().top, detail.offsetHeight, window.innerHeight)}px`;
    };
    place();
    const placed = requestAnimationFrame(place);
    list.addEventListener('scroll', place);
    return () => {
      cancelAnimationFrame(placed);
      list.removeEventListener('scroll', place);
    };
  }, [item, rowId]);
  const from = reasonOf(item) === null ? fromOf(item) : null;
  return (
    <div
      ref={box}
      id={DETAIL_ID}
      role="tooltip"
      onMouseDown={(event) => event.preventDefault()} // as the list: the focus stays in the editor
      className="absolute w-64 rounded-md break-words border border-border-strong bg-bg-overlay p-2 text-ui-sm text-fg"
    >
      {item.description !== '' && <p className="m-0 line-clamp-10 whitespace-pre-line">{item.description}</p>}
      {item.argumentHint !== null && <p className="m-0 mt-1 font-mono break-words text-fg-faint">{item.argumentHint}</p>}
      {from !== null && <p className="m-0 mt-1 text-fg-faint">{from}</p>}
      {reasonOf(item) !== null && <p className="m-0 mt-1 text-warning">{reasonOf(item)}</p>}
    </div>
  );
}

export function SlashPalette(props: PopupProps) {
  const { appSessionId, catalog, widgets, openWidget } = props.ctx;
  // decision 18: `/fork` on another machine, greyed with U9's sentence while it cannot fork there
  const forkRefused = useRemoteUnavailable(appSessionId, 'session.fork');
  const all = useMemo(() => slashItems(catalog, widgets, forkRefused === null ? {} : { fork: forkRefused }), [catalog, widgets, forkRefused]);
  const rows = useMemo(() => paletteRows(props.query, all).map((item) => rowOf(item, (name) => openWidget(name, ''))), [all, props.query, openWidget]);
  const { active, setActive, choose } = useListKeys(props, rows);
  const optionId = (i: number) => `composer-slash-${i}`;
  if (rows.length === 0) return null;
  const highlighted = rows[active].item;
  const detail = hasDetail(highlighted);
  return (
    <>
      <Listbox label="Commands" activeId={optionId(active)} size="slash" revealKey={rows}>
        {rows.map((row, index) => (
          <div
            key={row.key}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            aria-disabled={row.disabled || undefined}
            aria-describedby={index === active && detail ? DETAIL_ID : undefined}
            data-origin={row.item.origin}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(row)}
            className={`flex min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1 ${index === active ? 'bg-bg-active' : ''} ${row.disabled ? 'text-fg-faint' : ''}`}
          >
            <KindIcon origin={row.item.origin} muted={!row.disabled} />
            <span className="min-w-0 truncate">{row.item.title}</span>
          </div>
        ))}
      </Listbox>
      {detail && <Detail item={highlighted} rowId={optionId(active)} />}
    </>
  );
}
