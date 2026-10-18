// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R2, R4): the dashboard guide and format reference
// say how a query dataset is configured and refreshed, in the words and bounds the code uses: the two modes, the owner's
// grant, the states a live view draws, and the schedule's and arguments' limits the input schema enforces.
import { describe, expect, it } from 'vitest';
import { CONNECTOR_ARGS_MAX_BYTES } from '@shared/artifacts/connectors';
import { ArtifactDatasetInputSchema } from '@shared/maws/dashboard-tools';
import { QUERY_SCHEDULE_SECONDS } from '../../dashboard/datasets';
import { DATASET_STATES } from '../../dashboard/states';
import { KIND_GUIDES } from '../guides';

const { guide, format } = KIND_GUIDES.dashboard;
const number = (value: number) => value.toLocaleString('en-US');

describe('the dashboard guide’s live data', () => {
  it('names the two query modes and that only the owner grants the tool', () => {
    for (const words of ['source: {kind: "query"', 'refresh: true', 'schedule', 'staleAfter', DATASET_STATES.notFetched, 'cannot grant']) expect(guide).toContain(words);
  });

  it('states the live states and the query limits the code enforces', () => {
    for (const words of [DATASET_STATES.notFetched, DATASET_STATES.paused, 'stale since <time>', 'server · tool']) expect(format).toContain(words);
    const limits = format.split('## Limits')[1]!.split('## Examples')[0]!;
    for (const value of [QUERY_SCHEDULE_SECONDS.min, QUERY_SCHEDULE_SECONDS.max, CONNECTOR_ARGS_MAX_BYTES]) expect(limits).toContain(number(value));
    const base = { artifact: 'board', baseRevision: 1, id: 'live' };
    const query = { kind: 'query', server: 'fixture', tool: 'rows', args: {} };
    expect(ArtifactDatasetInputSchema.safeParse({ ...base, source: { ...query, schedule: QUERY_SCHEDULE_SECONDS.min } }).success).toBe(true);
    expect(ArtifactDatasetInputSchema.safeParse({ ...base, source: { ...query, schedule: QUERY_SCHEDULE_SECONDS.max } }).success).toBe(true);
    expect(ArtifactDatasetInputSchema.safeParse({ ...base, source: { ...query, schedule: QUERY_SCHEDULE_SECONDS.max + 1 } }).success).toBe(false);
    expect(ArtifactDatasetInputSchema.safeParse({ ...base, refresh: true }).success).toBe(true);
  });
});
