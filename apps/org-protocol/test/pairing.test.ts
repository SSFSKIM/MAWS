// The pairing code, its MAC and the entry's fingerprint (O13 §A, RL §5.3, RL DL28): what the vectors cannot say, the
// grammar's refusals and what each field binds.
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import { enrollmentMacInput } from '../src/enrollment.ts';
import { generateSigningKey, keyId, utf8 } from '../src/keys.ts';
import {
  decodePairingCode,
  encodePairingCode,
  entryDevice,
  isPairedDeviceId,
  isRpId,
  judgeEntry,
  PAIRING_CODE_PREFIX,
  pairingFingerprint,
  pairingMac,
  pairingMacInput,
  verifyPairingMac,
  type PairingCode,
  type PairingFields,
  type PendingEntry,
} from '../src/pairing.ts';
import type { Device } from '../src/types.ts';

const ORG = 'org-pairing';
const MEMBER = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const K = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

async function fixtures() {
  const [stepUp, recovery, channel, passkey, other] = await Promise.all([1, 2, 3, 4, 5].map(() => generateSigningKey()));
  const code: PairingCode = { hub: 'https://hub.example', org: ORG, member: MEMBER, roots: [await keyId(stepUp.pub)], recoveryPub: recovery.pub, k: base64urlEncode(K) };
  const phone: Omit<Device, 'endorsement'> = {
    id: 'phone-1',
    class: 'web-cards',
    keyStorage: 'webcrypto',
    channelPub: channel.pub,
    passkey: { credentialId: base64urlEncode(Uint8Array.from([1, 2, 3, 4])), publicKey: passkey.pub, rpId: 'hub.example' },
  };
  const mac: Omit<Device, 'endorsement'> = { id: 'mac-2', class: 'native-mac', keyStorage: 'enclave', channelPub: channel.pub, stepUpPub: other.pub };
  return { code, phone, mac, other };
}

const wrap = (body: string) => PAIRING_CODE_PREFIX + base64urlEncode(utf8(body));

describe('the pairing code', () => {
  it('round-trips through its canonical encoding', async () => {
    const { code } = await fixtures();
    const text = encodePairingCode(code);
    expect(text.startsWith('smns-pair-v1.')).toBe(true);
    expect(text).toBe(wrap(canonicalize(code)));
    expect(decodePairingCode(text)).toEqual(code);
  });

  it('takes a loopback hub over http, for the suites, and nothing else but https', async () => {
    const { code } = await fixtures();
    expect(decodePairingCode(encodePairingCode({ ...code, hub: 'http://127.0.0.1:8747' }))?.hub).toBe('http://127.0.0.1:8747');
    for (const hub of ['http://hub.example', 'ftp://hub.example', 'https://hub.example/', 'https://hub.example/path', 'hub.example', '']) {
      expect(() => encodePairingCode({ ...code, hub }), hub).toThrow(TypeError);
      expect(decodePairingCode(wrap(canonicalize({ ...code, hub }))), hub).toBeNull();
    }
  });

  it('answers null for any field out of its grammar', async () => {
    const { code } = await fixtures();
    const bad: Array<[string, unknown]> = [
      ['org', ''],
      ['org', 7],
      ['member', 'not-a-member'],
      ['roots', []],
      ['roots', [code.roots[0], code.roots[0]]],
      ['roots', ['AAAA']],
      ['recoveryPub', code.roots[0]],
      ['k', base64urlEncode(new Uint8Array(32))],
      ['k', base64urlEncode(new Uint8Array(8))],
    ];
    for (const [field, value] of bad) {
      const changed = { ...code, [field]: value };
      expect(decodePairingCode(wrap(canonicalize(changed))), `${field} ${JSON.stringify(value)}`).toBeNull();
      expect(() => encodePairingCode(changed as PairingCode), field).toThrow(TypeError);
    }
    const missing: Record<string, unknown> = { ...code };
    delete missing.k;
    expect(decodePairingCode(wrap(canonicalize(missing)))).toBeNull();
    expect(decodePairingCode(wrap(canonicalize({ ...code, extra: 1 })))).toBeNull();
  });

  it('answers null for anything but the one spelling of a code', async () => {
    const { code } = await fixtures();
    const text = encodePairingCode(code);
    expect(decodePairingCode(text.slice(PAIRING_CODE_PREFIX.length))).toBeNull();
    expect(decodePairingCode(`smns-enroll-v2.${text.slice(PAIRING_CODE_PREFIX.length)}`)).toBeNull();
    expect(decodePairingCode(`${text}=`)).toBeNull();
    expect(decodePairingCode(wrap(JSON.stringify(code, null, 1)))).toBeNull();
    expect(decodePairingCode(wrap('[1,2]'))).toBeNull();
    expect(decodePairingCode(wrap('{'))).toBeNull();
    expect(decodePairingCode(PAIRING_CODE_PREFIX + base64urlEncode(Uint8Array.from([0xff, 0xfe])))).toBeNull();
    expect(decodePairingCode(` ${text}`)).toBeNull();
  });
});

