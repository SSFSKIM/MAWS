// The device's part of the app (P5 O13 M3), started once the member is known: the device record and the org store
// read from IndexedDB, the registry socket opened as an app's while a device record exists (its `state` notices to the
// org store's pinned sync, its listings to the listings store), and the push subscription handed to the hub again,
// bound to the device while the head lists it, at start and whenever the device's state moves.
//
// `window.deskDevice()` answers what the device holds, for a scripted read (the browser suites): its state, the head's
// version, and the sessions listed. Nothing it answers is a key: the record's channel key is a CryptoKey no script reads.
import type { Listing } from 'org-protocol';
import type { Me } from '../hub/me';
import { bindPushDevice } from '../push/bound-device';
import { recordPushOutcome } from '../push/outcome';
import { browserPushEnv, resyncPush } from '../push/device';
import { registerServiceWorker } from '../pwa/service-worker';
import { gridApp } from '../state/grid';
import type { AppFrames } from '../hub/grid-client';
import { createCardsPasskey } from './cards-passkey';
import { idbDeviceStore } from './device-store';
import { browserDeviceHub } from './hub';
import { ListingsStore } from './listings-store';
import { activateOrgStore, idbOrgPersistence, OrgStore } from './org-store';
import { activateDevice, DeviceController, deviceController, useDevice } from './register';

let listings: ListingsStore | null = null;

/** The verified listings store of the app's device (the cards list's, M5); null before the app starts it. */
export const listingsStore = (): ListingsStore | null => listings;

export type DeviceReadout = { state: string | null; deviceId: string | null; version: number | null; listings: Array<{ machine: string; session: string; revision: number; title: string }> };

declare global {
  interface Window {
    deskDevice?: () => DeviceReadout;
  }
}

export function startDevice(me: Me): () => void {
  const org = me.org.id;
  const orgStore = new OrgStore(org, { persistence: idbOrgPersistence(), source: browserDeviceHub.orgState });
  const controller = new DeviceController({ org, store: idbDeviceStore(), orgStore, hub: browserDeviceHub, passkey: createCardsPasskey, origin: location.origin, rpId: location.hostname });
  const store = new ListingsStore({
    org: () => (orgStore.ready ? { head: orgStore.head(), certificates: orgStore.certificates() } : null),
    resolve: async (ref) => void (await controller.refresh(ref)),
  });
  activateOrgStore(orgStore);
  activateDevice(controller);
  listings = store;
  const offOrg = orgStore.onChange(() => void store.orgChanged());
  const frames: AppFrames = {
    opened: () => store.opened(),
    state: (frame) => controller.noticed(frame.version),
    listings: (frame) => void store.page(frame.records, frame.last),
    listing: (frame) => void store.listing(frame.record),
  };

  // What a push subscription is bound to follows the device: handed over again at start, then at each move.
  let bound: string | undefined;
  const offView = useDevice.subscribe((view) => {
    gridApp(view.record === null ? null : frames);
    if (view.record === null) store.clear();
    const now = view.record === null ? '' : `${view.record.deviceId} ${view.record.state.kind}`;
    if (!view.loaded || now === bound) return;
    bound = now;
    bindPushDevice(view.record?.state.kind === 'listed' ? view.record.deviceId : null);
    void recordPushOutcome(resyncPush(browserPushEnv(registerServiceWorker())));
  });
  void controller.load().catch((error: unknown) => {
    console.error('desk: reading the device', error);
    useDevice.setState({ loaded: true });
  });

  window.deskDevice = () => {
    const { record, head } = useDevice.getState();
    const listed = [...store.listings().values()].map(({ body }: { body: Listing }) => ({ machine: body.machine, session: body.session, revision: body.revision, title: body.fields.title }));
    return { state: record?.state.kind ?? null, deviceId: record?.deviceId ?? null, version: head?.version ?? null, listings: listed };
  };
  return () => {
    offView();
    offOrg();
    gridApp(null);
    bindPushDevice(null);
    activateDevice(null);
    activateOrgStore(null);
    if (listings === store) listings = null;
    delete window.deskDevice;
  };
}

/** Re-reads the org state for `reason` (the cards view's opening, a push landing: at most once a minute each). */
export function refreshOrg(reason: string): void {
  void deviceController()?.refresh(reason);
}
