// `host.attachment` (P5 O3-D M3; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §D; O3X5): whether an
// app is attached, told by the engine host's one client when that client listed the capability `host.attachment` in its
// hello (only `mawsd` does, as the permanent client whose connection outlives every app). The runtime keeps the presence
// the app-bound gates read (@shared/host/runtime's AppPresence); from any other client the command answers `internal`
// and changes nothing, so an embedded app stays keyed on its connection.
//
// A declaring client's {attached: true} is the owner back, as a welcome is for any other client (detached.ts): the cached
// login-shell capture is dropped, so the next launch captures the shell again.
//
// P5 O5 M4 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, Interfaces §F): the signal's `render` says the client
// answers render requests (a post-O5 `mawsd`, whose render seam answers them whatever its runtime's state). The capture
// and export bridges ask `answersRenders()`: the app's presence, or a declaring client's `render` while its connection
// is the served one; `show_pane` and the asks keep the presence alone. The engine host's welcome lists `host.render`
// (PEER_CAPABILITIES.engineHost) so `mawsd` knows this build reads the field.
import { HostCommandError, type HostClientHooks, type HostOn } from '@shared/host/runtime';
import { invalidateShellEnvironment } from '@shared/host/shell-env';
import { ipcError } from '@shared/ipc/errors';

export interface RenderAttachment {
  answersRenders(): boolean; // the capture and export bridges' gate
}

export function registerAttachment(on: HostOn, client: Pick<HostClientHooks, 'setAttachment' | 'presence' | 'hasClient' | 'onClientGone'>, attachedAgain: () => void = invalidateShellEnvironment): RenderAttachment {
  let render = false; // the declaring client's last `render`; false from its connection's end (and so at the next one's start)
  client.onClientGone(() => void (render = false));
  on('host.attachment', async ({ attached, render: renders }) => {
    const signal = client.setAttachment(attached);
    if (signal === 'refused') throw new HostCommandError(ipcError('internal', 'host.attachment from a client whose hello did not list host.attachment: nothing changed'));
    render = renders === true;
    if (signal === 'changed' && attached) attachedAgain();
  });
  return { answersRenders: () => client.presence.attached() || (render && client.hasClient()) };
}
