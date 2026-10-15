import { describe, expect, it } from 'vitest';
import vectorsFile from '../../src/protocol/vectors/codes.json';
import { base64urlDecode } from '../../src/protocol/base64url';
import { coveredBytes, DOMAINS, importOrgKey, inputSha256, newNonce, seal, sealRpc, verify, verifyRpc, type ShapeKind } from '../../src/protocol/codes';
import type { HumanDraft, LogEvent } from '../../src/protocol/log';
import type { Rpc } from '../../src/protocol/rpc';

type Vector = { name: string; domain: string; org_key: string; project: string; input: Record<string, unknown>; covered: string; covered_hex: string; code: string };
type Negative = { name: string; of: string; why: string; domain: string; org_key: string; project: string; input: Record<string, unknown> };
const { vectors, negatives, digest } = vectorsFile as unknown as { vectors: Vector[]; negatives: Negative[]; digest: { input: Record<string, string>; input_sha256: string } };

const kindOf = (domain: string): ShapeKind => {
  const found = (Object.entries(DOMAINS) as Array<[ShapeKind, string]>).find(([, d]) => d === domain);
  if (!found) throw new Error(`no kind for ${domain}`);
  return found[0];
};
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const keyOf = (b64: string) => importOrgKey(base64urlDecode(b64));
const verifyAny = async (kind: ShapeKind, keyB64: string, project: string, input: Record<string, unknown>) => {
  const key = await keyOf(keyB64);
  return kind === 'rpc' ? verifyRpc(key, input as unknown as Rpc, project) : verify(key, kind, project, input as never);
};

describe('the committed vectors (written by generate.py, an independent implementation)', () => {
  it('cover every case the plan names', () => {
    expect(vectors.map((v) => v.name)).toEqual(['say-ascii', 'message-unicode', 'hub-human', 'nested-object', 'rpc-decide', 'raised', 'settled', 'delivery']);
    expect(negatives.map((v) => v.name)).toEqual(expect.arrayContaining(['hub-human-fresh-nonce', 'say-text-changed', 'hub-human-other-project']));
  });

  describe.each(vectors)('$name', (v) => {
    const kind = kindOf(v.domain);

    it('covers the bytes the vector gives', () => {
      const bytes = coveredBytes(kind, v.project, v.input as never);
      expect(hex(bytes)).toBe(v.covered_hex);
      expect(new TextDecoder().decode(bytes)).toBe(v.covered);
    });

    it('seals to the vector’s code', async () => {
      const key = await keyOf(v.org_key);
      if (kind === 'rpc') {
        const draft: Partial<Rpc> = { ...(v.input as unknown as Rpc) };
        delete draft.mac;
        expect(await sealRpc(key, draft as Omit<Rpc, 'mac'>)).toEqual(v.input);
      } else {
        const { mac, ...draft } = v.input as { mac: { nonce: string; value: string } };
        expect(await seal(key, kind, v.project, draft as never, mac.nonce)).toEqual(v.input);
      }
    });

    it('verifies', async () => {
      expect(await verifyAny(kind, v.org_key, v.project, v.input)).toBe(true);
    });
  });

  describe.each(negatives)('$name ($why)', (n) => {
    it('fails verification', async () => {
      expect(await verifyAny(kindOf(n.domain), n.org_key, n.project, n.input)).toBe(false);
    });
  });

  it('digests a tool input as the lowercase hex SHA-256 of its canonical JSON', async () => {
    expect(await inputSha256(digest.input)).toBe(digest.input_sha256);
  });
});

describe('codes', () => {
  const project = '6f1c0a8e-3b2d-4c5e-9f70-8a1b2c3d4e5f';
  const human = (): HumanDraft => ({
    kind: 'human',
    from: 'human',
    member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c',
    to: '*',
    text: 'hello',
    created: '2026-10-15T08:00:00.000Z',
  });

  it('seals with a fresh 128-bit nonce when none is given, and a hub/ event still verifies after the hub sequences it', async () => {
    const key = await importOrgKey(new Uint8Array(32).fill(7));
    const sealed = await seal(key, 'log', project, human());
    expect(base64urlDecode(sealed.mac.nonce)).toHaveLength(16);
    const stored = { ...sealed, writer: 'hub/4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c', seq: 12, ts: '2026-10-15T08:00:00.100Z' };
    expect(await verify(key, 'log', project, stored)).toBe(true);
  });

  it('refuses a field the code does not cover, such as `via` added to an honest web event', async () => {
    const key = await importOrgKey(new Uint8Array(32).fill(7));
    const sealed = await seal(key, 'log', project, human());
    expect(await verify(key, 'log', project, { ...sealed, via: 'mini' } as unknown as LogEvent)).toBe(false);
  });

  it('refuses a code made with another org key', async () => {
    const sealed = await seal(await importOrgKey(new Uint8Array(32).fill(7)), 'log', project, human());
    expect(await verify(await importOrgKey(new Uint8Array(32).fill(8)), 'log', project, sealed)).toBe(false);
  });

  it('refuses a shape without a code, or with a code that is not base64url', async () => {
    const key = await importOrgKey(new Uint8Array(32).fill(7));
    const sealed = await seal(key, 'log', project, human());
    expect(await verify(key, 'log', project, { ...sealed, mac: { nonce: sealed.mac.nonce } } as never)).toBe(false);
    expect(await verify(key, 'log', project, { ...sealed, mac: { nonce: sealed.mac.nonce, value: '***' } })).toBe(false);
    expect(await verify(key, 'log', project, { ...human() } as never)).toBe(false);
  });

  it('refuses an RPC verified against a project other than its own', async () => {
    const key = await importOrgKey(new Uint8Array(32).fill(7));
    const rpc = await sealRpc(key, {
      rpc: 'interrupt',
      project,
      machine: 'mini',
      member: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c',
      created: '2026-10-15T08:00:00.000Z',
      nonce: newNonce(),
      args: { session: '67646a1b-2f5e-4c1d-8a3b-9c0d1e2f3a4b' },
    });
    expect(await verifyRpc(key, rpc, project)).toBe(true);
    expect(await verifyRpc(key, rpc, '0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59')).toBe(false);
    expect(await verifyRpc(key, { ...rpc, project: '0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59' }, '0d9e8f7a-6b5c-4d3e-a2f1-0e9d8c7b6a59')).toBe(false);
  });

  it('takes only a 256-bit org key', async () => {
    await expect(importOrgKey(new Uint8Array(16))).rejects.toThrow(TypeError);
  });
});
