// A lane A upload's attachments followed (P5 O9 M7): each file's state from the session's `media` op messages (DX4
// `MediaOpBody`, the whole upload in each), kept in the lane A store for the composer's strip; an upload whose every
// file went on to the model leaves after a moment, one that failed stays until dismissed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { applyLaneAState, dismissUpload, resetLaneAStore, useLaneA } from '../stores/lane-a';
import { laneAState } from './test-support/lane-a-state';
import { followUpload, resetUploadFollows, UPLOAD_LINGER_MS } from './uploads';
import { resetLaneAWatches } from './watches';

const A = at('app-a') as AppSessionId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const media = (upload: string, phase: 'start' | 'end', attachments: { index: number; state: string; reason?: string }[]) => ({
  project: '', machine: 'm', session: 'eng-1', kind: 'op', sub: null, n: null,
  body: { rpc: upload, op: 'media', phase, id: upload, upload, index: attachments.at(-1)!.index, state: attachments.at(-1)!.state, attachments },
});
const snapshot = { project: '', machine: 'm', session: 'eng-1', kind: 'snapshot', sub: 'w-1', n: 0, body: { streaming: [], usage: null } };
const files = () => useLaneA.getState().uploads.get(A)?.[0]?.files;

beforeEach(() => {
  resetLaneAStore();
  resetLaneAWatches();
  resetUploadFollows();
  applyLaneAState(A, laneAState(A));
});
afterEach(() => vi.useRealTimers());

describe('followUpload', () => {
  it('shows each file’s state as the bridge says it, and lets the upload go a moment after every file went on', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    followUpload(A, 'up-1', ['shot.png', 'notes.pdf'], fake.client);
    await settle();
    expect(files()).toEqual([{ name: 'shot.png', state: 'queued', reason: null }, { name: 'notes.pdf', state: 'queued', reason: null }]);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot, media('up-1', 'start', [{ index: 0, state: 'read' }, { index: 1, state: 'claimed' }])] });
    expect(files()).toEqual([{ name: 'shot.png', state: 'read', reason: null }, { name: 'notes.pdf', state: 'claimed', reason: null }]);
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [media('other', 'end', [{ index: 0, state: 'failed', reason: 'not ours' }])] }); // another upload's
    vi.useFakeTimers();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [media('up-1', 'end', [{ index: 0, state: 'forwarded' }, { index: 1, state: 'forwarded' }])] });
    expect(files()?.map((f) => f.state)).toEqual(['forwarded', 'forwarded']);
    vi.advanceTimersByTime(UPLOAD_LINGER_MS);
    expect(useLaneA.getState().uploads.has(A)).toBe(false);
    expect(fake.invoked('laneA.unwatch')).toEqual([{ appSessionId: A, watch: 'w-1' }]); // the follow let its watch go
  });

  it('keeps a failed or aborted file with its reason until dismissed', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    followUpload(A, 'up-2', ['a.png', 'b.png'], fake.client);
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot, media('up-2', 'end', [{ index: 0, state: 'forwarded' }, { index: 1, state: 'failed', reason: 'the file is no longer where it was saved' }])] });
    vi.useFakeTimers();
    vi.advanceTimersByTime(UPLOAD_LINGER_MS * 10);
    expect(files()).toEqual([{ name: 'a.png', state: 'forwarded', reason: null }, { name: 'b.png', state: 'failed', reason: 'the file is no longer where it was saved' }]);
    dismissUpload(A, 'up-2');
    expect(useLaneA.getState().uploads.has(A)).toBe(false);
  });

  it('starts from the op messages the page already heard for the upload', async () => {
    const fake = fakeClient({ 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    const { watchLaneA } = await import('./watches');
    const off = watchLaneA(A, () => {}, { client: fake.client });
    await settle();
    fake.event('laneA.plane', { appSessionId: A, watch: 'w-1', messages: [snapshot, media('up-3', 'start', [{ index: 0, state: 'read' }])] });
    followUpload(A, 'up-3', ['a.png'], fake.client);
    expect(files()).toEqual([{ name: 'a.png', state: 'read', reason: null }]);
    off();
  });
});
