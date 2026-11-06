// A project's held log and its cache (P5 O8 M7a, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M7a's *The
// cache* and Proves for cache.test.ts): events by offset with their verdicts, bounded to the newest by count and bytes;
// a damaged file read from offset 0; "as of" the last caught-up; migrated history kept past the bound by its writer's
// checkpoint, whose record's signer is checked again at load; and other bytes at a covered position never `migrated`,
// whatever offset served them and however often the cache is reloaded.
import { describe, expect, it } from 'vitest';
import { ChannelOrg, ORG, PROJECT, S1, type Event } from '../../../../test/org/channel-world';
import { emptyLog, loadLog, type ChannelLimits, type Ground } from './cache';

const LIMITS: ChannelLimits = { events: 5000, bytes: 8 * 1024 * 1024 };
const ground = (o: ChannelOrg): Ground => {
  const { ctx, state, certificates, now } = o.judging();
  return { ctx, state, certificates, now };
};
const at = (events: Event[], from = 1) => events.map((event, i) => ({ offset: from + i, event }));
const withoutSig = (event: Event) => Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'sig'));
/** The file as written and read back. */
const roundTrip = (file: unknown): unknown => JSON.parse(JSON.stringify(file));

describe('the bound', () => {
  it('keeps the newest events by offset, at most the count and the bytes, and resumes after the last offset given', async () => {
    const o = await ChannelOrg.make();
    const log = emptyLog(ORG, PROJECT, { events: 4, bytes: LIMITS.bytes });
    const says = await Promise.all(Array.from({ length: 6 }, (_, i) => o.say(o.mini, i + 1, `say ${i + 1}`)));
    await log.add(at(says), ground(o));
    expect(log.events().map((e) => e.offset)).toEqual([3, 4, 5, 6]);
    log.caughtUp(9, '2026-11-06T12:00:00.000Z');
    expect(log.after()).toBe(9);
    const small = emptyLog(ORG, PROJECT, { events: 100, bytes: 3 * JSON.stringify({ offset: 1, event: says[0], verdict: { label: 'verified' } }).length });
    await small.add(at(says), ground(o));
    expect(small.events().length).toBeLessThan(4);
    expect(small.events().at(-1)?.offset).toBe(6);
  });

  it("counts the bytes in UTF-8, as the file takes them, not the text's characters", async () => {
    const o = await ChannelOrg.make();
    const says = await Promise.all([1, 2, 3].map((n) => o.say(o.mini, n, '채널'.repeat(500))));
    const one = emptyLog(ORG, PROJECT, LIMITS);
    await one.add(at(says.slice(0, 1)), ground(o));
    const stored = JSON.stringify(one.file().events[0]);
    expect(Buffer.byteLength(stored, 'utf8')).toBeGreaterThan(2 * stored.length);
    // room for two entries by their characters, for only one by their bytes
    const log = emptyLog(ORG, PROJECT, { events: 100, bytes: Math.ceil(2.5 * stored.length) });
    await log.add(at(says), ground(o));
    expect(log.events().map((e) => e.offset)).toEqual([3]);
  });

  it("sends each event with its verdict, without the mac or the signature nothing past main checks", async () => {
    const o = await ChannelOrg.make();
    const log = emptyLog(ORG, PROJECT, LIMITS);
    const say = await o.say(o.mini, 1, 'hello');
    const words = await o.human(o.B, o.bDevice, 1, 'hi from Ana');
    await log.add(at([say, words, { writer: `mini/${S1}`, seq: 2, withheld: true }]), ground(o));
    const unsigned = withoutSig(say);
    const unsignedWords = withoutSig(words);
    expect(log.events()).toEqual([
      { offset: 1, writer: say.writer, seq: 1, event: unsigned, label: 'verified', owners: [{ id: o.A, email: 'sam.owner@example.com', name: 'Sam' }] },
      { offset: 2, writer: words.writer, seq: 1, event: unsignedWords, label: 'verified', author: { id: o.B, email: 'ana@example.com', name: 'Ana' } },
    ]);
    expect(log.after()).toBe(3);
  });

  it('keeps an event that fails, counted, and judges it again at the next head', async () => {
    const o = await ChannelOrg.make();
    const studio = await o.machine('studio');
    const log = emptyLog(ORG, PROJECT, LIMITS);
    await log.add(at([await o.say(studio, 1, 'early'), await o.say(o.mini, 1, 'fine')]), ground(o));
    expect(log.unverified()).toBe(1);
    expect(log.events().map((e) => e.offset)).toEqual([2]);
    await o.adopt((s) => {
      s.machines.push({ name: 'studio', ref: studio.ref, pub: studio.key.pub, owners: [o.A] });
      s.machineNames.push({ name: 'studio', ref: studio.ref });
    });
    await log.rejudge(ground(o));
    expect(log.unverified()).toBe(0);
    expect(log.events().map((e) => e.offset)).toEqual([1, 2]);
  });
});

