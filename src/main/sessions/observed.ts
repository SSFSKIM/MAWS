// X17's main read (P2-A execution document §5.5): `session.observedFacts`, beside `session.digests`, relays the engine
// host's `engine.observedFacts` (the host writes and recovers the facts file; main never reads it). A host that cannot
// answer gives null, logged: its banner already says the host is down, and the surfaces read "Not observed yet" until
// it is back. Main keeps no copy.
import type { ObservedFactsAnswer } from '@shared/engine/observed-facts';
import type { AppSessionId } from '@shared/graph/ids';
import { registerMainHandler, type HostDispatch } from '../ipc/router';
import { hostCall } from './context';

export async function observedFactsOf(dispatch: HostDispatch, appSessionId: AppSessionId, log: (line: string) => void): Promise<ObservedFactsAnswer | null> {
  try {
    return await hostCall(dispatch, 'engine.observedFacts', { appSessionId });
  } catch (error) {
    log(`observed facts of ${appSessionId} not read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function registerObservedFacts(dispatch: HostDispatch, log: (line: string) => void = (line) => console.warn(`[sessions] ${line}`)): void {
  registerMainHandler('session.observedFacts', ({ appSessionId }) => observedFactsOf(dispatch, appSessionId as AppSessionId, log));
}
