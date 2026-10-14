// The library sync's one tie to the engine host (the P3-L document, Decision Log 2): its reads as the host answers them
// through main's supervisor. The names of the host's library reads live here and nowhere else in main, so a ruling that
// renames or moves them (to P3-A's surface, say) changes this adapter only. A refusal (an unknown command, a host with
// no handler for one, an unavailable host, a timeout) rejects with the command and the IpcError's code and message.
import type { CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { HostSupervisor } from '../hosts/supervisor';
import type { LibrarySource } from './sync';

export type LibraryHost = Pick<HostSupervisor, 'dispatch' | 'onEvent' | 'onStreaming' | 'streaming'>;

export function hostLibrarySource(hosts: LibraryHost): LibrarySource {
  const read = async <N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> => {
    const result = (await hosts.dispatch('engine-host', name, input)) as CommandResult<N>;
    if (!result.ok) throw new Error(`${name}: ${result.error.code}: ${result.error.message}`);
    return result.value;
  };
  return {
    snapshot: () => read('library.snapshot', undefined),
    entry: (artifactId) => read('library.entry', { artifactId }),
    text: (artifactId) => read('library.text', { artifactId }),
    spaces: async () => (await read('spaces.list', undefined)).spaces,
    streaming: () => hosts.streaming('engine-host'),
    onStreaming: (listener) => hosts.onStreaming('engine-host', listener),
    onArtifactChanged: (listener) => hosts.onEvent('artifacts.changed', listener),
    onSpacesChanged: (listener) => hosts.onEvent('spaces.changed', () => listener()),
  };
}
