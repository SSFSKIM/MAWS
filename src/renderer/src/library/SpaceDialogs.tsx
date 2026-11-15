// The Spaces' management (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M4; Decision Log 12): New Space (a name,
// and optionally a project folder its artifacts are mirrored into, chosen in the native folder dialog through main's
// `layout.pickFiles`), and per Space a menu: show only it, Rename…, Instructions… (UX wave U10b), Link a folder… or
// Change folder…, Unlink folder, Delete Space… (asked first; its artifacts stay, in no Space, A's rule; the host removes
// what it mirrored). Writes go through P3-A's `spaces.*`.
// UX wave U10b (l8-settings-13; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, M9 and §E.2): a Space of
// this Mac carries instructions for agents, written in a sheet with one field and marked "Instructions" on its heading
// line; a chat a card of "Make something new" starts from the Space carries them as a chip (MakeSomethingNew.tsx).
import { DropdownMenu } from 'radix-ui';
import { useState } from 'react';
import type { LibrarySpace } from '@shared/ipc/schema/library';
import { ipc } from '../ipc/client';
import { Sheet, SheetForm } from '../sessions/Sheet';
import { DANGER, FIELD, PRIMARY, QUIET, SECONDARY } from '../sessions/ui';
import { SPACE_INSTRUCTIONS_MAX } from '@shared/artifacts/space-instructions';
import { createSpace, deleteSpace, linkSpaceDirectory, moveArtifactToSpace, renameSpace, setSpaceInstructions } from './actions';
import { DIALOG_COPY as D, SPACE_COPY } from './copy';
import { closeLibraryDialog, openLibraryDialog, toastFailure, useLibraryDialog, type SheetOf } from './dialogs';
import { MoreIcon } from './icons';
import { MENU, MENU_ITEM } from './LibraryHeader';
import { useSpaceInstructions } from './store';
import { showSpace, useLibraryView } from './view';

const SPACE_NAME_MAX = 200;
const INSTRUCTIONS_COUNTED_FROM = 7500; // the limit's line shows from here (§E.2)

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

// P5 O7 M5a: a Space of another machine's library is only narrowed to here; its management is this Mac's commands.
export function SpaceMenu({ space, narrowed = false }: { space: LibrarySpace; narrowed?: boolean }) {
  const remote = useLibraryView((s) => s.machine !== null);
  if (remote && narrowed) return null;
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
          {!remote && <SpaceManagement space={space} />}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function SpaceManagement({ space }: { space: LibrarySpace }) {
  return (
    <>
      <DropdownMenu.Item className={MENU_ITEM} onSelect={() => openLibraryDialog({ kind: 'renameSpace', space })}>
        {SPACE_COPY.rename}
      </DropdownMenu.Item>
      <DropdownMenu.Item className={MENU_ITEM} onSelect={() => openLibraryDialog({ kind: 'spaceInstructions', space })}>
        {SPACE_COPY.instructions}
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
    </>
  );
}

// The mark of a Space of this Mac that has instructions, on its heading line; it opens their sheet.
export function SpaceInstructionsMark({ space }: { space: LibrarySpace }) {
  const remote = useLibraryView((s) => s.machine !== null);
  const has = useSpaceInstructions().has(space.id);
  if (remote || !has) return null;
  return (
    <button
      type="button"
      onClick={() => openLibraryDialog({ kind: 'spaceInstructions', space })}
      className="inline-flex h-6 shrink-0 items-center rounded-sm px-1.5 text-ui-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
    >
      {SPACE_COPY.mark}
    </button>
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

// A Space's instructions: one field, eight lines tall at first, growing with its text to 40 % of the window, then
// scrolling, so Save stays in view; Enter makes a new line. Save is offered whenever the text differs from what is stored,
// the empty text included (saving it removes them). The field takes at most SPACE_INSTRUCTIONS_MAX characters (a paste is
// cut there), and from 7,500 a line under it counts them. A save holds both buttons disabled and the field read-only; a failure is said here and
// keeps the text; closing the sheet meanwhile does not cancel the save, and a failure then is toasted.
export function SpaceInstructionsSheet({ dialog }: SheetOf<'spaceInstructions'>) {
  const { space } = dialog;
  const close = () => closeLibraryDialog(dialog);
  const stored = useSpaceInstructions().get(space.id) ?? '';
  const [edited, setEdited] = useState<string | null>(null); // null until the owner edits: the stored text, as read
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const text = edited ?? stored;
  const title = SPACE_COPY.instructionsFor(space.name);
  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await setSpaceInstructions(space.id, text);
    setBusy(false);
    if (result.ok) close();
    else if (useLibraryDialog.getState().open === dialog) setError(result.error.message);
    else toastFailure(result.error.message);
  };
  return (
    <Sheet title={title} onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && text !== stored) void save();
        }}
        className="flex flex-col gap-3"
      >
        <p className="m-0 text-ui-sm text-fg-muted">{SPACE_COPY.receivers}</p>
        <textarea
          aria-label={title}
          autoFocus
          readOnly={busy} // what is saved is what the field shows: nothing typed during the save is lost
          value={text}
          maxLength={SPACE_INSTRUCTIONS_MAX}
          onChange={(event) => setEdited(event.target.value.slice(0, SPACE_INSTRUCTIONS_MAX))}
          className={`${FIELD} max-h-[40vh] min-h-[calc(8lh+0.5rem)] resize-none overflow-y-auto leading-snug field-sizing-content`}
        />
        {text.length >= INSTRUCTIONS_COUNTED_FROM && <p className="m-0 text-ui-sm text-fg-muted">{SPACE_COPY.limit(text.length)}</p>}
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={busy} onClick={close} className={SECONDARY}>
            {SPACE_COPY.cancel}
          </button>
          <button type="submit" disabled={busy || text === stored} className={PRIMARY}>
            {SPACE_COPY.save}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
