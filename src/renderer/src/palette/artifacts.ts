// ⌘K's artifacts (UX wave U6b-5a, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M4; Interfaces §E;
// decisions 21 and 22; S5). With text typed the palette asks the Library's own search, `library.list` with the query (its
// titles and text), of this Mac and of each machine the conversation search asks (`searchedMachines`), and keeps the
// machines that answered, this Mac first: a machine that does not answer is left out and nothing is said, since the
// Library says its own errors and the palette's last row leads there. Enter on an artifact follows the artifact link's
// rule with the session on screen in the link's place.
import type { MawsBridge } from '@shared/ipc/schema';
import type { LibraryRow } from '@shared/ipc/schema/library';
import type { MachineRef } from '@shared/machine/ref';
import { recordArtifactMachine, sessionArtifactMachine } from '../artifacts/machines';
import { focusedSession } from '../composer/ComposerAppKeys';
import { ipc } from '../ipc/client';
import { openArtifactTab, showOpenArtifactTab } from '../library/actions';
import { canShowArtifactInPanel } from '../shell/transfer';
import { openArtifactInPanel } from '../tools/artifacts/ArtifactsTool';

export interface ArtifactSearch { query: string; groups: { machine: MachineRef; rows: LibraryRow[] }[] } // machines that answered, this Mac first

// `query` comes back as given, so the palette can tell an answer for an older query; it is asked as the Library asks it.
export async function searchArtifacts(client: MawsBridge, query: string, machines: readonly MachineRef[]): Promise<ArtifactSearch> {
  const filter = { query: query.trim() };
  const ask = async (machine: MachineRef | null): Promise<LibraryRow[] | null> => {
    try {
      const answer = await (machine === null ? client.invoke('library.list', { filter }) : client.invoke('library.list', { filter }, { machine }));
      return answer.ok ? answer.value.rows : null;
    } catch {
      return null;
    }
  };
  const answers = await Promise.all([ask(null), ...machines.map(ask)]);
  const groups: ArtifactSearch['groups'] = [];
  answers.forEach((rows, i) => {
    if (rows !== null) groups.push({ machine: i === 0 ? client.localMachine : machines[i - 1]!, rows });
  });
  return { query, groups };
}

// Interfaces §E's four steps. The last is the case of no session on screen, and of a session on another machine than the
// artifact's, beside whose chat the side column would read the artifact on the wrong machine.
export function openPaletteArtifact(artifactId: string, machine: MachineRef): void {
  const local = ipc.localMachine;
  recordArtifactMachine(artifactId, machine, local);
  const session = focusedSession();
  if (session !== null && showOpenArtifactTab(session, artifactId)) return;
  if (session !== null && canShowArtifactInPanel(session) && sessionArtifactMachine(session, artifactId, local) === machine) {
    openArtifactInPanel(session, artifactId);
    return;
  }
  openArtifactTab(artifactId, undefined, machine);
}
