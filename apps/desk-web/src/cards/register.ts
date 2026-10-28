// This browser's registration as a `web-cards` device (P5 O13 M3, §B; RL §5.3): the owner's Mac runs
// `deployment admin pair --class web-cards`, which prints a pairing code carrying the org's root pins and a secret `k`;
// pasted here, the code is checked against who is signed in (its hub, org and member), then the device makes its
// non-extractable channel key and its cards passkey, posts the entry with its MAC under `k` to the hub's pending list,
// and waits for the Mac to sign it into a successor, reading the head every 5 s and at each `state` notice.
//
//   none ──register──▶ pending {expires} ──the head lists it──▶ listed {version} ──a head drops it──▶ removed {version}
//                            └──── its entry's TTL passes ────▶ expired
//
// Both screens show the entry's fingerprint (§A's `pairingFingerprint` over the org, the member and the whole entry),
// which the owner compares before approving: `k` travels by the clipboard, so `k` alone admits nothing. The device is
// listed only when the head carries its entry exactly as it was posted; a head that stops listing it, or drops the
// member, moves it to `removed`, and its keys stay until the owner forgets them (Forget).
import {
  decodePairingCode,
  generateSigningKey,
  pairingFingerprint,
  pairingMac,
  base64urlDecode,
  base64urlEncode,
  canonicalize,
  type Device,
  type OrgPins,
  type Passkey,
  type SignedOrgState,
} from 'org-protocol';
import { create } from 'zustand';
import type { Me } from '../hub/me';
import type { DeviceHub } from './hub';
import type { DeviceRecord, DeviceState, DeviceStore } from './device-store';
import type { OrgStore, SyncResult } from './org-store';

/** How often a pending device reads the head while it waits for the Mac. */
export const PENDING_POLL_MS = 5000;

export class RegisterError extends Error {}

/** What the Device panel draws. `record` holds the channel key, a CryptoKey no script can read. */
export type DeviceView = {
  loaded: boolean;
  record: DeviceRecord | null;
  /** The entry's fingerprint, `xxxxx-xxxxx`, as the Mac shows it. */
  fingerprint: string | null;
  /** The verified head's version and when it was issued; null until a first sync verified. */
  head: { version: number; issued: string } | null;
  /** Why the last read of the hub's state adopted nothing it served; null when it did. */
  refused: string | null;
};

const EMPTY: DeviceView = { loaded: false, record: null, fingerprint: null, head: null, refused: null };

export const useDevice = create<DeviceView>()(() => EMPTY);

export type DeviceDeps = {
  /** The signed-in member's org, whose device this is. */
  org: string;
  store: DeviceStore;
  orgStore: OrgStore;
  hub: DeviceHub;
  passkey: (me: Me, rpId: string) => Promise<Passkey>;
  /** This page's origin: the hub a code must name. */
  origin: string;
  /** The passkey's relying party: the hub's hostname. */
  rpId: string;
  now?: () => number;
  /** Where the view goes (the app's `useDevice`; a suite's own store). */
  view?: typeof useDevice;
};

/** The entry as the device posted it and the state will list it, before its endorsement. */
export function deviceEntry(record: Pick<DeviceRecord, 'deviceId' | 'channelPub' | 'passkey'>): Omit<Device, 'endorsement'> {
  return { id: record.deviceId, class: 'web-cards', keyStorage: 'webcrypto', channelPub: record.channelPub, passkey: record.passkey };
}

/** Whether `head` lists the device under its member exactly as it was posted (its endorsement aside). */
export function listedIn(record: DeviceRecord, head: SignedOrgState): boolean {
  const member = head.state.members.find((m) => m.id === record.member);
  const entry = member?.devices.find((d) => d.id === record.deviceId);
  if (entry === undefined) return false;
  const listed: Partial<Device> = { ...entry };
  delete listed.endorsement;
  return canonicalize(listed) === canonicalize(deviceEntry(record));
}

/** The device's state once `head` (null before a first sync) is the newest verified, at `now`. */
export function deviceStateIn(record: DeviceRecord, head: SignedOrgState | null, now: number): DeviceState {
  if (head !== null && listedIn(record, head)) return { kind: 'listed', version: head.state.version };
  const was = record.state;
  if (was.kind === 'listed') return { kind: 'removed', version: head?.state.version ?? was.version };
  if (was.kind === 'pending' && now >= Date.parse(was.expires)) return { kind: 'expired' };
  return was;
}

