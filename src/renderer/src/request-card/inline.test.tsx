import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { resetSlots, useSlot } from '../app/slots';
import { useAttention } from '../stores/attention';
import { markDocked, resetComposerStore } from '../stores/composer';
import { resetShellStores } from '../test-support/shell-stores';
import { TranscriptSlot, useTranscriptStore } from '../transcript';
import { builder, request, tool } from '../transcript/model/test-events';
import { connectRequestCard, renderInlineRequest, RequestCard } from './index';
import { itemFor, permission, type RequestEvent } from './test-requests';

const APP = 'app-inline' as AppSessionId;
const bash = permission({ requestId: request('r1'), toolUseId: tool('b1'), toolName: 'Bash', displayName: 'Bash', input: { command: 'git status' } });
const read = permission({ requestId: request('r2'), toolUseId: tool('c1'), toolName: 'Read', displayName: 'Read', input: { file_path: '/p/a.ts' } });
// Another session's request carrying the same recorded id (a second replay of one fixture), for another tool use.
const twin = permission({ requestId: request('r1'), toolUseId: tool('other'), toolName: 'Edit', displayName: 'Edit', input: { file_path: '/p/b.ts' } });
const TWIN = 'app-twin' as AppSessionId;

// One turn with two pending requests, as C3 would stream them: each gets a request_slot row.
function history(): SessionEvent[] {
  const b = builder();
  b.turn('u1', 'Look around');
  b.toolUse('b1', 'Bash', { command: 'git status' }, 'm1', 0);
  b.emit('permission.requested', payloadOf(bash));
  b.toolUse('c1', 'Read', { file_path: '/p/a.ts' }, 'm2', 0);
  b.emit('permission.requested', payloadOf(read));
  return b.events;
}
function payloadOf(event: RequestEvent & { kind: 'permission.requested' }) {
  const { requestId, toolUseId, toolName, displayName, input, description, decisionReasonType, suggestions, blockedPath } = event;
  return { requestId, toolUseId, toolName, displayName, input, description, decisionReasonType, suggestions, blockedPath };
}

const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  // happy-dom has no layout: a viewport for the scroller and a height per row, so the virtualiser mounts rows (C6's own setup).
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-transcript-scroller') ? 2000 : this.hasAttribute('data-index') ? 40 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

let disposeRenderer: () => void = () => {};
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  const events = history();
  const invoke = (name: string, input: { appSessionId?: string; requestId?: string }) =>
    Promise.resolve(
      name === 'session.events'
        ? { ok: true, value: { events, lastSeq: events.length, complete: true } }
        : name === 'attention.request'
          ? { ok: true, value: { event: { ...(input.appSessionId === TWIN ? twin : input.requestId === 'r1' ? bash : read), sessionId: events[0].sessionId } } }
          : { ok: false, error: { code: 'internal', message: `unexpected ${name}` } },
    );
  (window as { maws?: MawsBridge }).maws = { invoke, on: () => () => {} } as unknown as MawsBridge;
  const items: AttentionItem[] = [itemFor(bash, APP), itemFor(read, APP)];
  useAttention.getState().applySnapshot(items);
});
afterEach(() => {
  disposeRenderer();
  resetSlots();
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: MawsBridge }).maws;
});

const slot = (requestId: string) => document.querySelector<HTMLElement>(`[data-kind="request_slot"] [data-request-id="${requestId}"]`) ?? document.querySelector<HTMLElement>(`[data-request-id="${requestId}"]`);

describe("request renderer registers through C6's seam", () => {
  it('replaces the placeholder with the card, points at a docked request, and its disposer brings the placeholder back', async () => {
    render(<TranscriptSlot appSessionId={APP} />);
    await waitFor(() => expect(slot('r1')?.textContent).toBe('Waiting for you · Bash · answer in the composer'));

    act(() => {
      disposeRenderer = connectRequestCard();
    });
    await waitFor(() => expect(slot('r1')?.querySelector('h3')?.textContent).toBe('Bash'));
    expect(slot('r2')?.querySelector('h3')?.textContent).toBe('Read');

    let undock = () => {};
    act(() => {
      undock = markDocked(APP, 'r1' as RequestId); // a docked placement of this session shows r1
    });
    expect(slot('r1')?.textContent).toBe('◐Waiting for you · Bash · answer below ↓');
    expect(slot('r2')?.querySelector('h3')?.textContent).toBe('Read'); // a different pending request keeps its full card
    act(() => undock());
    expect(slot('r1')?.querySelector('h3')?.textContent).toBe('Bash');

    act(() => useAttention.getState().applyChanged({ appSessionId: APP, items: [itemFor(read, APP)] })); // r1 retired
    expect(slot('r1')?.textContent).toBe('');

    act(() => disposeRenderer());
    expect(slot('r2')?.textContent).toBe('Waiting for you · Read · answer in the composer');
  });

  it("registers the X4 card in C5's requestCard slot", () => {
    function Probe() {
      const Card = useSlot('requestCard');
      return <span>{Card === RequestCard ? 'C7 card' : 'fallback'}</span>;
    }
    render(<Probe />);
    expect(screen.getByText('fallback')).toBeTruthy();
    act(() => {
      disposeRenderer = connectRequestCard();
    });
    expect(screen.getByText('C7 card')).toBeTruthy();
  });

  it('a request id two sessions share (two replays of one fixture) resolves to the item of the slot’s tool use', async () => {
    act(() => useAttention.getState().applySnapshot([itemFor(twin, TWIN), itemFor(bash, APP)])); // the twin's session is listed first
    const slotRow = { id: 'slot:r1', turnId: null, at: bash.at, kind: 'request_slot', requestId: 'r1', toolUseId: 'b1', requestKind: 'permission', toolName: 'Bash', requestedAt: bash.at } as never;
    const { renderSessionRequest } = await import('./inline');
    render(<>{renderSessionRequest(slotRow)}</>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Bash' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Edit' })).toBeNull();
  });

  it('renderInlineRequest always renders the full card, docked or not', async () => {
    const render1 = renderInlineRequest(APP);
    const slotRow = { id: 'slot:r1', turnId: null, at: bash.at, kind: 'request_slot', requestId: 'r1', toolUseId: 'b1', requestKind: 'permission', toolName: 'Bash', requestedAt: bash.at } as never;
    const undock = markDocked(APP, 'r1' as RequestId);
    render(<>{render1(slotRow)}</>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Bash' })).toBeTruthy());
    expect(screen.queryByText(/answer below/)).toBeNull();
    undock();
    const other = render(<>{renderInlineRequest('app-other' as AppSessionId)(slotRow)}</>); // another session holds no such item
    expect(other.container.innerHTML).toBe('');
  });
});
