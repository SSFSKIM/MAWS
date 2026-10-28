// The phone's registration (P5 O13 M3, §B; RL §5.3) against a fake hub and an approving "Mac" that signs with the
// org's admin device, as `deployment admin pair` does: a code checked against who is signed in before anything is
// made; the entry posted with its MAC under the code's secret, its fingerprint the package's; the device listed only
// when the head carries its entry exactly; removed when a head drops it or its member; expired at its TTL; one device
// at a time; Forget emptying the store.
import {
  base64urlDecode,
  base64urlEncode,
  encodePairingCode,
  generateSigningKey,
  keyId,
  pairingFingerprint,
  signOrgState,
  verifyPairingMac,
  type PairingCode,
  type Passkey,
  type SignedOrgState,
} from 'org-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { OrgStateView, PendingDevice, PendingDeviceRequest } from 'desk-hub/protocol';
import type { Me } from '../hub/me';
import { adminDevice, endorsedBy, memberId, nextOf, rootedOrg, signedBy } from '../../test/org';
import { memoryDeviceStore } from './device-store';
import { memoryOrgPersistence, OrgStore } from './org-store';
import { DeviceController, RegisterError, deviceEntry, type DeviceView } from './register';

const ORIGIN = 'https://desk.example';
const TTL_MS = 600_000;

async function world() {
  const org = await rootedOrg('org-phone');
  const me: Me = { org: { id: org.org, name: 'Phone org', created: '', key_check: null }, member: { id: org.member, email: 'owner@example.com', role: 'admin', created: '' } };
  const k = crypto.getRandomValues(new Uint8Array(16));
  const code: PairingCode = { hub: ORIGIN, org: org.org, member: org.member, roots: org.pins.roots, recoveryPub: org.pins.recoveryPub, k: base64urlEncode(k) };
  const posted: PendingDeviceRequest[] = [];
  const passkeys: string[] = [];
  let now = Date.parse('2026-10-28T09:00:00.000Z');
  const hub = {
    chain: [org.genesis] as SignedOrgState[],
    /** Unreachable: every read fails. */
    down: false,
    /** A read waits on this, when set, and answers what the chain holds once it settles. */
    gate: null as Promise<void> | null,
    orgState: async (since: number): Promise<OrgStateView> => {
      if (hub.down) throw new TypeError('Failed to fetch');
      if (hub.gate) await hub.gate;
      return { head: hub.chain.at(-1)!, transitions: [], certificates: { certs: [], retirements: [] }, chain: hub.chain.filter((s) => s.state.version > since) };
    },
    postPending: async (request: PendingDeviceRequest): Promise<PendingDevice> => {
      posted.push(request);
      return { ...request, member: org.member, created: new Date(now).toISOString(), expires: new Date(now + TTL_MS).toISOString() };
    },
  };
  const passkey = async (_: Me, rpId: string): Promise<Passkey> => {
    passkeys.push(rpId);
    return { credentialId: base64urlEncode(crypto.getRandomValues(new Uint8Array(16))), publicKey: (await generateSigningKey()).pub, rpId };
  };
  const view = create<DeviceView>()(() => ({ loaded: false, record: null, fingerprint: null, head: null, refused: null }));
  const store = memoryDeviceStore();
  const persistence = memoryOrgPersistence();
  const controller = (over: { origin?: string } = {}) =>
    new DeviceController({
      org: org.org,
      store,
      orgStore: new OrgStore(org.org, { persistence, source: hub.orgState, now: () => now }),
      hub,
      passkey,
      origin: over.origin ?? ORIGIN,
      rpId: 'desk.example',
      now: () => now,
      view,
    });
  /** The Mac's approval: the pending entry signed into a successor under the member, endorsed by the admin device. */
  const approve = async (edit?: (entry: ReturnType<typeof deviceEntry>) => ReturnType<typeof deviceEntry>) => {
    const request = posted.at(-1)!;
    const { deviceId, ...rest } = request;
    const fields: Partial<typeof rest> = { ...rest };
    delete fields.mac;
    const device = edit ? edit({ id: deviceId, ...fields } as ReturnType<typeof deviceEntry>) : ({ id: deviceId, ...fields } as ReturnType<typeof deviceEntry>);
    const head = hub.chain.at(-1)!;
    const listed = await endorsedBy(org.org, org.member, device, org.admin);
    hub.chain.push(await signedBy(await nextOf(head, (s) => void s.members[0].devices.push(listed)), org.admin));
  };
  return { org, me, k, code, text: encodePairingCode(code), posted, passkeys, hub, view, store, controller, approve, tick: (ms: number) => (now += ms) };
}

let w: Awaited<ReturnType<typeof world>>;
beforeEach(async () => {
  w = await world();
});

