// The source sheet (P3-E2 M3; parent §2 "Views": the source label opens it; the header's Datasets action too): the
// keyboard's and a screen reader's way to a view's data. A sibling of the editor, drawn over the page's right edge as
// MAWS's own transient UI (the app's tokens, never the document's), it shows a dataset as the tab captured it when it
// opened: the source label, the description and validation notes, the columns with their types, every row of the
// snapshot that descriptor names in a virtual table (the whole snapshot, read by its ref and format through the tab's
// reader; sortable by a column, copyable as TSV; a bounded number of rows in the page at any size), and Download, main's
// Save of the snapshot's own bytes under its source name. A replacement while it is open leaves it on its snapshot until
// it is opened again. Escape or Close closes it and gives the focus back to what opened it. E3 M3: a query dataset's
// captured snapshot has the tab's live query block beside it (./LiveQuery.tsx), never over a history preview.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactHost } from '../../host';
import { snapshotOf, type Cell, type DatasetDescriptor } from '../datasets';
import { compareCells, viewRows, type ViewTable } from '../render';
import { mismatchNotes, sourceLabel, VIEW_STATES } from '../states';
import type { SheetDataset, SourceSheetSnapshot, SourceSheetState } from './sheet';
import type { SnapshotReader } from '../snapshots';
import type { LiveDatasets } from './live'; // E3
import { LiveQuery } from './LiveQuery'; // E3
import { toTsv } from './tsv';
import './sheet.css';

const ROW_H = 28; // px, every row one line
const OVERSCAN = 10;
const VIEWPORT_FALLBACK = 480; // px, before the scroller is measured

const TYPE_NAMES: Record<string, string> = { string: 'text', number: 'number', boolean: 'true or false', date: 'date', null: 'empty' };
const cellText = (value: Cell | undefined): string => (value === null || value === undefined ? '' : String(value));
const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

export interface SourceSheetProps {
  artifactId: string;
  sheet: SourceSheetState;
  reader: SnapshotReader;
  host: Pick<ArtifactHost, 'downloadAsset'>;
  actorName(actor: Actor): string;
  /** E3 M3: the tab's live datasets (the live query block's status and gestures), and its reopening on the current
   * capture of a dataset (`Show latest`, `Show current`). */
  live?: LiveDatasets;
  onReopen?(id: string): void;
}

export function SourceSheet({ artifactId, sheet, reader, host, actorName, live, onReopen }: SourceSheetProps) {
  const state = useSyncExternalStore(sheet.subscribe, sheet.snapshot);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  // The focus moves into the sheet at each opening and back to what had it when the sheet closes.
  useLayoutEffect(() => {
    if (!state.open) return;
    if (!panel.current?.contains(document.activeElement)) opener.current = document.activeElement;
    panel.current?.querySelector<HTMLElement>('.dash-sheet-close')?.focus();
  }, [state.open, state.opened]);
  useLayoutEffect(() => {
    if (state.open) return;
    const back = opener.current;
    opener.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }, [state.open]);

  if (!state.open) return null;
  const shown = state.datasets.find((dataset) => dataset.id === state.selected) ?? null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    sheet.close();
  };
  return (
    <aside ref={panel} className="dash-sheet" role="dialog" aria-label={shown ? `Source of ${shown.descriptor.title}` : 'Datasets'} onKeyDown={onKeyDown}>
      <header className="dash-sheet-header">
        <h2 className="dash-sheet-title">{shown ? shown.descriptor.title : 'Datasets'}</h2>
        <button type="button" className="dash-sheet-close doc-tool" onClick={() => sheet.close()}>
          Close
        </button>
      </header>
      {state.datasets.length > 1 && (
        <label className="dash-sheet-picker">
          <span>Dataset</span>
          <select className="doc-toolbar-select" aria-label="Dataset" value={state.selected ?? ''} onChange={(event) => sheet.select(event.target.value)}>
            {state.datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.descriptor.title} ({dataset.id})
              </option>
            ))}
          </select>
        </label>
      )}
      {shown ? (
        <DatasetDetail key={`${state.opened}:${state.capture}:${shown.id}`} artifactId={artifactId} id={shown.id} descriptor={shown.descriptor} view={shown.view} hold={state.hold} reader={reader} host={host} actorName={actorName} live={state.preview || state.previewing ? undefined : live /* E3 M3 fix: no live controls while a preview runs */} onReopen={onReopen} />
      ) : (
        <p className="dash-sheet-empty">No data is bound to this dashboard yet. An agent binds a file with artifact_dataset.</p>
      )}
    </aside>
  );
}

type Sort = { column: number; dir: 'ascending' | 'descending' } | null;

// What the rows show: the view's transformed rows (after its filter, aggregation, sort and limit, complete), or the whole
// snapshot as bound. A sheet opened from the header, on no view, shows the snapshot alone.
type Shown = 'view' | 'source';

