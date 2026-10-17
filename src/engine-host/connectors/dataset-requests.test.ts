// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3): the host's private registry of agents' dataset
// refresh requests. It announces a request by its id alone, answers main's read of it, binds the one connector
// operation that carries it (only a start that matches it), and settles at most once: the host's own end of the
// publication (its durable answer, a stale dataset, a revoke) at once; main's reply, the deadline, the engine's
// withdrawal or main's going otherwise, the last three cancelling the bound operation. E3 M2 fix: between the
// publication's admission and its commit or rollback, every other end is held, and the commit's outcome answers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONNECTOR_OPERATION_DEADLINE_MS } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactDatasetResult } from '@shared/maws/dashboard-tools';
import { DatasetRefreshRequests, type DatasetRefreshAsk, type DatasetRefreshSettlement } from './dataset-requests';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const ASK: DatasetRefreshAsk = { artifactId: ARTIFACT, datasetId: 'live', baseRevision: 4, appSessionId: 'app-1' as AppSessionId, opId: 'app-1/toolu_1', server: 'fixture', tool: 'rows', args: { series: 'revenue', limit: 2 } };
const START = { appSessionId: 'app-1', artifactId: ARTIFACT, server: 'fixture', tool: 'rows', arguments: { limit: 2, series: 'revenue' }, dataset: { id: 'live', baseRevision: 4 } };
const ANSWER: ArtifactDatasetResult = { status: 'dataset', artifactId: ARTIFACT, id: 'live', revision: 9, columns: [{ name: 'v', type: 'number' }], rows: 2 };

