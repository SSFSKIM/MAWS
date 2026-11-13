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
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { SETTLED_MS, useSettling } from '../lane-a/race';
import { connectKeys } from '../keymap/dispatcher';
import { bindingsOf } from '../keymap/useKeyChord';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { useHosts } from '../stores/hosts';
import { useSessions } from '../stores/sessions';
import { hostStatus } from '../test-support/host-status';
import { resetShellStores } from '../test-support/shell-stores';
import { RequestCard } from './RequestCard';
import { itemFor, permission } from './test-requests';

// The hover card asks the session's port of each of its buttons on its own answer (U1a §H). The lane A port carries both
// answers or neither, so the cases where it carries one and not the other refuse that one answer over the real port.
const refusing = vi.hoisted(() => ({ decision: null as 'allow' | 'deny' | null }));
vi.mock('../session/controls/controls-for', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session/controls/controls-for')>();
  return {
    ...actual,
    useSessionControls: (...args: Parameters<typeof actual.useSessionControls>) => {
      const port = actual.useSessionControls(...args);
      if (port === null || refusing.decision === null) return port;
      return {
        ...port,
        answerCapability: (item: AttentionItem, answer: Parameters<typeof port.answerCapability>[1]) =>
          answer.kind === 'permission' && answer.decision === refusing.decision ? { available: false as const, reason: 'Not carried here' } : port.answerCapability(item, answer),
      };
    },
  };
});

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
  refusing.decision = null;
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
    const offers2 = "A scoped allow takes the request's one suggestion; this request offers 2";
    // U1a §D: the third button and the menu's one entry, each closed with its reason, bound to no key and showing none
    const always = screen.getByRole('button', { name: 'Always allow in this project' });
    expect(always.hasAttribute('disabled')).toBe(true);
    expect(always.getAttribute('title')).toBe(offers2);
    expect(always.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(bindingsOf('request.allowLasting')).toEqual([]);
    await userEvent.setup().click(screen.getByRole('button', { name: 'More allow options' }));
    const session = await screen.findByRole('menuitem', { name: 'Allow for this session' });
    expect(session.getAttribute('aria-disabled')).toBe('true');
    expect(session.getAttribute('title')).toBe(offers2);
    await userEvent.setup().keyboard('{Escape}');
    await userEvent.setup().click(screen.getByRole('button', { name: 'More deny options' }));
    const stop = await screen.findByRole('menuitem', { name: 'Deny and stop the turn' });
    expect(stop.getAttribute('aria-disabled')).toBe('true');
    expect(stop.getAttribute('title')).toBe('Deny-and-interrupt is answered in the terminal');
    await userEvent.setup().keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Allow once' }).getAttribute('aria-keyshortcuts')).toBe('Meta+Enter'); // what it carries keeps its key
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
  });

  it('settles in place as answered in the terminal, offering nothing', () => {
    live({ pending: [raised()] });
    mount(permission({ requestId: REQ }));
    act(() => live({ pending: [], settled: [{ request: REQ, session: 'eng-1', winner: 'terminal', outcome: 'allow', by: 'terminal' }] }));
    expect(screen.getByRole('status').textContent).toBe('Answered in the terminal: Allowed');
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
    expect(screen.queryByText('Also asked in the terminal: the first answer wins')).toBeNull();
  });

  it('reads a MAWS answer that lost the race as that settlement, never an error', async () => {
    fake = fakeClient({ 'laneA.answer': { outcome: 'not_pending', settled: { winner: 'terminal', outcome: 'deny', by: 'terminal' }, message: 'already answered' }, 'laneA.catalog': null });
    window.maws = fake.client as unknown as PreloadBridge;
    live({ pending: [raised()] });
    mount(permission({ requestId: REQ }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Answered in the terminal: Denied'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays on an answer refused as the terminal’s to give, saying so with its actions closed, until a real settlement', async () => {
    fake = fakeClient({ 'laneA.answer': { outcome: 'not_pending', settled: null, terminalOnly: true, message: 'the window closed' }, 'laneA.catalog': null });
    window.maws = fake.client as unknown as PreloadBridge;
    live({ pending: [raised({ agentId: 'a1' })] });
    mount(permission({ requestId: REQ, agentId: 'a1' as never }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(screen.getByText('Answer this in the terminal')).toBeTruthy());
    await act(async () => void vi.advanceTimersByTime(5_000)); // past the not-pending card's close
    expect(screen.queryByText('Already answered elsewhere')).toBeNull();
    for (const name of ['Allow once', 'Allow for this session', 'Deny']) expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
    act(() => live({ pending: [], settled: [{ request: REQ, session: 'eng-1', winner: 'terminal', outcome: 'allow', by: 'terminal' }] }));
    expect(screen.getByRole('status').textContent).toBe('Answered in the terminal: Allowed');
  });

  it('reads a background request past its window as the terminal’s to answer, its buttons disabled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    live({ pending: [raised({ agentId: 'a1', deadline: new Date(Date.now() + 1200).toISOString() })] });
    mount(permission({ requestId: REQ, agentId: 'a1' as never }));
    expect(screen.getByRole('button', { name: 'Allow once' }).hasAttribute('disabled')).toBe(false);
    await act(async () => void vi.advanceTimersByTime(1100));
    expect(screen.getByText('Answer this in the terminal')).toBeTruthy();
    for (const name of ['Allow once', 'Allow for this session', 'Deny']) { // every answer button the card has
      const button = screen.getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('title')).toBe('Answer this in the terminal');
    }
  });
});

