// Deleting a design system from its page (D10 of docs/doperpowers/plans/2026-10-12-p3-d-design-systems.md): the header's
// "Delete design system…" asks first; A's store refuses while a live artifact names the system (`designSystemInUse
// {artifactIds}`), and the sheet then lists those artifacts by title, each opening in a tab, with "Move them to…": the
// owner picks another system, or their defaults (the artifact names none, so its Space's or the owner's governs), and
// "Move and delete" moves every one (`artifacts.update {designSystemId}`) and deletes again. Moving is the owner's
// confirmed intent here: they asked to delete. A refusal that names new artifacts shows the list again.
import { useState } from 'react';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import { artifactRefusalOf } from '@shared/ipc/schema/artifacts';
import { ipc } from '../../ipc/client';
import { deleteArtifact, openArtifactTab } from '../../library/actions';
import { useLibraryList } from '../../library/store';
import { Sheet, SheetForm } from '../../sessions/Sheet';
import { DANGER, FIELD } from '../../sessions/ui';
import { DESIGN_SYSTEM_COPY as C } from './copy';

const THEIR_DEFAULTS = ''; // the select's value for "no system of their own"

function idsOf(refusal: ArtifactRefusal | null): string[] | null {
  if (refusal?.reason !== 'designSystemInUse') return null;
  const ids = refusal.data.artifactIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function DeleteSystemSheet({ artifactId, name, onClose }: { artifactId: string; name: string; onClose(): void }) {
  const [inUse, setInUse] = useState<string[] | null>(null);
  const [target, setTarget] = useState(THEIR_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = useLibraryList();
  const systems = useLibraryList({ kind: 'design_system' });
  const titleOf = (id: string) => all.value?.rows.find((row) => row.id === id)?.title ?? id;
  // The library's row the owner is deleting, by its title: a copy keeps its law's title, which would name the original.
  const shown = all.value?.rows.find((row) => row.id === artifactId)?.title ?? name;
  const others = (systems.value?.rows ?? []).filter((row) => row.id !== artifactId).sort((a, b) => a.title.localeCompare(b.title, 'en'));

  const remove = async () => {
    const result = await deleteArtifact(artifactId);
    if (result.ok) return onClose();
    const ids = idsOf(result.refusal);
    if (ids) setInUse(ids);
    else setError(result.error.message);
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const moveAndDelete = async () => {
    for (const id of inUse ?? []) {
      const moved = await ipc.invoke('artifacts.update', { artifactId: id, designSystemId: target === THEIR_DEFAULTS ? null : target });
      if (!moved.ok && artifactRefusalOf(moved.error)?.reason !== 'notFound') return setError(C.moveFailed(titleOf(id), moved.error.message)); // one gone meanwhile needs no move
    }
    await remove();
  };

  if (inUse === null) {
    return (
      <Sheet title={C.deleteTitle(shown)} onClose={onClose}>
        <SheetForm focusSubmit canSubmit={!busy} onSubmit={() => void run(remove)} submitLabel={C.delete} submitClass={DANGER}>
          <p className="m-0 text-fg-muted">{C.deleteBody}</p>
          {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
        </SheetForm>
      </Sheet>
    );
  }
  return (
    <Sheet title={C.inUseTitle} onClose={onClose}>
      <SheetForm canSubmit={!busy} onSubmit={() => void run(moveAndDelete)} submitLabel={C.moveAndDelete} submitClass={DANGER}>
        <p className="m-0 text-fg-muted">{C.inUseBody(shown, inUse.length)}</p>
        <ul aria-label={C.inUseList} className="m-0 flex max-h-48 list-none flex-col overflow-auto p-0">
          {inUse.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  openArtifactTab(id);
                }}
                className="w-full truncate rounded-sm px-2 py-1 text-left text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2"
              >
                {titleOf(id)}
              </button>
            </li>
          ))}
        </ul>
        <label className="flex flex-col gap-1 text-ui-sm text-fg-muted">
          {C.moveTo}
          <select aria-label={C.moveTo} value={target} onChange={(event) => setTarget(event.target.value)} className={FIELD}>
            <option value={THEIR_DEFAULTS}>{C.theirDefaults}</option>
            {others.map((system) => (
              <option key={system.id} value={system.id}>
                {system.title}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="m-0 text-ui-sm text-danger">{error}</p>}
      </SheetForm>
    </Sheet>
  );
}