describe('a pairing code', () => {
  it("is refused before anything is made when it names another org, member or hub, or isn't one", async () => {
    const c = w.controller();
    await c.load();
    const other = (change: Partial<PairingCode>) => encodePairingCode({ ...w.code, ...change });
    await expect(c.register(other({ member: '0'.repeat(32) }), w.me)).rejects.toThrow(/another member/);
    await expect(c.register(other({ org: 'org-elsewhere' }), w.me)).rejects.toThrow(/another org/);
    await expect(c.register(other({ hub: 'https://elsewhere.example' }), w.me)).rejects.toThrow(/for the desk at https:\/\/elsewhere.example/);
    await expect(c.register('smns-enroll-v2.abc', w.me)).rejects.toThrow(RegisterError);
    expect(w.passkeys).toEqual([]);
    expect(w.posted).toEqual([]);
    expect(await w.store.load(w.org.org)).toBeNull();
  });
});

describe('registration', () => {
  it('posts the entry with its MAC under the code, keeps a non-extractable channel key, and waits with the fingerprint', async () => {
    const c = w.controller();
    await c.load();
    const record = await c.register(`  ${w.text}\n`, w.me);
    expect(w.passkeys).toEqual(['desk.example']);
    const [request] = w.posted;
    expect(request).toEqual({ deviceId: record.deviceId, class: 'web-cards', keyStorage: 'webcrypto', channelPub: record.channelPub, passkey: record.passkey, mac: request.mac });
    expect(request).not.toHaveProperty('stepUpPub');
    expect(await verifyPairingMac(w.k, { org: w.org.org, member: w.org.member, device: deviceEntry(record) }, request.mac)).toBe(true);
    expect(record.channelKey.extractable).toBe(false);
    expect(record.channelKey.usages).toEqual(['sign']);
    await expect(crypto.subtle.exportKey('pkcs8', record.channelKey)).rejects.toThrow();
    expect(base64urlDecode(record.deviceId)).toHaveLength(16);
    expect(record.pins).toEqual({ roots: w.code.roots, recoveryPub: w.code.recoveryPub });
    expect(record.state).toEqual({ kind: 'pending', expires: '2026-10-28T09:10:00.000Z' });
    expect((await w.store.load(w.org.org))?.state.kind).toBe('pending');
    const view = w.view.getState();
    expect(view.fingerprint).toBe(await pairingFingerprint(w.org.org, w.org.member, deviceEntry(record)));
    expect(view.fingerprint).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    // Nothing the view or the request carries holds the key's bytes; the record holds the CryptoKey itself.
    expect(JSON.stringify(request)).not.toMatch(/"d"|privateKey/);
    c.stop();
  });

  it('is listed once the head carries its entry as posted, and the org state verified from the code', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    expect(await c.sync()).toBe('pending');
    await w.approve();
    expect(await c.sync()).toBe('listed');
    expect(c.record!.state).toEqual({ kind: 'listed', version: 2 });
    expect(w.view.getState().head).toMatchObject({ version: 2 });
    expect((await w.store.load(w.org.org))?.state).toEqual({ kind: 'listed', version: 2 });
    c.stop();
  });

  it('is not listed by an entry the hub swapped: its passkey another under the same device id and channel key', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    const swapped = (await generateSigningKey()).pub;
    await w.approve((entry) => ({ ...entry, passkey: { ...entry.passkey!, publicKey: swapped } }));
    expect(await c.sync()).toBe('pending');
    c.stop();
  });

  it('expires at its TTL when no head lists it', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    w.tick(TTL_MS);
    expect(await c.sync()).toBe('expired');
    c.stop();
  });

  it('refuses a second registration while one is pending or listed, and pairs anew once the first expired', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    await expect(c.register(w.text, w.me)).rejects.toThrow(/a device of the org already/);
    await w.approve();
    await c.sync();
    await expect(c.register(w.text, w.me)).rejects.toThrow(/a device of the org already/);
    expect(w.posted).toHaveLength(1);

    const fresh = await world();
    const d = fresh.controller();
    await d.load();
    await d.register(fresh.text, fresh.me);
    fresh.tick(TTL_MS);
    await d.sync();
    const again = await d.register(fresh.text, fresh.me);
    expect(again.state.kind).toBe('pending');
    expect(fresh.posted).toHaveLength(2);
    d.stop();
    c.stop();
  });
});

