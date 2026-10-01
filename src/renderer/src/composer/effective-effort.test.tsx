import { join } from 'node:path';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { status as statusOf } from '../../../../test/support/builders';
import { fixtureLine } from '../../../../test/support/widget-backend';
import { effortBasis, resetEffectiveEfforts, useEffectiveEffort } from './effective-effort';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-effort' as AppSessionId;
// pass2/dialogs.jsonl seq 58: Sonnet with nothing configured applies "high"; reads.jsonl seq 60: Haiku applies none
const SONNET = (fixtureLine(ROOT, 'pass2/dialogs#58') as { applied: unknown }).applied;
const HAIKU = (fixtureLine(ROOT, 'reads#60') as { applied: unknown }).applied;

function bridge(answers: unknown[]) {
  const invoke = vi.fn(async () => ({ ok: true, value: answers.length > 1 ? answers.shift() : answers[0] }));
  return { client: { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge, invoke };
}

afterEach(() => {
  cleanup(); // every composer of a session reads one status; a hook left mounted from another test would read another
  resetEffectiveEfforts();
});

describe('the effort the engine runs at comes from get_settings, once per ready and per change', () => {
  it('reads applied.effort at ready, and not again while nothing that decides it moves', async () => {
    const { client, invoke } = bridge([{ applied: SONNET }]);
    const ready: EngineSessionStatus = { ...statusOf(ID), model: { requested: null, resolved: 'claude-sonnet-5[1m]' } };
    const hook = renderHook(({ s }: { s: EngineSessionStatus | null }) => useEffectiveEffort(ID, s, client), { initialProps: { s: ready } });
    await waitFor(() => expect(hook.result.current).toBe('high'));
    hook.rerender({ s: { ...ready, lastEventSeq: ready.lastEventSeq + 5 } }); // a turn's events: the basis stands
    renderHook(() => useEffectiveEffort(ID, ready, client)); // a second composer mounting: the answer is shared
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('session.getSettings', { appSessionId: ID });
  });

  it('reads again after a set_model or an effort change, and answers null for a model without effort', async () => {
    const { client, invoke } = bridge([{ applied: SONNET }, { applied: HAIKU }]);
    const ready: EngineSessionStatus = { ...statusOf(ID), model: { requested: null, resolved: 'claude-sonnet-5[1m]' } };
    const hook = renderHook(({ s }: { s: EngineSessionStatus | null }) => useEffectiveEffort(ID, s, client), { initialProps: { s: ready } });
    await waitFor(() => expect(hook.result.current).toBe('high'));
    hook.rerender({ s: { ...ready, model: { requested: 'haiku', resolved: 'claude-sonnet-5[1m]' } } });
    await waitFor(() => expect(hook.result.current).toBeNull());
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('asks nothing of a process that is not ready, and an answer that names no effort stays unknown', async () => {
    const { client, invoke } = bridge([{ effective: {}, sources: [] }]);
    const starting = statusOf(ID, { process: 'initializing' });
    expect(effortBasis(starting)).toBeNull();
    const hook = renderHook(({ s }: { s: EngineSessionStatus | null }) => useEffectiveEffort(ID, s, client), { initialProps: { s: starting } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).not.toHaveBeenCalled();
    hook.rerender({ s: statusOf(ID) });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(hook.result.current).toBeUndefined();
  });
});
