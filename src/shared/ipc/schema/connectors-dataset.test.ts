// E3 M2 fix (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3; the architect's explicit-phase ruling): a
// dataset operation's take, `ConnectorDatasetTake`, beside H's nullable outcome on `connectors.take`. Its phases are
// explicit and closed: publishing (the operation's id), the compact metadata once (never a row), or a typed failure.
import { describe, expect, it } from 'vitest';
import { validateCommandOutput } from '../validate';
import { ConnectorDatasetTakeSchema } from './connectors';

const OP = '00000000-0000-4000-8000-000000000001';
const META = { status: 'dataset', artifactId: '11111111-1111-4111-8111-111111111111', id: 'live', revision: 7, columns: [{ name: 'v', type: 'number', mismatches: 1 }], rows: 2, warnings: ['1 value of v is not a number'] };

describe('a dataset operation’s take', () => {
  it('admits publishing, the compact metadata and the five typed failures', () => {
    expect(ConnectorDatasetTakeSchema.safeParse({ status: 'publishing', operationId: OP }).success).toBe(true);
    expect(ConnectorDatasetTakeSchema.safeParse(META).success).toBe(true);
    for (const reason of ['stale', 'validation', 'toolError', 'timeout', 'revoked']) expect(ConnectorDatasetTakeSchema.safeParse({ status: 'failed', reason }).success, reason).toBe(true);
  });

  it('refuses rows, a server’s words, another reason and an unknown phase', () => {
    for (const take of [
      { ...META, values: [[107], [110]] },
      { ...META, rows: [{ v: 107 }] },
      { status: 'failed', reason: 'toolError', message: 'upstream exploded' },
      { status: 'failed', reason: 'changed' },
      { status: 'publishing' },
      { status: 'queued', operationId: OP },
      null,
    ]) {
      expect(ConnectorDatasetTakeSchema.safeParse(take).success, JSON.stringify(take)).toBe(false);
    }
  });

  it('rides `connectors.take` beside H’s outcome, which a generic take answers alone as before', () => {
    expect(validateCommandOutput('connectors.take', { outcome: null, dataset: { status: 'publishing', operationId: OP } }).ok).toBe(true);
    expect(validateCommandOutput('connectors.take', { outcome: null, dataset: META }).ok).toBe(true);
    expect(validateCommandOutput('connectors.take', { outcome: null }).ok).toBe(true);
    expect(validateCommandOutput('connectors.take', { outcome: { ok: true, result: { any: 'json' } } }).ok).toBe(true);
    expect(validateCommandOutput('connectors.take', { outcome: null, dataset: { status: 'failed', reason: 'nope' } }).ok).toBe(false);
  });
});
