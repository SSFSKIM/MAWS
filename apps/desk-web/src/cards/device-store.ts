// This browser as a `web-cards` device of the org (P5 O13 §B; RL §5.3, §5.10): its record in IndexedDB's `device`
// store, keyed by org id. The channel key is a non-extractable P-256 CryptoKey, which IndexedDB keeps without exposing
// its bytes, so no page script, log line or request ever carries it; the passkey's private half is the authenticator's.
// The pins are the pairing code's (the org's root key ids and its recovery key), never the hub's: the org store
// verifies its first sync against them.
import type { B64, MemberId, Passkey } from 'org-protocol';
import { committed, DESK_DB, done, openDesk } from '../store/idb';

/** Where the device stands: posted and waiting for the Mac's approval, listed in the head, or neither any more. */
export type DeviceState = { kind: 'pending'; expires: string } | { kind: 'listed'; version: number } | { kind: 'expired' } | { kind: 'removed'; version: number };

export type DeviceRecord = {
  deviceId: string;
  member: MemberId;
  /** Non-extractable, P-256, `sign`. */
  channelKey: CryptoKey;
  /** The channel key's public point, uncompressed (65 bytes), base64url. */
  channelPub: B64;
  passkey: Passkey;
  pins: { roots: B64[]; recoveryPub: B64 };
  state: DeviceState;
};

export interface DeviceStore {
  load(org: string): Promise<DeviceRecord | null>;
  save(org: string, record: DeviceRecord): Promise<void>;
  forget(org: string): Promise<void>;
}

/** Whether `value` is a record this code wrote: anything else stored under the org is read as no device. */
function isDeviceRecord(value: unknown): value is DeviceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<DeviceRecord>;
  return typeof r.deviceId === 'string' && typeof r.member === 'string' && r.channelKey instanceof CryptoKey && !r.channelKey.extractable && typeof r.channelPub === 'string' && typeof r.passkey === 'object' && typeof r.pins === 'object' && typeof r.state === 'object';
}

export function idbDeviceStore(): DeviceStore {
  return {
    async load(org) {
      const db = await openDesk();
      const value: unknown = await done(db.transaction(DESK_DB.device).objectStore(DESK_DB.device).get(org));
      return isDeviceRecord(value) ? value : null;
    },
    async save(org, record) {
      const tx = (await openDesk()).transaction(DESK_DB.device, 'readwrite');
      tx.objectStore(DESK_DB.device).put(record, org);
      await committed(tx);
    },
    async forget(org) {
      const tx = (await openDesk()).transaction(DESK_DB.device, 'readwrite');
      tx.objectStore(DESK_DB.device).delete(org);
      await committed(tx);
    },
  };
}

export function memoryDeviceStore(): DeviceStore {
  const records = new Map<string, DeviceRecord>();
  return {
    load: async (org) => records.get(org) ?? null,
    save: async (org, record) => void records.set(org, record),
    forget: async (org) => void records.delete(org),
  };
}
