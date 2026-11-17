// The compaction's row and U1b's end row in one drawn list (UX wave U3b, Interfaces §E, at the chain merge of U1c's
// head): while a session compacts with a request waiting at the transcript's end, "Compacting session…" is the last row
// before the end row, and the end row stays last. The session's pane as the app mounts it (`TranscriptSlot`), its
// request listed by the attention store and the compaction noted in the compacting store.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { resetSurfaceRegistry } from '../engine-surface/registry';
import { connectRequestCard } from '../request-card';
import { itemFor, type RequestEvent } from '../request-card/test-requests';
import { useAttention } from '../stores/attention';
import { noteCompacting, useCompacting } from '../stores/compacting';
import { resetComposerStore } from '../stores/composer';
import { resetLaneAStore } from '../stores/lane-a';
import { useTranscriptStore } from '../stores/transcript';
import { resetShellStores } from '../test-support/shell-stores';
import { builder, request, tool } from './model/test-events';
import { TranscriptSlot } from './view/TranscriptSlot';

const APP = at('app-compacting-end' as AppSessionId);

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  // happy-dom has no layout: a viewport for the scroller and a height per row, so the virtualiser mounts rows
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 4000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

let fake: FakeClient;
let events: SessionEvent[] = [];
let requests = new Map<string, SessionEvent>();
let off: () => void = () => {};
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetLaneAStore();
  resetSurfaceRegistry();
  useAttention.setState({ receipts: new Map(), settling: new Map() });
  useCompacting.setState({ held: new Map() });
  events = [];
  requests = new Map();
  fake = fakeClient({
    'session.events': () => ({ events, lastSeq: events.length, complete: true }),
    'attention.request': (input: { requestId: string }) => ({ event: requests.get(input.requestId) ?? null }),
  });
  window.maws = fake.client as unknown as PreloadBridge;
  off = connectRequestCard();
});
afterEach(() => {
  off();
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: PreloadBridge }).maws;
});

// A turn whose shell call waits for permission: its request is drawn at the transcript's end.
function waitingPrompt() {
  const b = builder();
  b.turn('u1', 'Tidy the build folder.');
  b.text('m0', 0, 'Clearing it now.');
  b.toolUse('b1', 'Bash', { command: 'make clean' }, 'm1', 0);
  const asked = b.emit('permission.requested', {
    requestId: request('rp'), toolUseId: tool('b1'), toolName: 'Bash', displayName: 'Bash', input: { command: 'make clean' }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null,
  });
  events = b.events;
  requests.set(asked.requestId, asked);
  return itemFor(asked as RequestEvent, APP, { summary: 'Bash: make clean' });
}

const drawnIds = () => [...document.querySelectorAll<HTMLElement>('[data-row-id]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index)).map((row) => row.dataset.rowId);

describe('the compaction’s row with a request waiting at the end', () => {
  it('is the last row before the end row, and goes with the compaction while the end row stays last', async () => {
    const item = waitingPrompt();
    act(() => useAttention.getState().applySnapshot([item], TEST_MACHINE));
    render(<section data-pane={0}><TranscriptSlot appSessionId={APP} /></section>);
    await waitFor(() => expect(document.querySelector('[data-request-end] [data-request-card]')).not.toBeNull());
    expect(drawnIds().at(-1)).toBe('request-end');
    act(() => noteCompacting(APP, { kind: 'bridge', rpc: 'rpc-1' }, true));
    await waitFor(() => expect(drawnIds().slice(-2)).toEqual(['activity:compacting', 'request-end']));
    act(() => noteCompacting(APP, { kind: 'bridge', rpc: 'rpc-1' }, false));
    await waitFor(() => expect(drawnIds()).not.toContain('activity:compacting'));
    expect(drawnIds().at(-1)).toBe('request-end');
  });
});