let announced: string[];
let client: boolean;
let clock: number;
function registry(deadlineMs?: number) {
  announced = [];
  client = true;
  clock = Date.now();
  let n = 0;
  return new DatasetRefreshRequests({ announce: (requestId) => announced.push(requestId), hasClient: () => client, ...(deadlineMs !== undefined && { deadlineMs }), now: () => clock, newId: () => `00000000-0000-4000-8000-00000000000${++n}` });
}
afterEach(() => vi.useRealTimers());
const startOf = (requestId: string, over: Record<string, unknown> = {}) => ({ ...START, dataset: { ...START.dataset, requestId }, ...over });
// whether a promise has settled, after its microtasks ran
async function settled<T>(promise: Promise<T>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return done;
}

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

  it('answers the host’s own end at once: its durable answer, a stale dataset as a conflict, a revoke; main’s reply after it is not pending', async () => {
    const requests = registry();
    const asked = requests.ask(ASK, new AbortController().signal);
    const scope = requests.claim(announced[0]!, startOf(announced[0]!), () => {})!;
    expect(scope).toMatchObject({ actor: { kind: 'session', appSessionId: 'app-1' }, opId: 'app-1/toolu_1' });
    expect(scope.admit()).toBe(true);
    scope.ended!({ published: ANSWER });
    expect(await asked).toEqual({ kind: 'published', answer: ANSWER });
    expect(requests.answer(announced[0]!, { ok: false, state: 'failed', reason: 'toolError' })).toBe('not_pending');
    expect(scope.admit()).toBe(false);

    const stale = requests.ask(ASK, new AbortController().signal);
    requests.claim(announced[1]!, startOf(announced[1]!), () => {})!.ended!({ discarded: 'stale', detail: 'dataset "live" changed since the refresh began' });
    expect(await stale).toEqual({ kind: 'stale', detail: 'dataset "live" changed since the refresh began' });

    const changedBefore = requests.ask(ASK, new AbortController().signal);
    requests.claim(announced[2]!, startOf(announced[2]!), () => {})!.refused('dataset "live" changed since revision 4; read the dashboard again', true);
    expect(await changedBefore).toEqual({ kind: 'stale', detail: 'dataset "live" changed since revision 4; read the dashboard again' });

    const revoked = requests.ask(ASK, new AbortController().signal);
    requests.claim(announced[3]!, startOf(announced[3]!), () => {})!.ended!({ discarded: 'revoked', detail: 'the grant ended' });
    expect(await revoked).toEqual({ kind: 'refused', outcome: { ok: false, state: 'revoked', reason: 'revoked' }, refusal: 'the grant ended' });
  });

  it('answers a host refusal’s own words over main’s reason when nothing was published', async () => {
    const requests = registry();
    const refused = requests.ask(ASK, new AbortController().signal);
    requests.claim(announced[0]!, startOf(announced[0]!), () => {})!.refused('a dashboard made from files is never written');
    expect(await settled(refused)).toBe(false); // main's reply settles it
    requests.answer(announced[0]!, { ok: false, state: 'failed', reason: 'toolError' });
    expect(await refused).toEqual({ kind: 'refused', outcome: { ok: false, state: 'failed', reason: 'toolError' }, refusal: 'a dashboard made from files is never written' });
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

  it('runs on the one shared budget: no publication is admitted at or past it, nor once the request ended', async () => {
    vi.useFakeTimers();
    expect(CONNECTOR_OPERATION_DEADLINE_MS).toBe(180_000);
    const requests = registry();
    void requests.ask(ASK, new AbortController().signal);
    const scope = requests.claim(announced[0]!, startOf(announced[0]!), () => {})!;
    clock += CONNECTOR_OPERATION_DEADLINE_MS; // its clock at the deadline, before its timer ran
    expect(scope.admit()).toBe(false);
    const late = requests.ask(ASK, new AbortController().signal);
    const lateScope = requests.claim(announced[1]!, startOf(announced[1]!), () => {})!;
    await vi.advanceTimersByTimeAsync(CONNECTOR_OPERATION_DEADLINE_MS);
    expect(await late).toEqual({ kind: 'timeout' }); // the one budget, not 190 s
    expect(lateScope.admit()).toBe(false);
    const withdrawn = new AbortController();
    void requests.ask(ASK, withdrawn.signal);
    const ended = requests.claim(announced[2]!, startOf(announced[2]!), () => {})!;
    withdrawn.abort();
    expect(ended.admit()).toBe(false);
  });

  // E3 M2 fix (reviewer finding 2): the commit outlives no settlement that says nothing was published
  describe('a publication admitted and not yet committed', () => {
    const triggers: [string, (requests: DatasetRefreshRequests, requestId: string, engine: AbortController) => unknown, DatasetRefreshSettlement][] = [
      ['main’s reply', (requests, requestId) => requests.answer(requestId, { ok: false, state: 'paused', reason: 'unavailable' }), { kind: 'refused', outcome: { ok: false, state: 'paused', reason: 'unavailable' }, refusal: 'the publication was not committed: disk full' }],
      ['the engine’s withdrawal', (_requests, _requestId, engine) => engine.abort(), { kind: 'withdrawn' }],
      ['the deadline', () => vi.advanceTimersByTimeAsync(5_000), { kind: 'timeout' }],
      ['main’s going', (requests) => requests.clientGone(), { kind: 'noClient' }],
    ];

    it.each(triggers)('holds %s until the commit, which answers its durable record', async (_what, trigger) => {
      vi.useFakeTimers();
      const requests = registry(5_000);
      const engine = new AbortController();
      const cancels: number[] = [];
      const asked = requests.ask(ASK, engine.signal);
      const scope = requests.claim(announced[0]!, startOf(announced[0]!), () => cancels.push(1))!;
      expect(scope.admit()).toBe(true);
      await trigger(requests, announced[0]!, engine);
      expect(await settled(asked)).toBe(false);
      expect(requests.read(announced[0]!)).not.toBeNull();
      scope.ended!({ published: ANSWER });
      expect(await asked).toEqual({ kind: 'published', answer: ANSWER });
      expect(cancels).toEqual([]);
    });

    it.each(triggers)('answers %s held meanwhile when the commit rolls back, nothing published', async (_what, trigger, expected) => {
      vi.useFakeTimers();
      const requests = registry(5_000);
      const engine = new AbortController();
      const cancels: number[] = [];
      const asked = requests.ask(ASK, engine.signal);
      const scope = requests.claim(announced[0]!, startOf(announced[0]!), () => cancels.push(1))!;
      expect(scope.admit()).toBe(true);
      await trigger(requests, announced[0]!, engine);
      expect(await settled(asked)).toBe(false);
      scope.ended!({ error: 'disk full' });
      expect(await asked).toEqual(expected);
      expect(cancels).toEqual([1]);
    });

    it('waits for main’s reply after a rollback no other end preceded', async () => {
      const requests = registry();
      const asked = requests.ask(ASK, new AbortController().signal);
      const scope = requests.claim(announced[0]!, startOf(announced[0]!), () => {})!;
      expect(scope.admit()).toBe(true);
      scope.ended!({ error: 'disk full' });
      expect(await settled(asked)).toBe(false);
      requests.answer(announced[0]!, { ok: false, state: 'failed', reason: 'toolError' });
      expect(await asked).toEqual({ kind: 'refused', outcome: { ok: false, state: 'failed', reason: 'toolError' }, refusal: 'the publication was not committed: disk full' });
    });
  });
});