describe('the pairing MAC', () => {
  it("length-prefixes its domain, the org, the member and the device entry's canonical form", async () => {
    const { phone } = await fixtures();
    const fields: PairingFields = { org: ORG, member: MEMBER, device: phone };
    const parts = ['smns-pair-mac-v1', ORG, MEMBER, canonicalize(phone)].map((s) => Buffer.from(s, 'utf8'));
    const input = Buffer.concat(parts.flatMap((p) => [Buffer.from([p.length >>> 24, (p.length >>> 16) & 255, (p.length >>> 8) & 255, p.length & 255]), p]));
    expect(Buffer.from(pairingMacInput(fields)).equals(input)).toBe(true);
    expect(await pairingMac(K, fields)).toBe(createHmac('sha256', K).update(input).digest('base64url'));
  });

  it("verifies its own MAC, and refuses one over any field the hub could substitute", async () => {
    const { phone, mac: macDevice, other } = await fixtures();
    for (const device of [phone, macDevice]) {
      const fields: PairingFields = { org: ORG, member: MEMBER, device };
      const mac = await pairingMac(K, fields);
      expect(await verifyPairingMac(K, fields, mac)).toBe(true);
      const changes: Array<Partial<Omit<Device, 'endorsement'>>> = [
        { id: 'phone-2' },
        { keyStorage: 'software' },
        { channelPub: other.pub === device.channelPub ? phone.passkey!.publicKey : other.pub },
      ];
      if (device.passkey) changes.push({ passkey: { ...device.passkey, credentialId: base64urlEncode(Uint8Array.from([9])) } }, { passkey: { ...device.passkey, rpId: 'evil.example' } });
      if (device.stepUpPub) changes.push({ stepUpPub: phone.channelPub });
      for (const change of changes) expect(await verifyPairingMac(K, { ...fields, device: { ...device, ...change } }, mac), JSON.stringify(change)).toBe(false);
      expect(await verifyPairingMac(K, { ...fields, org: 'org-other' }, mac)).toBe(false);
      expect(await verifyPairingMac(K, { ...fields, member: 'f9e8d7c6b5a4938271605f4e3d2c1b0a' }, mac)).toBe(false);
      expect(await verifyPairingMac(Uint8Array.from(K, (b) => b ^ 1), fields, mac)).toBe(false);
    }
  });

  it('answers false, never throws, for a MAC or an entry out of grammar', async () => {
    const { phone, other } = await fixtures();
    const fields: PairingFields = { org: ORG, member: MEMBER, device: phone };
    const mac = await pairingMac(K, fields);
    for (const bad of [undefined, null, 7, '', mac.slice(1), base64urlEncode(new Uint8Array(31))]) expect(await verifyPairingMac(K, fields, bad)).toBe(false);
    // A web-cards entry never carries a step-up key (RL §5.10), and an entry is checked before it is endorsed.
    const stepUp = { ...phone, stepUpPub: other.pub };
    expect(await verifyPairingMac(K, { ...fields, device: stepUp }, mac)).toBe(false);
    expect(() => pairingMacInput({ ...fields, device: stepUp })).toThrow(TypeError);
    expect(() => pairingMacInput({ ...fields, device: { ...phone, endorsement: { kid: 'x', value: 'y' } } as Device })).toThrow(TypeError);
    expect(() => pairingMacInput({ ...fields, member: 'nobody' })).toThrow(TypeError);
    expect(() => pairingMacInput({ ...fields, org: '' })).toThrow(TypeError);
  });

  it('refuses a pairing secret below 128 bits', async () => {
    const { phone } = await fixtures();
    await expect(pairingMac(new Uint8Array(8), { org: ORG, member: MEMBER, device: phone })).rejects.toThrow(TypeError);
  });

  it("never encodes as an enrollment MAC's input", async () => {
    const { phone } = await fixtures();
    const pairing = Buffer.from(pairingMacInput({ org: ORG, member: MEMBER, device: phone }));
    const enrollment = Buffer.from(enrollmentMacInput({ name: 'mini', machinePub: phone.channelPub, ref: 'mref-mini-0000001', tokenId: 'enroll-1' }));
    expect(pairing.subarray(4, 4 + 16).toString()).toBe('smns-pair-mac-v1');
    expect(enrollment.subarray(4, 4 + 18).toString()).toBe('smns-enroll-mac-v1');
  });
});

