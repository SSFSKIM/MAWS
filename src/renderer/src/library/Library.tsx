// The Artifacts tab (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; parent §2 item 1): every artifact the owner
// and the sessions made, from main's derived index (`library.list`, read again at each `library.changed`). All
// (Pinned first, then by date), Pinned, and By Space (one group per Space, then No Space; a Space can be narrowed to,
// and new artifacts are then made in it); search over titles and text and a type filter whose counts follow both;
// "Make something new" above the list when nothing is being searched; the rows and their actions; the Spaces'
// management. Registered into P3-G's `artifactsLibrary` slot (App.tsx).
//
// While the next answer is read (a new search, another view), the last answer stays on screen rather than the list
// emptying; a failed read keeps it too, with the failure and a Try again above it.
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LibrarySpace } from '@shared/ipc/schema/library';
import { ChevronLeftIcon } from '../app/IconButton';
import { useNow } from '../app/use-now';
import { LIBRARY_PAGE as P } from './copy';
import { useLibraryDialog } from './dialogs';
import { dateGroups, spaceGroups, type RowGroup } from './groups';
import { LibraryHeader } from './LibraryHeader';
import { DeleteSheet, InUseSheet, RenameSheet } from './RowMenu';
import { Rows, type Line } from './Rows';
import { DeleteSpaceSheet, NewSpaceSheet, RenameSpaceSheet, SpaceMenu } from './SpaceDialogs';
import { refreshLibrary, useLibraryList, useLibrarySpaces, type LibraryList, type LibraryRead } from './store';
import { currentSpaceOf, filterOf, setLibraryView, useLibraryView, type LibraryViewState } from './view';

// The read's answer, or while it has none yet the last answer shown.
function useKeptList(read: LibraryRead<LibraryList>): LibraryList | undefined {
  const [kept, setKept] = useState(read.value);
  if (read.value !== undefined && read.value !== kept) setKept(read.value);
  return read.value ?? kept;
}

function linesOf(view: LibraryViewState, read: LibraryRead<LibraryList>, list: LibraryList | undefined, spaces: LibrarySpace[] | undefined, now: number): Line[] {
  const lines: Line[] = [];
  const searching = view.query.trim() !== '';
  const narrowed = view.view === 'bySpace' && view.spaceId !== null;
  if ((view.view === 'all' || narrowed) && !searching) lines.push({ kind: 'make', key: 'make', spaceId: currentSpaceOf(view) });
  if (read.status === 'error') lines.push({ kind: 'note', key: 'error', text: P.readFailed(read.error ?? ''), retry: () => refreshLibrary(), tone: 'warning' });
  if (list === undefined) {
    if (read.status !== 'error') lines.push({ kind: 'note', key: 'reading', text: P.reading });
    return lines;
  }
  const unnarrowedSpaces = view.view === 'bySpace' && !narrowed;
  if (unnarrowedSpaces && spaces?.length === 0) lines.push({ kind: 'note', key: 'no-spaces', text: P.emptySpaces });
  const groups: RowGroup[] = unnarrowedSpaces
    ? spaceGroups(list.rows, spaces ?? [], { includeEmpty: !searching && view.kind === null })
    : dateGroups(list.rows, now, { pinnedFirst: view.view === 'all' });
  if (groups.length === 0) {
    if (unnarrowedSpaces && spaces?.length === 0 && !searching && view.kind === null) return lines;
    const space = narrowed ? spaces?.find((s) => s.id === view.spaceId) : undefined;
    const text = searching
      ? P.noMatch(view.query.trim())
      : view.kind !== null
        ? P.noKind(view.kind)
        : view.view === 'pinned'
          ? P.emptyPinned
          : space
            ? P.emptySpace(space.name)
            : P.emptyAll;
    lines.push({ kind: 'note', key: 'empty', text });
    return lines;
  }
  for (const group of groups) {
    const space = group.space ? (spaces?.find((s) => s.id === group.space!.id) ?? { ...group.space, createdAt: 0, count: group.rows.length }) : undefined;
    lines.push({ kind: 'heading', key: `heading:${group.key}`, title: group.title, space });
    if (group.rows.length === 0) lines.push({ kind: 'groupEmpty', key: `empty:${group.key}` });
    for (const row of group.rows) lines.push({ kind: 'row', key: `row:${group.key}:${row.id}`, row });
  }
  return lines;
}

// By Space narrowed to one Space: the way back to every Space, the Space's name, where it mirrors to, and its menu.
function SpaceBar({ space }: { space: LibrarySpace }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="mx-auto flex max-w-(--measure-wide) min-w-0 items-center gap-2 px-6 py-2">
        <button
          type="button"
          onClick={() => setLibraryView({ spaceId: null })}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-sm py-0.5 pr-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
        >
          <ChevronLeftIcon />
          {P.allSpaces}
        </button>
        <span aria-hidden className="text-fg-faint">
          /
        </span>
        <h2 className="m-0 min-w-0 truncate text-ui font-semibold text-fg">{space.name}</h2>
        {space.linkedDir && (
          <span title={space.linkedDir} className="min-w-0 truncate text-ui-sm text-fg-faint">
            {P.linkedTo(space.linkedDir)}
          </span>
        )}
        <SpaceMenu space={space} narrowed />
      </div>
    </div>
  );
}

function LibraryDialogs() {
  const open = useLibraryDialog((s) => s.open);
  switch (open?.kind) {
    case undefined:
      return null;
    case 'rename':
      return <RenameSheet key={open.artifact.id} dialog={open} />;
    case 'delete':
      return <DeleteSheet key={open.artifact.id} dialog={open} />;
    case 'inUse':
      return <InUseSheet key={open.artifact.id} dialog={open} />;
    case 'newSpace':
      return <NewSpaceSheet key={open.moveArtifact?.id ?? ''} dialog={open} />;
    case 'renameSpace':
      return <RenameSpaceSheet key={open.space.id} dialog={open} />;
    case 'deleteSpace':
      return <DeleteSpaceSheet key={open.space.id} dialog={open} />;
  }
}

const isTextField = (el: EventTarget | null): boolean => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);

// `/` focuses the search, as in the plugin library.
function focusSearch(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || isTextField(event.target)) return;
  const field = event.currentTarget.querySelector<HTMLInputElement>('[data-widget-search]');
  if (!field) return;
  event.preventDefault();
  field.focus();
}

export function Library() {
  const view = useLibraryView(useShallow((s) => s));
  const read = useLibraryList(filterOf(view));
  const list = useKeptList(read);
  const spacesRead = useLibrarySpaces();
  const spaces = spacesRead.value;
  const now = useNow();

  const narrowedTo = view.view === 'bySpace' && view.spaceId !== null ? spaces?.find((s) => s.id === view.spaceId) : undefined;
  // a narrowed Space that is gone (deleted here or by an agent) gives way to every Space
  const narrowedGone = view.view === 'bySpace' && view.spaceId !== null && spacesRead.status === 'ready' && narrowedTo === undefined;
  useEffect(() => {
    if (narrowedGone) setLibraryView({ spaceId: null });
  }, [narrowedGone]);

  return (
    <div data-library className="flex h-full min-h-0 flex-col bg-bg" onKeyDown={focusSearch}>
      <LibraryHeader counts={list?.counts} />
      {narrowedTo && <SpaceBar space={narrowedTo} />}
      <Rows lines={linesOf(view, read, list, spaces, now)} />
      <LibraryDialogs />
    </div>
  );
}
