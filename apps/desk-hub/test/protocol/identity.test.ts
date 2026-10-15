import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../../src/protocol/base64url';
import { decodeEnrollmentCode, encodeEnrollmentCode, isMachineName, machineNameKey, serviceTokenName, type EnrollmentCode } from '../../src/protocol/identity';

const code = (): EnrollmentCode => ({
  hub: 'https://desk-hub.example.workers.dev',
  org: 'o-1',
  token: 'tok_abc',
  machine: 'SK.local',
  key: base64urlEncode(new Uint8Array(32).fill(9)),
});

describe('the enrollment code (built in the browser, run as `sminos hub enroll <code>`)', () => {
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
