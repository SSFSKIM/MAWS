// The library's actions (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M3; Decision Log 9): the owner's writes go
// through P3-A's `artifacts.*` and `spaces.*` (the human as actor, set by the host), and the library shows a write once
// main's index has it (`library.changed`), never before. Each answers the command's value, or the failure with the
// store's refusal read back (`artifactRefusalOf`: `designSystemInUse {artifactIds}`, `notFound`, …), null when the
// failure is not the store's (a timeout, an unavailable host).
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { CommandInput, CommandName, CommandOutput, IpcError, MawsBridge } from '@shared/ipc/schema';
import { artifactRefusalOf, type ArtifactRefusal, type ArtifactRow } from '@shared/ipc/schema/artifacts';
import type { Space } from '@shared/artifacts/entity';
import { ipc } from '../ipc/client';
import { useLayout } from '../stores/layout';

export type LibraryActionResult<T> = { ok: true; value: T } | { ok: false; error: IpcError; refusal: ArtifactRefusal | null };

async function run<N extends CommandName, T>(client: MawsBridge, name: N, input: CommandInput<N>, pick: (output: CommandOutput<N>) => T): Promise<LibraryActionResult<T>> {
  const result = await client.invoke(name, input);
  return result.ok ? { ok: true, value: pick(result.value) } : { ok: false, error: result.error, refusal: artifactRefusalOf(result.error) };
}

const artifactOf = ({ artifact }: { artifact: ArtifactRow }) => artifact;
const spaceOf = ({ space }: { space: Space }) => space;
const nothing = () => undefined;

// ---- artifacts ---------------------------------------------------------------------------------------------------------

export const createArtifact = (input: CommandInput<'artifacts.create'> & { kind: ArtifactKind }, client: MawsBridge = ipc) => run(client, 'artifacts.create', input, artifactOf);
export const renameArtifact = (artifactId: string, title: string, client: MawsBridge = ipc) => run(client, 'artifacts.update', { artifactId, title }, artifactOf);
export const setArtifactPinned = (artifactId: string, pinned: boolean, client: MawsBridge = ipc) => run(client, 'artifacts.update', { artifactId, pinned }, artifactOf);
// null: out of every Space
export const moveArtifactToSpace = (artifactId: string, spaceId: string | null, client: MawsBridge = ipc) => run(client, 'artifacts.update', { artifactId, spaceId }, artifactOf);
export const duplicateArtifact = (artifactId: string, client: MawsBridge = ipc) => run(client, 'artifacts.duplicate', { artifactId }, artifactOf);
export const deleteArtifact = (artifactId: string, client: MawsBridge = ipc) => run(client, 'artifacts.delete', { artifactId }, nothing);
// Decision Log 15: once per open, by the surface that showed the artifact's content to the owner, never by the list.
export const markArtifactViewed = (artifactId: string, client: MawsBridge = ipc) => run(client, 'artifacts.markViewed', { artifactId }, nothing);

// ---- Spaces ------------------------------------------------------------------------------------------------------------

export const createSpace = (name: string, linkedDir?: string, client: MawsBridge = ipc) =>
  run(client, 'spaces.create', linkedDir === undefined ? { name } : { name, linkedDir }, spaceOf);
export const renameSpace = (spaceId: string, name: string, client: MawsBridge = ipc) => run(client, 'spaces.update', { spaceId, name }, spaceOf);
// null: unlinked (its mirror's files are removed by the host)
export const linkSpaceDirectory = (spaceId: string, linkedDir: string | null, client: MawsBridge = ipc) => run(client, 'spaces.update', { spaceId, linkedDir }, spaceOf);
// Its artifacts are left in no Space (A's rule).
export const deleteSpace = (spaceId: string, client: MawsBridge = ipc) => run(client, 'spaces.delete', { spaceId }, nothing);

// ---- opening -----------------------------------------------------------------------------------------------------------

// An artifact in a main tab of its own (one per artifact: opened again, its tab is activated), in the current tab set.
// The tab lives in the main area, so a maximized or floating panel docks first, as `openArtifacts` does for the library.
export function openArtifactTab(artifactId: string): void {
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'artifact', artifactId });
}
