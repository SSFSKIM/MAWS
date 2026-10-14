// A library row's actions (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 14): Open, Pin or Unpin,
// Rename…, Move to Space (each Space, No Space, New Space…), Duplicate and Delete…, the same items in the row's "…" menu
// (also on Shift+F10) and in its context menu. Every write goes through P3-A's `artifacts.*` (the library's actions),
// and the list shows it once main's index has it; a refusal is toasted, or said in the sheet that asked. Delete asks
// first; a design system still styling artifacts is refused `designSystemInUse`, answered by a sheet that names them,
// each opening in a tab. M5b: Export, a submenu of the formats main's exporters serve for the kind and, for a File
// artifact, "Save a copy…" (export.ts), shown when the kind has either.
import { ContextMenu, DropdownMenu } from 'radix-ui';
import { useEffect, useState, type ReactNode } from 'react';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { ipc } from '../ipc/client';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { DANGER, FIELD, PRIMARY, SECONDARY } from '../sessions/ui';
import { deleteArtifact, duplicateArtifact, moveArtifactToSpace, openArtifactTab, renameArtifact, setArtifactPinned } from './actions';
import { DIALOG_COPY as D, ROW_COPY as R } from './copy';
import { exportArtifact, saveArtifactCopy, useExportFormats } from './export';
import { VIEWERS_COPY } from '../tools/artifacts/viewers/copy';
import { closeLibraryDialog, openLibraryDialog, replaceLibraryDialog, toastFailure, type ArtifactRef, type SheetOf } from './dialogs';
import { MoreIcon } from './icons';
import { MENU, MENU_ITEM } from './LibraryHeader';
import { useLibrarySpaces } from './store';

type Menu = typeof DropdownMenu; // ContextMenu's parts take the same props
const NO_SPACE = 'none'; // the radio value of No Space (no Space id is it)

const reportFailure = async (pending: Promise<{ ok: true } | { ok: false; error: { message: string } }>) => {
  const result = await pending;
  if (!result.ok) toastFailure(result.error.message);
};

function RowMenuItems({ M, row }: { M: Menu; row: LibraryRow }) {
  const spaces = useLibrarySpaces().value ?? [];
  const ref: ArtifactRef = { id: row.id, title: row.title };
  return (
    <>
      <M.Item className={MENU_ITEM} onSelect={() => openArtifactTab(row.id)}>
        {R.open}
      </M.Item>
      <M.Item className={MENU_ITEM} onSelect={() => void reportFailure(setArtifactPinned(row.id, !row.pinned))}>
        {row.pinned ? R.unpin : R.pin}
      </M.Item>
      <M.Item className={MENU_ITEM} onSelect={() => openLibraryDialog({ kind: 'rename', artifact: ref })}>
        {R.rename}
      </M.Item>
      <M.Sub>
        <M.SubTrigger className={`${MENU_ITEM} justify-between data-[state=open]:bg-bg-hover`}>
          {R.moveToSpace}
          <span aria-hidden className="text-fg-faint">
            ›
          </span>
        </M.SubTrigger>
        <M.Portal>
          <M.SubContent sideOffset={4} className={MENU}>
            <M.RadioGroup value={row.space?.id ?? NO_SPACE} onValueChange={(next) => void reportFailure(moveArtifactToSpace(row.id, next === NO_SPACE ? null : next))}>
              {spaces.map((space) => (
                <M.RadioItem key={space.id} value={space.id} className={MENU_ITEM}>
                  <Indicator M={M} />
                  <span className="max-w-60 truncate">{space.name}</span>
                </M.RadioItem>
              ))}
              <M.RadioItem value={NO_SPACE} className={MENU_ITEM}>
                <Indicator M={M} />
                {R.noSpace}
              </M.RadioItem>
            </M.RadioGroup>
            <M.Separator className="my-1 h-px bg-border" />
            <M.Item className={MENU_ITEM} onSelect={() => openLibraryDialog({ kind: 'newSpace', moveArtifact: ref })}>
              <span className="w-3.5" />
              {R.newSpace}
            </M.Item>
          </M.SubContent>
        </M.Portal>
      </M.Sub>
      <M.Item className={MENU_ITEM} onSelect={() => void reportFailure(duplicateArtifact(row.id))}>
        {R.duplicate}
      </M.Item>
      <ExportItems M={M} row={row} />
      <M.Separator className="my-1 h-px bg-border" />
      <M.Item className={`${MENU_ITEM} text-danger`} onSelect={() => openLibraryDialog({ kind: 'delete', artifact: ref })}>
        {R.delete}
      </M.Item>
    </>
  );
}

