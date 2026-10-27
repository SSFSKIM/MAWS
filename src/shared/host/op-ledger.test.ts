// RL4's operation ledger file (O10 M7; Interfaces §H): one line per record, the claim fsynced before the run, compaction to
// KEPT_S at open, a torn last line ignored, and an unreadable ledger answering every op `unavailable`.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEPT_S, OP_HORIZON_S } from 'org-protocol';
import { OpLedger, type OpClaim } from './op-ledger';

// The ledger's own calls to fsync and write, observable (an ESM namespace can't be spied on in place).
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync), writeSync: vi.fn(actual.writeSync) };
});

let dir: string;
let now: number;
const T0 = Date.parse('2026-10-27T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const claim = (edit: Partial<OpClaim> = {}): OpClaim => ({ member: 'm-a', device: 'd-a', fingerprint: 'fp-1', target: 'app-1', name: 'session.send', ...edit });
const OP = 'op-0000000000000001';
const OP2 = 'op-0000000000000002';
const open = () => OpLedger.open(dir, 'ops.jsonl', { now: () => now });
const lines = () => fs.readFileSync(join(dir, 'ops.jsonl'), 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'op-ledger-'));
  fs.chmodSync(dir, 0o700);
  now = T0;
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a claim, then the run, then the result', () => {
  it('writes the claim and fsyncs it before `begin` returns, so nothing runs that the disk does not hold', () => {
    const ledger = open();
    const fsync = vi.mocked(fs.fsyncSync);
    fsync.mockClear();
    const begun = ledger.begin(OP, iso(now), claim(), () => null);
    expect(begun).toEqual({ kind: 'claimed' });
    expect(fsync).toHaveBeenCalled();
    expect(lines()).toEqual([{ opId: OP, opCreated: iso(T0), at: T0, claim: claim() }]);
    expect(fs.statSync(join(dir, 'ops.jsonl')).mode & 0o777).toBe(0o600);
    ledger.finish(OP, { ok: true, value: 1 });
    expect(lines()[1]).toEqual({ opId: OP, result: { ok: true, value: 1 } });
  });

  it('answers a known op from the ledger and runs nothing: its result, or in-progress while only claimed', () => {
    const ledger = open();
    expect(ledger.begin(OP, iso(now), claim(), () => null)).toEqual({ kind: 'claimed' });
    const check = vi.fn(() => null);
    expect(ledger.begin(OP, iso(now), claim(), check)).toEqual({ kind: 'answered', answer: { state: 'in-progress' } });
    ledger.finish(OP, { ok: true, value: 'sent' });
    expect(ledger.begin(OP, iso(now), claim(), check)).toEqual({ kind: 'answered', answer: { state: 'done', result: { ok: true, value: 'sent' } } });
    expect(check).not.toHaveBeenCalled();
  });

  it('refuses a known op under another fingerprint or another member `op-conflict`, saying nothing of the stored one', () => {
    const ledger = open();
    ledger.begin(OP, iso(now), claim(), () => null);
    ledger.finish(OP, { ok: true, value: 'secret' });
    expect(ledger.begin(OP, iso(now), claim({ fingerprint: 'fp-2' }), () => null)).toEqual({ kind: 'answered', answer: { state: 'refused', reason: 'op-conflict' } });
    expect(ledger.begin(OP, iso(now), claim({ member: 'm-b' }), () => null)).toEqual({ kind: 'answered', answer: { state: 'refused', reason: 'op-conflict' } });
  });

  it('claims nothing when the check refuses, or when the op is past the horizon (`expired`)', () => {
    const ledger = open();
    expect(ledger.begin(OP, iso(now), claim(), () => 'context')).toEqual({ kind: 'answered', answer: { state: 'refused', reason: 'context' } });
    expect(ledger.begin(OP2, iso(now - OP_HORIZON_S * 1000 - 1), claim(), () => null)).toEqual({ kind: 'answered', answer: { state: 'refused', reason: 'expired' } });
    expect(fs.existsSync(join(dir, 'ops.jsonl'))).toBe(false);
    expect(ledger.query(OP, iso(now), false)).toEqual({ state: 'not-received' });
  });

  it('refuses a tombstoned op for good (`tombstoned`)', () => {
    const ledger = open();
    expect(ledger.query(OP, iso(now), true)).toEqual({ state: 'not-received' });
    expect(ledger.begin(OP, iso(now), claim(), () => null)).toEqual({ kind: 'answered', answer: { state: 'refused', reason: 'tombstoned' } });
    expect(open().begin(OP, iso(now), claim(), () => null)).toEqual({ kind: 'answered', answer: { state: 'refused', reason: 'tombstoned' } });
  });
});

