// The vectors' encodings checked by a second implementation: Node's own crypto (not WebCrypto) and a canonical form
// written here for the vectors' plain JSON (strings, safe integers, null, booleans), so the package does not check
// itself.
import { createCipheriv, createECDH, createHash, createHmac, createPublicKey, verify } from 'node:crypto';
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

  it('length-prefix each enrollment field under the domain, and MAC it with HMAC-SHA-256', () => {
    for (const e of VECTORS.enrollment) {
      const parts = ['smns-enroll-mac-v1', e.name, e.machinePub, e.ref, e.tokenId].map((s) => Buffer.from(s, 'utf8'));
      const input = Buffer.concat(parts.flatMap((p) => [Buffer.from([p.length >>> 24, (p.length >>> 16) & 255, (p.length >>> 8) & 255, p.length & 255]), p]));
      expect(b64(input)).toBe(e.input);
      expect(b64(createHmac('sha256', Buffer.from(e.k, 'base64url')).update(input).digest())).toBe(e.mac);
    }
    const [ab, a] = VECTORS.enrollment;
    expect([ab.name, ab.ref, a.name, a.ref]).toEqual(['ab', 'cdeeeeeeeeeeeeee', 'a', 'bcdeeeeeeeeeeeeee']);
    expect(ab.mac).not.toBe(a.mac);
  });

  it("spell a pairing code, length-prefix its MAC's fields under the domain, and take the fingerprint from that input", () => {
    const p = VECTORS.pairing;
    expect(p.code).toBe(`smns-pair-v1.${b64(Buffer.from(jcs(p.decoded), 'utf8'))}`);
    const base32 = (bytes: Buffer) => {
      const bits = [...bytes].map((b) => b.toString(2).padStart(8, '0')).join('');
      return Array.from({ length: 10 }, (_, i) => 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(bits.slice(5 * i, 5 * i + 5), 2)]).join('');
    };
    for (const [fields, mac, fingerprint] of [
      [p.fields, p.mac, p.fingerprint],
      [p.swapped.fields, p.swapped.mac, p.swapped.fingerprint],
    ] as const) {
      const parts = ['smns-pair-mac-v1', fields.org, fields.member, jcs(fields.device)].map((s) => Buffer.from(s, 'utf8'));
      const input = Buffer.concat(parts.flatMap((part) => [Buffer.from([part.length >>> 24, (part.length >>> 16) & 255, (part.length >>> 8) & 255, part.length & 255]), part]));
      if (fields === p.fields) expect(b64(input)).toBe(p.input);
      expect(b64(createHmac('sha256', Buffer.from(p.decoded.k, 'base64url')).update(input).digest())).toBe(mac);
      const ten = base32(createHash('sha256').update(input).digest());
      expect(fingerprint).toBe(`${ten.slice(0, 5)}-${ten.slice(5)}`);
    }
    expect(p.swapped.fields.device.channelPub).toBe(p.fields.device.channelPub);
    expect(p.swapped.fingerprint).not.toBe(p.fingerprint);
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

/** A P-256 public key from its 65-byte point, for Node's verify. */
const pointKey = (pub: string) => {
  const point = Buffer.from(pub, 'base64url');
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(point.subarray(1, 33)), y: b64(point.subarray(33)) }, format: 'jwk' });
};
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();
const hmac = (key: Buffer, data: Buffer | string) => createHmac('sha256', key).update(data).digest();
/** HKDF-Expand for one block (at most 32 bytes), as RFC 5869 writes it. */
const expand = (prk: Buffer, info: string, length: number) => hmac(prk, Buffer.concat([Buffer.from(info, 'utf8'), Buffer.from([1])])).subarray(0, length);
const without = (value: Record<string, unknown>, ...fields: string[]) => Object.fromEntries(Object.entries(value).filter(([k]) => !fields.includes(k)));

