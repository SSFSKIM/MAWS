// The Artifacts tool's list (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5; parent §4.1: "the session's own list
// with 'All artifacts' one click away"): a scope row (This session · All) with "Open library" beside it, then the
// artifacts grouped by kind in the kinds' order, each group present only when it has rows, newest first (main's
// order). This session is the session's lineage (the session and its side-thread ancestors, X9's scope); All is the
// whole library. A row: the kind's glyph, the title and "Edited <ago> by <who>". The scope and the scroll are the
// tool state's, so Back returns to where the list was.
// P4 (P3-L's landing debt): the lines below the scope row (a refusal or the empty note, each kind's heading, its rows)
// are drawn through the shell's virtualiser, as the Artifacts tab's are (library/Rows.tsx), so a library of thousands
// mounts only what is near the view. Every row stays its own tab stop in the list's order, and a row holding the
// keyboard stays mounted while the list scrolls away from it; the heading of the group at the top stays pinned there.
import { defaultRangeExtractor, measureElement, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { actorDisplay } from '@shared/artifacts/actor';
import { ARTIFACT_KINDS, type ArtifactKind } from '@shared/artifacts/entity';
import type { AppSessionId } from '@shared/graph/ids';
import type { LibraryFilter, LibraryRow } from '@shared/ipc/schema/library';
import { formatAgo } from '@shared/app/date-format';
import { useNow } from '../../app/use-now';
import { KIND_PLURAL_LABELS, LIBRARY_COPY } from '../../library/copy';
import { KindIcon } from '../../library/icons';
import { refreshLibrary, useLibraryList } from '../../library/store';
import { openArtifacts } from '../../main/artifacts';
import { ARTIFACTS_TOOL_COPY } from './copy';

export type ArtifactsScope = 'session' | 'all';

const control = 'rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2';
const segment = 'px-2 py-0.5 text-ui-sm text-fg-muted outline-accent hover:text-fg focus-visible:outline-2 aria-pressed:bg-bg-active aria-pressed:text-fg';

interface Props {
  appSessionId: AppSessionId | null;
  scope: ArtifactsScope;
  scrollTop: number;
  onScope(scope: ArtifactsScope): void;
  onScroll(scrollTop: number): void;
  onOpen(artifactId: string): void;
}

export function ArtifactsList({ appSessionId, scope, scrollTop, onScope, onScroll, onOpen }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  // Where the list is put back to: Back and a remount return to where the list was; another scope is another list, which
  // starts at its top (the tool state's offset is zeroed with it), and so do its lines when they mount only once that
  // scope is read (adjusted while rendering, so they never mount at the old offset).
  const [restore, setRestore] = useState({ scope, top: scrollTop });
  if (restore.scope !== scope) setRestore({ scope, top: 0 });
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = restore.top;
  }, [restore]);
  const filter: LibraryFilter | null = scope === 'all' ? {} : appSessionId === null ? null : { appSessionId, lineage: true };
  return (
    <div data-artifacts-list="" ref={scroller} onScroll={(e) => onScroll(e.currentTarget.scrollTop)} className="relative flex h-full min-h-0 flex-col overflow-auto">
      <div className="m-3 mb-1 flex shrink-0 items-center gap-2">
        <div role="group" aria-label={ARTIFACTS_TOOL_COPY.scopeLabel} className="flex overflow-hidden rounded-sm border border-border">
          {(['session', 'all'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={scope === value} onClick={() => onScope(value)} className={segment}>
              {ARTIFACTS_TOOL_COPY.scopes[value]}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={openArtifacts} className="shrink-0 rounded-sm px-1.5 py-0.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2">
          {ARTIFACTS_TOOL_COPY.openLibrary}
        </button>
      </div>
      {filter === null ? <Quiet>{ARTIFACTS_TOOL_COPY.noSession}</Quiet> : <Groups filter={filter} scope={scope} initialOffset={restore.top} onOpen={onOpen} />}
    </div>
  );
}

// A refused read, retryable: alone before the first answer, above the last good list after it (the store keeps it).
function Failure({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2 text-ui text-fg">
      <p className="m-0">{message}</p>
      <button type="button" onClick={() => refreshLibrary()} className={control}>
        {ARTIFACTS_TOOL_COPY.retry}
      </button>
    </div>
  );
}

type Line =
  | { kind: 'failure'; key: string; message: string }
  | { kind: 'empty'; key: string; text: string }
  | { kind: 'heading'; key: string; of: ArtifactKind }
  | { kind: 'row'; key: string; row: LibraryRow; last: boolean }; // `last`: the group's last row, with the gap below it

const ESTIMATES = { failure: 72, empty: 36, heading: 30, row: 50, lastRow: 58 } as const;
type SizeKey = keyof typeof ESTIMATES;
const sizeKey = (line: Line): SizeKey => (line.kind === 'row' ? (line.last ? 'lastRow' : 'row') : line.kind);
// A line of each kind is of one height: what one measured last places a list mounted again (Back from a record) where
// the last one was, so the kept scroll offset lands on the same row. A hidden list measures 0, which is not kept.
const measured: Partial<Record<SizeKey, number>> = {};

function Groups({ filter, scope, initialOffset, onOpen }: { filter: LibraryFilter; scope: ArtifactsScope; initialOffset: number; onOpen(artifactId: string): void }) {
  const read = useLibraryList(filter);
  const error = read.status === 'error' ? (read.error ?? '') : null;
  if (read.value === undefined) {
    return error === null ? <Quiet>{ARTIFACTS_TOOL_COPY.reading}</Quiet> : <Failure message={ARTIFACTS_TOOL_COPY.couldNotList(error)} />;
  }
  return <Lines rows={read.value.rows} error={error} scope={scope} appSessionId={filter.appSessionId} initialOffset={initialOffset} onOpen={onOpen} />;
}

// A refused refresh above the last good rows, the empty note, then each kind's heading and its rows, newest first.
function linesOf(rows: readonly LibraryRow[], error: string | null, scope: ArtifactsScope): Line[] {
  return [
    ...(error !== null ? [{ kind: 'failure' as const, key: 'failure', message: ARTIFACTS_TOOL_COPY.couldNotRefresh(error) }] : []),
    ...(rows.length === 0 ? [{ kind: 'empty' as const, key: 'empty', text: scope === 'all' ? ARTIFACTS_TOOL_COPY.emptyAll : ARTIFACTS_TOOL_COPY.emptySession }] : []),
    ...ARTIFACT_KINDS.flatMap((kind): Line[] => {
      const ofKind = rows.filter((row) => row.kind === kind);
      if (ofKind.length === 0) return [];
      return [{ kind: 'heading', key: `heading:${kind}`, of: kind }, ...ofKind.map((row, i): Line => ({ kind: 'row', key: row.id, row, last: i === ofKind.length - 1 }))];
    }),
  ];
}

// `initialOffset`: where the list is put back to (the tool state's scroll), so the first lines drawn are those there.
function Lines({ rows, error, scope, appSessionId, initialOffset, onOpen }: { rows: readonly LibraryRow[]; error: string | null; scope: ArtifactsScope; appSessionId?: AppSessionId; initialOffset: number; onOpen(artifactId: string): void }) {
  const lines = useMemo(() => linesOf(rows, error, scope), [rows, error, scope]);
  // The lines' box sits in the list's scroller (its parent, whose ref is not attached yet when this mounts) below the
  // scope row: where it starts is the virtualiser's scroll margin, measured again when the box gets its size (a list
  // mounted in a collapsed panel measures 0 until it is shown).
  const box = useRef<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(0);
  const container = useCallback((element: HTMLDivElement | null) => {
    box.current = element;
    if (!element) return;
    const measure = () => setMargin(element.offsetTop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // each line's group heading (-1 before the first), and the row holding the keyboard, kept mounted out of range
  const headingOf = useMemo(() => {
    let heading = -1;
    return lines.map((line, index) => (line.kind === 'heading' ? (heading = index) : heading));
  }, [lines]);
  const [focused, setFocused] = useState<string | null>(null);
  const kept = useMemo(() => (focused === null ? -1 : lines.findIndex((line) => line.kind === 'row' && line.row.id === focused)), [lines, focused]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const base = defaultRangeExtractor(range);
      const extra = [headingOf[range.startIndex] ?? -1, kept].filter((index) => index >= 0 && !base.includes(index));
      return extra.length === 0 ? base : [...base, ...extra].sort((a, b) => a - b);
    },
    [headingOf, kept],
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualiser's functions are read in render by design
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => box.current?.parentElement ?? null,
    initialOffset,
    estimateSize: (index) => {
      const key = sizeKey(lines[index]!);
      return measured[key] ?? ESTIMATES[key];
    },
    measureElement: (element, entry, instance) => {
      const size = measureElement(element, entry, instance);
      const line = lines[instance.indexFromElement(element)];
      if (line && size > 0) measured[sizeKey(line)] = size;
      return size;
    },
    getItemKey: (index) => lines[index]!.key,
    overscan: 6,
    scrollMargin: margin,
    rangeExtractor,
  });
  const items = virtualizer.getVirtualItems();
  const pinned = headingOf[virtualizer.range?.startIndex ?? 0] ?? -1; // the group at the top: its heading stays there

  const draw = (line: Line) => {
    switch (line.kind) {
      case 'failure':
        return <Failure message={line.message} />;
      case 'empty':
        return <Quiet>{line.text}</Quiet>;
      case 'heading':
        return <h3 className="m-0 px-3 py-1.5 text-ui-sm font-normal text-fg-muted">{KIND_PLURAL_LABELS[line.of]}</h3>;
      case 'row':
        return <ListRow row={line.row} appSessionId={appSessionId} onOpen={onOpen} onFocus={(within) => setFocused((f) => (within ? line.row.id : f === line.row.id ? null : f))} />;
    }
  };

  return (
    <div ref={container} className="relative w-full shrink-0" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => {
        const line = lines[item.index]!;
        return (
          <div
            key={item.key}
            data-index={item.index}
            data-artifacts-group={line.kind === 'heading' ? line.of : undefined}
            ref={virtualizer.measureElement}
            className={item.index === pinned ? 'sticky top-0 z-10 bg-bg-raised' : `absolute inset-x-0 top-0${line.kind === 'heading' ? ' bg-bg-raised' : ''}${line.kind === 'row' && line.last ? ' pb-2' : ''}`}
            style={item.index === pinned ? undefined : { transform: `translateY(${item.start - margin}px)` }}
          >
            {draw(line)}
          </div>
        );
      })}
    </div>
  );
}

function ListRow({ row, appSessionId, onOpen, onFocus }: { row: LibraryRow; appSessionId?: AppSessionId; onOpen(artifactId: string): void; onFocus(within: boolean): void }) {
  const now = useNow();
  const by = actorDisplay(row.lastEditor, row.lastEditorTitle).name;
  const link = row.sessions.find((session) => session.appSessionId === appSessionId);
  const relationship = link ? link.roles.includes('created') ? 'Created' : link.roles.includes('edited') ? 'Edited' : 'Read' : 'From a parent session';
  const edited = LIBRARY_COPY.edited(formatAgo(Math.max(0, now - row.lastEditedAt)), by);
  const detail = appSessionId ? `${relationship}${link ? ` · ${formatAgo(Math.max(0, now - link.lastAt))}` : ''}` : row.builtIn ? `Built in${row.seedOnly ? '' : ` · ${edited}`}` : edited;
  return (
    <button
      type="button"
      data-artifact-row=""
      data-artifact-id={row.id}
      data-kind={row.kind}
      onClick={() => onOpen(row.id)}
      onFocus={() => onFocus(true)}
      onBlur={() => onFocus(false)}
      className="flex w-full min-w-0 items-start gap-2.5 px-3 py-1.5 text-left outline-accent hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2"
    >
      <KindIcon kind={row.kind} className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span data-part="title" className="truncate text-ui text-fg">
          {row.title}
        </span>
        <span data-part="line" className="truncate text-ui-sm text-fg-muted">
          {detail}
        </span>
      </span>
    </button>
  );
}

function Quiet({ children }: { children: string }) {
  return <p className="m-0 px-3 py-2 text-ui text-fg-muted">{children}</p>;
}
