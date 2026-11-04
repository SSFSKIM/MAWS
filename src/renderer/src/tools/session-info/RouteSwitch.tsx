// The Route row's action (W2, C3; §5.5 as amended 2026-10-01): C11's Direct⇄gateway switch, which lived in the status
// line's usage popover footer until the status line went. One button per target the routing facts offer, a retry on
// the target that failed, and the switch's progress and failure in words under it; the machine and its sheet are
// C11's (`switch-route.ts`, `SwitchSheet`), unchanged.
// P5 O7 M8: the switch restarts the session (`session.stop`), which a session on another machine doesn't take from here
// yet (lane-b/remote-unavailable.ts): each button is greyed, saying why.
import type { AppSessionId } from '@shared/graph/ids';
import { ROUTE, SWITCH, type SwitchTarget } from '../../gateway/copy';
import { useGateway } from '../../gateway/store';
import { switchRoute } from '../../gateway/switch-route';
import { useRemoteUnavailable } from '../../lane-b/remote-unavailable'; // P5 O7 M8

const ACTION = 'ml-2 rounded-sm px-1 text-ui-sm text-accent outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint disabled:hover:bg-transparent';

export function RouteSwitch({ appSessionId, targets }: { appSessionId: AppSessionId; targets: readonly SwitchTarget[] }) {
  const switching = useGateway((s) => s.switching.get(appSessionId) ?? null);
  const busy = switching !== null && switching.phase !== 'done' && switching.phase !== 'failed';
  const unavailable = useRemoteUnavailable(appSessionId, 'session.stop');
  return (
    <>
      {targets.map((target) => (
        <button key={target} type="button" className={ACTION} disabled={busy || unavailable !== null} title={unavailable ?? undefined} onClick={() => void switchRoute(appSessionId, target)}>
          {switching?.phase === 'failed' && switching.target === target ? `${SWITCH.retry} · ${ROUTE.switchTo[target]}` : ROUTE.switchTo[target]}
        </button>
      ))}
      {busy && (
        <span role="status" className="block text-fg-muted">
          {switching.phase === 'confirming' && switching.confirm === null ? SWITCH.checking : SWITCH.phase[switching.phase]}
        </span>
      )}
      {switching?.phase === 'failed' && (
        <span role="alert" className="block text-danger">
          {switching.error}
        </span>
      )}
    </>
  );
}
