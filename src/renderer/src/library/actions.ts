// The library's actions (docs/doperpowers/plans/2026-10-12-p3-l-library.md, M3; Decision Log 9): the owner's writes go
// through P3-A's `artifacts.*` and `spaces.*` (the human as actor, set by the host), and the library shows a write once
// main's index has it (`library.changed`), never before. Each answers the command's value, or the failure with the
// store's refusal read back (`artifactRefusalOf`: `designSystemInUse {artifactIds}`, `notFound`, …), null when the
// failure is not the store's (a timeout, an unavailable host).
import type { ArtifactKind } from '@shared/artifacts/entity';
import type { ArtifactLocation } from '@shared/artifacts/link'; // P4-B4
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandInput, CommandName, CommandOutput, InvokeRest, IpcError, MawsBridge } from '@shared/ipc/schema';
import { artifactRefusalOf, type ArtifactRefusal, type ArtifactRow } from '@shared/ipc/schema/artifacts';
import { tabId } from '@shared/ipc/schema/layout';
import type { Space } from '@shared/artifacts/entity';
import type { MachineRef } from '@shared/machine/ref';
import { artifactMachineOf, sessionArtifactMachine } from '../artifacts/machines';
import { ipc } from '../ipc/client';
import { useLayout } from '../stores/layout';
import { isOpen } from '../stores/layout-model';
import { requestArtifactOpen } from '../tools/artifacts/viewers/requests'; // P4-B4
import { refreshSpaceInstructions } from './store'; // UX wave U10b (M9)
import { ARTIFACT } from '../transcript/model/copy'; // UX wave U10b: the row's words, shared with the editor's notice

export type LibraryActionResult<T> = { ok: true; value: T } | { ok: false; error: IpcError; refusal: ArtifactRefusal | null };

async function run<N extends CommandName, T>(client: MawsBridge, name: N, input: CommandInput<N>, pick: (output: CommandOutput<N>) => T, ...opts: InvokeRest<N>): Promise<LibraryActionResult<T>> {
  const result = await client.invoke(name, input, ...opts);
  return result.ok ? { ok: true, value: pick(result.value) } : { ok: false, error: result.error, refusal: artifactRefusalOf(result.error) };
}

const artifactOf = ({ artifact }: { artifact: ArtifactRow }) => artifact;
const spaceOf = ({ space }: { space: Space }) => space;
const nothing = () => undefined;
// P5 O6 M4: the library is this machine's, and so are the folders a Space links, until it spans machines (O4, O7).
const local = (client: MawsBridge) => ({ machine: client.localMachine });

// ---- artifacts ---------------------------------------------------------------------------------------------------------

export const createArtifact = (input: CommandInput<'artifacts.create'> & { kind: ArtifactKind }, client: MawsBridge = ipc) => run(client, 'artifacts.create', input, artifactOf, local(client));
export const renameArtifact = (artifactId: string, machine: MachineRef, title: string, client: MawsBridge = ipc) => run(client, 'artifacts.update', { artifactId, title }, artifactOf, { machine });
export const setArtifactPinned = (artifactId: string, machine: MachineRef, pinned: boolean, client: MawsBridge = ipc) => run(client, 'artifacts.update', { artifactId, pinned }, artifactOf, { machine });
// null: out of every Space
export const moveArtifactToSpace = (artifactId: string, machine: MachineRef, spaceId: string | null, client: MawsBridge = ipc) => run(client, 'artifacts.update', { artifactId, spaceId }, artifactOf, { machine });
export const duplicateArtifact = (artifactId: string, machine: MachineRef, client: MawsBridge = ipc) => run(client, 'artifacts.duplicate', { artifactId }, artifactOf, { machine });
export const deleteArtifact = (artifactId: string, machine: MachineRef, client: MawsBridge = ipc) => run(client, 'artifacts.delete', { artifactId }, nothing, { machine });
// UX wave U10b (M5, §C.4): undo an agent's delete on the artifact's machine. Resolves null once the artifact is live
// again, else the sentence an act that ended without its effect leaves: this Mac's store's sentence after "Not restored:";
// another machine's as main words it (`refusalWords`, `failureWords`: "Not restored: <machine> is offline", …).
export async function undeleteArtifact(artifactId: string, machine: MachineRef, client: MawsBridge = ipc): Promise<string | null> {
  const result = await client.invoke('artifacts.undelete', { artifactId }, { machine });
  if (result.ok) return null;
  return machine === client.localMachine ? ARTIFACT.notRestored(result.error.message) : result.error.message;
}
// The transcript's row follows the same session route as openArtifactInPanel.
export function undeleteSessionArtifact(appSessionId: AppSessionId, artifactId: string, client: MawsBridge = ipc): Promise<string | null> {
  const machine = sessionArtifactMachine(appSessionId, artifactId, client.localMachine);
  return undeleteArtifact(artifactId, machine, client);
}
// Decision Log 15: once per open, by the surface that showed the artifact's content to the owner, never by the list.
export const markArtifactViewed = (artifactId: string, machine: MachineRef, client: MawsBridge = ipc) => run(client, 'artifacts.markViewed', { artifactId }, nothing, { machine });

