// `host.attachment` (P5 O3-D M3; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §D; O3X5): whether an
// app is attached, told by the engine host's one client when that client listed the capability `host.attachment` in its
// hello (only `mawsd` does, as the permanent client whose connection outlives every app). The runtime keeps the presence
// the app-bound gates read (@shared/host/runtime's AppPresence); from any other client the command answers `internal`
// and changes nothing, so an embedded app stays keyed on its connection.
//
// A declaring client's {attached: true} is the owner back, as a welcome is for any other client (detached.ts): the cached
// login-shell capture is dropped, so the next launch captures the shell again.
import { HostCommandError, type HostClientHooks, type HostOn } from '@shared/host/runtime';
import { invalidateShellEnvironment } from '@shared/host/shell-env';
import { ipcError } from '@shared/ipc/errors';

export function registerAttachment(on: HostOn, client: Pick<HostClientHooks, 'setAttachment'>, attachedAgain: () => void = invalidateShellEnvironment): void {
  on('host.attachment', async ({ attached }) => {
    const signal = client.setAttachment(attached);
    if (signal === 'refused') throw new HostCommandError(ipcError('internal', 'host.attachment from a client whose hello did not list host.attachment: nothing changed'));
    if (signal === 'changed' && attached) attachedAgain();
  });
}