describe('the file', () => {
  it('reads a damaged file, or another project\'s, from offset 0', async () => {
    const o = await ChannelOrg.make();
    for (const raw of [null, 'garbage', { version: 2 }, { version: 1, org: ORG, project: PROJECT, after: 'x', asOf: null, events: [], checkpoints: [] }]) {
      const log = await loadLog(raw, { org: ORG, project: PROJECT, limits: LIMITS, ground: ground(o), log: () => {} });
      expect(log.after()).toBe(0);
      expect(log.events()).toEqual([]);
    }
    const kept = emptyLog(ORG, '2f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0', LIMITS);
    await kept.add(at([await o.say(o.mini, 1, 'elsewhere')]), ground(o));
    expect((await loadLog(roundTrip(kept.file()), { org: ORG, project: PROJECT, limits: LIMITS, ground: ground(o), log: () => {} })).after()).toBe(0);
  });

  it('keeps "as of", the offset and the verdicts across a reload; another org\'s file is dropped, and signed out the stored verdicts stand', async () => {
    const o = await ChannelOrg.make();
    const log = emptyLog(ORG, PROJECT, LIMITS);
    expect(log.asOf()).toBeNull();
    await log.add(at([await o.say(o.mini, 1, 'hello')]), ground(o));
    log.caughtUp(4, '2026-11-06T11:59:00.000Z');
    const file = roundTrip(log.file());
    const again = await loadLog(file, { org: ORG, project: PROJECT, limits: LIMITS, ground: ground(o), log: () => {} });
    expect(again.asOf()).toBe('2026-11-06T11:59:00.000Z');
    expect(again.after()).toBe(4);
    expect(again.events()).toEqual(log.events());
    const offline = await loadLog(file, { org: null, project: PROJECT, limits: LIMITS, ground: null, log: () => {} });
    expect(offline.events()).toEqual(log.events());
    expect(offline.org).toBe(ORG);
    const other = await loadLog(file, { org: 'another-org', project: PROJECT, limits: LIMITS, ground: null, log: () => {} });
    expect(other.events()).toEqual([]);
    expect(other.after()).toBe(0);
  });
});

