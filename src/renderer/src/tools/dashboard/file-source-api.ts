import type { CommandOutput, MawsBridge } from '@shared/ipc/schema';

type FileStatus = CommandOutput<'artifacts.datasetFiles'>;
export interface DatasetFileApi {
  check(): Promise<FileStatus>;
  reread(id: string, baseRevision: number): Promise<CommandOutput<'artifacts.rereadDatasetFile'>>;
}

export function datasetFileApi(artifactId: string, ipc: Pick<MawsBridge, 'invoke'>): DatasetFileApi {
  return {
    check: async () => {
      const result = await ipc.invoke('artifacts.datasetFiles', { artifactId });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
    reread: async (id, baseRevision) => {
      const result = await ipc.invoke('artifacts.rereadDatasetFile', { artifactId, id, baseRevision });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    },
  };
}
