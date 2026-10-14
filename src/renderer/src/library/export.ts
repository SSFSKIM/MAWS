// Export and Save a copy (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b; Decision Log 14), for the library
// row's Export item and the viewers' Export menu. The formats offered for a kind are those main's exporter registry
// serves (`library.exportFormats`, asked once per kind for the window's life: exporters register as main starts), so a
// format `artifacts.export` would refuse `exportUnavailable` is never offered. An export is A's (`artifacts.export`,
// written under the store's directory) and then saved where the owner chooses (`library.saveAs` of that export, the
// native dialog at Downloads); a File artifact's "Save a copy…" saves its stored file the same way. The outcome is a
// toast; a cancelled dialog says nothing.
import { useEffect, useState } from 'react';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { VIEWERS_COPY } from '../tools/artifacts/viewers/copy';
import { toastFailure } from './dialogs';

const NONE: readonly ArtifactExportFormat[] = [];
const formats = new Map<ArtifactKind, readonly ArtifactExportFormat[]>();
const asking = new Map<ArtifactKind, Promise<readonly ArtifactExportFormat[]>>();

// The kind's formats, asked of main the first time (none while it has not answered, or when it could not).
export function useExportFormats(kind: ArtifactKind | null, client: MawsBridge = ipc): readonly ArtifactExportFormat[] {
  const known = kind === null ? NONE : formats.get(kind);
  const [, answered] = useState(0);
  useEffect(() => {
    if (kind === null || formats.has(kind)) return;
    let live = true;
    let pending = asking.get(kind);
    if (!pending) {
      pending = client.invoke('library.exportFormats', { kind }).then((result) => {
        asking.delete(kind);
        if (!result.ok) return NONE; // asked again by the next viewer or menu
        formats.set(kind, result.value.formats);
        return result.value.formats;
      });
      asking.set(kind, pending);
    }
    void pending.then(() => {
      if (live) answered((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [kind, client]);
  return known ?? NONE;
}

// Tests: nothing known.
export function resetExportFormats(): void {
  formats.clear();
  asking.clear();
}

const savedToast = (path: string) => void toast({ level: 'info', text: VIEWERS_COPY.saved(path), actions: [], dismissible: true });

// The artifact's live revision (or the version `versionId`) exported as `format`, then saved where the owner chooses.
// The save dialog names the file by the artifact's title, which main reads itself.
export async function exportArtifact(artifactId: string, format: ArtifactExportFormat, versionId?: number, client: MawsBridge = ipc): Promise<void> {
  const exported = await client.invoke('artifacts.export', { artifactId, format, ...(versionId !== undefined && { versionId }) });
  if (!exported.ok) return toastFailure(VIEWERS_COPY.exportFailed(exported.error.message));
  const saved = await client.invoke('library.saveAs', { artifactId, source: { export: { revision: exported.value.revision, format } } });
  if (!saved.ok) return toastFailure(VIEWERS_COPY.exportFailed(saved.error.message));
  if (saved.value.saved) savedToast(saved.value.path);
}

// A byte kind's stored file (at `revision`, else the latest) saved where the owner chooses.
export async function saveArtifactCopy(artifactId: string, revision?: number, client: MawsBridge = ipc): Promise<void> {
  const saved = await client.invoke('library.saveAs', { artifactId, source: { content: revision === undefined ? {} : { revision } } });
  if (!saved.ok) return toastFailure(VIEWERS_COPY.saveFailed(saved.error.message));
  if (saved.value.saved) savedToast(saved.value.path);
}
