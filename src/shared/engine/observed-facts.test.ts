// X17's file shape (P2-A §5.5): the tolerant reader and the per-field merge.
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '../graph/ids';
import { contextUsageOf, emptyObservedFacts, mergeObservedFacts, readObservedFacts, type ObservedFacts } from './observed-facts';

const ID = 'app-obs' as AppSessionId;
const fact = <T>(value: T, at: string, launchId = 'L1') => ({ value, at, launchId });

const facts = (over: Partial<ObservedFacts> = {}): ObservedFacts => ({ ...emptyObservedFacts(ID, '2026-10-09T10:00:00.000Z', 'live'), ...over });

describe('readObservedFacts (tolerant)', () => {
  it('reads a file it wrote, with every fact in place', () => {
    const file = facts({ engineSessionId: 'e-1', launches: ['L1'], model: fact('claude-haiku-4-5', '2026-10-09T10:00:01.000Z'), plugins: fact({ plugins: [], errors: [], warnings: [] }, '2026-10-09T10:00:01.000Z') });
    expect(readObservedFacts(JSON.stringify(file))).toEqual(file);
  });

  it('ignores unknown keys, at the top and inside a fact', () => {
    const file = { ...facts({ mode: fact('plan', '2026-10-09T10:00:01.000Z') }), futureKey: 1 };
    const text = JSON.stringify({ ...file, mode: { ...file.mode, extra: true } });
    const read = readObservedFacts(text)!;
    expect(read).not.toHaveProperty('futureKey');
    expect(read.mode).toEqual(fact('plan', '2026-10-09T10:00:01.000Z'));
  });

  it('reads one bad field as unknown and keeps the rest', () => {
    const text = JSON.stringify({ ...facts({ model: fact('m', '2026-10-09T10:00:01.000Z') }), mode: { value: 'sideways', at: 'x', launchId: 'L1' }, plugins: 'nope' });
    const read = readObservedFacts(text)!;
    expect(read.mode).toBeNull();
    expect(read.plugins).toBeNull();
    expect(read.model).toEqual(fact('m', '2026-10-09T10:00:01.000Z'));
  });

  it('reads a higher version the same way (fields are additive)', () => {
    const read = readObservedFacts(JSON.stringify({ ...facts({ outputStyle: fact('default', '2026-10-09T10:00:01.000Z') }), version: 2 }))!;
    expect(read.version).toBe(1);
    expect(read.outputStyle?.value).toBe('default');
  });

  it('answers null for a truncated or foreign file', () => {
    expect(readObservedFacts(JSON.stringify(facts()).slice(0, 40))).toBeNull();
    expect(readObservedFacts('[]')).toBeNull();
    expect(readObservedFacts(JSON.stringify({ version: 1 }))).toBeNull(); // no session id: not a facts file
  });
});

describe('mergeObservedFacts', () => {
  it('takes the later `at` per field, whichever side it is on, and unites the launches', () => {
    const a = facts({ launches: ['L1'], model: fact('old', '2026-10-09T10:00:00.000Z'), plugins: fact({ plugins: [{ name: 'p', path: '/p', source: null, version: null }], errors: [], warnings: [] }, '2026-10-09T10:00:00.000Z') });
    const b = facts({ launches: ['L2'], model: fact('new', '2026-10-09T11:00:00.000Z', 'L2'), source: 'journal' });
    const merged = mergeObservedFacts(a, b);
    expect(merged.model).toEqual(fact('new', '2026-10-09T11:00:00.000Z', 'L2'));
    expect(merged.plugins?.value.plugins).toHaveLength(1); // b observed no plugins: a's stand
    expect(merged.launches.sort()).toEqual(['L1', 'L2']);
    expect(merged.source).toBe('journal');
    // order-independent per field
    expect(mergeObservedFacts(b, a).model).toEqual(merged.model);
    expect(mergeObservedFacts(b, a).plugins).toEqual(merged.plugins);
  });

  it('never lets an unknown erase a known fact', () => {
    const a = facts({ contextUsage: fact({ percent: 2, totalTokens: 19_058, maxTokens: 1_000_000, autoCompactThreshold: null }, '2026-10-09T10:00:00.000Z') });
    expect(mergeObservedFacts(a, facts()).contextUsage).toEqual(a.contextUsage);
  });
});

describe('contextUsageOf', () => {
  it('maps a context sample as the digest maps it', () => {
    expect(contextUsageOf({ percentage: 41.4, totalTokens: 82_800.4, maxTokens: 200_000, autoCompactThreshold: 167_000.2, isAutoCompactEnabled: true })).toEqual({ percent: 41.4, totalTokens: 82_800, maxTokens: 200_000, autoCompactThreshold: 167_000 });
    expect(contextUsageOf({ percentage: 2, totalTokens: 19_058, maxTokens: 1_000_000, autoCompactThreshold: 980_000, isAutoCompactEnabled: false }).autoCompactThreshold).toBeNull();
  });
});