export class DeviceController {
  #record: DeviceRecord | null = null;
  #poll: ReturnType<typeof setInterval> | null = null;
  #stopped = false;
  /**
   * Every change of the device's record runs here, one after the other: a judgement that began before Forget either
   * wrote before Forget deleted, or finds no record once it runs, so nothing persists past Forget.
   */
  #writes: Promise<unknown> = Promise.resolve();
  readonly #off: () => void;

  constructor(private readonly deps: DeviceDeps) {
    this.#off = deps.orgStore.onChange(() => void this.#judge());
  }

  #now(): number {
    return (this.deps.now ?? Date.now)();
  }

  get #view() {
    return this.deps.view ?? useDevice;
  }

  get record(): DeviceRecord | null {
    return this.#record;
  }

  /** Reads what the device kept, and brings it up to date with the hub's state when there is a device. */
  async load(): Promise<void> {
    await this.#serially(async () => {
      this.#record = await this.deps.store.load(this.deps.org);
      if (this.#record !== null) await this.deps.orgStore.load();
    });
    // A pending pairing whose TTL passed while the app was closed reads expired whether or not the hub answers.
    await this.#judge({ loaded: true });
    if (this.#record !== null) {
      this.#watchPending();
      await this.sync().catch((error: unknown) => console.error('desk: reading the org state', error));
    }
  }

  /**
   * Registers this browser with the pairing code `text`, for `me`: refused before anything is made when a device is
   * registered already (but for an expired pairing), or when the code is not one for this hub, org and member.
   */
  async register(text: string, me: Me): Promise<DeviceRecord> {
    const held = this.#record;
    if (held !== null && held.state.kind !== 'expired') throw new RegisterError('This browser is a device of the org already. Forget it first to pair it again.');
    const code = decodePairingCode(text.trim());
    if (code === null) throw new RegisterError("That isn't a pairing code. Copy the whole code `deployment admin pair` printed (it starts smns-pair-v1.).");
    if (code.hub !== this.deps.origin) throw new RegisterError(`That code is for the desk at ${code.hub}, not this one (${this.deps.origin}).`);
    if (code.org !== me.org.id || code.member !== me.member.id) throw new RegisterError(`That code pairs a device of another ${code.org !== me.org.id ? 'org' : 'member'}, not ${me.member.email}'s in ${me.org.name}.`);

    const channel = await generateSigningKey(false);
    const passkey = await this.deps.passkey(me, this.deps.rpId);
    const record: DeviceRecord = {
      deviceId: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
      member: me.member.id,
      channelKey: channel.privateKey,
      channelPub: channel.pub,
      passkey,
      pins: { roots: code.roots, recoveryPub: code.recoveryPub },
      state: { kind: 'expired' },
    };
    const device = deviceEntry(record);
    const mac = await pairingMac(base64urlDecode(code.k), { org: code.org, member: code.member, device });
    const { id, ...fields } = device;
    const pending = await this.deps.hub.postPending({ deviceId: id, ...fields, mac });
    record.state = { kind: 'pending', expires: pending.expires };
    await this.#serially(async () => {
      if (this.#record !== held) throw new RegisterError('The device changed while pairing (forgotten or paired in another way). Try again.');
      // A new pairing verifies the org afresh from its own code's pins.
      if (held !== null) await this.deps.orgStore.forget();
      await this.deps.store.save(this.deps.org, record);
      this.#record = record;
    });
    await this.#publish({ refused: null });
    this.#watchPending();
    void this.sync().catch((error: unknown) => console.error('desk: reading the org state', error));
    return record;
  }

  /**
   * The pending poll's step: the TTL judged by the local clock first, so an unreachable hub cannot hold a pairing open
   * past it, then the hub read.
   */
  async check(): Promise<void> {
    await this.#judge();
    if (this.#record?.state.kind === 'pending') await this.sync();
  }

  /** Reads the hub's state after the held head, verified against the device's pins; the device's state after it. */
  async sync(): Promise<DeviceState['kind'] | null> {
    const record = this.#record;
    if (record === null) return null;
    const result = await this.deps.orgStore.sync(this.#pins(record));
    this.#view.setState({ refused: result.refused ?? null });
    await this.#judge();
    return this.#record?.state.kind ?? null;
  }

  /** A `state` notice from the registry socket: read the state when it is newer than the head held. */
  noticed(version: number): void {
    if (this.#record === null) return;
    const held = this.deps.orgStore.held()?.head.state.version ?? 0;
    if (version > held) void this.sync().catch((error: unknown) => console.error('desk: reading the org state', error));
  }

  /** Re-reads the state for `reason` (org-store.ts's `refresh`: at most once a minute for each reason). */
  refresh(reason: string): Promise<SyncResult | null> {
    const record = this.#record;
    if (record === null) return Promise.resolve(null);
    return this.deps.orgStore.refresh(reason, this.#pins(record));
  }

  /** Deletes the device's record, its keys with it, and the org state it held. Its entry in the org state stays until
   * the owner's Mac removes it (`deployment admin remove-device`). */
  async forget(): Promise<void> {
    this.#stopPoll();
    await this.#serially(async () => {
      this.#record = null;
      await this.deps.store.forget(this.deps.org);
      await this.deps.orgStore.forget();
    });
    this.#view.setState({ ...EMPTY, loaded: true });
  }

  stop(): void {
    this.#stopped = true;
    this.#stopPoll();
    this.#off();
  }

  #pins(record: DeviceRecord): OrgPins {
    return { roots: record.pins.roots, recoveryPub: record.pins.recoveryPub };
  }

  /** Runs `change` after every record change asked for before it. */
  #serially<T>(change: () => Promise<T>): Promise<T> {
    const run = this.#writes.then(change);
    this.#writes = run.catch(() => {});
    return run;
  }

  /** The device's state against the head now held and the local clock, kept when it moved. */
  async #judge(change: Partial<DeviceView> = {}): Promise<void> {
    await this.#serially(async () => {
      const record = this.#record;
      if (record === null) return;
      const state = deviceStateIn(record, this.deps.orgStore.held()?.head ?? null, this.#now());
      if (canonicalize(state) === canonicalize(record.state)) return;
      const next = { ...record, state };
      await this.deps.store.save(this.deps.org, next);
      this.#record = next;
    });
    await this.#publish(change);
    if (this.#record?.state.kind !== 'pending') this.#stopPoll();
  }

  /** The view of the record held now; a record that changed while its fingerprint was made is published as it is now. */
  async #publish(change: Partial<DeviceView>): Promise<void> {
    for (;;) {
      const record = this.#record;
      const fingerprint = record === null ? null : await pairingFingerprint(this.deps.org, record.member, deviceEntry(record));
      if (this.#record !== record) continue;
      const head = this.deps.orgStore.held()?.head ?? null;
      this.#view.setState({ ...change, record, fingerprint, head: head === null ? null : { version: head.state.version, issued: head.state.issued } });
      return;
    }
  }

  #watchPending(): void {
    if (this.#stopped || this.#poll !== null || this.#record?.state.kind !== 'pending') return;
    this.#poll = setInterval(() => void this.check().catch((error: unknown) => console.error('desk: reading the org state', error)), PENDING_POLL_MS);
  }

  #stopPoll(): void {
    if (this.#poll !== null) clearInterval(this.#poll);
    this.#poll = null;
  }
}

let active: DeviceController | null = null;

/** The controller the app started for the signed-in member (null before). */
export const deviceController = (): DeviceController | null => active;

/** Makes `controller` the app's, stopping the one before. */
export function activateDevice(controller: DeviceController | null): void {
  active?.stop();
  active = controller;
}

/** §B's `register`: the app's controller registering with `code`. */
export function register(code: string, me: Me): Promise<DeviceRecord> {
  if (active === null) throw new RegisterError('The device is still loading.');
  return active.register(code, me);
}

/** §B's `syncOrg`: the app's controller reading the hub's state; the device's state after it. */
export async function syncOrg(): Promise<DeviceState['kind'] | null> {
  return (await active?.sync()) ?? null;
}
