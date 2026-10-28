// History re-attestation (O14 M4, Interfaces §D): the digest's definition, the record's shape, and what the verifier
// does with the events it is handed. The cases a verifier in any runtime must agree on are the vectors' (`history`).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base64urlEncode } from '../src/base64url.ts';
import { canonicalize } from '../src/canonical.ts';
import { historyDigest, historyDigestStep, isHistoryAttestation, verifyHistoryAttestation, verifyHistorySigner, type StoredEvent } from '../src/history.ts';
import { generateSigningKey, keyId } from '../src/keys.ts';
import { NO_CERTIFICATES, signRecord } from '../src/records.ts';
import { SIGNING_DOMAINS, type HistoryAttestation, type OrgState } from '../src/types.ts';
import { HISTORY_CASES } from '../vectors/scenario-history.ts';
import { replayHistory } from '../vectors/replay-history.ts';
import { VECTORS } from '../vectors/index.ts';

const ORG = 'org-history';
const WRITER = 'mini/0c5f3c86-5d2e-4b8f-9a61-3e2a1b0c9d8e';
const REF = 'mref-mini-history-1';
const mac = (n: number) => ({ nonce: base64urlEncode(new Uint8Array(16).fill(n)), value: base64urlEncode(new Uint8Array(32).fill(n)) });
const event = (seq: number, writer = WRITER): StoredEvent => ({ ts: `2026-10-01T00:00:0${seq}.000Z`, writer, seq, kind: 'say', from: 'mini', to: '*', text: `say ${seq}`, mac: mac(seq) });

/** The digest as Interfaces §D writes it, with Node's own SHA-256: h_0 empty, h_i = SHA-256(h_{i-1} ‖ canonical(e_i − mac)). */
function reference(events: StoredEvent[]): string {
  let h = Buffer.alloc(0);
  for (const e of events) {
    const bare: Record<string, unknown> = { ...e };
    delete bare.mac;
    h = createHash('sha256').update(Buffer.concat([h, Buffer.from(canonicalize(bare), 'utf8')])).digest();
  }
  return base64urlEncode(h);
}

async function machine() {
  const key = await generateSigningKey();
  const state: OrgState = {
    org: ORG,
    version: 3,
    prev: null,
    issued: '2026-10-27T00:00:00.000Z',
    root: { keys: [], recoveryPub: key.pub },
    members: [],
    machines: [{ name: 'mini', ref: REF, pub: key.pub, owners: 'org' }],
    machineNames: [{ name: 'mini', ref: REF }],
    retired: [],
    revoked: [],
    delegations: [],
    projects: [],
  };
  return { key, state };
}

const body = async (events: StoredEvent[], over: Partial<HistoryAttestation> = {}): Promise<HistoryAttestation> => ({
  org: ORG,
  project: 'p1',
  writer: WRITER,
  names: ['mini'],
  upTo: events.length,
  digest: await historyDigest(events),
  created: '2026-10-28T00:00:00.000Z',
  ...over,
});

describe('the history digest', () => {
  it('is the running SHA-256 over each canonical event without its mac, from seq 1 on', async () => {
    const events = [event(1), event(2), event(3)];
    expect(await historyDigest(events)).toBe(reference(events));
    // The mac is outside it: another code over the same body digests alike; a changed body does not.
    expect(await historyDigest(events.map((e) => ({ ...e, mac: mac(9) })))).toBe(reference(events));
    expect(await historyDigest([event(1), { ...event(2), text: 'changed' }, event(3)])).not.toBe(reference(events));
    // Order and position are inside it.
    expect(await historyDigest([event(2), event(1), event(3)])).not.toBe(reference(events));
  });

  it('folds a step at a time to the same value a whole fold gives', async () => {
    const events = [event(1), event(2), event(3)];
    let h: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    for (const e of events) h = await historyDigestStep(h, e);
    expect(base64urlEncode(h)).toBe(await historyDigest(events));
  });
});

