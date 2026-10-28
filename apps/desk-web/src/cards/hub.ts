// The hub's routes the device uses (O11 M3, M4), the signed-in member's own: the org state as the hub serves it (the
// head, or with `?since=` the chain after a version, with the transitions and the delegated machines' certificates),
// and the pairing exchange's pending list, where a new device posts its keys with its MAC. The hub only carries both:
// the state is verified here (org-store.ts) and the MAC on the approving Mac.
import { ORG_STATE_PATH, PENDING_DEVICES_PATH, type OrgStateView, type PendingDevice, type PendingDeviceRequest } from 'desk-hub/protocol';
import { hubJson, withJson } from '../hub/http';

export type DeviceHub = {
  orgState(since: number): Promise<OrgStateView>;
  postPending(request: PendingDeviceRequest): Promise<PendingDevice>;
};

export const browserDeviceHub: DeviceHub = {
  orgState: (since) => hubJson<OrgStateView>(`${ORG_STATE_PATH}?since=${since}`),
  postPending: async (request) => (await hubJson<{ pending: PendingDevice }>(PENDING_DEVICES_PATH, withJson('POST', request))).pending,
};