describe('migrated history past the bound', () => {
  /** The channel reads the attestations first, then the log page by page (two pages here), then catches up. */
  async function migrated(count: number, limits: ChannelLimits) {
    const o = await ChannelOrg.make();
    const history = Array.from({ length: count }, (_, i) => o.dx1('oldmini', i + 1));
    const log = emptyLog(ORG, PROJECT, limits);
    expect(await log.attest([await o.attest(history)], ground(o))).toBe(false); // nothing of the writer held yet
    const half = Math.ceil(count / 2);
    await log.add(at(history.slice(0, half)), ground(o));
    await log.add(at(history.slice(half), half + 1), ground(o));
    log.caughtUp(count, '2026-11-06T12:00:00.000Z');
    return { o, history, log };
  }

  it('reads a writer `legacy` until its attestation verifies over its events, then `migrated`', async () => {
    const o = await ChannelOrg.make();
    const history = [o.dx1('oldmini', 1), o.dx1('oldmini', 2)];
    const log = emptyLog(ORG, PROJECT, LIMITS);
    await log.add(at(history), ground(o));
    expect(log.events().map((e) => e.label)).toEqual(['legacy', 'legacy']);
    expect(await log.attest([await o.attest(history)], ground(o))).toBe(true);
    expect(log.events().map((e) => [e.label, e.by])).toEqual([
      ['migrated', 'mini'],
      ['migrated', 'mini'],
    ]);
  });

  it('verifies a DX1 writer larger than both bounds once, evicts it in part, and still reads it `migrated` across a restart', async () => {
    const entry = (await ChannelOrg.make()).dx1('oldmini', 1);
    const bytes = 12 * JSON.stringify({ offset: 1, event: entry, verdict: { label: 'migrated', by: 'mini' } }).length;
    const { o, log } = await migrated(30, { events: 20, bytes });
    expect(log.events().length).toBeLessThanOrEqual(12);
    expect(log.events().every((e) => e.label === 'migrated' && e.by === 'mini')).toBe(true);
    // newer events evict more of the writer; the checkpoint stays
    await log.add(at([await o.say(o.mini, 1, 'after the move')], 31), ground(o));
    const reloaded = await loadLog(roundTrip(log.file()), { org: ORG, project: PROJECT, limits: { events: 20, bytes }, ground: ground(o), log: () => {} });
    const dx1 = reloaded.events().filter((e) => e.writer.startsWith('oldmini/'));
    expect(dx1.length).toBeGreaterThan(0);
    expect(dx1.every((e) => e.label === 'migrated' && e.by === 'mini')).toBe(true);
    expect(dx1.every((e) => e.seq > 1)).toBe(true); // the prefix that verified it is gone
  });

  it("re-checks the checkpoint's record at load: a head that ends its signer reads the writer `legacy`", async () => {
    const { o, log } = await migrated(5, { events: 3, bytes: LIMITS.bytes });
    await o.adopt((s) => {
      s.machines = s.machines.filter((m) => m.ref !== o.mini.ref);
    });
    const reloaded = await loadLog(roundTrip(log.file()), { org: ORG, project: PROJECT, limits: { events: 3, bytes: LIMITS.bytes }, ground: ground(o), log: () => {} });
    expect(reloaded.events().map((e) => e.label)).toEqual(['legacy', 'legacy', 'legacy']);
  });

  it('never reads a forged event at a covered writer and seq `migrated`, served at a new offset, evicted and reloaded', async () => {
    const { o, log } = await migrated(4, { events: 6, bytes: LIMITS.bytes });
    const forged = o.dx1('oldmini', 4, 'not what mini attested');
    await log.add([{ offset: 40, event: forged }], ground(o));
    expect(log.unverified()).toBe(1);
    expect(log.events().map((e) => e.offset)).toEqual([1, 2, 3, 4]);
    // newer events push the genuine prefix out; the forged one, still held, never reads migrated
    await log.add(at(await Promise.all([1, 2, 3].map((n) => o.say(o.mini, n, `later ${n}`))), 41), ground(o));
    const reloaded = await loadLog(roundTrip(log.file()), { org: ORG, project: PROJECT, limits: { events: 6, bytes: LIMITS.bytes }, ground: ground(o), log: () => {} });
    expect(reloaded.unverified()).toBe(1);
    expect(reloaded.events().some((e) => e.offset === 40)).toBe(false);
    await reloaded.rejudge(ground(o));
    expect(reloaded.events().some((e) => e.offset === 40)).toBe(false);
    // the same forged bytes alone in a cache, the checkpoint beside them, still fail
    const alone = roundTrip({ ...(log.file() as object), events: [{ offset: 40, event: forged, verdict: { label: 'migrated', by: 'mini' } }] });
    const tampered = await loadLog(alone, { org: ORG, project: PROJECT, limits: LIMITS, ground: ground(o), log: () => {} });
    expect(tampered.events()).toEqual([]);
    expect(tampered.unverified()).toBe(1);
  });

  it("spares a writer's events from the bound only for an attestation whose signer verifies, and only up to its upTo", async () => {
    const o = await ChannelOrg.make();
    const history = Array.from({ length: 30 }, (_, i) => o.dx1('oldmini', i + 1));
    const whole = await o.attest(history);
    const forged = { ...whole, sig: { ...whole.sig, value: `${whole.sig.value.slice(0, -6)}AAAAAA` } };
    // seq 1 has not arrived, so nothing checkpoints yet: the log is still waiting on the writer
    const unsigned = emptyLog(ORG, PROJECT, { events: 10, bytes: LIMITS.bytes });
    await unsigned.attest([forged], ground(o));
    await unsigned.add(at(history.slice(1), 2), ground(o));
    expect(unsigned.file().events.length).toBe(10);
    const partial = emptyLog(ORG, PROJECT, { events: 10, bytes: LIMITS.bytes });
    await partial.attest([await o.attest(history, 5)], ground(o));
    await partial.add(at(history.slice(1), 2), ground(o));
    const seqs = partial.file().events.map((e) => e.event.seq);
    expect(seqs).toHaveLength(10);
    expect(seqs.slice(0, 4)).toEqual([2, 3, 4, 5]); // spared up to upTo, the newest kept after them
  });

  it('names the DX1 writers whose events pass every attestation it holds, once each time they pass', async () => {
    const { o, log } = await migrated(2, LIMITS);
    expect(log.attestationsDue()).toBe(false);
    await log.add([{ offset: 3, event: o.dx1('oldmini', 3) }], ground(o));
    expect(log.events().at(-1)?.label).toBe('legacy');
    expect(log.attestationsDue()).toBe(true);
    await log.attest([], ground(o));
    expect(log.attestationsDue()).toBe(false);
  });
});