describe('the record', () => {
  it('is exactly its fields, each well formed', async () => {
    const good = await body([event(1)]);
    expect(isHistoryAttestation(good)).toBe(true);
    for (const bad of [
      { ...good, extra: 1 },
      { ...good, names: [] },
      { ...good, names: ['mini', 'MINI'] },
      { ...good, names: ['hub'] },
      { ...good, upTo: 0 },
      { ...good, upTo: 1.5 },
      { ...good, digest: 'short' },
      { ...good, created: '2026-10-28' },
      { ...good, writer: 'no-slash' },
      { ...good, org: '' },
      { ...good, project: '' },
    ]) {
      expect(isHistoryAttestation(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('the verifier', () => {
  const AT = { project: 'p1', writer: WRITER };

  it('reads the attested writer’s events up to upTo from a whole log, other writers and later events beside them', async () => {
    const { key, state } = await machine();
    const events = [event(1), event(2), event(3)];
    const record = await signRecord(SIGNING_DOMAINS.historyAttest, await body(events), key.privateKey, key.pub);
    const log = [event(1), event(1, 'other/x'), event(2), event(3), event(4)];
    expect(await verifyHistoryAttestation(record, log, state, NO_CERTIFICATES, AT)).toEqual({ ok: true, by: { ref: REF, name: 'mini' } });
    expect(await verifyHistoryAttestation(record, [event(1), event(2)], state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'short' });
    expect(await verifyHistoryAttestation(record, 'not events' as unknown as StoredEvent[], state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'short' });
  });

  it('folds exactly one event per position, 1 to upTo in turn: a gap is short, a repeat or a turn out of order is not the digest', async () => {
    const { key, state } = await machine();
    const record = await signRecord(SIGNING_DOMAINS.historyAttest, await body([event(1), event(2), event(3)]), key.privateKey, key.pub);
    expect(await verifyHistoryAttestation(record, [event(1), event(3)], state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'short' });
    expect(await verifyHistoryAttestation(record, [event(3), event(1), event(2)], state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'digest' });
    expect(await verifyHistoryAttestation(record, [event(1), event(2), event(2), event(3)], state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'digest' });
    // A hub's forged second event at seq 1, folded in beside the genuine one: the record's digest covers both, and still
    // no reader accepts it, since position 1 holds two events.
    const forged = { ...event(1), text: 'never said' };
    const doubled = await signRecord(SIGNING_DOMAINS.historyAttest, await body([event(1), forged], { upTo: 1 }), key.privateKey, key.pub);
    expect(await verifyHistoryAttestation(doubled, [event(1), forged], state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'digest' });
  });

  it('binds the record to the project and the writer the reader draws: another’s record is refused, whatever its events', async () => {
    const { key, state } = await machine();
    const events = [event(1)];
    const record = await signRecord(SIGNING_DOMAINS.historyAttest, await body(events), key.privateKey, key.pub);
    expect(await verifyHistoryAttestation(record, events, state, NO_CERTIFICATES, { project: 'p2', writer: WRITER })).toEqual({ ok: false, reason: 'binding' });
    expect(await verifyHistoryAttestation(record, events, state, NO_CERTIFICATES, { project: 'p1', writer: 'mini/another' })).toEqual({ ok: false, reason: 'binding' });
    expect(await verifyHistorySigner(record, state, NO_CERTIFICATES, { project: 'p2', writer: WRITER })).toEqual({ ok: false, reason: 'binding' });
  });

  it('judges the signer and the binding without the events (the hub’s courtesy check)', async () => {
    const { key, state } = await machine();
    const record = await signRecord(SIGNING_DOMAINS.historyAttest, await body([event(1)]), key.privateKey, key.pub);
    expect(await verifyHistorySigner(record, state, NO_CERTIFICATES, AT)).toEqual({ ok: true, by: { ref: REF, name: 'mini' } });
    const hubAt = { project: 'p1', writer: `hub/${'a'.repeat(32)}` };
    const hubWriter = await signRecord(SIGNING_DOMAINS.historyAttest, await body([event(1)], { writer: hubAt.writer }), key.privateKey, key.pub);
    expect(await verifyHistorySigner(hubWriter, state, NO_CERTIFICATES, hubAt)).toEqual({ ok: false, reason: 'binding' });
    const malformed = { body: { ...record.body, extra: true }, sig: record.sig };
    expect(await verifyHistorySigner(malformed as never, state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifyHistorySigner(record, { ...state, org: 'another' }, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'signature' });
    // A key of the right id that signed another body does not verify.
    expect(await verifyHistorySigner({ body: { ...record.body, upTo: 2 }, sig: record.sig }, state, NO_CERTIFICATES, AT)).toEqual({ ok: false, reason: 'signature' });
    expect(await keyId(key.pub)).toBe(record.sig.kid);
  });
});

describe('the committed vectors', () => {
  it('carry the history cases M4 proves, and replay them (vectors.test.ts replays them with fresh keys too)', async () => {
    const names = new Set(VECTORS.history.cases.map((c) => c.name));
    for (const name of HISTORY_CASES) expect(names, name).toContain(name);
    expect(await replayHistory(VECTORS.history)).toEqual([]);
  });
});