function DatasetDetail({ artifactId, id, descriptor, view, hold, reader, host, actorName, live, onReopen }: { artifactId: string; id: string; descriptor: DatasetDescriptor; view?: SheetDataset['view']; hold: SourceSheetSnapshot['hold'] } & Pick<SourceSheetProps, 'reader' | 'host' | 'actorName' | 'live' | 'onReopen'>) {
  const [source, setSource] = useState<ViewTable | null>(null);
  const [shown, setShown] = useState<Shown>(view ? 'view' : 'source');
  const [failed, setFailed] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>(null);
  const [status, setStatus] = useState('');
  const snapshot = useMemo(() => snapshotOf(descriptor), [descriptor]); // E3: null for a query never fetched
  useEffect(() => {
    if (!snapshot || hold !== 'held') return; // E3: nothing read before the captured snapshot is held
    let current = true;
    reader.read(snapshot).then(
      (read) => current && setSource(read),
      (error: unknown) => current && setFailed(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      current = false;
    };
  }, [reader, snapshot, hold]);
  // P3-F: the hold gates what was read as it gates the reading. A hold lost while open (pending its recapture, or
  // unavailable) withholds the rows read under it, and its read's failure, from the table and Copy rows alike.
  const held = hold === 'held';
  const rows = held ? source : null;
  // the view's rows: the interpretation the view itself draws (renderView's transform), never a second one
  const viewed = useMemo(() => (view && rows ? viewRows(view.spec, rows, id) : null), [view, rows, id]);
  const table = shown === 'view' ? (viewed?.ok ? viewed.table : null) : rows;
  const order = useMemo(() => {
    if (!table) return [];
    const indexes = table.rows.map((_, i) => i);
    if (!sort) return indexes;
    const column = table.columns[sort.column];
    const sign = sort.dir === 'ascending' ? 1 : -1;
    return indexes.sort((a, b) => compareCells(table.rows[a][sort.column] ?? null, table.rows[b][sort.column] ?? null, column, sign) || a - b);
  }, [table, sort]);
  const choose = (next: Shown) => {
    setShown(next);
    setSort(null);
  };
  const cycle = (column: number) => setSort((now) => (now?.column !== column ? { column, dir: 'ascending' } : now.dir === 'ascending' ? { column, dir: 'descending' } : null));
  const copy = async () => {
    if (!table) return;
    const text = toTsv([table.columns.map((c) => c.name), ...order.map((i) => table.rows[i].map(cellText))]);
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`Copied ${order.length.toLocaleString('en-US')} ${order.length === 1 ? 'row' : 'rows'}`);
    } catch (error) {
      setStatus(`Not copied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const name = descriptor.source.kind === 'file' ? descriptor.source.name : `${id}.json`;
  const download = async () => {
    if (!snapshot) return;
    setStatus('');
    try {
      const { path } = await host.downloadAsset(artifactId, snapshot.ref, { name });
      setStatus(path ? `Saved to ${baseName(path)}` : '');
    } catch (error) {
      setStatus(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <div className="dash-sheet-body">
      <p className="dash-sheet-label">{sourceLabel(descriptor, descriptor.updated ? actorName(descriptor.updated.by) : '')}</p>
      {descriptor.description && <p className="dash-sheet-description">{descriptor.description}</p>}
      {live && descriptor.source.kind === 'query' && <LiveQuery id={id} title={descriptor.title} captured={descriptor.source} live={live} onReopen={onReopen} /> /* E3 M3 */}
      {mismatchNotes(descriptor).map((note) => (
        <p key={note} className="dash-sheet-note">
          {note}
        </p>
      ))}
      <ul className="dash-sheet-columns" aria-label="Columns">
        {descriptor.columns.map((column) => (
          <li key={column.name}>
            <span className="dash-sheet-column">{column.name}</span> <span className="dash-sheet-type">{TYPE_NAMES[column.type] ?? column.type}</span>
            {descriptor.rowKey === column.name && <span className="dash-sheet-type"> · row key</span>}
          </li>
        ))}
      </ul>
      {view && snapshot && (
        <div className="dash-sheet-shown" role="group" aria-label="Rows shown">
          <button type="button" className="doc-tool" aria-pressed={shown === 'view'} data-active={shown === 'view' ? '' : undefined} onClick={() => choose('view')}>
            {viewed?.ok ? `This view’s rows (${viewed.table.rows.length.toLocaleString('en-US')})` : 'This view’s rows'}
          </button>
          <button type="button" className="doc-tool" aria-pressed={shown === 'source'} data-active={shown === 'source' ? '' : undefined} onClick={() => choose('source')}>
            {`All source rows (${descriptor.rows.toLocaleString('en-US')})`}
          </button>
        </div>
      )}
      <div className="dash-sheet-actions">
        <span className="dash-sheet-count">{shown === 'view' && view ? `${view.caption}: ${table ? `${table.rows.length.toLocaleString('en-US')} ${table.rows.length === 1 ? 'row' : 'rows'}` : '…'}` : `${descriptor.rows.toLocaleString('en-US')} ${descriptor.rows === 1 ? 'row' : 'rows'}`}</span>
        <button type="button" className="doc-tool" disabled={!table} onClick={() => void copy()}>
          Copy rows
        </button>
        {snapshot && hold !== 'unavailable' && (
          <button type="button" className="doc-tool" aria-label={`Download ${name}`} disabled={hold !== 'held'} onClick={() => void download()}>
            Download
          </button>
        )}
      </div>
      <p className="dash-sheet-status" role="status">
        {status}
      </p>
      {shown === 'view' &&
        viewed?.ok &&
        viewed.notes.map((note) => (
          <p key={note} className="dash-sheet-note">
            {note}
          </p>
        ))}
      {!snapshot ? (
        <p className="dash-sheet-note">This query has not been fetched yet; there are no rows to show.</p>
      ) : hold === 'unavailable' ? (
        <p className="dash-sheet-note" role="alert">This snapshot is no longer available; open the source again to see the current one.</p>
      ) : held && failed !== null ? (
        <p className="dash-sheet-note" role="alert">{`The rows could not be read: ${failed}`}</p>
      ) : shown === 'view' && viewed && !viewed.ok ? (
        <p className="dash-sheet-note" role="alert">{`This view cannot be drawn: ${viewed.error}`}</p>
      ) : table === null ? (
        <p className="dash-sheet-loading">Reading the rows…</p>
      ) : (
        <Rows key={shown} table={table} order={order} sort={sort} onSort={cycle} overflowed={shown === 'view' && viewed?.ok ? viewed.overflowed : undefined} />
      )}
    </div>
  );
}

// The rows as a table whose body draws only the rows in view (and a few beyond), each ROW_H high, over a spacer as tall
// as all of them, so the page holds a bounded number of rows at any snapshot size. One element scrolls both ways, the
// head sticking at its top, so the head's columns and the rows' always line up. A view's aggregate that overflowed reads
// "overflow" in its cell (the note above says which), and copies as the empty field it holds.
function Rows({ table, order, sort, onSort, overflowed }: { table: ViewTable; order: number[]; sort: Sort; onSort(column: number): void; overflowed?: (row: number, column: number) => boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(VIEWPORT_FALLBACK);
  // The scroller is flex-sized, so its height follows the window: measured on mount, then again whenever it resizes, once
  // a frame however many resizes land in it (E2 panel); the observer and a pending frame end with the rows.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const measure = () => {
      if (box.clientHeight > 0) setHeight(box.clientHeight);
    };
    measure();
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);
  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const last = Math.min(order.length, Math.ceil((top + height) / ROW_H) + OVERSCAN);
  const template = `repeat(${table.columns.length}, minmax(calc(var(--space) * 28), 1fr))`;
  const width = `calc(var(--space) * 28 * ${table.columns.length})`; // every column at least its minimum, the head's and the rows' alike
  return (
    <div ref={scroller} className="dash-sheet-table" role="table" aria-label="Rows" aria-rowcount={order.length + 1} aria-colcount={table.columns.length} tabIndex={0} onScroll={(event) => setTop(event.currentTarget.scrollTop)}>
      <div role="rowgroup" className="dash-sheet-head" style={{ minWidth: width }}>
        <div role="row" aria-rowindex={1} className="dash-sheet-row" style={{ gridTemplateColumns: template }}>
          {table.columns.map((column, i) => (
            <div key={column.name} role="columnheader" aria-sort={sort?.column === i ? sort.dir : 'none'} className="dash-sheet-cell">
              <button type="button" className="dash-sheet-sort" aria-label={`Sort by ${column.name}`} onClick={() => onSort(i)}>
                {column.name}
                <span aria-hidden="true">{sort?.column === i ? (sort.dir === 'ascending' ? ' ↑' : ' ↓') : ''}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
      <div role="rowgroup" className="dash-sheet-rows" style={{ height: order.length * ROW_H, minWidth: width }}>
        {order.slice(first, last).map((index, k) => (
          <div key={index} role="row" aria-rowindex={first + k + 2} className="dash-sheet-row" style={{ gridTemplateColumns: template, position: 'absolute', top: (first + k) * ROW_H, height: ROW_H, left: 0, right: 0 }}>
            {table.columns.map((column, c) => (
              <div key={column.name} role="cell" className="dash-sheet-cell" data-numeric={column.type === 'number' ? '' : undefined}>
                {overflowed?.(index, c) ? VIEW_STATES.overflowCell : cellText(table.rows[index][c])}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
