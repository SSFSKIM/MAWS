// Main's `artifacts.open` (X24; docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 13): one
// MessageChannelMain per open, one end to the engine host on its parent port (`{t: 'doc', channel, artifactId, actor}`,
// the actor always the human: the window cannot name another) and the other to the asking window, posted on
// `maws:doc-port` with the channel number the window awaits it by (the preload re-posts it to the page). Main checks
// first that the artifact is a live document kind, so a window never waits on a port the host would close at once.
//
// In utility mode the two ends are entangled directly: main keeps neither, and a window that closes or reloads closes
// its end, which the host sees as the port's `close`. When the host exits, its ends close with it and the renderer's
// ArtifactHost re-opens (the one reopen path). Detached mode, where main keeps the host's end and relays it over the
// socket, is M5's.
import type { MessageChannelMain, WebContents } from 'electron';
import type { Actor } from '@shared/artifacts/actor';
import { isDocKind } from '@shared/artifacts/entity';
import { ipcError } from '@shared/ipc/errors';
import type { CommandResult } from '@shared/ipc/schema';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import { DOC_PORT_CHANNEL } from '@shared/ipc/doc-port';
import { CommandFailure, type HostDispatch } from '../ipc/router';
import type { HostSupervisor } from '../hosts/supervisor';

export { DOC_PORT_CHANNEL };

export interface DocOpenDeps {
  dispatch: HostDispatch;
  postDocPort: HostSupervisor['postDocPort'];
  channel: () => Pick<MessageChannelMain, 'port1' | 'port2'>; // `new MessageChannelMain()` in the app
}

const HUMAN: Actor = { kind: 'human' };
let lastChannel = 0;

const refusal = (reason: ArtifactRefusal['reason'], message: string) => new CommandFailure(ipcError('invalid_input', message, { reason, data: {} } satisfies ArtifactRefusal));

export async function openDocument(deps: DocOpenDeps, artifactId: string, sender: Pick<WebContents, 'postMessage' | 'isDestroyed'>): Promise<{ channel: number }> {
  const found = (await deps.dispatch('engine-host', 'artifacts.get', { artifactId })) as CommandResult<'artifacts.get'>;
  if (!found.ok) throw new CommandFailure(found.error);
  const { artifact } = found.value;
  if (!artifact) throw refusal('notFound', `no artifact ${artifactId}`);
  if (!isDocKind(artifact.kind)) throw refusal('invalid', `a ${artifact.kind} artifact has no document to open`);
  if (sender.isDestroyed()) throw new CommandFailure(ipcError('internal', 'the window that asked is gone'));
  lastChannel = (lastChannel + 1) >>> 0;
  const channel = lastChannel;
  const { port1, port2 } = deps.channel();
  if (!deps.postDocPort({ t: 'doc', channel, artifactId, actor: HUMAN }, port1)) {
    port1.close();
    port2.close();
    throw new CommandFailure(ipcError('host_unavailable', 'the engine host cannot take a document port now'));
  }
  sender.postMessage(DOC_PORT_CHANNEL, { channel, artifactId }, [port2]);
  return { channel };
}