// The O9 sitting (item 9): the hover card read "Approval needed" with no Allow or Deny, on a Bash and a Write. UX wave U1a
// §H: the hover card offers what the one rule admits, for every lane, each button by the session's port on its own answer:
// a lane A read or command is allowed once there through the bridge, a file change only denied, and a terminal session
// whose bridge is not live offers neither.
describe('a terminal session’s request in the sidebar’s hover card', () => {
  const hover = (event: Extract<SessionEvent, { kind: `${string}.requested` }>) => render(<RequestCard item={itemFor(event, APP)} request={event} placement="hover" paneIndex={null} />);
  const buttons = () => screen.queryAllByRole('button').map((b) => b.textContent);

  it.each([
    ['a read-only tool’s', 'Read', { file_path: '/w/notes.txt' }],
    ['a command’s', 'Bash', { command: 'ls' }],
  ])('allows %s permission once through the bridge', async (_, tool, input) => {
    live({ pending: [raised({ tool, input })] });
    hover(permission({ requestId: REQ, toolName: tool, displayName: tool, input }));
    expect(buttons()).toEqual(['Open session', 'Deny', 'Allow once']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
  });

  it('only denies a file change, through the bridge', async () => {
    const input = { file_path: '/w/a.ts', content: 'export {};' };
    live({ pending: [raised({ tool: 'Write', input })] });
    hover(permission({ requestId: REQ, toolName: 'Write', displayName: 'Write', input }));
    expect(buttons()).toEqual(['Open session', 'Deny']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }]));
  });

  it('offers neither while the bridge is not live', () => {
    live({ bridge: 'none', pending: [raised({ tool: 'Read', input: { file_path: '/w/notes.txt' } })] });
    hover(permission({ requestId: REQ, toolName: 'Read', displayName: 'Read', input: { file_path: '/w/notes.txt' } }));
    expect(buttons()).toEqual(['Open session']);
  });

  it.each([
    ['refuses Allow once and carries Deny', 'allow', ['Open session', 'Deny'], 'Deny', { kind: 'permission', decision: 'deny' }],
    ['carries Allow once and refuses Deny', 'deny', ['Open session', 'Allow once'], 'Allow once', { kind: 'permission', decision: 'allow', scope: 'once' }],
  ] as const)('where the port %s, offers only the answer it carries, and sends it', async (_, refused, shown, press, sent) => {
    refusing.decision = refused;
    live({ pending: [raised({ tool: 'Read', input: { file_path: '/w/notes.txt' } })] });
    hover(permission({ requestId: REQ, toolName: 'Read', displayName: 'Read', input: { file_path: '/w/notes.txt' } }));
    expect(buttons()).toEqual(shown);
    await userEvent.setup().click(screen.getByRole('button', { name: press }));
    await waitFor(() => expect(answers()).toEqual([sent]));
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

  // UX wave U1a §F: the bridge carries allow and deny, never a mode, so a terminal session's plan has no menu and its
  // button names no mode, even under this build's engine host and with a status of an earlier run naming one
  it('offers no mode menu and names no mode', async () => {
    useHosts.setState({ supervisor: hostStatus() });
    try {
      useSessions.getState().applyStatus({ appSessionId: APP, status: { ...status(APP, { process: 'exited' }), prePlanMode: 'acceptEdits' } }, TEST_MACHINE);
      live({ pending: [raised({ tool: 'ExitPlanMode', input: { plan: '1. do it' } })] });
      mount({ id: 'e' as never, sessionId: 's' as never, at: '2026-10-28T10:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, kind: 'plan.requested', requestId: REQ, toolUseId: REQ as never, plan: '1. do it', input: { plan: '1. do it' } });
      expect(screen.queryByRole('button', { name: 'More implement options' })).toBeNull();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Implement' }));
      await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null }]));
    } finally {
      useHosts.setState({ supervisor: null });
    }
  });

  // U1a (A5, A18; §G): an asynchronous question is never declined by Esc, and its Dismiss sends the bridge's dismissal
  // where the bridge declares it; a state without the key is the plugin as installed before sminos 1.47.0
  const asyncRaised = raised({ tool: 'mcp__plugin_sminos_ask__ask', async: true, input: { questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes' }] }] } });
  const asyncQuestion: SessionEvent = {
    id: 'e' as never, sessionId: 's' as never, at: '2026-10-28T10:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, kind: 'question.requested', requestId: REQ, toolUseId: REQ as never,
    questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes', description: null, preview: null }], multiSelect: false }],
  };
  const mountAsync = () => mount(asyncQuestion as Extract<SessionEvent, { kind: 'question.requested' }>, { kind: 'async_input' });
  const dismissButton = () => screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement;
  const withDismiss = (control: { available: boolean; reason?: string }) => ({ ...laneAState(APP).controls, 'decide.dismiss': control });

  it('never declines an async question by Esc, and a Skip that would leave it unanswered is closed', async () => {
    live({ pending: [asyncRaised], controls: withDismiss({ available: true }) });
    mountAsync();
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

  it('dismisses an async question through the bridge where it declares decide.dismiss: one laneA.answer of the plain deny', async () => {
    live({ pending: [asyncRaised], controls: withDismiss({ available: true }) });
    mountAsync();
    expect(dismissButton().disabled).toBe(false);
    await userEvent.setup().click(dismissButton());
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }]));
    expect(fake.invoked('laneA.answer')).toHaveLength(1);
  });

  it('draws Dismiss disabled with why where the bridge declares no dismissal, or declares it unavailable', async () => {
    live({ pending: [asyncRaised] });
    mountAsync();
    expect(dismissButton().disabled).toBe(true);
    expect(dismissButton().title).toBe('Dismiss it in the terminal');
    await userEvent.setup().click(dismissButton());
    expect(answers()).toEqual([]);
    cleanup();
    live({ pending: [asyncRaised], controls: withDismiss({ available: false, reason: 'MAWS controls this session' }) });
    mountAsync();
    expect(dismissButton().disabled).toBe(true);
    expect(dismissButton().title).toBe('MAWS controls this session');
    expect(screen.getByRole('button', { name: 'Skip' }).hasAttribute('disabled')).toBe(true);
  });

  it('returns to its controls with Retry when the bridge refuses the dismissal, the question still waiting', async () => {
    live({ pending: [asyncRaised], controls: withDismiss({ available: true }) });
    fake = fakeClient({ 'laneA.answer': { outcome: 'refused', code: 'bad-args', message: 'behavior is allow or deny' }, 'laneA.catalog': null });
    window.maws = fake.client as unknown as PreloadBridge;
    mountAsync();
    await userEvent.setup().click(dismissButton());
    expect(await screen.findByText("Couldn't deliver the answer")).toBeTruthy();
    expect(screen.getByText("Couldn't deliver the answer").getAttribute('title')).toBe('behavior is allow or deny');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(dismissButton().disabled).toBe(false);
  });

  it.each([
    ['terminal', 'Dismissed in the terminal'],
    ['cli', 'Dismissed elsewhere'],
    ['bridge', 'No longer asked'],
  ])('settles a withdrawn async question by %s in place as “%s”', (by, words) => {
    live({ pending: [asyncRaised] });
    mountAsync();
    act(() => live({ pending: [], settled: [{ request: REQ, session: 'eng-1', winner: by === 'terminal' ? 'terminal' : 'other', outcome: 'withdrawn', by }] }));
    expect(screen.getByRole('status').textContent).toBe(words);
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
