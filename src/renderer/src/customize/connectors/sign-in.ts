// The renderer's side of a connector sign-in (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design
// "Signing in"): main owns the operation; `connectors.signInChanged` is heard for the window's life (App.tsx), so a
// sign-in started in Customize keeps its state while the page shows something else.
// - A result is the configured server's it was started for: its name, its scope, and the page's directory for a project
//   or local server (a name is the person's own, so two projects may each configure a different `linear`), recorded with
//   the session that signed in and when it was heard. Main's events carry only the operation and the name, so an event
//   is bound to its server by the receipt `connectors.signIn` answers; the ones heard before it (main says `starting`
//   before it answers) wait for it.
// - Per server, the latest event of its newest operation: a second press cancels the first in main, and the first's
//   events stop counting once the second's receipt is bound. A refused invoke reads as a failed sign-in.
import { create } from 'zustand';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { CustomizationServer } from '@shared/ipc/schema/customization';
import type { MawsBridge } from '@shared/ipc/schema';
import type { AppSessionId } from '@shared/graph/ids';
import { ipc } from '../../ipc/client';
import { transportWords } from '../../widgets/read';

export interface SignInTarget {
  name: string;
  scope: CustomizationServer['scope'];
  cwd: string | null; // the page's directory: part of a project or local server's identity
}

export interface SignInRecord {
  event: ConnectorSignInChanged; // the latest of the server's newest operation
  appSessionId: string; // the session it signs in
  at: number; // when the renderer heard it (ms)
}

export const signInKeyOf = ({ name, scope, cwd }: SignInTarget): string => [scope, scope === 'project' || scope === 'local' ? (cwd ?? '') : '', name].join('\u0000');

interface SignIns {
  byServer: ReadonlyMap<string, SignInRecord>;
}

export const useSignIns = create<SignIns>()(() => ({ byServer: new Map() }));

const UNBOUND_KEPT = 32; // operations heard without a receipt (another window's): the oldest dropped past this
const bound = new Map<string, { key: string; appSessionId: string }>(); // live operations by opId
const newest = new Map<string, string>(); // server key → its newest operation
const unbound = new Map<string, { event: ConnectorSignInChanged; at: number }[]>(); // opId → events heard before its receipt

const TERMINAL: ReadonlySet<ConnectorSignInChanged['state']> = new Set(['done', 'failed', 'cancelled']);

function record(key: string, appSessionId: string, event: ConnectorSignInChanged, at: number): void {
  useSignIns.setState(({ byServer }) => ({ byServer: new Map(byServer).set(key, { event, appSessionId, at }) }));
}

export function heard(event: ConnectorSignInChanged, at = Date.now()): void {
  const owner = bound.get(event.opId);
  if (owner === undefined) {
    const waiting = unbound.get(event.opId) ?? [];
    unbound.delete(event.opId);
    unbound.set(event.opId, [...waiting, { event, at }]);
    if (unbound.size > UNBOUND_KEPT) unbound.delete(unbound.keys().next().value!);
    return;
  }
  if (TERMINAL.has(event.state)) bound.delete(event.opId);
  if (newest.get(owner.key) !== event.opId) return; // an older operation's
  record(owner.key, owner.appSessionId, event, at);
}

export function connectSignInEvents(bridge: MawsBridge = ipc): () => void {
  return bridge.on('connectors.signInChanged', (event) => heard(event));
}

export async function startSignIn(target: SignInTarget, appSessionId: string, bridge: MawsBridge = ipc): Promise<void> {
  const key = signInKeyOf(target);
  const answer = await bridge.invoke('connectors.signIn', { name: target.name, appSessionId: appSessionId as AppSessionId });
  if (!answer.ok) {
    newest.set(key, `refused:${key}`);
    record(key, appSessionId, { opId: `refused:${key}`, name: target.name, state: 'failed', reason: 'engine', message: transportWords(answer.error), where: null }, Date.now());
    return;
  }
  const { opId } = answer.value;
  bound.set(opId, { key, appSessionId });
  newest.set(key, opId);
  const waiting = unbound.get(opId) ?? [];
  unbound.delete(opId);
  for (const { event, at } of waiting) heard(event, at);
}

export function cancelSignIn(opId: string, bridge: MawsBridge = ipc): void {
  void bridge.invoke('connectors.signInCancel', { opId });
}

/** Every record and binding dropped (tests). */
export function resetSignIns(): void {
  bound.clear();
  newest.clear();
  unbound.clear();
  useSignIns.setState({ byServer: new Map() });
}

/** The latest sign-in of a server that is still under way, for Cancel. */
export const RUNNING: ReadonlySet<ConnectorSignInChanged['state']> = new Set(['starting', 'waiting_browser', 'waiting_callback', 'watching_status', 'submitting']);
