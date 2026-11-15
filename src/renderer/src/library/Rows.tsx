// The library's scrolling list (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 14): the lines the
// view gives (the "Make something new" cards, each group's heading and rows, a note) drawn through the shell's
// virtualiser, so a library of thousands mounts only what is on screen. The rows share one tab stop: the arrows move the
// keyboard between rows (Home and End to the ends), scrolling the next one into view first; Enter opens the row's
// artifact; Shift+F10 opens the row's menu (the context-menu key opens it at the row by itself). The stop is always a
// mounted row: the one the keyboard last held while it is mounted, else the first row in view; and a row holding the
// keyboard (or its menu) stays mounted while the list scrolls away from it, so focus is never dropped by the scroll.
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { openArtifactTab } from './actions';
import { LIBRARY_PAGE as P } from './copy';
import { MakeSomethingNew } from './MakeSomethingNew';
import { Row } from './Row';
import { SpaceMenu } from './SpaceDialogs';
import { showSpace } from './view';

export type Line =
  | { kind: 'make'; key: string; spaceId: string | null }
  | { kind: 'heading'; key: string; title: string; space?: LibrarySpace }
  | { kind: 'row'; key: string; row: LibraryRow }
  | { kind: 'groupEmpty'; key: string }
  | { kind: 'note'; key: string; text: string; retry?: () => void; tone?: 'quiet' | 'warning' };

const ESTIMATES: Record<Line['kind'], number> = { make: 132, heading: 36, row: 56, groupEmpty: 28, note: 72 };
const MOVES: Record<string, (at: number, last: number) => number> = {
  ArrowDown: (at, last) => Math.min(at + 1, last),
  ArrowUp: (at) => Math.max(at - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

const HEADING = 'm-0 text-ui-sm font-semibold text-fg-muted';

function GroupHeading({ title, space }: { title: string; space?: LibrarySpace }) {
  if (!space) return <h2 className={`${HEADING} px-2 pt-4 pb-1.5`}>{title}</h2>;
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-2 pt-4 pb-1.5">
      <h2 className={`${HEADING} min-w-0 truncate`}>
        <button type="button" onClick={() => showSpace(space.id)} className="truncate rounded-sm outline-accent hover:text-fg focus-visible:outline-2">
          {space.name}
        </button>
      </h2>
      <span className="shrink-0 text-ui-sm text-fg-faint tabular-nums">{space.count}</span>
      {space.linkedDir && (
        <span title={space.linkedDir} className="min-w-0 truncate text-ui-sm text-fg-faint">
          {P.linkedTo(space.linkedDir)}
        </span>
      )}
      <SpaceMenu space={space} />
    </div>
  );
}

function Note({ text, retry, tone = 'quiet' }: { text: string; retry?: () => void; tone?: 'quiet' | 'warning' }) {
  return (
    <div role={tone === 'warning' ? 'alert' : undefined} className={`flex flex-col items-start gap-2 px-2 py-6 text-ui ${tone === 'warning' ? 'text-fg' : 'text-fg-muted'}`}>
      <p className="m-0 max-w-(--measure)">{text}</p>
      {retry && (
        <button type="button" onClick={retry} className="rounded-sm border border-border-strong px-2.5 py-1 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
          {P.retry}
        </button>
      )}
    </div>
  );
}

export function Rows({ lines }: { lines: Line[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((index: number) => lines[index].key, [lines]);

  // the rows in order, and where each is among the lines
  const rowLines = useMemo(() => lines.flatMap((line, index) => (line.kind === 'row' ? [{ id: line.row.id, index }] : [])), [lines]);
  const [current, setCurrent] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null); // the row the keyboard is in (the row or one of its controls)
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [focusNext, setFocusNext] = useState<string | null>(null);

  // the lines kept mounted out of range: the focused row and the row whose menu is open
  const kept = useMemo(() => rowLines.filter((r) => r.id === focused || r.id === menuFor).map((r) => r.index), [rowLines, focused, menuFor]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const base = defaultRangeExtractor(range);
      const extra = kept.filter((index) => !base.includes(index));
      return extra.length === 0 ? base : [...base, ...extra].sort((a, b) => a - b);
    },
    [kept],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualiser's functions are read in render by design
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => ESTIMATES[lines[index].kind],
    getItemKey,
    overscan: 6,
    paddingStart: 12,
    paddingEnd: 32,
    rangeExtractor,
  });

  // the tab stop: the row the keyboard last held while it is mounted, else the first mounted row in view
  const items = virtualizer.getVirtualItems();
  const mountedRows = items.filter((item) => lines[item.index]?.kind === 'row');
  const lineId = (index: number) => (lines[index] as Extract<Line, { kind: 'row' }>).row.id;
  const top = virtualizer.scrollOffset ?? 0;
  const firstInView = mountedRows.find((item) => item.end > top) ?? mountedRows[0];
  const stop = current !== null && mountedRows.some((item) => lineId(item.index) === current) ? current : firstInView ? lineId(firstInView.index) : (rowLines[0]?.id ?? null);
  // the row the keyboard moved to, focused once it is mounted (the virtualiser scrolled it into view)
  useEffect(() => {
    if (focusNext === null) return;
    const element = scroller.current?.querySelector<HTMLElement>(`[data-artifact-row="${CSS.escape(focusNext)}"]`);
    if (!element) return;
    element.focus();
    setFocusNext(null);
  }, [focusNext, items]);

  const onRowKeyDown = (row: LibraryRow) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.defaultPrevented) return;
    if (event.key === 'F10' && event.shiftKey) setMenuFor(row.id);
    else if (event.key === 'Enter') openArtifactTab(row.id);
    else if (MOVES[event.key] && rowLines.length > 0) {
      const at = rowLines.findIndex((r) => r.id === row.id);
      const next = rowLines[MOVES[event.key](at, rowLines.length - 1)];
      setCurrent(next.id);
      virtualizer.scrollToIndex(next.index, { align: 'auto' });
      setFocusNext(next.id);
    } else return;
    event.preventDefault();
  };

  const draw = (line: Line): ReactNode => {
    switch (line.kind) {
      case 'make':
        return <MakeSomethingNew spaceId={line.spaceId} />;
      case 'heading':
        return <GroupHeading title={line.title} space={line.space} />;
      case 'groupEmpty':
        return <p className="m-0 px-2 py-1 text-ui-sm text-fg-faint">{P.emptySpaceGroup}</p>;
      case 'note':
        return <Note text={line.text} retry={line.retry} tone={line.tone} />;
      case 'row':
        return (
          <Row
            row={line.row}
            stop={stop === line.row.id}
            menuOpen={menuFor === line.row.id}
            onMenuOpen={(open) => setMenuFor(open ? line.row.id : null)}
            onFocus={() => setCurrent(line.row.id)}
            onFocusWithin={(within) => setFocused((f) => (within ? line.row.id : f === line.row.id ? null : f))}
            onKeyDown={onRowKeyDown(line.row)}
          />
        );
    }
  };

  return (
    <div ref={scroller} data-library-scroller className="min-h-0 flex-1 overflow-y-auto">
      <div className="@container mx-auto max-w-(--measure-wide) px-4">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => (
            <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} className="absolute inset-x-0 top-0" style={{ transform: `translateY(${item.start}px)` }}>
              {draw(lines[item.index])}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
