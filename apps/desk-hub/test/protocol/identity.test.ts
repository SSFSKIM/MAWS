import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../../src/protocol/base64url';
import {
  decodeCode,
  decodeEnrollmentCode,
  decodeEnrollmentCodeV2,
  delegationFor,
  encodeEnrollmentCodeV2,
  NEVER_OFFLINE,
  NO_USE_CAP,
  decodeProvisioningCode,
  encodeEnrollmentCode,
  encodeProvisioningCode,
  isMachineName,
  machineNameKey,
  machineProjectId,
  serviceTokenName,
  type EnrollmentCode,
  type EnrollmentCodeV2,
  type ProvisioningCode,
} from '../../src/protocol/identity';
import machineProjects from '../../src/protocol/vectors/machine-project.json';

const code = (): EnrollmentCode => ({
  hub: 'https://desk-hub.example.workers.dev',
  org: 'o-1',
  token: 'tok_abc',
  machine: 'SK.local',
  key: base64urlEncode(new Uint8Array(32).fill(9)),
});

describe('the enrollment code (built in the browser, pasted at the prompt of `sminos hub enroll`)', () => {
  it('round-trips', () => {
    const text = encodeEnrollmentCode(code());
    expect(text.startsWith('smns-enroll-v1.')).toBe(true);
    expect(text).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(decodeEnrollmentCode(text)).toEqual(code());
  });

  it('admits a local hub over http only on a loopback host', () => {
    expect(decodeEnrollmentCode(encodeEnrollmentCode({ ...code(), hub: 'http://127.0.0.1:8787' })).hub).toBe('http://127.0.0.1:8787');
    expect(() => encodeEnrollmentCode({ ...code(), hub: 'http://hub.example.com' })).toThrow(TypeError);
  });

  it.each([
    ['another prefix', (t: string) => t.replace('smns-enroll-v1.', 'smns-enroll-v2.')],
    ['a damaged body', (t: string) => t.slice(0, -4)],
  ])('refuses %s', (_label, damage) => {
    expect(() => decodeEnrollmentCode(damage(encodeEnrollmentCode(code())))).toThrow(TypeError);
  });

  it('refuses a key spelled other than canonically: spare bits set, or padding (DX1: one spelling per value)', () => {
    const key = code().key;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const respelled = key.slice(0, -1) + alphabet[alphabet.indexOf(key.at(-1)!) + 1];
    for (const variant of [respelled, `${key}=`]) {
      const body = base64urlEncode(new TextEncoder().encode(JSON.stringify({ ...code(), key: variant })));
      expect(() => decodeEnrollmentCode(`smns-enroll-v1.${body}`)).toThrow(TypeError);
      expect(() => encodeEnrollmentCode({ ...code(), key: variant })).toThrow(TypeError);
    }
  });

  it.each([
    ['a key that is not 256 bits', { key: base64urlEncode(new Uint8Array(16)) }],
    ['a machine name that is not admitted', { machine: 'hub' }],
    ['an empty token', { token: '' }],
  ])('refuses %s', (_label, change) => {
    expect(() => encodeEnrollmentCode({ ...code(), ...change })).toThrow(TypeError);
  });
});

const provision = (): ProvisioningCode => ({
  hub: 'https://desk-hub.example.workers.dev',
  org: 'o-1',
  token: 'secret_abc',
  prefix: 'dc-',
  key: base64urlEncode(new Uint8Array(32).fill(7)),
});
/** A provisioning code's text over any JSON body, as a hand-built one would be. */
const provisionText = (body: unknown) => `smns-provision-v1.${base64urlEncode(new TextEncoder().encode(JSON.stringify(body)))}`;

