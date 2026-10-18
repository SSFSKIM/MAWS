import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../../src/protocol/base64url';
import { decodeEnrollmentCode, encodeEnrollmentCode, isMachineName, machineNameKey, machineProjectId, serviceTokenName, type EnrollmentCode } from '../../src/protocol/identity';
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