describe('a pending device with the hub out of reach', () => {
  // The controller says each failed read on the console, as the app does.
  beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('expires at its TTL by the local clock, reading nothing from the hub', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    w.hub.down = true;
    w.tick(TTL_MS);
    await c.check();
    expect(c.record!.state).toEqual({ kind: 'expired' });
    expect((await w.store.load(w.org.org))?.state).toEqual({ kind: 'expired' });
    expect(w.view.getState().record?.state).toEqual({ kind: 'expired' });
    c.stop();
  });

  it('is loaded as expired when its TTL passed while the app was closed', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    c.stop();
    w.hub.down = true;
    w.tick(TTL_MS + 1000);
    const again = w.controller();
    await again.load();
    expect(again.record!.state).toEqual({ kind: 'expired' });
    expect(w.view.getState().record?.state).toEqual({ kind: 'expired' });
    again.stop();
  });
});

describe('Forget', () => {
  it('wins over a read in flight: nothing it adopts after Forget writes the device again', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    await c.sync();
    let release!: () => void;
    w.hub.gate = new Promise((resolve) => (release = resolve));
    await w.approve();
    const reading = c.sync().catch(() => null);
    await new Promise((r) => setTimeout(r, 10));
    const forgetting = c.forget();
    release();
    await Promise.all([reading, forgetting]);
    await new Promise((r) => setTimeout(r, 20));
    expect(await w.store.load(w.org.org)).toBeNull();
    expect(c.record).toBeNull();
    expect(w.view.getState()).toMatchObject({ loaded: true, record: null, fingerprint: null });
    c.stop();
  });
});

describe('a listed device', () => {
  it('is removed when a head drops it, and when a head drops its member', async () => {
    const c = w.controller();
    await c.load();
    const record = await c.register(w.text, w.me);
    await w.approve();
    await c.sync();
    // The step that drops a device puts its key into `revoked` (RL DL 24), as `remove-device` does.
    const revoked = { keyId: await keyId(record.channelPub), holder: { member: w.org.member, device: record.deviceId, class: 'web-cards' as const, key: 'channel' as const } };
    const head = w.hub.chain.at(-1)!;
    w.hub.chain.push(
      await signedBy(
        await nextOf(head, (s) => {
          s.members[0].devices = s.members[0].devices.filter((d) => d.id !== record.deviceId);
          s.revoked.push(revoked);
        }),
        w.org.admin,
      ),
    );
    expect(await c.sync()).toBe('removed');
    expect(c.record!.state).toEqual({ kind: 'removed', version: 3 });
    c.stop();

    // A member dropped from the org takes its devices with it.
    const other = await world();
    const d = other.controller();
    await d.load();
    const phone = await d.register(other.text, other.me);
    await other.approve();
    await d.sync();
    const admin = await adminDevice('a2');
    const v2 = other.hub.chain.at(-1)!;
    const handover = await signedBy(
      await nextOf(v2, async (s) => {
        s.members.push({ id: memberId(), email: 'second@example.com', role: 'admin', devices: [admin.device] });
        s.root.keys.push(await keyId(admin.stepUp.pub));
      }),
      other.org.admin,
    );
    const dropped = await signOrgState(
      await nextOf(handover, async (s) => {
        s.members = s.members.filter((m) => m.id !== other.org.member);
        s.root.keys = [await keyId(admin.stepUp.pub)];
        for (const device of [other.org.admin.device, deviceEntry(phone)]) {
          s.revoked.push({ keyId: await keyId(device.channelPub), holder: { member: other.org.member, device: device.id, class: device.class, key: 'channel' } });
          if (device.stepUpPub) s.revoked.push({ keyId: await keyId(device.stepUpPub), holder: { member: other.org.member, device: device.id, class: device.class, key: 'step-up' } });
        }
      }),
      [admin.stepUp],
    );
    other.hub.chain.push(handover, dropped);
    expect(await d.sync()).toBe('removed');
    expect(d.record!.state).toEqual({ kind: 'removed', version: 4 });
    d.stop();
  });

  it('is loaded as it was left, and Forget empties the device and the org state it held', async () => {
    const first = w.controller();
    await first.load();
    await first.register(w.text, w.me);
    await w.approve();
    await first.sync();
    first.stop();
    const again = w.controller();
    await again.load();
    expect(again.record?.state).toEqual({ kind: 'listed', version: 2 });
    expect(w.view.getState()).toMatchObject({ loaded: true, head: { version: 2 } });
    await again.forget();
    expect(await w.store.load(w.org.org)).toBeNull();
    expect(w.view.getState()).toMatchObject({ loaded: true, record: null, fingerprint: null, head: null });
    again.stop();
  });

  it('reads the state at a notice newer than its head, and not at one it holds', async () => {
    const c = w.controller();
    await c.load();
    await c.register(w.text, w.me);
    await c.sync();
    const reads = () => w.hub.chain.length;
    await w.approve();
    c.noticed(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.record!.state.kind).toBe('pending');
    c.noticed(reads());
    await expect.poll(() => c.record!.state.kind).toBe('listed');
    c.stop();
  });
});
