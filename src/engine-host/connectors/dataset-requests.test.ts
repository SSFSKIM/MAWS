// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the host's private registry of agents' dataset
// refresh requests. It announces a request by its id alone, answers main's read of it, binds the one connector
// operation that carries it (only a start that matches it), owns the durable answer that operation's publication
// records, and settles at most once: main's reply, the deadline, the engine's withdrawal or main's going, the last
// three cancelling the bound operation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactDatasetResult } from '@shared/maws/dashboard-tools';
import { DatasetRefreshRequests, type DatasetRefreshAsk } from './dataset-requests';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const ASK: DatasetRefreshAsk = { artifactId: ARTIFACT, datasetId: 'live', baseRevision: 4, appSessionId: 'app-1' as AppSessionId, opId: 'app-1/toolu_1', server: 'fixture', tool: 'rows', args: { series: 'revenue', limit: 2 } };
const START = { appSessionId: 'app-1', artifactId: ARTIFACT, server: 'fixture', tool: 'rows', arguments: { limit: 2, series: 'revenue' }, dataset: { id: 'live', baseRevision: 4 } };
const ANSWER: ArtifactDatasetResult = { status: 'dataset', artifactId: ARTIFACT, id: 'live', revision: 9, columns: [{ name: 'v', type: 'number' }], rows: 2 };

let announced: string[];
let client: boolean;
function registry(answerMs = 1_000) {
  announced = [];
  client = true;
  let n = 0;
  return new DatasetRefreshRequests({ announce: (requestId) => announced.push(requestId), hasClient: () => client, answerMs, newId: () => `00000000-0000-4000-8000-00000000000${++n}` });
}
afterEach(() => vi.useRealTimers());
const startOf = (requestId: string, over: Record<string, unknown> = {}) => ({ ...START, dataset: { ...START.dataset, requestId }, ...over });

describe('the dataset refresh requests', () => {
  it('announces a request by its id alone, answers main’s read of it, and settles once on main’s reply', async () => {
    const requests = registry();
    const asked = requests.ask(ASK, new AbortController().signal);
    expect(announced).toEqual(['00000000-0000-4000-8000-000000000001']);
    const [requestId] = announced as [string];
    expect(requests.read(requestId)).toEqual({ artifactId: ARTIFACT, datasetId: 'live', baseRevision: 4, appSessionId: 'app-1', server: 'fixture', tool: 'rows', args: { series: 'revenue', limit: 2 } });
    expect(requests.answer(requestId, { ok: false, state: 'revoked', reason: 'notGranted' })).toBe('delivered');
    expect(await asked).toEqual({ kind: 'refused', outcome: { ok: false, state: 'revoked', reason: 'notGranted' }, refusal: null });
    expect(requests.answer(requestId, { ok: true })).toBe('not_pending');
    expect(requests.read(requestId)).toBeNull();
    expect(requests.read('00000000-0000-4000-8000-00000000000f')).toBeNull();
  });

  it('answers the durable record of the publication, never main’s words; a host refusal’s own words over main’s reason', async () => {
    const requests = registry();
    const asked = requests.ask(ASK, new AbortController().signal);
    const scope = requests.claim(announced[0]!, startOf(announced[0]!), () => {})!;
    expect(scope).toMatchObject({ actor: { kind: 'session', appSessionId: 'app-1' }, opId: 'app-1/toolu_1' });
    expect(scope.live()).toBe(true);
    scope.published!(ANSWER);
    requests.answer(announced[0]!, { ok: false, state: 'failed', reason: 'toolError' });
    expect(await asked).toEqual({ kind: 'published', answer: ANSWER });
    expect(scope.live()).toBe(false);

    const refused = requests.ask(ASK, new AbortController().signal);
    requests.claim(announced[1]!, startOf(announced[1]!), () => {})!.refused('dataset "live" changed since revision 4; read the dashboard again');
    requests.answer(announced[1]!, { ok: false, state: 'failed', reason: 'toolError' });
    expect(await refused).toEqual({ kind: 'refused', outcome: { ok: false, state: 'failed', reason: 'toolError' }, refusal: 'dataset "live" changed since revision 4; read the dashboard again' });
  });

  it('binds only the one start that is the request: its session, dashboard, dataset, base and query', () => {
    const requests = registry();
    void requests.ask(ASK, new AbortController().signal);
    const [requestId] = announced as [string];
    for (const over of [{ appSessionId: 'app-2' }, { artifactId: '22222222-2222-4222-8222-222222222222' }, { dataset: { id: 'other', baseRevision: 4, requestId } }, { dataset: { id: 'live', requestId } }, { dataset: { id: 'live', baseRevision: 5, requestId } }, { tool: 'other' }, { arguments: { series: 'revenue' } }]) {
      expect(requests.claim(requestId, startOf(requestId, over), () => {}), JSON.stringify(over)).toBeNull();
    }
    expect(requests.claim('00000000-0000-4000-8000-00000000000f', startOf('00000000-0000-4000-8000-00000000000f'), () => {})).toBeNull();
    expect(requests.claim(requestId, startOf(requestId), () => {})).not.toBeNull();
    expect(requests.claim(requestId, startOf(requestId), () => {})).toBeNull(); // at most one operation per request
  });

  it('settles noClient at once when no app is connected, announcing nothing', async () => {
    const requests = registry();
    client = false;
    expect(await requests.ask(ASK, new AbortController().signal)).toEqual({ kind: 'noClient' });
    expect(announced).toEqual([]);
  });

  it('cancels the bound operation when the engine withdraws the call, the deadline passes or main goes', async () => {
    vi.useFakeTimers();
    const requests = registry(5_000);
    const cancels: string[] = [];
    const engine = new AbortController();
    const withdrawn = requests.ask(ASK, engine.signal);
    requests.claim(announced[0]!, startOf(announced[0]!), () => cancels.push('withdrawn'));
    engine.abort();
    expect(await withdrawn).toEqual({ kind: 'withdrawn' });

    const late = requests.ask(ASK, new AbortController().signal);
    requests.claim(announced[1]!, startOf(announced[1]!), () => cancels.push('timeout'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await late).toEqual({ kind: 'timeout' });

    const gone = requests.ask(ASK, new AbortController().signal);
    requests.claim(announced[2]!, startOf(announced[2]!), () => cancels.push('noClient'));
    requests.clientGone();
    expect(await gone).toEqual({ kind: 'noClient' });
    expect(cancels).toEqual(['withdrawn', 'timeout', 'noClient']);
    expect(requests.read(announced[2]!)).toBeNull();

    const aborted = new AbortController();
    aborted.abort();
    expect(await requests.ask(ASK, aborted.signal)).toEqual({ kind: 'withdrawn' });
    expect(announced).toHaveLength(3);
  });

  it('answers the durable publication even when the request ends otherwise (its op is recorded either way)', async () => {
    vi.useFakeTimers();
    const requests = registry(5_000);
    const late = requests.ask(ASK, new AbortController().signal);
    const cancels: number[] = [];
    requests.claim(announced[0]!, startOf(announced[0]!), () => cancels.push(1))!.published!(ANSWER);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await late).toEqual({ kind: 'published', answer: ANSWER });
    expect(cancels).toEqual([]);
  });
});
