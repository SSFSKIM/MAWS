// A client's request to the engine host, and the park (P5 O5 landing 1: the park race of acceptance 5's machine side).
// The engine host asked to exit when idle (the park clock's ask, or a discovery wake's `parkNow`) leaves at once when it
// holds no live row, whatever request it was sent: one in flight, or one sent before `mawsd` sees its connection end, is
// answered `host_unavailable` (and a write it began may be lost with its answer). So every request a client sends to
// the engine host through `mawsd` (the front's forward, the endpoint's, the artifact endpoint's lookups, the render
// seam's answers to the bridges) goes through here:
// - it is a need (`DaemonClocks.engineNeeded`): the park clock starts again from it, and a discovery wake's park still
//   to be asked is left to the clock, so the host woken for a read and then asked for more stays up;
// - while any is in flight no park is asked (`DaemonClocks.engineRequests`);
// - one that arrives after the ask was sent waits for that host's exit (bounded by EXIT_SETTLE_MS), and then goes as any
//   request to a parked host does: the supervisor holds it and starts the next host for it. A host still serving after
//   the bound is not leaving (it holds live rows): the ask is taken back (`takeBackPark`) and the request goes to it.
import type { HostResponse } from '@shared/ipc/host-protocol';
import type { HostOwner, HostSupervisor } from '@shared/host/host-supervisor';
import type { DaemonClocks } from './clocks';

// An idle engine host's exit order is a socket close and a shutdown with nothing to stop: well under this
export const EXIT_SETTLE_MS = 5_000;

type Forward = HostSupervisor['forward'];

export interface EngineRequestsOptions {
  hosts: Pick<HostSupervisor, 'forward' | 'onState' | 'parked'>;
  clocks: Pick<DaemonClocks, 'engineNeeded' | 'engineRequests' | 'parkAsked' | 'takeBackPark'>;
  log(line: string): void;
  exitSettleMs?: number;
}

export function engineRequests({ hosts, clocks, log, exitSettleMs = EXIT_SETTLE_MS }: EngineRequestsOptions): { forward: Forward; inFlight(): number } {
  let inFlight = 0;

  // The asked host's exit: its link leaving `ready`, or its park; false when the bound passed first
  const exited = () =>
    new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        resolve(value);
      };
      const off = hosts.onState('engine-host', (state) => {
        if (state.state !== 'ready' || hosts.parked('engine-host')) finish(true);
      });
      const timer = setTimeout(() => finish(false), exitSettleMs);
      if (hosts.parked('engine-host')) finish(true);
    });

  const forward: Forward = async (owner: HostOwner, request) => {
    if (owner !== 'engine-host') return hosts.forward(owner, request);
    inFlight += 1;
    clocks.engineRequests(inFlight);
    clocks.engineNeeded();
    try {
      if (clocks.parkAsked()) {
        log(`[hosts] ${request.name} arrived after the engine host was asked to park: waiting for its exit`);
        if (!(await exited()) && clocks.parkAsked()) {
          log(`[hosts] the engine host asked to park still serves after ${exitSettleMs / 1000} s: the park taken back for ${request.name}`);
          clocks.takeBackPark();
        }
      }
      return (await hosts.forward(owner, request)) as HostResponse;
    } finally {
      inFlight -= 1;
      clocks.engineRequests(inFlight);
    }
  };
  return { forward, inFlight: () => inFlight };
}
