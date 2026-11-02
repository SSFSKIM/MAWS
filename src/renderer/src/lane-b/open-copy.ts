// "Open externally" for a file of another machine (P5 O7 M5a, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// M5, "Open a copy, and Save As of a remote artifact"; A10). The machine's own open commands take a path on the machine,
// which means nothing on this Mac, so none is offered there: a file of a lane B session on another machine, a library
// file of another machine's artifact, opens as a copy main pages here (`remote.openCopy`, into the temporary directory,
// 64 MiB at most) and hands to the OS. Reveal in Finder stays greyed "on <machine>": there is nothing here to reveal.
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { machineOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { isRemoteLaneB } from './remote-session';

export const COPY_WORDS = {
  title: (machine: string) => `Opens a copy of this file from ${machine} on this Mac`,
} as const;

type Opened = CommandResult<'files.openExternal'>;

/** A session's file opened outside MAWS: by the OS here, or for a lane B session on another machine, as a copy here. */
export function openSessionFile(appSessionId: AppSessionId, path: string, client: MawsBridge): Promise<Opened> {
  if (!isRemoteLaneB(appSessionId)) return client.invoke('files.openExternal', { appSessionId, path });
  // the session's address sends it to its machine, whose file it reads; main answers it here (its allow-list)
  return client.invoke('remote.openCopy', { machine: machineOf(appSessionId), source: { appSessionId, path } });
}

/** A stored file of another machine's artifact (at `revision`, else the latest), opened as a copy here. */
export const openArtifactCopy = (machine: MachineRef, artifactId: string, revision: number | undefined, client: MawsBridge): Promise<Opened> =>
  client.invoke('remote.openCopy', { machine, source: { artifactId, ...(revision !== undefined && { revision }) } });
