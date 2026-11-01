// `mawsd`'s engine host update under way, told on machine.sock (P5 O16 M3c fix wave 2; docs/doperpowers/plans/
// 2026-10-31-p5-o16-holder.md, D63; M3c's concern 1). While the engine host drains for a handover, `mawsd`'s relay holds
// an app's hello on engine-host.sock (there is no welcome to reflect), which the app used to read past its start budget
// as a `mawsd` that never answers: it stopped the `mawsd` it had spawned, or failed `held_lock`. So `mawsd` posts the host
// supervisor's handover state (host-supervisor.ts `EngineHandoverState`) as `daemon.engineHandover` at each change, again
// every ENGINE_HANDOVER_RESEND_MS while one is under way (a client that attached meanwhile learns it, and a client bounds
// its freshness by it), and `none` once at its end. It reads the host supervisor alone, so it never wakes a parked host.
import type { EngineHandoverState, HostSupervisor } from '@shared/host/host-supervisor';
import type { EngineHandover } from '@shared/ipc/schema/daemon';

export const ENGINE_HANDOVER_RESEND_MS = 5_000; // the deferral's own retry (WAIT_RETRY_MS); main's freshness bound is three of these

export interface EngineHandoverTellDeps {
  hosts: Pick<HostSupervisor, 'handoverState' | 'onHandover'>;
  emit(payload: EngineHandover): boolean; // the front's bus, to every ready machine.sock client
}

export function tellEngineHandover(deps: EngineHandoverTellDeps): { stop(): void } {
  let resend: ReturnType<typeof setInterval> | null = null;
  const post = (state: EngineHandoverState | null) => {
    const at = new Date().toISOString();
    deps.emit(state === null ? { state: 'none', inFlight: 0, at } : { state: state.state, inFlight: state.inFlight, ...(state.tool !== undefined && { tool: state.tool }), at });
  };
  const changed = (state: EngineHandoverState | null) => {
    if (resend !== null) clearInterval(resend);
    resend = null;
    post(state);
    if (state === null) return;
    resend = setInterval(() => post(deps.hosts.handoverState('engine-host')), ENGINE_HANDOVER_RESEND_MS);
    (resend as { unref?: () => void }).unref?.();
  };
  const off = deps.hosts.onHandover('engine-host', changed);
  return {
    stop() {
      off();
      if (resend !== null) clearInterval(resend);
      resend = null;
    },
  };
}
