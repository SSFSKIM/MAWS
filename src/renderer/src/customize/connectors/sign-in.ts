// The renderer's side of a connector sign-in (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Signing in"): main owns the operation; `connectors.signInChanged` is heard for the window's life (App.tsx), so a
// sign-in started in Customize keeps its state while the page shows something else. Per server name, the latest event of
// its newest operation (a second press cancels the first in main, whose `cancelled` comes before the new `starting`, so
// the old operation's events are dropped once the new one started). A refused invoke reads as a failed sign-in.
import { create } from 'zustand';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { MawsBridge } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../ipc/client';
import { transportWords } from '../../widgets/read';

interface SignIns {
  byName: ReadonlyMap<string, ConnectorSignInChanged>;
}

export const useSignIns = create<SignIns>()(() => ({ byName: new Map() }));

export function heard(event: ConnectorSignInChanged): void {
  useSignIns.setState(({ byName }) => {
    const current = byName.get(event.name);
    if (event.state !== 'starting' && current !== undefined && current.opId !== event.opId) return { byName }; // an older operation's
    return { byName: new Map(byName).set(event.name, event) };
  });
}

export function connectSignInEvents(bridge: MawsBridge = ipc): () => void {
  return bridge.on('connectors.signInChanged', heard);
}

export async function startSignIn(name: string, appSessionId: string, bridge: MawsBridge = ipc): Promise<void> {
  const answer = await bridge.invoke('connectors.signIn', { name, appSessionId: appSessionId as AppSessionId });
  if (answer.ok) return;
  const refused: ConnectorSignInChanged = { opId: `refused:${name}`, name, state: 'failed', reason: 'engine', message: transportWords(answer.error), where: null };
  useSignIns.setState(({ byName }) => ({ byName: new Map(byName).set(name, refused) }));
}

export function cancelSignIn(opId: string, bridge: MawsBridge = ipc): void {
  void bridge.invoke('connectors.signInCancel', { opId });
}

/** The latest sign-in of a server that is still under way, for Cancel. */
export const RUNNING: ReadonlySet<ConnectorSignInChanged['state']> = new Set(['starting', 'waiting_browser', 'waiting_callback', 'watching_status', 'submitting']);