describe("the entry's fingerprint", () => {
  const base32 = (bytes: Buffer) => {
    let bits = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    return Array.from({ length: Math.floor(bits.length / 5) }, (_, i) => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(bits.slice(5 * i, 5 * i + 5), 2)]).join('');
  };

  it("is the first ten base32 characters of SHA-256 over the MAC's own input, as xxxxx-xxxxx", async () => {
    const { phone } = await fixtures();
    const print = await pairingFingerprint(ORG, MEMBER, phone);
    expect(print).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    const ten = base32(createHash('sha256').update(pairingMacInput({ org: ORG, member: MEMBER, device: phone })).digest()).slice(0, 10);
    expect(print).toBe(`${ten.slice(0, 5)}-${ten.slice(5)}`);
  });

  it('is the same on both screens: the endorsement the listed entry gains is left out', async () => {
    const { phone } = await fixtures();
    const listed: Device = { ...phone, endorsement: { kid: base64urlEncode(new Uint8Array(16)), value: base64urlEncode(new Uint8Array(64)) } };
    expect(await pairingFingerprint(ORG, MEMBER, listed)).toBe(await pairingFingerprint(ORG, MEMBER, phone));
  });

  it("differs for an entry that kept the phone's channel key and swapped its passkey or step-up key (RL DL28)", async () => {
    const { phone, mac, other } = await fixtures();
    const print = await pairingFingerprint(ORG, MEMBER, phone);
    expect(await pairingFingerprint(ORG, MEMBER, { ...phone, passkey: { ...phone.passkey!, publicKey: other.pub } })).not.toBe(print);
    expect(await pairingFingerprint(ORG, MEMBER, { ...phone, passkey: { ...phone.passkey!, credentialId: base64urlEncode(Uint8Array.from([7])) } })).not.toBe(print);
    expect(await pairingFingerprint(ORG, MEMBER, { ...phone, passkey: { ...phone.passkey!, rpId: 'evil.example' } })).not.toBe(print);
    expect(await pairingFingerprint(ORG, MEMBER, { ...mac, stepUpPub: phone.passkey!.publicKey })).not.toBe(await pairingFingerprint(ORG, MEMBER, mac));
    expect(await pairingFingerprint('org-other', MEMBER, phone)).not.toBe(print);
  });
});

