import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { bareOf } from '@shared/machine/address';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { resetSlots, useSlot } from '../app/slots';
import { useAttention } from '../stores/attention';
import { resetComposerStore } from '../stores/composer';
import { resetShellStores } from '../test-support/shell-stores';
import { TranscriptSlot, useTranscriptStore } from '../transcript';
import { builder, request, tool } from '../transcript/model/test-events';
import { connectRequestCard, renderInlineRequest, RequestCard } from './index';
import { itemFor, permission, type RequestEvent } from './test-requests';
import { accessibleText } from '../test-support/accessible-text'; // board ticket 815

const APP = at('app-inline' as AppSessionId);
const bash = permission({ requestId: request('r1'), toolUseId: tool('b1'), toolName: 'Bash', displayName: 'Bash', input: { command: 'git status' } });
const read = permission({ requestId: request('r2'), toolUseId: tool('c1'), toolName: 'Read', displayName: 'Read', input: { file_path: '/p/a.ts' } });
// Another session's request carrying the same recorded id (a second replay of one fixture), for another tool use.
const twin = permission({ requestId: request('r1'), toolUseId: tool('other'), toolName: 'Edit', displayName: 'Edit', input: { file_path: '/p/b.ts' } });
const TWIN = at('app-twin' as AppSessionId);

// One turn with two pending requests, as C3 would stream them: since UX wave U1b both are drawn at the transcript's end.
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
        : name === 'session.appEvents'
          ? { ok: true, value: { events: [] } }
          : name === 'attention.request'
          ? { ok: true, value: { event: { ...(input.appSessionId === bareOf(TWIN) ? twin : input.requestId === 'r1' ? bash : read), sessionId: events[0].sessionId } } }
          : { ok: false, error: { code: 'internal', message: `unexpected ${name}` } },
    );
  window.maws = { localMachine: TEST_MACHINE, invoke, on: () => () => {} } as unknown as PreloadBridge;
  const items: AttentionItem[] = [itemFor(bash, APP), itemFor(read, APP)];
  useAttention.getState().applySnapshot(items, TEST_MACHINE);
});
afterEach(() => {
  disposeRenderer();
  resetSlots();
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: PreloadBridge }).maws;
});

const end = () => document.querySelector<HTMLElement>('[data-request-end]');
const endRow = () => document.querySelector<HTMLElement>('[data-row-id="request-end"]');

// UX wave U1b (§C): a request makes no row; the transcript's end row draws a session's prompts through the seam
describe("request renderer registers through C6's seam", () => {
  it('draws the end row’s prompts once registered, the oldest open and the other under Also waiting; with none registered the end row draws nothing', async () => {
    render(<TranscriptSlot appSessionId={APP} />);
    await waitFor(() => expect(document.querySelector('[data-kind="group"]')).not.toBeNull());
    expect(endRow()?.textContent ?? '').toBe(''); // no renderer: no card, and no placeholder pointing at the composer
    expect(document.body.textContent).not.toContain('answer in the composer');

    act(() => {
      disposeRenderer = connectRequestCard();
    });
    await waitFor(() => expect(end()?.querySelector('h3')?.textContent).toBe('◐Run a command'));
    expect(end()?.querySelector('[data-waiting-line]')?.textContent).toContain('permission.requested');
    expect(document.querySelectorAll('.transcript-row[data-kind="request_slot"]')).toHaveLength(1); // the end row alone

    act(() => useAttention.getState().applyChanged({ appSessionId: APP, items: [itemFor(read, APP)] }, TEST_MACHINE)); // r1 retired
    await waitFor(() => expect(end()?.querySelector('h3')?.textContent).toBe('◐Read a file'));
    expect(end()?.querySelector('[data-waiting-line]')).toBeNull();

    act(() => disposeRenderer());
    await waitFor(() => expect(end()).toBeNull());
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
    act(() => useAttention.getState().applySnapshot([itemFor(twin, TWIN), itemFor(bash, APP)], TEST_MACHINE)); // the twin's session is listed first
    const slotRow = { id: 'slot:r1', turnId: null, at: bash.at, kind: 'request_slot', requestId: 'r1', toolUseId: 'b1', requestKind: 'permission', toolName: 'Bash', requestedAt: bash.at } as never;
    const { renderSessionRequest } = await import('./inline');
    render(<>{renderSessionRequest(slotRow)}</>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Run a command' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Edit b.ts' })).toBeNull();
  });

  // UC-1 (A17): an answered request waits nowhere, so its slot in the transcript draws no card
  it('draws nothing for a request whose answer was delivered', async () => {
    act(() => useAttention.getState().applySnapshot([{ ...itemFor(bash, APP), state: 'delivered' }, itemFor(read, APP)], TEST_MACHINE));
    const slotRow = { id: 'slot:r1', turnId: null, at: bash.at, kind: 'request_slot', requestId: 'r1', toolUseId: 'b1', requestKind: 'permission', toolName: 'Bash', requestedAt: bash.at } as never;
    const { renderInlineRequest: forSession } = await import('./inline');
    const { container } = render(<>{forSession(APP)(slotRow)}</>);
    await act(async () => {});
    expect(container.textContent).toBe('');
  });

  it('an unreadable request’s card in a row says so, and its Retry reads it again', async () => {
    const item = itemFor(bash, APP);
    useAttention.setState({ requests: new Map([[item.id, null]]), unreadable: new Map([[item.id, 'no host']]) });
    const slotRow = { id: 'slot:r1', turnId: null, at: bash.at, kind: 'request_slot', requestId: 'r1', toolUseId: 'b1', requestKind: 'permission', toolName: 'Bash', requestedAt: bash.at } as never;
    const { renderSessionRequest } = await import('./inline');
    render(<div data-testid="inline">{renderSessionRequest(slotRow)}</div>);
    const inline = screen.getByTestId('inline');
    expect(accessibleText(inline.querySelector('[role="alert"]')!)).toBe('The request could not be readRetry'); // why is the words' tip (board ticket 815)
    act(() => inline.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
    await waitFor(() => expect(useAttention.getState().requests.get(item.id)).toMatchObject({ requestId: 'r1' }));
    expect(useAttention.getState().unreadable.has(item.id)).toBe(false);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Run a command' })).toBeTruthy());
  });

  it('renderInlineRequest renders the full card from the named session only', async () => {
    const render1 = renderInlineRequest(APP);
    const slotRow = { id: 'slot:r1', turnId: null, at: bash.at, kind: 'request_slot', requestId: 'r1', toolUseId: 'b1', requestKind: 'permission', toolName: 'Bash', requestedAt: bash.at } as never;
    render(<>{render1(slotRow)}</>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Run a command' })).toBeTruthy());
    const other = render(<>{renderInlineRequest(at('app-other' as AppSessionId))(slotRow)}</>); // another session holds no such item
    expect(other.container.innerHTML).toBe('');
  });
});