// ---- Spaces ------------------------------------------------------------------------------------------------------------

export const createSpace = (name: string, linkedDir?: string, client: MawsBridge = ipc) =>
  run(client, 'spaces.create', linkedDir === undefined ? { name } : { name, linkedDir }, spaceOf, local(client));
export const renameSpace = (spaceId: string, name: string, client: MawsBridge = ipc) => run(client, 'spaces.update', { spaceId, name }, spaceOf, local(client));
// null: unlinked (its mirror's files are removed by the host)
export const linkSpaceDirectory = (spaceId: string, linkedDir: string | null, client: MawsBridge = ipc) => run(client, 'spaces.update', { spaceId, linkedDir }, spaceOf, local(client));
// Its artifacts are left in no Space (A's rule).
export const deleteSpace = (spaceId: string, client: MawsBridge = ipc) => run(client, 'spaces.delete', { spaceId }, nothing);
// UX wave U10b (M9, §E.2): a Space's instructions on this Mac ('' removes them), read again once written, so this window
// shows them whether or not the host's announcement reaches it first.
export async function setSpaceInstructions(spaceId: string, text: string, client: MawsBridge = ipc): Promise<LibraryActionResult<void>> {
  const result = await run(client, 'spaces.setInstructions', { spaceId, text }, nothing);
  if (result.ok) refreshSpaceInstructions(client);
  return result;
}

// ---- opening -----------------------------------------------------------------------------------------------------------

// An artifact in a main tab of its own (one per machine and artifact: opened again, its tab is activated), in the current tab set.
// The tab lives in the main area, so a maximized or floating panel docks first, as `openArtifacts` does for the library.
// P4-B4: at the place `location` names (an artifact link's fragment), asked of the tab's editor at the latest version
// unless it names one; a plain open asks nothing of the editor, so a tab opened again keeps the version it shows.
// Use the chosen row or the link source's machine, when known. Bare links use the window's route hints.
export function openArtifactTab(artifactId: string, location?: ArtifactLocation, machine?: MachineRef): void {
  const on = machine ?? artifactMachineOf(artifactId) ?? ipc.localMachine;
  if (location !== undefined) requestArtifactOpen(artifactId, on, 'latest', 'main', location);
  const layout = useLayout.getState();
  layout.revealMain();
  layout.openTab({ kind: 'artifact', artifactId, machine: on });
}

// UX wave U6d (card C5, "Show that tab"; the execution document's decisions 1 to 3): the main tab that already shows the
// artifact, brought forward at the place `location` names, as a mention's click asks before it opens beside the chat.
// The tab is looked for in this window's one strip on the machine the side column would read the artifact on
// (`sessionArtifactMachine`, `openArtifactInPanel`'s rule), so a tab of the same id on another machine is not taken.
// False, and nothing done, when the strip holds none; it awaits nothing.
export function showOpenArtifactTab(appSessionId: AppSessionId, artifactId: string, location?: ArtifactLocation, on?: MachineRef): boolean {
  const machine = on ?? sessionArtifactMachine(appSessionId, artifactId, ipc.localMachine);
  if (!isOpen(useLayout.getState().main, tabId({ kind: 'artifact', artifactId, machine }))) return false;
  openArtifactTab(artifactId, location, machine);
  return true;
}
