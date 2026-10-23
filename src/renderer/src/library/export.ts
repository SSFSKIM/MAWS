// Export and Save a copy (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M5b; Decision Log 14), for the library
// row's Export item and the viewers' Export menu. The formats offered for a kind are those main's exporter registry
// serves (`library.exportFormats`, asked once per kind for the window's life: exporters register as main starts), so a
// format `artifacts.export` would refuse `exportUnavailable` is never offered. An export is A's (`artifacts.export`,
// written under the store's directory) and then saved where the owner chooses (`library.saveAs` of that export, the
// native dialog at Downloads); a File artifact's "Save a copy…" saves its stored file the same way. The outcome is a
// toast; a cancelled dialog says nothing.
import { useEffect, useSyncExternalStore } from 'react';
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ArtifactExportFormat } from '@shared/maws/tools';
import { ipc } from '../ipc/client';
import { toast } from '../stores/notices';
import { VIEWERS_COPY } from '../tools/artifacts/viewers/copy';
import { toastFailure } from './dialogs';

// P3-H (the P3 spec's Decision Log 92): the window's answers per kind and the asks in flight, shared by every menu,
// header and sheet; a render reads an answer only through `useSyncExternalStore`, so the one asking re-renders with it.
// (Read in render directly, the React Compiler memoized it on the kind: the first consumer of a kind never showed it.)
const NONE: readonly ArtifactExportFormat[] = [];
const formats = new Map<ArtifactKind, readonly ArtifactExportFormat[]>();
const asking = new Set<ArtifactKind>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

// Asks main once for a kind while no answer is known or awaited; a refusal (or a failed ask) leaves it unknown, asked
// again by the next viewer or menu.
function ask(kind: ArtifactKind, client: MawsBridge): void {
  if (formats.has(kind) || asking.has(kind)) return;
  asking.add(kind);
  client.invoke('library.exportFormats', { kind }).then(
    (result) => {
      asking.delete(kind);
      if (!result.ok) return;
      formats.set(kind, result.value.formats);
      listeners.forEach((listener) => listener());
    },
    () => void asking.delete(kind),
  );
}

// The kind's formats, asked of main the first time (none while it has not answered, or when it could not).
export function useExportFormats(kind: ArtifactKind | null, client: MawsBridge = ipc): readonly ArtifactExportFormat[] {
  const known = useSyncExternalStore(subscribe, () => (kind === null ? NONE : (formats.get(kind) ?? NONE)));
  useEffect(() => {
    if (kind !== null) ask(kind, client);
  }, [kind, client]);
  return known;
}

// Tests: nothing known.
export function resetExportFormats(): void {
  formats.clear();
  asking.clear();
}

const savedToast = (path: string, commentAuthorName?: string) => void toast({ level: 'info', text: VIEWERS_COPY.saved(path, commentAuthorName), actions: [], dismissible: true });

// The artifact's live revision (or the version `versionId`) exported as `format`, then saved where the owner chooses.
// The save dialog names the file by the artifact's title, which main reads itself. P4 (W1, L302): the export is a file
// of its own (`ownFile`), saved by its id, so another export of the same revision and format meanwhile never swaps it.
export async function exportArtifact(artifactId: string, format: ArtifactExportFormat, versionId?: number, client: MawsBridge = ipc): Promise<void> {
  const exported = await client.invoke('artifacts.export', { artifactId, format, ...(versionId !== undefined && { versionId }), ownFile: true });
  if (!exported.ok) return toastFailure(VIEWERS_COPY.exportFailed(exported.error.message));
  const { revision, exportId } = exported.value;
  const saved = await client.invoke('library.saveAs', { artifactId, source: { export: { revision, format, ...(exportId !== undefined && { exportId }) /* P3-E (Decision Log 33) */ } } });
  if (!saved.ok) return toastFailure(VIEWERS_COPY.exportFailed(saved.error.message));
  if (saved.value.saved) savedToast(saved.value.path, exported.value.commentAuthorName);
}

// A byte kind's stored file (at `revision`, else the latest) saved where the owner chooses.
export async function saveArtifactCopy(artifactId: string, revision?: number, client: MawsBridge = ipc): Promise<void> {
  const saved = await client.invoke('library.saveAs', { artifactId, source: { content: revision === undefined ? {} : { revision } } });
  if (!saved.ok) return toastFailure(VIEWERS_COPY.saveFailed(saved.error.message));
  if (saved.value.saved) savedToast(saved.value.path);
}
