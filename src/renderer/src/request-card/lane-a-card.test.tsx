// The request card on a terminal session MAWS drives through its sminos bridge (P5 O9 M6, "The card's options" and "The
// race"; the owner's Q3): each option lane A can't carry is drawn disabled in place with its reason and never sent; the
// card says the terminal asks too, settles in place as the race ended (a late answer included), and past a background
// request's window reads as the terminal's to answer. A docked request the terminal answered stays docked, settled, 3 s.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { LaneARaised, LaneAState } from '@shared/ipc/schema/lane-a';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { SETTLED_MS, useSettling } from '../lane-a/race';
import { connectKeys } from '../keymap/dispatcher';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { RequestCard } from './RequestCard';
import { itemFor, permission } from './test-requests';

const APP = at('app-lane-a' as AppSessionId);
const REQ = 'toolu_req' as RequestId;
let fake: FakeClient;
let disconnect: () => void;

beforeEach(() => {
  resetShellStores();
  resetLaneAStore();
  useSessions.setState((s) => ({ records: new Map(s.records).set(APP, record(APP, { holder: { kind: 'terminal', pid: 4242 } })), recordsVersion: s.recordsVersion + 1 }));
  fake = fakeClient({ 'laneA.answer': { outcome: 'delivered' }, 'laneA.catalog': null });
  window.maws = fake.client as unknown as PreloadBridge;
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
  vi.useRealTimers();
});

const raised = (over: Partial<LaneARaised> = {}): LaneARaised => ({ request: REQ, session: 'eng-1', tool: 'Bash', input: { command: 'ls' }, ...over });
const live = (over: Partial<LaneAState> = {}) => applyLaneAState(APP, laneAState(APP, over));
const answers = () => fake.invoked('laneA.answer').map((input) => (input as { answer: unknown }).answer);

function mount(event: Extract<SessionEvent, { kind: `${string}.requested` }>, over: Partial<AttentionItem> = {}) {
  const item = itemFor(event, APP, over);
  render(<RequestCard item={item} request={event} placement="docked" paneIndex={0} />);
  return item;
}

