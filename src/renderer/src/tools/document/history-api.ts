// The document editor's `HistoryApi` on A's IPC (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D10;
// Decision Log 28 to 30; the ledger's X23 and X24): bound to one artifact, each method the store's command through the
// renderer's bridge and `ArtifactHost` (a version's V2 state, the merged provenance between two seqs). "Name this
// version" sends the label alone, so the version keeps its note (A's Decision Log 38c). `lastViewedAt` answers the time
// the tab read from the artifact's row before the surface recorded this showing's view (the "See N new changes" pill
// compares against the view before this one), and the time of the rail's own `markViewed` after it. New versions are
// heard from `artifacts.changed` for this artifact, coalesced; the rail's failures go to the renderer's log.
import type { HistoryApi } from '@artifacts/document/editor/history/api';
import type { ArtifactHost } from '@artifacts/host';
import type { CommandInput, CommandName, CommandOutput, MawsBridge } from '@shared/ipc/schema';

const VERSIONS_QUIET_MS = 500; // a burst of writes re-reads the list once

export interface HistoryApiDeps {
  artifactId: string;
  ipc: Pick<MawsBridge, 'invoke' | 'on'>;
  host: Pick<ArtifactHost, 'versionState' | 'attributions'>;
  /** The owner's last view of the artifact as the tab holds it (read from the row before this showing's view). */
  viewedAt: { get(): number | null; set(at: number): void };
  sessionTitle?(appSessionId: string): string | undefined;
  log(line: string): void;
}

export function createHistoryApi({ artifactId, ipc, host, viewedAt, sessionTitle, log }: HistoryApiDeps): HistoryApi {
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const result = await ipc.invoke(name, input);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  return {
    versions: async () => (await call('artifacts.versions', { artifactId })).versions,
    lastViewedAt: async () => viewedAt.get(),
    versionState: (versionId) => host.versionState(artifactId, versionId),
    attributions: (fromSeq, toSeq) => host.attributions(artifactId, fromSeq, toSeq),
    saveVersion: ({ label, note }) => call('artifacts.saveVersion', { artifactId, label, ...(note !== undefined ? { note } : {}) }),
    nameVersion: async (versionId, { label, note }) => {
      await call('artifacts.nameVersion', { artifactId, versionId, label, ...(note !== undefined ? { note } : {}) });
    },
    restore: (versionId) => call('artifacts.restore', { artifactId, versionId }),
    duplicate: async (versionId) => ({ artifactId: (await call('artifacts.duplicate', { artifactId, versionId })).artifact.id }),
    markViewed: async () => {
      await call('artifacts.markViewed', { artifactId });
      viewedAt.set(Date.now());
    },
    onVersions: (listener) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const off = ipc.on('artifacts.changed', (change) => {
        if (change.artifactId !== artifactId || timer !== null) return;
        timer = setTimeout(() => {
          timer = null;
          listener();
        }, VERSIONS_QUIET_MS);
      });
      return () => {
        off();
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
    },
    ...(sessionTitle ? { sessionTitle } : {}),
    log,
  };
}
