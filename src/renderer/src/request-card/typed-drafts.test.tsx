// UX wave U1b, the branch review's fix wave (the architect's ruling of 2026-11-15 UTC): what a person types into a
// request's card, a prompt's reason for denying and a plan's feedback, lives where a question's answers in progress live:
// by the request, in this window's memory, until the request leaves its session's list. So the end row's open card
// swapped for another waiting request and back, or a plan's form scrolled out of a transcript's virtual list and back,
// keeps the text. Every command, plan and word is invented.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { useAttention } from '../stores/attention';
import { resetShellStores } from '../test-support/shell-stores';
import { RequestCard } from './RequestCard';
import { itemFor, permission, type RequestEvent } from './test-requests';

const APP = at('app-drafts' as AppSessionId);
const first = permission({ requestId: 'req-first' as never, toolUseId: 'toolu_first' as never, input: { command: 'rm -r build' } });
const second = permission({ requestId: 'req-second' as never, toolUseId: 'toolu_second' as never, input: { command: 'make lint' } });
const plan = { ...permission({ requestId: 'req-plan' as never, toolUseId: 'toolu_plan' as never }), kind: 'plan.requested', plan: '1. Read the notes.\n2. Write the page.', input: {} } as Extract<RequestEvent, { kind: 'plan.requested' }>;
const items = { first: itemFor(first, APP), second: itemFor(second, APP), plan: itemFor(plan, APP) };

beforeEach(() => {
  resetShellStores();
  window.maws = fakeClient({ 'session.answer': { outcome: 'delivered' } }).client as unknown as PreloadBridge;
  act(() => useAttention.getState().applySnapshot(Object.values(items), TEST_MACHINE));
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

// The end row's open card, as `EndRegion` draws it: one card, keyed by its request.
const end = (event: RequestEvent | null) => (event === null ? <div /> : <RequestCard key={event.requestId} item={itemFor(event, APP)} request={event} placement="inline" region="end" paneIndex={null} />);
const reason = () => screen.queryByRole('textbox', { name: 'Reason for denying' }) as HTMLTextAreaElement | null;
const feedback = () => screen.queryByRole('textbox', { name: 'What should change in the plan' }) as HTMLTextAreaElement | null;

describe('a request’s typed draft', () => {
  it('a reason typed for Deny… with a reason stands through a switch to another waiting prompt and back', async () => {
    const user = userEvent.setup();
    const { rerender } = render(end(first));
    await user.click(screen.getByRole('button', { name: 'Deny… with a reason' }));
    await user.type(reason()!, 'not the build folder');
    rerender(end(second));
    expect(reason(), 'the other prompt has no reason of its own').toBeNull();
    rerender(end(first));
    expect(reason()?.value).toBe('not the build folder');
  });

  it('a plan’s feedback stands through its form leaving the page and coming back', async () => {
    const user = userEvent.setup();
    const { rerender } = render(end(plan));
    await user.click(screen.getByRole('button', { name: 'Keep planning' }));
    await user.type(feedback()!, 'Write the page first');
    rerender(end(null));
    rerender(end(plan));
    expect(feedback()?.value).toBe('Write the page first');
  });

  it('goes when its request leaves the session’s list, and only that request’s', async () => {
    const user = userEvent.setup();
    const { rerender } = render(end(first));
    await user.click(screen.getByRole('button', { name: 'Deny… with a reason' }));
    await user.type(reason()!, 'not the build folder');
    rerender(end(plan));
    await user.click(screen.getByRole('button', { name: 'Keep planning' }));
    await user.type(feedback()!, 'Write the page first');
    rerender(end(null));
    act(() => useAttention.getState().applyChanged({ appSessionId: APP, items: [items.second, items.plan] }, TEST_MACHINE));
    rerender(end(first));
    expect(reason(), 'its box closed, its text gone').toBeNull();
    expect(screen.getByRole('button', { name: 'Deny… with a reason' })).toBeTruthy();
    rerender(end(plan));
    expect(feedback()?.value).toBe('Write the page first');
  });
});