describe("RL2's and RL4's encodings, by a second implementation", () => {
  const [t] = VECTORS.channel.transcripts;
  const h1 = JSON.parse(t.h1) as Record<string, unknown>;
  const h2 = JSON.parse(t.h2) as Record<string, unknown>;
  const h3 = JSON.parse(t.h3) as Record<string, unknown>;

  it('derive the handshake keys: ECDH, the salt over h1 and h2, HKDF-Extract and -Expand', () => {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(t.deviceEphemeral.d as string, 'base64url'));
    const z = ecdh.computeSecret(Buffer.from(h2.e as string, 'base64url'));
    const salt = sha256(jcs(h1) + jcs(without(h2, 'sig', 'mac')));
    expect(b64(salt)).toBe(t.salt);
    const prk = hmac(salt, z);
    expect(b64(expand(prk, 'smns-rl2-v1 mac r', 32))).toBe(t.kmR);
    expect(b64(expand(prk, 'smns-rl2-v1 mac i', 32))).toBe(t.kmI);
    expect(b64(expand(prk, 'smns-rl2-v1 key i2r', 32))).toBe(t.i2r.key);
    expect(b64(expand(prk, 'smns-rl2-v1 iv i2r', 4))).toBe(t.i2r.iv);
    expect(b64(expand(prk, 'smns-rl2-v1 key r2i', 32))).toBe(t.r2i.key);
    expect(b64(expand(prk, 'smns-rl2-v1 iv r2i', 4))).toBe(t.r2i.iv);
    expect(b64(expand(prk, 'smns-rl2-v1 id', 16))).toBe(t.channelId);
  });

  it('sign each side over both messages before its own, and MAC its identity', () => {
    const machineInput = `smns-rl2-v1\n${jcs({ role: 'machine', h1, h2: without(h2, 'sig', 'mac') })}`;
    const deviceInput = `smns-rl2-v1\n${jcs({ role: 'device', h1, h2: without(h2, 'sig', 'mac'), h3: without(h3, 'sig', 'mac') })}`;
    expect(machineInput).toBe(t.machineTranscript);
    expect(deviceInput).toBe(t.deviceTranscript);
    const p1363 = (pub: string, input: string, sig: unknown) =>
      verify('sha256', Buffer.from(input, 'utf8'), { key: pointKey(pub), dsaEncoding: 'ieee-p1363' }, Buffer.from((sig as { value: string }).value, 'base64url'));
    expect(p1363(t.machinePub, machineInput, h2.sig)).toBe(true);
    expect(p1363(t.devicePub, deviceInput, h3.sig)).toBe(true);
    const machineMac = `smns-rl2-v1\n${jcs({ keyId: h2.keyId, machine: h1.machine, role: 'machine' })}`;
    expect(machineMac).toBe(t.machineMacInput);
    expect(b64(hmac(Buffer.from(t.kmR, 'base64url'), machineMac))).toBe(h2.mac);
    expect(b64(hmac(Buffer.from(t.kmI, 'base64url'), t.deviceMacInput))).toBe(h3.mac);
  });

  it('seal each frame with AES-256-GCM: the header as associated data, the nonce the iv and the sequence', () => {
    for (const f of VECTORS.channel.frames) {
      const header = Buffer.alloc(10);
      header[0] = 1;
      header[1] = f.epoch & 0xff;
      header.writeBigUInt64BE(BigInt(f.seq), 2);
      const nonce = Buffer.alloc(12);
      Buffer.from(f.keys.iv, 'base64url').copy(nonce);
      nonce.writeBigUInt64BE(BigInt(f.seq), 4);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(f.keys.key, 'base64url'), nonce);
      cipher.setAAD(header);
      const body = Buffer.concat([cipher.update(Buffer.from(f.plaintext, 'base64url')), cipher.final(), cipher.getAuthTag()]);
      expect(b64(Buffer.concat([header, body])), f.name).toBe(f.frame);
    }
  });

  it('rekey by HKDF-Expand over the old key alone', () => {
    for (const { keys, next } of VECTORS.channel.rekeys) {
      const key = Buffer.from(keys.key, 'base64url');
      expect(b64(expand(key, 'smns-rl2-v1 rekey', 32))).toBe(next.key);
      expect(b64(expand(key, 'smns-rl2-v1 rekey iv', 4))).toBe(next.iv);
    }
  });

  it("sign an action over its domain and canonical form, and fingerprint what a reseal keeps", () => {
    for (const { name, action, input, digest, fingerprint } of VECTORS.encodings.actions) {
      const a = action as unknown as Record<string, unknown>;
      expect(input, name).toBe(`smns-action-v1\n${jcs(without(a, 'stepUp', 'webauthn'))}`);
      expect(b64(sha256(input))).toBe(digest);
      expect(b64(sha256(jcs(without(a, 'nonce', 'created', 'stepUp', 'webauthn'))))).toBe(fingerprint);
    }
    const stepped = fixture<Record<string, unknown> & { stepUp: string }>("an action's step-up by its device's step-up key");
    const input = `smns-action-v1\n${jcs(without(stepped, 'stepUp', 'webauthn'))}`;
    const stepUpPub = VECTORS.cases.find((c) => c.name === "an action's step-up by its device's step-up key")?.args[1] as string;
    expect(verify('sha256', Buffer.from(input, 'utf8'), { key: pointKey(stepUpPub), dsaEncoding: 'ieee-p1363' }, Buffer.from(stepped.stepUp, 'base64url'))).toBe(true);
  });

  it("make a WebAuthn assertion's DER signature over authenticatorData and the client data's hash, the challenge the action's digest", () => {
    const answer = fixture<Record<string, unknown> & { webauthn: Record<string, string> }>('a web-cards answer with its assertion');
    const passkey = VECTORS.cases.find((c) => c.name === 'a web-cards answer with its assertion')?.args[1] as { publicKey: string; rpId: string };
    const authData = Buffer.from(answer.webauthn.authenticatorData, 'base64url');
    const client = Buffer.from(answer.webauthn.clientDataJSON, 'base64url');
    expect(authData.subarray(0, 32)).toEqual(sha256(passkey.rpId));
    expect(authData[32] & 0x05).toBe(0x05);
    expect(authData.readUInt32BE(33)).toBe(5);
    const challenge = b64(sha256(`smns-action-v1\n${jcs(without(answer, 'stepUp', 'webauthn'))}`));
    expect(JSON.parse(client.toString('utf8'))).toMatchObject({ type: 'webauthn.get', challenge, origin: 'https://desk.example' });
    const signed = Buffer.concat([authData, sha256(client)]);
    expect(verify('sha256', signed, { key: pointKey(passkey.publicKey), dsaEncoding: 'der' }, Buffer.from(answer.webauthn.signature, 'base64url'))).toBe(true);
  });
});