describe("the approving side's judges", () => {
  /** The entry the device posts for `device`: its fields, flat, and its MAC under `k`. */
  const entryOf = async (device: Omit<Device, 'endorsement'>, k = K): Promise<PendingEntry> => {
    const { id, ...rest } = device;
    return { deviceId: id, ...rest, mac: await pairingMac(k, { org: ORG, member: MEMBER, device }) };
  };
  const pairing = (cls: Device['class'], listed: string[] = []) => ({ org: ORG, member: MEMBER, k: K, class: cls, listed: new Set(listed) });

  it('rebuilds the device a state would list from an entry, with no field the entry lacks', async () => {
    const { phone, mac } = await fixtures();
    // The hub's own fields (`member`, `created`, `expires`) ride along on its list; they are not the device's.
    const served = { ...(await entryOf(mac)), member: MEMBER, created: '2026-10-28T00:00:00Z', expires: '2026-10-28T00:10:00Z' };
    expect(entryDevice(served)).toEqual(mac);
    const device = entryDevice(await entryOf(phone));
    expect(device).toEqual(phone);
    expect(Object.keys(device)).not.toContain('stepUpPub');
  });

  it('takes an entry of the class asked for, its MAC under the code\'s secret, as the device the successor lists', async () => {
    const { phone, mac } = await fixtures();
    expect(await judgeEntry(await entryOf(mac), pairing('native-mac'))).toEqual({ ok: true, device: mac });
    expect(await judgeEntry(await entryOf(phone), pairing('web-cards', ['mac-2']))).toEqual({ ok: true, device: phone });
  });

  it('refuses an entry whose MAC is under another secret', async () => {
    const { mac } = await fixtures();
    const entry = await entryOf(mac, Uint8Array.from(K, (b) => b ^ 1));
    expect(await judgeEntry(entry, pairing('native-mac'))).toEqual({ ok: false, why: "its MAC is not under this code's secret" });
  });

  it('refuses an entry of another class than the pairing asked for', async () => {
    const { phone, mac } = await fixtures();
    expect(await judgeEntry(await entryOf(mac), pairing('web-cards'))).toEqual({ ok: false, why: 'of class native-mac, not web-cards' });
    expect(await judgeEntry(await entryOf(phone), pairing('native-mac'))).toEqual({ ok: false, why: 'of class web-cards, not native-mac' });
  });

  it('refuses an entry whose id the head already lists', async () => {
    const { mac } = await fixtures();
    expect(await judgeEntry(await entryOf(mac), pairing('native-mac', ['mac-2']))).toEqual({ ok: false, why: 'its id is a device the head already lists' });
  });

  it('refuses an id outside base64url and a relying party that is not a host name, each MAC valid', async () => {
    const { phone, mac } = await fixtures();
    for (const id of ['mac 2', 'mac.2', '\x1b[2Kmac', 'a'.repeat(129)]) {
      expect(await judgeEntry(await entryOf({ ...mac, id }), pairing('native-mac')), id).toEqual({ ok: false, why: 'its id is outside the device id grammar (base64url)' });
    }
    for (const rpId of ['Evil.example', 'evil..example', 'a b', 'evil\x1b[31m.example']) {
      const device = { ...phone, passkey: { ...phone.passkey!, rpId } };
      expect(await judgeEntry(await entryOf(device), pairing('web-cards')), rpId).toEqual({ ok: false, why: "its passkey's rpId is not a host name" });
    }
    expect([isPairedDeviceId('mac-2'), isPairedDeviceId('A_z-09'), isPairedDeviceId(''), isPairedDeviceId('a/b'), isPairedDeviceId('a'.repeat(128))]).toEqual([true, true, false, false, true]);
    expect([isRpId('127.0.0.1'), isRpId('hub.example'), isRpId(`${'a'.repeat(63)}.example`), isRpId(`${'a'.repeat(64)}.example`), isRpId('-hub.example')]).toEqual([true, true, true, false, false]);
  });

  it('refuses what no state could list: a web-cards entry with a step-up key or with no passkey, and a malformed key', async () => {
    const { phone, other } = await fixtures();
    const stepUp = { ...(await entryOf(phone)), stepUpPub: other.pub };
    expect(await judgeEntry(stepUp, pairing('web-cards'))).toEqual({ ok: false, why: 'a web-cards entry with a step-up key, which the class never holds (RL 5.10)' });
    const noPasskey: Omit<Device, 'endorsement'> = { id: phone.id, class: 'web-cards', keyStorage: 'webcrypto', channelPub: phone.channelPub };
    expect(await judgeEntry(await entryOf(noPasskey), pairing('web-cards'))).toEqual({ ok: false, why: 'a web-cards entry with no passkey' });
    expect(await judgeEntry({ ...(await entryOf(phone)), channelPub: 'not-a-key' }, pairing('web-cards'))).toEqual({ ok: false, why: 'not a device entry the org state could list' });
  });
});
