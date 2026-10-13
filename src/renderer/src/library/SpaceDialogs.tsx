// The Spaces' management (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 12): New Space (a name,
// and optionally a project folder its artifacts are mirrored into, chosen in the native folder dialog through main's
// `layout.pickFiles`), and per Space a menu: show only it, Rename…, Link a folder… or Change folder…, Unlink folder,
// Delete Space… (asked first; its artifacts stay, in no Space, A's rule; the host removes what it mirrored). Writes
// go through P3-A's `spaces.*`.
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import type { LibrarySpace } from '@shared/ipc/schema/library';
import { ipc } from '../ipc/client';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { DANGER, FIELD, PRIMARY, QUIET } from '../sessions/ui';
import { createSpace, deleteSpace, linkSpaceDirectory, moveArtifactToSpace, renameSpace } from './actions';
import { DIALOG_COPY as D, SPACE_COPY } from './copy';
import { closeLibraryDialog, openLibraryDialog, toastFailure, type SheetOf } from './dialogs';
import { MoreIcon } from './icons';
import { MENU, MENU_ITEM } from './LibraryHeader';
import { showSpace } from './view';

const SPACE_NAME_MAX = 200;

// The native folder dialog; null when cancelled (a refusal is toasted).
async function pickFolder(): Promise<string | null> {
  const picked = await ipc.invoke('layout.pickFiles', { kind: 'directory', directory: null, multiple: false });
  if (!picked.ok) {
    toastFailure(picked.error.message);
    return null;
  }
  return picked.value.files[0]?.path ?? null;
}

async function linkFolder(space: LibrarySpace): Promise<void> {
  const dir = await pickFolder();
  if (dir === null) return;
  const result = await linkSpaceDirectory(space.id, dir);
  if (!result.ok) toastFailure(result.error.message);
}

async function unlinkFolder(space: LibrarySpace): Promise<void> {
  const result = await linkSpaceDirectory(space.id, null);
  if (!result.ok) toastFailure(result.error.message);
}

export function SpaceMenu({ space, narrowed = false }: { space: LibrarySpace; narrowed?: boolean }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={SPACE_COPY.menu(space.name)}
          title={SPACE_COPY.menu(space.name)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-faint outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 data-[state=open]:bg-bg-active data-[state=open]:text-fg"
        >
          <MoreIcon className="size-3.5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className={MENU}>
          {!narrowed && (
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => showSpace(space.id)}>
              {SPACE_COPY.open}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => openLibraryDialog({ kind: 'renameSpace', space })}>
            {SPACE_COPY.rename}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={MENU_ITEM} onSelect={() => void linkFolder(space)}>
            {space.linkedDir ? SPACE_COPY.changeFolder : SPACE_COPY.link}
          </DropdownMenu.Item>
          {space.linkedDir && (
            <DropdownMenu.Item className={MENU_ITEM} onSelect={() => void unlinkFolder(space)}>
              {SPACE_COPY.unlink}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={`${MENU_ITEM} text-danger`} onSelect={() => openLibraryDialog({ kind: 'deleteSpace', space })}>
            {SPACE_COPY.delete}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ---- the sheets ----------------------------------------------------------------------------------------------------------

// New Space; from "Move to Space › New Space…", the artifact moves into it once it exists.
export function NewSpaceSheet({ dialog }: SheetOf<'newSpace'>) {
  const { moveArtifact } = dialog;
  const close = () => closeLibraryDialog(dialog);
  const [name, setName] = useState('');
  const [dir, setDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const submit = async () => {
    setBusy(true);
    const made = await createSpace(trimmed, dir ?? undefined);
    if (!made.ok) {
      setBusy(false);
      return setError(made.error.message);
    }
    if (moveArtifact) {
      const moved = await moveArtifactToSpace(moveArtifact.id, made.value.id);
      if (!moved.ok) toastFailure(moved.error.message);
    }
    close();
  };
  return (
    <Sheet title={D.newSpaceTitle} onClose={close}>
      <SheetForm canSubmit={!busy && trimmed.length > 0} onSubmit={() => void submit()} submitLabel={moveArtifact ? D.createAndMove(moveArtifact.title) : D.create} submitClass={PRIMARY}>
        <input aria-label={D.nameField} placeholder={D.nameField} autoFocus value={name} maxLength={SPACE_NAME_MAX} onChange={(e) => setName(e.target.value)} className={FIELD} />
        <p className="m-0 flex min-w-0 items-center gap-2 text-ui-sm text-fg-muted">
          <span className="min-w-0 flex-1 truncate" title={dir ?? undefined}>
            {dir === null ? D.folderNone : D.folderLinked(dir)}
          </span>
          <button
            type="button"
            onClick={async () => {
              const picked = await pickFolder();
              if (picked !== null) setDir(picked);
            }}
            className={QUIET}
          >
            {dir === null ? D.chooseFolder : D.changeFolder}
          </button>
          {dir !== null && (
            <button type="button" onClick={() => setDir(null)} className={QUIET}>
              {D.clearFolder}
            </button>
          )}
        </p>
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}

export function RenameSpaceSheet({ dialog }: SheetOf<'renameSpace'>) {
  const { space } = dialog;
  const close = () => closeLibraryDialog(dialog);
  const [name, setName] = useState(space.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const submit = async () => {
    setBusy(true);
    const result = await renameSpace(space.id, trimmed);
    setBusy(false);
    if (result.ok) close();
    else setError(result.error.message);
  };
  return (
    <Sheet title={D.renameSpaceTitle} onClose={close}>
      <SheetForm canSubmit={!busy && trimmed.length > 0 && trimmed !== space.name} onSubmit={() => void submit()} submitLabel={D.rename} submitClass={PRIMARY}>
        <input aria-label={D.nameField} autoFocus value={name} maxLength={SPACE_NAME_MAX} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} className={FIELD} />
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}

export function DeleteSpaceSheet({ dialog }: SheetOf<'deleteSpace'>) {
  const { space } = dialog;
  const close = () => closeLibraryDialog(dialog);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const result = await deleteSpace(space.id);
    setBusy(false);
    if (result.ok) close();
    else setError(result.error.message);
  };
  return (
    <Sheet title={D.deleteSpaceTitle(space.name)} onClose={close}>
      <SheetForm focusSubmit canSubmit={!busy} onSubmit={() => void submit()} submitLabel={D.delete} submitClass={DANGER}>
        <p className="m-0 text-fg-muted">
          {D.deleteSpaceBody(space.count)}
          {space.linkedDir && ` ${D.deleteSpaceLinked}`}
        </p>
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}
