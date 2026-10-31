// A `remote.session` as main's remote lane B adapter says it (P5 O7 M2, Interfaces §K), for the renderer's suites: the
// link up over the hub, the stream live, every control available and no reason, unless the test says otherwise.
import type { AppSessionId } from '@shared/graph/ids';
import { CONTROL_KEYS, type ControlKey, type RemoteCapability, type RemoteSession } from '@shared/ipc/schema/remote';

export const ALL_OPEN = Object.fromEntries(CONTROL_KEYS.map((key) => [key, { available: true }])) as Record<ControlKey, RemoteCapability>;

export function remoteSessionState(address: AppSessionId, over: Partial<Omit<RemoteSession, 'address'>> = {}): RemoteSession {
  return {
    address,
    link: { state: 'up', carrier: 'relay', refusal: null, member: 'member-1', rights: [] },
    stream: 'live',
    controls: ALL_OPEN,
    reason: null,
    ...over,
  };
}