// M5b: Export ›, its formats and a File artifact's Save a copy…; nothing when the kind has neither.
function ExportItems({ M, row }: { M: Menu; row: LibraryRow }) {
  const formats = useExportFormats(row.kind);
  const copies = row.kind === 'file';
  if (formats.length === 0 && !copies) return null;
  return (
    <M.Sub>
      <M.SubTrigger className={`${MENU_ITEM} justify-between data-[state=open]:bg-bg-hover`}>
        {R.export}
        <span aria-hidden className="text-fg-faint">
          ›
        </span>
      </M.SubTrigger>
      <M.Portal>
        <M.SubContent sideOffset={4} className={MENU}>
          {formats.map((format) => (
            <M.Item key={format} className={MENU_ITEM} onSelect={() => void exportArtifact(row.id, format)}>
              {VIEWERS_COPY.exportFormats[format]}
            </M.Item>
          ))}
          {copies && (
            <M.Item className={MENU_ITEM} onSelect={() => void saveArtifactCopy(row.id)}>
              {VIEWERS_COPY.saveCopy}
            </M.Item>
          )}
        </M.SubContent>
      </M.Portal>
    </M.Sub>
  );
}

function Indicator({ M }: { M: Menu }) {
  return (
    <span aria-hidden className="w-3.5 text-accent">
      <M.ItemIndicator>●</M.ItemIndicator>
    </span>
  );
}

// The row's "…" button and its menu; `open` is the row's, so Shift+F10 on the row opens it too.
export function RowMenu({ row, open, onOpenChange, tabIndex }: { row: LibraryRow; open: boolean; onOpenChange(open: boolean): void; tabIndex: number }) {
  return (
    <DropdownMenu.Root modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={R.menu(row.title)}
          title={R.menu(row.title)}
          tabIndex={tabIndex}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-faint outline-accent group-hover:text-fg-muted group-focus-visible:text-fg-muted hover:bg-bg-active hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active data-[state=open]:text-fg"
        >
          <MoreIcon />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={MENU}>
          <RowMenuItems M={DropdownMenu} row={row} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// The same items at the pointer, on the row's context menu.
export function RowContextMenu({ row, children }: { row: LibraryRow; children: ReactNode }) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={MENU}>
          <RowMenuItems M={ContextMenu as unknown as Menu} row={row} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ---- the artifact's sheets ---------------------------------------------------------------------------------------------

export function RenameSheet({ dialog }: SheetOf<'rename'>) {
  const { artifact } = dialog;
  const close = () => closeLibraryDialog(dialog);
  const [title, setTitle] = useState(artifact.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = title.trim();
  const submit = async () => {
    setBusy(true);
    const result = await renameArtifact(artifact.id, trimmed);
    setBusy(false);
    if (result.ok) close();
    else setError(result.error.message);
  };
  return (
    <Sheet title={D.renameTitle} onClose={close}>
      <SheetForm canSubmit={!busy && trimmed.length > 0 && trimmed !== artifact.title} onSubmit={() => void submit()} submitLabel={D.rename} submitClass={PRIMARY}>
        <input aria-label={D.titleField} autoFocus value={title} maxLength={1_000} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.currentTarget.select()} className={FIELD} />
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}

export function DeleteSheet({ dialog }: SheetOf<'delete'>) {
  const { artifact } = dialog;
  const close = () => closeLibraryDialog(dialog);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const result = await deleteArtifact(artifact.id);
    setBusy(false);
    if (result.ok) return close();
    if (result.refusal?.reason === 'designSystemInUse') {
      const ids = result.refusal.data.artifactIds;
      return replaceLibraryDialog(dialog, { kind: 'inUse', artifact, artifactIds: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [] });
    }
    setError(result.error.message);
  };
  return (
    <Sheet title={D.deleteTitle(artifact.title)} onClose={close}>
      <SheetForm focusSubmit canSubmit={!busy} onSubmit={() => void submit()} submitLabel={D.delete} submitClass={DANGER}>
        <p className="m-0 text-fg-muted">{D.deleteBody}</p>
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}

// The artifacts a design system still styles, by title (main's index), each a way to open it.
export function InUseSheet({ dialog }: SheetOf<'inUse'>) {
  const { artifact, artifactIds } = dialog;
  const close = () => closeLibraryDialog(dialog);
  const [titles, setTitles] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all(artifactIds.map(async (artifactId) => [artifactId, await ipc.invoke('library.get', { artifactId })] as const)).then((answers) => {
      if (!live) return;
      setTitles(new Map(answers.map(([artifactId, result]) => [artifactId, (result.ok && result.value.row?.title) || artifactId])));
    });
    return () => {
      live = false;
    };
  }, [artifactIds]);
  return (
    <Sheet title={D.inUseTitle} onClose={close}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-fg-muted">{D.inUseBody(artifact.title)}</p>
        {titles === null ? (
          <p className="m-0 text-ui-sm text-fg-muted">{D.inUseReading}</p>
        ) : (
          <ul className="m-0 flex max-h-60 list-none flex-col overflow-auto p-0">
            {artifactIds.map((artifactId) => (
              <li key={artifactId}>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    openArtifactTab(artifactId);
                  }}
                  className="w-full truncate rounded-sm px-2 py-1 text-left text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2"
                >
                  {titles.get(artifactId)}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <button type="button" autoFocus onClick={close} className={SECONDARY}>
            {D.close}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
