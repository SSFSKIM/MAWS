// "Hub unreachable" (P5 O7 M2, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, "The carrier hover"; A2, P5
// Decision Log 108; P5 §3's hub-offline, channel-up): drawn once, in the sidebar's org header, while the hub can't be
// reached and some other machine is still up over an RL2 link, apart from any machine's own offline greying. A machine
// reached through a profile's socket has no hub between, so it says nothing of the hub.
import { useHubAccess } from '../stores/hub-access';
import { useMachines } from '../stores/machines';

export const HUB_UNREACHABLE = 'Hub unreachable';

export function HubNotice() {
  const unreachable = useHubAccess((s) => s.access === 'unreachable');
  const reached = useMachines((s) => [...s.machines.values()].some((m) => m.state === 'up' && (m.carrier === 'direct' || m.carrier === 'relay')));
  if (!unreachable || !reached) return null;
  return (
    <p role="status" data-testid="hub-unreachable" className="m-0 px-[19px] pb-1 text-ui-sm text-fg-muted">
      {HUB_UNREACHABLE}
    </p>
  );
}