describe('a query', () => {
  it('answers each state with the stored binding, and survives a reopen (a restart)', () => {
    let ledger = open();
    ledger.begin(OP, iso(now), claim(), () => null);
    expect(ledger.query(OP, iso(now), true)).toEqual({ state: 'in-progress', member: 'm-a', device: 'd-a', fingerprint: 'fp-1', target: 'app-1', name: 'session.send' });
    ledger = open();
    expect(ledger.query(OP, iso(now), true)).toMatchObject({ state: 'in-progress', member: 'm-a' });
    ledger.finish(OP, { ok: true, value: 7 });
    ledger = open();
    expect(ledger.query(OP, iso(now), true)).toEqual({ state: 'done', outcome: { ok: true, value: 7 }, member: 'm-a', device: 'd-a', fingerprint: 'fp-1', target: 'app-1', name: 'session.send' });
  });

  it('tombstones an absent op only when asked, and answers `not-received` only once the tombstone is on disk', () => {
    const ledger = open();
    expect(ledger.query(OP, iso(now), false)).toEqual({ state: 'not-received' });
    expect(fs.existsSync(join(dir, 'ops.jsonl'))).toBe(false);
    expect(ledger.query(OP, iso(now), true)).toEqual({ state: 'not-received' });
    expect(lines()).toEqual([{ opId: OP, opCreated: iso(now), at: now, tombstone: true }]);
  });

  it('answers `unavailable`, never `not-received`, when the tombstone cannot be written', () => {
    const ledger = open();
    vi.mocked(fs.writeSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
    });
    expect(ledger.query(OP, iso(now), true)).toEqual({ state: 'unavailable' });
  });

  it('answers `expired` past the horizon whether or not the ledger still holds the op', () => {
    const ledger = open();
    ledger.begin(OP, iso(now), claim(), () => null);
    now += OP_HORIZON_S * 1000 + 1;
    expect(ledger.query(OP, iso(T0), true)).toEqual({ state: 'expired' });
    expect(ledger.query(OP2, iso(T0), true)).toEqual({ state: 'expired' });
  });
});

describe('the file', () => {
  it('creates nothing until its first record, then its directory 0700 and the file 0600', () => {
    const inner = join(dir, 'supervisor');
    const ledger = OpLedger.open(inner, 'ops.jsonl', { now: () => now });
    expect(ledger.query(OP, iso(now), false)).toEqual({ state: 'not-received' });
    expect(fs.existsSync(inner)).toBe(false);
    ledger.begin(OP, iso(now), claim(), () => null);
    expect(fs.statSync(inner).mode & 0o777).toBe(0o700);
    expect(fs.statSync(join(inner, 'ops.jsonl')).mode & 0o777).toBe(0o600);
  });

  it('drops entries older than KEPT_S at open, and rewrites what it keeps', () => {
    let ledger = open();
    ledger.begin(OP, iso(now), claim(), () => null);
    ledger.finish(OP, { ok: true, value: 1 });
    now += 3_600_000;
    ledger.begin(OP2, iso(now), claim(), () => null);
    now = T0 + KEPT_S * 1000 + 1;
    ledger = open();
    expect(lines().map((l) => l.opId)).toEqual([OP2]);
    expect(ledger.query(OP2, iso(now), false)).toMatchObject({ state: 'in-progress' });
  });

  it('ignores a torn last line, and the next append never joins it', () => {
    let ledger = open();
    ledger.begin(OP, iso(now), claim(), () => null);
    fs.appendFileSync(join(dir, 'ops.jsonl'), '{"opId":"op-00000000000');
    ledger = open();
    expect(ledger.readable).toBe(true);
    ledger.finish(OP, { ok: true, value: 2 });
    expect(lines()).toEqual([{ opId: OP, opCreated: iso(T0), at: T0, claim: claim() }, { opId: OP, result: { ok: true, value: 2 } }]);
  });

  it('keeps a whole last record that lost only its newline', () => {
    open().begin(OP, iso(now), claim(), () => null);
    fs.appendFileSync(join(dir, 'ops.jsonl'), JSON.stringify({ opId: OP, result: { ok: true, value: 3 } }));
    const ledger = open();
    expect(ledger.query(OP, iso(now), false)).toMatchObject({ state: 'done', outcome: { ok: true, value: 3 } });
    ledger.begin(OP2, iso(now), claim(), () => null);
    expect(lines().map((l) => l.opId)).toEqual([OP, OP, OP2]);
  });

  it('is unreadable when a line before the last does not parse, or the file is widened or a symlink: every op is then `unavailable`', () => {
    open().begin(OP, iso(now), claim(), () => null);
    const path = join(dir, 'ops.jsonl');
    const good = fs.readFileSync(path, 'utf8');
    fs.writeFileSync(path, `garbage\n${good}`);
    for (const ledger of [open()]) {
      expect(ledger.readable).toBe(false);
      expect(ledger.query(OP, iso(now), true)).toEqual({ state: 'unavailable' });
      expect(ledger.begin(OP2, iso(now), claim(), () => null)).toEqual({ kind: 'answered', answer: { state: 'refused', reason: 'unavailable' } });
    }
    fs.writeFileSync(path, good);
    fs.chmodSync(path, 0o644);
    expect(open().readable).toBe(false);
    fs.chmodSync(path, 0o600);
    fs.renameSync(path, `${path}.real`);
    fs.symlinkSync(`${path}.real`, path);
    expect(open().readable).toBe(false);
  });
});