describe("the provisioning code (a reusable key's code, built in the browser, piped into `sminos hub enroll`)", () => {
  it('round-trips under its own prefix', () => {
    const text = encodeProvisioningCode(provision());
    expect(text.startsWith('smns-provision-v1.')).toBe(true);
    expect(text).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(decodeProvisioningCode(text)).toEqual(provision());
  });

  it('is read by decodeCode, as is a one-time code, each tagged with its kind', () => {
    expect(decodeCode(encodeProvisioningCode(provision()))).toEqual({ kind: 'provision', ...provision() });
    expect(decodeCode(encodeEnrollmentCode(code()))).toEqual({ kind: 'enroll', ...code() });
  });

  it('is refused by the one-time decoder, which an older sminos ports, at its prefix', () => {
    expect(() => decodeEnrollmentCode(encodeProvisioningCode(provision()))).toThrow(new TypeError('enrollment code: not smns-enroll-v1'));
  });

  it.each([
    ['another prefix', 'smns-provision-v2.' + encodeProvisioningCode(provision()).slice('smns-provision-v1.'.length), 'provisioning code: not smns-provision-v1'],
    ['a damaged body', encodeProvisioningCode(provision()).slice(0, -4), 'provisioning code: damaged'],
    ['a body that is not an object', provisionText('dc-'), 'provisioning code: damaged'],
    ['no hub', provisionText({ ...provision(), hub: undefined }), 'provisioning code: no hub'],
    ['no org', provisionText({ ...provision(), org: '' }), 'provisioning code: no org'],
    ['no token', provisionText({ ...provision(), token: 7 }), 'provisioning code: no token'],
    ['no prefix', provisionText({ ...provision(), prefix: undefined }), 'provisioning code: no prefix'],
    ['an empty prefix', provisionText({ ...provision(), prefix: '' }), 'provisioning code: no prefix'],
    ['a prefix that is not a string', provisionText({ ...provision(), prefix: ['dc-'] }), 'provisioning code: no prefix'],
    ['no key', provisionText({ ...provision(), key: undefined }), 'provisioning code: no key'],
    ['a hub that is not a URL', provisionText({ ...provision(), hub: 'desk hub' }), 'provisioning code: the hub is not a URL'],
    ['a hub that is not https', provisionText({ ...provision(), hub: 'http://hub.example.com' }), 'provisioning code: the hub is not https'],
    ['the prefix hub', provisionText({ ...provision(), prefix: 'hub' }), 'provisioning code: the prefix is not admitted'],
    ['a prefix starting with a dash', provisionText({ ...provision(), prefix: '-x' }), 'provisioning code: the prefix is not admitted'],
    ['a prefix of 64 characters', provisionText({ ...provision(), prefix: 'd'.repeat(64) }), 'provisioning code: the prefix is not admitted'],
    ['a key that is not base64url', provisionText({ ...provision(), key: 'not base64!' }), 'provisioning code: the key is not base64url'],
    ['a key that is not 256 bits', provisionText({ ...provision(), key: base64urlEncode(new Uint8Array(16)) }), 'provisioning code: the key is not 256 bits'],
  ])('refuses %s, in the words the kind names', (_label, text, message) => {
    expect(() => decodeProvisioningCode(text)).toThrow(new TypeError(message));
    // decodeCode words a refusal by the kind its prefix named; another prefix is neither kind.
    expect(() => decodeCode(text)).toThrow(new TypeError(text.startsWith('smns-provision-v1.') ? message : 'enrollment code: not smns-enroll-v1 or smns-provision-v1'));
  });

  it("words a one-time code's refusal as the one-time decoder does, and an unknown prefix as neither kind", () => {
    const noMachine = `smns-enroll-v1.${base64urlEncode(new TextEncoder().encode(JSON.stringify({ ...code(), machine: '' })))}`;
    expect(() => decodeCode(noMachine)).toThrow(new TypeError('enrollment code: no machine'));
    expect(() => decodeCode('smns-other-v1.e30')).toThrow(new TypeError('enrollment code: not smns-enroll-v1 or smns-provision-v1'));
    expect(() => decodeCode('')).toThrow(new TypeError('enrollment code: not smns-enroll-v1 or smns-provision-v1'));
  });

  it('refuses to encode what it would refuse to decode', () => {
    expect(() => encodeProvisioningCode({ ...provision(), prefix: 'legacy' })).toThrow(new TypeError('provisioning code: the prefix is not admitted'));
    expect(() => encodeProvisioningCode({ ...provision(), token: '' })).toThrow(new TypeError('provisioning code: no token'));
  });
});

describe('machine names', () => {
  it.each(['SK.local', 'mini', 'Mac-mini.local', 'build_2'])('admits %s', (name) => {
    expect(isMachineName(name)).toBe(true);
  });

  it.each(['', 'hub', 'HUB', 'legacy', 'a/b', '.hidden', '-x', 'with space', 'é', 'x'.repeat(64)])('refuses %j', (name) => {
    expect(isMachineName(name)).toBe(false);
  });

  it('compares names without case, since a case-insensitive disk would put two writers in one file', () => {
    expect(machineNameKey('SK.local')).toBe(machineNameKey('sk.LOCAL'));
  });

  it('names the machine’s service token after the org and the machine', () => {
    expect(serviceTokenName('o-1', 'SK.local')).toBe('desk-o-1-SK.local');
  });
});

