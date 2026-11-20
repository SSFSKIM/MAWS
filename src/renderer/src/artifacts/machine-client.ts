// Editor dependencies speak in bare artifact ids; scope their artifact commands to the view's machine before IPC.
// Leave unrelated commands (local window actions, addressed sessions, etc.) and explicit command targets alone.
import type { CommandName, InvokeRest, MawsBridge } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';

type ArtifactClient = Pick<MawsBridge, 'invoke' | 'on'>;
const onArtifactMachine = (name: CommandName): boolean =>
  (name.startsWith('artifacts.') && name !== 'artifacts.copyAsset') || name.startsWith('library.') || name === 'presentations.present';

export function artifactClient(client: ArtifactClient, machine: MachineRef): ArtifactClient {
  return {
    invoke(name, input, ...opts) {
      if (!onArtifactMachine(name) || opts[0]?.machine !== undefined) return client.invoke(name, input, ...opts);
      return client.invoke(name, input, ...([{ ...opts[0], machine }] as InvokeRest<typeof name>));
    },
    on(name, listener) {
      return client.on(name, (payload, from) => {
        if (from.machine === machine || (name !== 'artifacts.changed' && name !== 'library.changed' && name !== 'connectors.grantChanged')) listener(payload, from);
      });
    },
  };
}
