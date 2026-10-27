// The vectors' encodings checked by a second implementation: Node's own crypto (not WebCrypto) and a canonical form
// written here for the vectors' plain JSON (strings, safe integers, null, booleans), so the package does not check
// itself.
import { createHash, createHmac, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VECTOR_KEYS, VECTORS, type KeyName } from '../vectors/index.ts';

/** RFC 8785 for plain JSON without fractions: keys sorted by UTF-16 units, JSON.stringify for everything else. */
function jcs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${jcs(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const b64 = (bytes: Buffer) => bytes.toString('base64url');
const kidOf = (pub: string) => b64(createHash('sha256').update(Buffer.from(pub, 'base64url')).digest().subarray(0, 16));
const keyByKid = (kid: string) => {
  const found = (Object.keys(VECTOR_KEYS) as KeyName[]).find((name) => VECTOR_KEYS[name].kid === kid);
  if (!found) throw new Error(`no vector key ${kid}`);
  return VECTOR_KEYS[found];
};
/** ECDSA P-256 / SHA-256 over `input`, the signature in P1363 `r‖s`, by Node's crypto from the key's public JWK. */
const verifies = (input: string, sig: { kid: string; value: string }) => {
  const { jwk } = keyByKid(sig.kid);
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, format: 'jwk' });
  return verify('sha256', Buffer.from(input, 'utf8'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig.value, 'base64url'));
};
type Signed = { body: unknown; sig: { kid: string; value: string } };
const fixture = <T>(name: string) => VECTORS.fixtures[name] as T;

describe('the encodings, by a second implementation', () => {
  it('derive a kid from the first 16 bytes of SHA-256 over the 65-byte point', () => {
    for (const { pub, kid } of VECTORS.encodings.kids) {
      expect(Buffer.from(pub, 'base64url')).toHaveLength(65);
      expect(kidOf(pub)).toBe(kid);
    }
  });

  it("chain a state to the SHA-256 of its predecessor's canonical form", () => {
    const g1 = fixture<{ state: unknown }>('g1');
    const v2 = fixture<{ state: { prev: string } }>('v2');
    expect(v2.state.prev).toBe(b64(createHash('sha256').update(jcs(g1.state)).digest()));
  });

  it('sign a state over its domain and its canonical form', () => {
    const v2 = fixture<{ state: unknown; sigs: Signed['sig'][] }>('v2');
    expect(verifies(`smns-org-state-v1\n${jcs(v2.state)}`, v2.sigs[0])).toBe(true);
    expect(verifies(`smns-org-state-v2\n${jcs(v2.state)}`, v2.sigs[0])).toBe(false);
  });

  it('sign each record over its domain and its body', () => {
    for (const { domain, body, input } of VECTORS.encodings.inputs) expect(input).toBe(`${domain}\n${jcs(body)}`);
    const grant = fixture<Signed>('a grant signed by the machine owner');
    expect(verifies(`smns-org-grant-v1\n${jcs(grant.body)}`, grant.sig)).toBe(true);
  });

  it('sign an endorsement over the device without its endorsement, bound to the org and member', () => {
    const v3 = fixture<{ state: { org: string; members: Array<{ id: string; devices: Array<Record<string, unknown>> }> } }>('v3');
    const member = v3.state.members[1];
    const { endorsement, ...device } = member.devices[1] as { endorsement: Signed['sig'] };
    expect(verifies(`smns-device-endorse-v1\n${jcs({ org: v3.state.org, member: member.id, device })}`, endorsement)).toBe(true);
  });

  it("sign a log event over org, project and the event without mac and sig, and a hub/ event without its position", () => {
    const machine = fixture<Record<string, unknown> & { sig: Signed['sig'] }>("a machine's event signed by its key");
    const { sig, ...covered } = machine;
    expect(verifies(`smns-hub-log-v2\norg-vectors\nproj-1\n${jcs(covered)}`, sig)).toBe(true);
    expect(verifies(`smns-hub-log-v2\norg-vectors\nproj-2\n${jcs(covered)}`, sig)).toBe(false);

    const human = fixture<Record<string, unknown> & { sig: Signed['sig'] }>("a member's words signed by their device's channel key");
    const { sig: humanSig, writer, seq, ts, ...draft } = human;
    expect([typeof writer, typeof seq, typeof ts]).toEqual(['string', 'number', 'string']);
    expect(verifies(`smns-hub-log-v2\norg-vectors\nproj-1\n${jcs(draft)}`, humanSig)).toBe(true);
  });

  it("dual-code an event: DX1's mac covers the v2 sig, and the v2 sig leaves the mac out", () => {
    for (const { project, orgKey, event } of VECTORS.dual) {
      const { mac, ...rest } = event as { mac: { nonce: string; value: string } } & Record<string, unknown>;
      expect(rest).toHaveProperty('sig');
      const v1: Record<string, unknown> = { ...rest, mac: { nonce: mac.nonce } };
      if (String(rest.writer).startsWith('hub/')) for (const field of ['writer', 'seq', 'ts']) delete v1[field];
      const code = createHmac('sha256', Buffer.from(orgKey, 'base64url')).update(`smns-hub-log-v1\n${project}\n${jcs(v1)}`).digest();
      expect(b64(code)).toBe(mac.value);
    }
  });
});