describe('a terminal session’s permission card', () => {
  it('says the terminal asks too, closes deny-and-interrupt and a scope it can’t carry in place with their reasons, and answers the rest', async () => {
    live({ pending: [raised({ suggestions: [{ type: 'addRules' }, { type: 'addRules' }] })] });
    mount(permission({ requestId: REQ, suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls' }], behavior: 'allow', destination: 'localSettings' }] }));
    expect(screen.getByText('Also asked in the terminal: the first answer wins')).toBeTruthy();
    const session = screen.getByRole('radio', { name: 'Allow for this session' });
    expect(session.hasAttribute('disabled')).toBe(true);
    expect(session.getAttribute('title')).toBe("A scoped allow takes the request's one suggestion; this request offers 2");
    await userEvent.setup().click(screen.getByRole('button', { name: 'More deny options' }));
    const stop = await screen.findByRole('menuitem', { name: 'Deny and stop the turn' });
    expect(stop.getAttribute('aria-disabled')).toBe('true');
    expect(stop.getAttribute('title')).toBe('Deny-and-interrupt is answered in the terminal');
    await userEvent.setup().keyboard('{Escape}');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
  });

  it('settles in place as answered in the terminal, offering nothing', () => {
    live({ pending: [raised()] });
    mount(permission({ requestId: REQ }));
    act(() => live({ pending: [], settled: [{ request: REQ, session: 'eng-1', winner: 'terminal', outcome: 'allow', by: 'terminal' }] }));
    expect(screen.getByRole('status').textContent).toBe('Answered in the terminal: Allowed');
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(screen.queryByText('Also asked in the terminal: the first answer wins')).toBeNull();
  });

  it('reads a MAWS answer that lost the race as that settlement, never an error', async () => {
    fake = fakeClient({ 'laneA.answer': { outcome: 'not_pending', settled: { winner: 'terminal', outcome: 'deny', by: 'terminal' }, message: 'already answered' }, 'laneA.catalog': null });
    window.maws = fake.client as unknown as PreloadBridge;
    live({ pending: [raised()] });
    mount(permission({ requestId: REQ }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Answered in the terminal: Denied'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays on an answer refused as the terminal’s to give, saying so with its actions closed, until a real settlement', async () => {
    fake = fakeClient({ 'laneA.answer': { outcome: 'not_pending', settled: null, terminalOnly: true, message: 'the window closed' }, 'laneA.catalog': null });
    window.maws = fake.client as unknown as PreloadBridge;
    live({ pending: [raised({ agentId: 'a1' })] });
    mount(permission({ requestId: REQ, agentId: 'a1' as never }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByText('Answer this in the terminal')).toBeTruthy());
    await act(async () => void vi.advanceTimersByTime(5_000)); // past the not-pending card's close
    expect(screen.queryByText('Already answered elsewhere')).toBeNull();
    for (const name of ['Allow', 'Deny']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    act(() => live({ pending: [], settled: [{ request: REQ, session: 'eng-1', winner: 'terminal', outcome: 'allow', by: 'terminal' }] }));
    expect(screen.getByRole('status').textContent).toBe('Answered in the terminal: Allowed');
  });

  it('reads a background request past its window as the terminal’s to answer, its buttons disabled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    live({ pending: [raised({ agentId: 'a1', deadline: new Date(Date.now() + 1200).toISOString() })] });
    mount(permission({ requestId: REQ, agentId: 'a1' as never }));
    expect(screen.getByRole('button', { name: 'Allow' }).hasAttribute('disabled')).toBe(false);
    await act(async () => void vi.advanceTimersByTime(1100));
    expect(screen.getByText('Answer this in the terminal')).toBeTruthy();
    for (const name of ['Allow', 'Deny']) {
      const button = screen.getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('title')).toBe('Answer this in the terminal');
    }
  });
});

// The O9 sitting (item 9): the hover card read "Approval needed" with no Allow or Deny, on a Bash and a Write. The hover
// approves only a read-only tool's permission (charter §5.1), for every lane: a lane A Read is approved there through
// the port, and a Bash or Write offers Open session alone, as lane B's does.
describe('a terminal session’s request in the sidebar’s hover card', () => {
  const hover = (event: Extract<SessionEvent, { kind: `${string}.requested` }>) => render(<RequestCard item={itemFor(event, APP)} request={event} placement="hover" paneIndex={null} />);

  it('approves a read-only tool’s permission through the bridge', async () => {
    live({ pending: [raised({ tool: 'Read', input: { file_path: '/w/notes.txt' } })] });
    hover(permission({ requestId: REQ, toolName: 'Read', displayName: 'Read', input: { file_path: '/w/notes.txt' } }));
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
  });

  it.each(['Bash', 'Write'])('offers %s only Open session, as for any session', (tool) => {
    live({ pending: [raised({ tool })] });
    hover(permission({ requestId: REQ, toolName: tool, displayName: tool }));
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
  });
});

describe('a terminal session’s plan and question cards', () => {
  it('closes a plan’s clear and implement with its reason, and implements', async () => {
    live({ pending: [raised({ tool: 'ExitPlanMode', input: { plan: '1. do it' } })] });
    mount({ id: 'e' as never, sessionId: 's' as never, at: '2026-10-28T10:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, kind: 'plan.requested', requestId: REQ, toolUseId: REQ as never, plan: '1. do it', input: { plan: '1. do it' } });
    const clear = screen.getByRole('button', { name: 'Clear context and implement' });
    expect(clear.hasAttribute('disabled')).toBe(true);
    expect(clear.getAttribute('title')).toBe('/clear runs in the terminal');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Implement' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null }]));
  });

  it('never declines an async question: Esc sends nothing and a Skip that would leave it unanswered is closed', async () => {
    live({ pending: [raised({ tool: 'mcp__plugin_sminos_ask__ask', async: true, input: { questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes' }] }] } })] });
    const questions = [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: null, preview: null }], multiSelect: false }];
    mount({ id: 'e' as never, sessionId: 's' as never, at: '2026-10-28T10:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, kind: 'question.requested', requestId: REQ, toolUseId: REQ as never, questions });
    const skip = screen.getByRole('button', { name: 'Skip' });
    expect(skip.hasAttribute('disabled')).toBe(true);
    expect(skip.getAttribute('title')).toBe('An async question needs an answer');
    act(() => document.querySelector<HTMLElement>('[data-docked-frame]')!.focus());
    await userEvent.setup().keyboard('{Escape}');
    expect(answers()).toEqual([]);
    await userEvent.setup().click(within(screen.getByRole('radiogroup', { name: 'Ship it?' })).getByRole('radio', { name: 'Yes' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Ship it?': 'Yes' } }]));
  });
});

describe('the docked request a terminal answered', () => {
  function Dock({ item }: { item: AttentionItem | null }) {
    const shown = useSettling(item);
    return <p>{shown === null ? 'nothing docked' : `docked ${shown.id}`}</p>;
  }

  it('stays docked SETTLED_MS once the terminal answered it, and leaves at once when this app did', () => {
    vi.useFakeTimers();
    const item = itemFor(permission({ requestId: REQ }), APP);
    live({ pending: [raised()] });
    const view = render(<Dock item={item} />);
    act(() => live({ pending: [], settled: [{ request: REQ, session: 'eng-1', winner: 'terminal', outcome: 'allow', by: 'terminal' }] }));
    view.rerender(<Dock item={null} />);
    expect(screen.getByText(`docked ${item.id}`)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(SETTLED_MS - 1));
    expect(screen.getByText(`docked ${item.id}`)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText('nothing docked')).toBeTruthy();

    const ours = itemFor(permission({ requestId: 'toolu_ours' as RequestId }), APP);
    view.rerender(<Dock item={ours} />);
    act(() => live({ pending: [], settled: [{ request: 'toolu_ours', session: 'eng-1', winner: 'web', outcome: 'allow', by: 'maws' }] }));
    view.rerender(<Dock item={null} />);
    expect(screen.getByText('nothing docked')).toBeTruthy();
  });
});