describe("a machine's project id (the committed vectors, written by generate-machine-project.py from Python's uuid)", () => {
  it.each(machineProjects.vectors)('$why', ({ org, machine, id }) => {
    expect(machineProjectId(org, machine)).toBe(id);
  });

  it('is a version 5 uuid of the URL namespace, and a .smns project id', () => {
    expect(machineProjects.namespace).toBe('6ba7b811-9dad-11d1-80b4-00c04fd430c8');
    for (const { id } of machineProjects.vectors) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

const codeV2 = (): EnrollmentCodeV2 => ({
  hub: 'https://desk-hub.example.workers.dev',
  token: 'tok_abc',
  roots: [base64urlEncode(new Uint8Array(16).fill(1))],
  recoveryPub: base64urlEncode(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i))),
  k: base64urlEncode(new Uint8Array(32).fill(3)),
});
const v2Text = (body: unknown) => `smns-enroll-v2.${base64urlEncode(new TextEncoder().encode(JSON.stringify(body)))}`;

describe('the v2 enrollment code (RL §5.3: the org’s trust anchors and a pairing secret, no org key)', () => {
  it('round-trips, with or without the machine it re-enrolls', () => {
    const text = encodeEnrollmentCodeV2(codeV2());
    expect(text.startsWith('smns-enroll-v2.')).toBe(true);
    expect(text).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(decodeEnrollmentCodeV2(text)).toEqual(codeV2());
    expect(decodeEnrollmentCodeV2(encodeEnrollmentCodeV2({ ...codeV2(), machine: 'mini' }))).toEqual({ ...codeV2(), machine: 'mini' });
  });

  it('carries no org key, and is refused by the v1 decoder at its prefix', () => {
    expect(Object.keys(decodeEnrollmentCodeV2(encodeEnrollmentCodeV2(codeV2()))).sort()).toEqual(['hub', 'k', 'recoveryPub', 'roots', 'token']);
    expect(() => decodeEnrollmentCode(encodeEnrollmentCodeV2(codeV2()))).toThrow(new TypeError('enrollment code: not smns-enroll-v1'));
    expect(() => decodeCode(encodeEnrollmentCodeV2(codeV2()))).toThrow(TypeError);
  });

  it.each([
    ['a v1 prefix', encodeEnrollmentCode(code()), 'enrollment code: not smns-enroll-v2'],
    ['a damaged body', encodeEnrollmentCodeV2(codeV2()).slice(0, -4), 'enrollment code: damaged'],
    ['no token', v2Text({ ...codeV2(), token: '' }), 'enrollment code: no token'],
    ['a hub that is not https', v2Text({ ...codeV2(), hub: 'http://hub.example.com' }), 'enrollment code: the hub is not https'],
    ['no roots', v2Text({ ...codeV2(), roots: [] }), 'enrollment code: the roots are not key ids'],
    ['a root that is not a key id', v2Text({ ...codeV2(), roots: [base64urlEncode(new Uint8Array(32))] }), 'enrollment code: the roots are not key ids'],
    ['a recovery key that is not a point', v2Text({ ...codeV2(), recoveryPub: base64urlEncode(new Uint8Array(65)) }), 'enrollment code: the recovery key is not a public key'],
    ['a pairing secret under 128 bits', v2Text({ ...codeV2(), k: base64urlEncode(new Uint8Array(15)) }), 'enrollment code: the pairing secret is not 128 to 512 bits'],
    ['a machine name that is not admitted', v2Text({ ...codeV2(), machine: 'hub' }), 'enrollment code: the machine name is not admitted'],
    ['an org key', v2Text({ ...codeV2(), key: base64urlEncode(new Uint8Array(32)) }), 'enrollment code: unknown field key'],
  ])('refuses %s', (_label, text, message) => {
    expect(() => decodeEnrollmentCodeV2(text)).toThrow(new TypeError(message));
  });
});

describe('a provisioning key re-issued as a delegation (RL §5.3)', () => {
  const key = { id: 'a'.repeat(32), prefix: 'dc-', expires: '2027-01-01T00:00:00.000Z', max_uses: 5, offline_revoke_s: 21_600 };

  it('carries the key’s id, prefix, expiry and terms, with the admin’s pub and owners', () => {
    expect(delegationFor(key, 'PUB', 'org')).toEqual({ id: key.id, pub: 'PUB', prefix: 'dc-', expires: key.expires, maxUses: 5, offlineRevokeS: 21_600, owners: 'org' });
  });

  it('maps "no cap" and "never" to the numbers RL5 requires', () => {
    expect(delegationFor({ ...key, max_uses: null, offline_revoke_s: null }, 'PUB', ['m'])).toMatchObject({ maxUses: NO_USE_CAP, offlineRevokeS: NEVER_OFFLINE });
    expect(NO_USE_CAP).toBe(Number.MAX_SAFE_INTEGER);
    expect(NEVER_OFFLINE).toBe(0);
  });
});
