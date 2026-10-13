// The history rail's api on A's IPC (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D10; Decision Log 28
// to 30): each method the store's command for one artifact; provenance up to the live state asked as
// `attributions(from, MAX_SAFE_INTEGER)`; "Name this version" sending the label only; `lastViewedAt` the time the tab
// read from the artifact's row before the surface recorded this view, then the time of the rail's own view; new
// versions heard from `artifacts.changed` for this artifact; failures to the renderer's log.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactVersion } from '@shared/artifacts/version';
import type { CommandName, EventName, MawsBridge } from '@shared/ipc/schema';
import { createHistoryApi } from './history-api';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const OTHER = '9f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const version: ArtifactVersion = { id: 3, seq: 12, at: 1_760_000_000_000, actor: { kind: 'human' }, kind: 'auto', assetRefs: [] } as ArtifactVersion;

function bridge(answers: Partial<Record<CommandName, unknown>> = {}) {
  const calls: Array<[string, unknown]> = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName, input: unknown) => {
      calls.push([name, input]);
      const value = answers[name];
      if (value instanceof Error) return { ok: false, error: { code: 'internal', message: value.message } };
      return { ok: true, value };
    }) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
  };
  const emit = (name: string, payload: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  return { ipc, calls, emit, listeners };
}

function make(answers: Partial<Record<CommandName, unknown>> = {}, viewedBefore: number | null = 1_000) {
  const b = bridge(answers);
  const host = { versionState: vi.fn(async () => new Uint8Array([1])), attributions: vi.fn(async () => new Uint8Array([2])) };
  const log = vi.fn();
  let viewed = viewedBefore;
  const api = createHistoryApi({ artifactId: A, ipc: b.ipc, host, viewedAt: { get: () => viewed, set: (at) => (viewed = at) }, sessionTitle: (id) => (id === 'app-1' ? 'Fix the build' : undefined), log });
  return { api, host, log, ...b };
}

afterEach(() => vi.useRealTimers());

describe('the history api on A’s IPC', () => {
  it('reads the versions, a version’s state and the provenance between two seqs of this artifact', async () => {
    const { api, host, calls } = make({ 'artifacts.versions': { versions: [version] } });
    expect(await api.versions()).toEqual([version]);
    expect(calls).toEqual([['artifacts.versions', { artifactId: A }]]);
    expect(await api.versionState(3)).toEqual(new Uint8Array([1]));
    expect(host.versionState).toHaveBeenCalledWith(A, 3);
    expect(await api.attributions(0, Number.MAX_SAFE_INTEGER)).toEqual(new Uint8Array([2]));
    expect(host.attributions).toHaveBeenCalledWith(A, 0, Number.MAX_SAFE_INTEGER);
  });

  it('saves, names (the label only), restores and copies through the store’s commands', async () => {
    const { api, calls } = make({
      'artifacts.saveVersion': { versionId: 4 },
      'artifacts.nameVersion': { version },
      'artifacts.restore': { revision: 20, versionId: 5 },
      'artifacts.duplicate': { artifact: { id: OTHER } },
    });
    expect(await api.saveVersion({ label: 'Draft to legal', note: 'Ready' })).toEqual({ versionId: 4 });
    await api.nameVersion!(3, { label: 'Before legal' });
    expect(await api.restore(3)).toEqual({ revision: 20, versionId: 5 });
    expect(await api.duplicate(3)).toEqual({ artifactId: OTHER });
    expect(calls).toEqual([
      ['artifacts.saveVersion', { artifactId: A, label: 'Draft to legal', note: 'Ready' }],
      ['artifacts.nameVersion', { artifactId: A, versionId: 3, label: 'Before legal' }],
      ['artifacts.restore', { artifactId: A, versionId: 3 }],
      ['artifacts.duplicate', { artifactId: A, versionId: 3 }],
    ]);
    expect(Object.keys(calls[1][1] as object)).not.toContain('note'); // an omitted note keeps the version's note (A's 38c)
  });

  it('answers the last view the tab read before this showing, then the rail’s own view', async () => {
    vi.useFakeTimers({ now: 5_000 });
    const { api, calls } = make({ 'artifacts.markViewed': undefined }, 1_000);
    expect(await api.lastViewedAt()).toBe(1_000);
    await api.markViewed();
    expect(calls).toEqual([['artifacts.markViewed', { artifactId: A }]]);
    expect(await api.lastViewedAt()).toBe(5_000);
  });

  it('rejects with the store’s message when a command is refused', async () => {
    const { api } = make({ 'artifacts.restore': new Error('the version is gone') });
    await expect(api.restore(3)).rejects.toThrow('the version is gone');
  });

  it('hears new versions from this artifact’s changes, coalesced, and stops when asked', async () => {
    vi.useFakeTimers();
    const { api, emit } = make();
    const heard = vi.fn();
    const off = api.onVersions!(heard);
    emit('artifacts.changed', { artifactId: A, kind: 'document', revision: 3, change: 'updated' });
    emit('artifacts.changed', { artifactId: A, kind: 'document', revision: 4, change: 'updated' });
    emit('artifacts.changed', { artifactId: OTHER, kind: 'document', revision: 9, change: 'updated' });
    expect(heard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(heard).toHaveBeenCalledOnce();
    off();
    emit('artifacts.changed', { artifactId: A, kind: 'document', revision: 5, change: 'updated' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(heard).toHaveBeenCalledOnce();
  });

  it('names a session by its title and logs to the renderer’s log', () => {
    const { api, log } = make();
    expect(api.sessionTitle!('app-1')).toBe('Fix the build');
    api.log!('history: counting failed');
    expect(log).toHaveBeenCalledWith('history: counting failed');
  });
});
