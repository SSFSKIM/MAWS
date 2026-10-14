import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { StartOutcome } from '@shared/sessions/setup';
import { TRUST_GATES } from '@shared/sessions/trust';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { closeDialog, useDialogs } from './dialogs';
import { health, ID, intent, MESSAGE, putIntent, REPO, resetSetupStore, resources, trustState } from '../test-support/setup-intents';
import { FailureCard } from './FailureCard';
import { NewSessionEmptyState } from './NewSessionEmptyState';
import { RelayCard } from './RelayCard';
import { connectSetupDock } from './SetupCard';
import { connectKeys } from '../keymap/dispatcher';
import { resetDockedCards, useDockedCards } from '../composer/docked/registry';
import { registerMessageReturn } from './message-return';
import { continueSetup, isContinuing, releaseMessage, resumeSession, startIntent } from './setup-actions';
// P2-A start
import { record, status } from '../../../../test/support/builders';
import { RELAY_POLL_MS } from './SetupCard';
import { sendHumanPrompt } from '../composer/submit/send-human-prompt';
import { submitHumanSerialized } from '../composer/editor/submit'; // P2-F (L118)
import { resetComposerStore, useComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { acquireSession } from './acquire';
// P2-A end
import { connectSetup, isStarting, useSetup } from './store';
import { TrustCard } from './TrustCard';
// C11 start
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BUILTIN_MODELS } from '@shared/sessions/models';
import { SETTINGS_DEFAULTS_V14 } from '@shared/settings/defaults';
import { GatewayDialogs } from '../gateway/SwitchSheet';
import { registerAction } from '../keymap/actions-runtime';
import { useSettings } from '../stores/settings';
import { REL } from '../test-support/relative-time';
// C11 end

let fake: FakeClient;
let returned: unknown[];
let offReturn: () => void;
let offDock: () => void;

// Where C7's composer shows a docked card: the oldest one, in the composer's place (M4b docks every setup card there).
function Docked() {
  const cards = useDockedCards(ID);
  return (
    <div data-testid="docked" data-cards={cards.map((c) => c.id).join(' ')}>
      {cards[0]?.render() ?? null}
    </div>
  );
}
const dockedIds = () => screen.getByTestId('docked').dataset.cards;

function withMain(auto: Parameters<typeof fakeClient>[0] = {}) {
  fake = fakeClient(auto);
  window.maws = fake.client;
}

beforeEach(() => {
  resetSetupStore();
  useSessions.setState({ records: new Map(), engine: new Map(), digests: new Map() }); // P2-A: a record's card is told by its record
  useNotices.setState({ notices: [] });
  returned = [];
  offReturn = registerMessageReturn((_id, message) => returned.push(message));
  resetDockedCards();
  offDock = connectSetupDock();
});
afterEach(() => {
  cleanup();
  offDock();
  offReturn();
  delete (window as { maws?: MawsBridge }).maws;
});

const answer = (outcome: StartOutcome) => () => outcome;
const starting: StartOutcome = { status: 'starting', appSessionId: ID };

describe('trust card', () => {
  it('lists what trust would load, or the generic gates, and names the key when it differs', () => {
    const { rerender } = render(<TrustCard trust={trustState({ directory: `${REPO}/.claude/worktrees/one` })} busy={false} onAccept={vi.fn()} onDecline={vi.fn()} onStartWithoutTrusting={vi.fn()} />);
    expect(screen.getByText('.claude/settings.json')).toBeTruthy();
    expect(screen.getByText('1 MCP server: c10-sentinel')).toBeTruthy();
    expect(screen.getByText(`${REPO}/.claude/worktrees/one`)).toBeTruthy();
    expect(screen.getByText(/Trust is recorded for the repository at/).textContent).toContain(REPO);
    rerender(<TrustCard trust={trustState({ found: [] })} busy={false} onAccept={vi.fn()} onDecline={vi.fn()} onStartWithoutTrusting={vi.fn()} />);
    for (const gate of TRUST_GATES) expect(screen.getByText(gate)).toBeTruthy();
  });

  it('renders the home copy and no found promise for the home directory', () => {
    render(<TrustCard trust={trustState({ isHome: true, keyKind: 'directory', found: [{ file: '.claude/settings.json', summary: '1 allow rule' }] })} busy={false} onAccept={vi.fn()} onDecline={vi.fn()} onStartWithoutTrusting={vi.fn()} />);
    expect(screen.getByText(/Claude Code never saves trust for your home folder/)).toBeTruthy();
    expect(screen.queryByText('.claude/settings.json')).toBeNull();
    expect(screen.queryByText(/Loads its settings/)).toBeNull();
  });

  it('docks only on needs_trust, and sends accepted or declined as pressed', async () => {
    withMain({ 'session.start': answer({ status: 'needs_trust', appSessionId: ID, trust: trustState() }), 'session.intent.release': () => intent() });
    putIntent(intent()); // before Send: main retains the message from the start on
    render(<Docked />);
    expect(screen.queryByRole('button', { name: 'Trust and start' })).toBeNull();
    expect(dockedIds()).toBe('');
    expect(await act(() => startIntent(ID, MESSAGE))).toEqual({ ok: true });
    expect(dockedIds(), 'docked in the composer through C7\'s dockCard').toBe('c10:trust');
    expect(screen.getByRole('group', { name: 'Trust this folder?' }).textContent).toContain('Composer paused'); // C7's DockedCardFrame
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    expect(fake.invoked('session.start').at(-1)).toEqual({ appSessionId: ID, message: null, options: { trust: 'accepted' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Start without trusting' }));
    expect(fake.invoked('session.start').at(-1)).toEqual({ appSessionId: ID, message: null, options: { trust: 'declined' } });
  });

  it('Cancel undocks, returns the retained message to the editor, then releases it', async () => {
    withMain({ 'session.start': answer({ status: 'needs_trust', appSessionId: ID, trust: trustState() }), 'session.intent.release': () => intent() });
    putIntent(intent({ message: MESSAGE }));
    render(<Docked />);
    await act(() => startIntent(ID, MESSAGE));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(returned).toEqual([MESSAGE]);
    expect(fake.calls.filter((c) => c.startsWith('invoke')).at(-1)).toBe('invoke session.intent.release');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Trust and start' })).toBeNull());
    expect(dockedIds(), 'undocked').toBe('');
  });

  it("answers Enter and Esc through C7's frame: Enter trusts and starts, Esc cancels and hands the message back", async () => {
    const disconnect = connectKeys();
    try {
      withMain({ 'session.start': answer({ status: 'needs_trust', appSessionId: ID, trust: trustState() }), 'session.intent.release': () => intent() });
      putIntent(intent());
      render(<Docked />);
      await act(() => startIntent(ID, MESSAGE));
      const frame = screen.getByRole('group', { name: 'Trust this folder?' });
      act(() => frame.focus());
      await userEvent.keyboard('{Enter}');
      expect(fake.invoked('session.start').at(-1)).toEqual({ appSessionId: ID, message: null, options: { trust: 'accepted' } });
      await waitFor(() => expect(screen.getByRole('group', { name: 'Trust this folder?' })).toBeTruthy()); // the answer docked it again
      act(() => screen.getByRole('group', { name: 'Trust this folder?' }).focus());
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(fake.invoked('session.intent.release')).toEqual([{ appSessionId: ID }]));
      expect(returned).toEqual([MESSAGE]);
    } finally {
      disconnect();
    }
  });

  it('a card whose continuation is running ignores Esc and Enter', async () => {
    const disconnect = connectKeys();
    try {
      withMain({ 'session.intent.release': () => intent() }); // session.start waits for the test's answer
      putIntent(intent());
      render(<Docked />);
      useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE });
      const frame = await screen.findByRole('group', { name: 'Trust this folder?' });
      act(() => frame.focus());
      await userEvent.keyboard('{Enter}');
      expect(fake.invoked('session.start')).toHaveLength(1); // Trust and start, not answered yet
      // the continuation runs: the card is still docked (a start this window sent), and its keys are unbound
      act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
      const running = await screen.findByRole('group', { name: 'Trust this folder?' });
      act(() => running.focus());
      await userEvent.keyboard('{Escape}');
      await userEvent.keyboard('{Enter}');
      expect(fake.invoked('session.intent.release'), 'Esc hands nothing back while main runs the start').toEqual([]);
      expect(fake.invoked('session.start'), 'Enter starts nothing twice').toHaveLength(1);
      expect(returned).toEqual([]);
    } finally {
      disconnect();
    }
  });

  it("Cancel on a resume's card only undocks it, quietly: an acquisition retains nothing in main (P2-A)", async () => {
    withMain({ 'session.acquire': () => ({ status: 'needs_trust', appSessionId: ID, trust: trustState() }), 'session.intent.release': () => null });
    useSessions.setState({ records: new Map([[ID, record(ID)]]) });
    render(<Docked />);
    expect(await act(() => resumeSession(ID))).toBe(true);
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: ID, reason: 'resume' }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dockedIds()).toBe(''));
    expect(fake.invoked('session.intent.release')).toEqual([]);
    expect(returned).toEqual([]);
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('a continuation that is refused hands the docked message back and says why', async () => {
    let outcome: StartOutcome = { status: 'needs_trust', appSessionId: ID, trust: trustState() };
    withMain({ 'session.start': () => outcome });
    putIntent(intent({ message: MESSAGE }));
    render(<Docked />);
    await act(() => startIntent(ID, MESSAGE));
    outcome = { status: 'missing_directory', appSessionId: ID, directory: REPO };
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(returned).toEqual([MESSAGE]));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual([`Directory not found: ${REPO}`]);
  });
});

describe('relay card', () => {
  it("'Run direct' re-invokes session.start with the direct route on the same id", async () => {
    withMain({ 'session.start': answer({ status: 'relay_unreachable', appSessionId: ID, health: health() }), 'engine.relayHealth': () => health() });
    putIntent(intent({ message: MESSAGE }));
    render(<Docked />);
    await act(() => startIntent(ID, MESSAGE));
    expect(await screen.findByText(/relay is not answering/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Run direct' }));
    expect(fake.invoked('session.start').at(-1)).toEqual({ appSessionId: ID, message: null, options: { gateway: 'direct' } });
  });

  it('docks on a late relay_unreachable from the launch, and restarts routed once the relay answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let up = false;
      withMain({ 'session.start': answer(starting), 'engine.relayHealth': () => health({ ok: up, status: up ? 200 : null, error: up ? null : 'timed out' }) });
      putIntent(intent({ message: MESSAGE }));
      render(<Docked />);
      act(() => useSetup.getState().applySetup({ appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'relay_unreachable', health: health() } }));
      expect(await screen.findByRole('button', { name: 'Run direct' })).toBeTruthy();
      up = true;
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      await waitFor(() => expect(fake.invoked('session.start').at(-1)).toEqual({ appSessionId: ID, message: null, options: { gateway: 'gateway' } }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("under the 'wait' policy the primary is 'Open ClaudeUsage, then start'; Run direct waits for a Claude model on a gateway model", () => {
    const { rerender } = render(<RelayCard health={health()} policy="wait" now={Date.parse('2026-09-29T10:00:04.000Z')} gatewayModel={false} openClaudeUsage={null} onAccept={vi.fn()} onDecline={vi.fn()} onRecheck={vi.fn()} />);
    expect(screen.getAllByRole('button')[0]!.textContent).toBe('Open ClaudeUsage, then start');
    expect(screen.getByText(new RegExp(`Waiting for the relay · checked ${REL.now}`))).toBeTruthy();
    rerender(<RelayCard health={health()} policy="ask" now={Date.parse('2026-09-29T10:00:04.000Z')} gatewayModel openClaudeUsage={null} onAccept={vi.fn()} onDecline={vi.fn()} onRecheck={vi.fn()} />);
    const direct = screen.getByRole('button', { name: 'Run direct' });
    expect(direct.hasAttribute('disabled')).toBe(true);
    expect(direct.getAttribute('title')).toBe('Pick a Claude model first');
  });
});

// C11 start: the docked card as C11 feeds it (C11's Asks of C10 (2) and (7)): the policy from settings v3, the hand-off
// action once registered, and Run direct on a gateway model asking for a Claude model first.
// P2-A (M1's re-review): an intent's relay card shares the path: a Recheck pending when it is cancelled starts nothing
describe('relay card, a Recheck outliving its card', () => {
  it('an intent’s card cancelled while its Recheck is out starts nothing once the relay answers', async () => {
    withMain({ 'session.intent.release': () => intent() });
    putIntent(intent({ message: MESSAGE }));
    act(() => useSetup.getState().dock(ID, { kind: 'relay', health: health(), message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fake.pending('engine.relayHealth')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(useSetup.getState().cards.has(ID)).toBe(false));
    await act(() => fake.reply('engine.relayHealth', health({ ok: true, status: 200, error: null })));
    expect(fake.invoked('session.start')).toEqual([]);
  });
});

describe('relay card, with C11', () => {
  let relayUp = false;
  const docked = async (over: Parameters<typeof intent>[0] = {}) => {
    relayUp = false;
    withMain({
      'session.start': answer({ status: 'relay_unreachable', appSessionId: ID, health: health() }),
      'engine.relayHealth': () => health({ ok: relayUp, status: relayUp ? 200 : null, error: relayUp ? null : 'timed out' }),
      'session.intent.patch': (input: unknown) => ({ ...intent(over), ...(input as { patch: object }).patch }),
      'engine.models': { models: [...BUILTIN_MODELS], source: 'builtin', at: null },
    });
    putIntent(intent({ message: MESSAGE, ...over }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Docked />
        <GatewayDialogs />
      </QueryClientProvider>,
    );
    await act(() => startIntent(ID, MESSAGE));
    return within(await screen.findByTestId('docked'));
  };
  afterEach(() => useSettings.setState({ state: null }));

  it("settings' relayUnreachable 'wait' makes Open ClaudeUsage, then start the primary, and it runs C11's hand-off", async () => {
    useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V14, gateway: { ...SETTINGS_DEFAULTS_V14.gateway, relayUnreachable: 'wait' } }, resolvedTheme: 'light' } as never });
    const handOff = vi.fn();
    const off = registerAction('gateway.openClaudeUsage', handOff);
    const card = await docked();
    const [primary] = card.getAllByRole('button');
    expect(primary!.textContent).toBe('Open ClaudeUsage, then start');
    expect(card.getByText(/Waiting for the relay/)).toBeTruthy();
    await userEvent.click(primary!);
    expect(handOff).toHaveBeenCalledTimes(1);
    off();
  });

  it('on a gateway model Run direct asks for a Claude model, patches the intent with it, then starts direct', async () => {
    const card = await docked({ model: 'claude/astra' });
    const direct = card.getByRole('button', { name: 'Run direct' });
    expect(direct.hasAttribute('disabled')).toBe(false);
    await userEvent.click(direct);
    const pick = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
    await userEvent.click(await within(pick).findByRole('radio', { name: /^Sonnet/ }));
    await userEvent.click(within(pick).getByRole('button', { name: 'Use this model' }));
    await waitFor(() => expect(fake.invoked('session.start').at(-1)).toEqual({ appSessionId: ID, message: null, options: { gateway: 'direct' } }));
    expect(fake.invoked('session.intent.patch').at(-1)).toEqual({ appSessionId: ID, patch: { model: 'sonnet' } });
  });

  it('while the Claude-model pick is open the card stops polling, so a recovering relay starts nothing under it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const card = await docked({ model: 'claude/astra' });
      await userEvent.click(card.getByRole('button', { name: 'Run direct' }));
      const pick = await screen.findByRole('dialog', { name: 'Choose a Claude model' });
      relayUp = true;
      const polls = fake.invoked('engine.relayHealth').length;
      await act(() => vi.advanceTimersByTimeAsync(12_000));
      expect(fake.invoked('engine.relayHealth').length, 'no poll while the pick is open').toBe(polls);
      expect(fake.invoked('session.start').map((i) => (i as { options: unknown }).options)).toEqual([{}]); // only the first send's
      await userEvent.click(within(pick).getByRole('button', { name: 'Cancel' }));
      await act(() => vi.advanceTimersByTimeAsync(5_000));
      await waitFor(() => expect(fake.invoked('session.start').at(-1)).toEqual({ appSessionId: ID, message: null, options: { gateway: 'gateway' } })); // the poll is back
    } finally {
      vi.useRealTimers();
    }
  });
});
// C11 end

// Debt wave 4: main refuses a relay alias on the direct route; Send offers the Direct-compatible choice first
describe('a gateway model on the direct route', () => {
  const words = 'claude/astra is a gateway model, which the Direct route cannot serve · choose a Claude model, or start on the gateway';
  const refusal: StartOutcome = { status: 'invalid', appSessionId: ID, field: 'model', message: words };

  it('a pick is written with its effort and the message sent once more; the resend asks no second time', async () => {
    const outcomes = [refusal, starting];
    withMain({ 'session.start': () => outcomes.shift(), 'session.intent.patch': ({ patch }: { patch: object }) => intent({ gateway: 'direct', ...patch }) });
    putIntent(intent({ gateway: 'direct', model: 'claude/astra', effort: 'max' }));
    const pick = vi.fn(async () => ({ model: 'sonnet', effort: 'high' as const }));
    expect(await act(() => startIntent(ID, MESSAGE, pick))).toEqual({ ok: true });
    expect(pick).toHaveBeenCalledExactlyOnceWith(ID);
    expect(fake.invoked('session.intent.patch')).toEqual([{ appSessionId: ID, patch: { model: 'sonnet', effort: 'high' } }]);
    expect(fake.invoked('session.start')).toEqual([
      { appSessionId: ID, message: MESSAGE, options: {} },
      { appSessionId: ID, message: MESSAGE, options: {} },
    ]);
    expect(useSetup.getState().intents.get(ID)).toMatchObject({ model: 'sonnet', effort: 'high' });
  });

  it('a cancelled pick leaves the refusal, naming the model and the route, as the editor’s error and the intent as it was', async () => {
    withMain({ 'session.start': answer(refusal) });
    putIntent(intent({ gateway: 'direct', model: 'claude/astra' }));
    expect(await act(() => startIntent(ID, MESSAGE, async () => null))).toEqual({ ok: false, error: words });
    expect(fake.invoked('session.intent.patch')).toEqual([]);
    expect(fake.invoked('session.start')).toHaveLength(1);
  });

  it('a refusal after the pick is the editor’s error, with no second pick', async () => {
    withMain({ 'session.start': answer(refusal), 'session.intent.patch': () => intent({ gateway: 'direct', model: 'sonnet' }) });
    putIntent(intent({ gateway: 'direct', model: 'claude/astra' }));
    const pick = vi.fn(async () => ({ model: 'sonnet', effort: null }));
    expect(await act(() => startIntent(ID, MESSAGE, pick))).toEqual({ ok: false, error: words });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(fake.invoked('session.intent.patch')).toEqual([{ appSessionId: ID, patch: { model: 'sonnet' } }]);
  });
});

describe('failure card', () => {
  const failed = (over: Parameters<typeof resources>[0] = {}) => ({ message: 'launch refused: replay_disabled', resources: resources(over) });

  it('renders every resource outcome in words, the branch included', () => {
    const worktree = { path: `${REPO}/.claude/worktrees/accept-fail`, branch: 'worktree-accept-fail', createdHere: true, detail: null };
    const props = { busy: false, retainedWorktree: false, onAccept: vi.fn(), onDecline: vi.fn(), onDiscard: vi.fn(), onKeep: vi.fn() };
    const { rerender } = render(<FailureCard failure={failed({ worktree: { ...worktree, state: 'removed', branchState: 'deleted' } })} {...props} />);
    expect(screen.getByText('launch refused: replay_disabled')).toBeTruthy();
    expect(screen.getByText('Worktree accept-fail removed')).toBeTruthy();
    expect(screen.getByText('Branch worktree-accept-fail deleted')).toBeTruthy();
    expect(screen.getByText('Record removed')).toBeTruthy();
    rerender(<FailureCard failure={failed({ worktree: { ...worktree, state: 'remove_refused', detail: 'dirty: 1 uncommitted change', branchState: 'kept' } })} {...props} />);
    expect(screen.getByText('Worktree accept-fail kept: 1 uncommitted change')).toBeTruthy();
    expect(screen.getByText('Branch worktree-accept-fail kept')).toBeTruthy();
    rerender(<FailureCard failure={failed({ worktree: { ...worktree, state: 'remove_failed', detail: 'fatal: busy', branchState: 'kept' } })} {...props} />);
    expect(screen.getByText('Worktree accept-fail could not be removed: fatal: busy')).toBeTruthy();
    rerender(<FailureCard failure={failed({ worktree: { ...worktree, state: 'removed', branchState: 'delete_refused', detail: 'unmerged: 1 commit' } })} {...props} />);
    expect(screen.getByText('Branch worktree-accept-fail kept: 1 commit')).toBeTruthy();
    rerender(<FailureCard failure={failed({ worktree: { ...worktree, state: 'removed', branchState: 'delete_failed', detail: 'error: locked' } })} {...props} />);
    expect(screen.getByText('Branch worktree-accept-fail could not be deleted: error: locked')).toBeTruthy();
    rerender(<FailureCard failure={failed({ record: 'kept', transcript: 'kept' })} {...props} />);
    expect(screen.getByText('Session kept with its transcript')).toBeTruthy();
  });

  it('docks on failed; Retry re-invokes session.start with nothing beyond the id; Keep the worktree detaches it', async () => {
    const path = `${REPO}/.claude/worktrees/accept-fail`;
    const detached = intent({ message: MESSAGE, location: { kind: 'existingWorktree', repoRoot: REPO, path }, progress: { ...intent().progress, worktree: { path, branch: 'worktree-accept-fail', head: 'abc', createdHere: false } } });
    withMain({ 'session.start': answer(starting), 'session.intent.resolveWorktree': () => ({ intent: detached, worktree: { path, branch: 'worktree-accept-fail', createdHere: false, state: 'kept', detail: null, branchState: 'none' } }) });
    putIntent(intent({ message: MESSAGE, progress: { ...intent().progress, worktree: { path, branch: 'worktree-accept-fail', head: 'abc', createdHere: true } } }));
    render(<Docked />);
    act(() => useSetup.getState().applySetup({ appSessionId: ID, phase: 'launching', detail: 'Starting', outcome: null })); // this window follows the start
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    act(() =>
      useSetup.getState().applySetup({
        appSessionId: ID,
        phase: 'failed',
        detail: null,
        outcome: { kind: 'error', message: 'the engine exited', resources: resources({ worktree: { path, branch: 'worktree-accept-fail', createdHere: true, state: 'remove_refused', detail: 'dirty: 1 uncommitted change', branchState: 'kept' } }) },
      }),
    );
    expect(dockedIds()).toBe('c10:failure');
    await userEvent.click(await screen.findByRole('button', { name: 'Keep the worktree' }));
    expect(fake.invoked('session.intent.resolveWorktree')).toEqual([{ appSessionId: ID, resolution: 'keep' }]);
    // the kept checkout's cleanup is reachable from the result (no record names it until a session runs there)
    const [kept] = useNotices.getState().notices;
    expect(kept?.text).toBe('Worktree accept-fail kept as this session’s location');
    expect(kept?.actions.map((a) => a.label)).toEqual(['Remove worktree…']);
    act(() => kept!.actions[0]!.run());
    expect(useDialogs.getState().open).toEqual({ kind: 'cleanup', target: { repoRoot: REPO, path, branch: 'worktree-accept-fail' } });
    act(() => closeDialog());
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fake.invoked('session.start')).toEqual([{ appSessionId: ID, message: null, options: {} }]);
  });

  it('a record’s failed resume is no card but a toast; the record stays an exited session', async () => {
    withMain({ 'session.intent.list': () => ({ intents: [] }), 'session.deletions.list': () => ({ manifests: [] }) });
    const connection = connectSetup(fake.client);
    render(<Docked />);
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'the engine exited (code 1)', resources: resources({ record: 'kept' }) } }));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['the engine exited (code 1)']);
    connection.disconnect();
  });

  it('a failed acquisition is told once: the row’s Resume names it from the reply; its run’s tagged failure toasts nothing (P2-A)', async () => {
    withMain({ 'session.acquire': () => ({ status: 'failed', appSessionId: ID, message: 'the engine exited (code 1)', resources: resources({ record: 'kept' }) }), 'session.intent.list': () => ({ intents: [] }), 'session.deletions.list': () => ({ manifests: [] }) });
    const connection = connectSetup(fake.client);
    await connection.ready;
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'the engine exited (code 1)', resources: resources({ record: 'kept' }) }, acquisition: true }));
    expect(await act(() => resumeSession(ID))).toBe(false);
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: ID, reason: 'resume' }]);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['the engine exited (code 1)']);
    expect(returned, 'an acquisition holds no message to hand back').toEqual([]);
    connection.disconnect();
  });

  it('a launch that kept its transcript is told after its intent went: a toast, no card, and its unsent first message back in the editor', async () => {
    withMain({ 'session.intent.list': () => ({ intents: [intent({ message: MESSAGE })] }), 'session.deletions.list': () => ({ manifests: [] }) });
    const connection = connectSetup(fake.client);
    await connection.ready;
    render(<Docked />);
    act(() => fake.event('session.intent.changed', { appSessionId: ID, intent: null }));
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'the model is not available', resources: resources({ record: 'kept', transcript: 'kept' }) } }));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['the model is not available']);
    expect(returned, 'the handoff never happened: the message comes back').toEqual([MESSAGE]);
    connection.disconnect();
  });

  it('a start that became ready and then lost its intent hands nothing back', async () => {
    withMain({ 'session.intent.list': () => ({ intents: [intent({ message: MESSAGE })] }), 'session.deletions.list': () => ({ manifests: [] }) });
    const connection = connectSetup(fake.client);
    await connection.ready;
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'ready', detail: null, outcome: { kind: 'ready', engineSessionId: 'e' as never, firstTurn: 'sent' } }));
    act(() => fake.event('session.intent.changed', { appSessionId: ID, intent: null }));
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'later', resources: resources({ record: 'kept' }) } }));
    expect(returned).toEqual([]);
    connection.disconnect();
  });

  // the window reloaded while a card waited (or a start ran): main holds the message and reports no failure, and the
  // card lived in the old page; the tab offers Retry and Back to editing instead of a composer locked with nothing to press
  it('after a reload, an intent still holding its message offers Retry (which docks the trust card again) and Back to editing', async () => {
    withMain({ 'session.intent.list': () => ({ intents: [intent({ message: MESSAGE })] }), 'session.deletions.list': () => ({ manifests: [] }), 'session.start': answer({ status: 'needs_trust', appSessionId: ID, trust: trustState() }), 'session.intent.release': () => intent() });
    const connection = connectSetup(fake.client);
    await connection.ready;
    render(<Docked />);
    expect(await screen.findByText('Your first message has not been sent.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to editing' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(fake.invoked('session.start')).toEqual([{ appSessionId: ID, message: null, options: {} }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(returned).toEqual([MESSAGE]);
    expect(fake.invoked('session.intent.release')).toEqual([{ appSessionId: ID }]);
    connection.disconnect();
  });

  // (carried to M4b by the interim branch review) the reload card cannot know whether main still runs the start: Back to
  // editing asks main first and returns the message only once main handed it back
  it("after a reload, Back to editing releases first and returns the message only when main handed it back", async () => {
    withMain({ 'session.intent.list': () => ({ intents: [intent({ message: MESSAGE })] }), 'session.deletions.list': () => ({ manifests: [] }) });
    const connection = connectSetup(fake.client);
    await connection.ready;
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Back to editing' }));
    expect(fake.invoked('session.intent.release')).toEqual([{ appSessionId: ID }]);
    expect(returned, 'nothing before main answers').toEqual([]);
    await act(() => fake.fail('session.intent.release', `starting: a start is in flight for ${ID}`));
    expect(returned, 'main is sending it').toEqual([]);
    expect(useNotices.getState().notices.map((n) => [n.level, n.text])).toEqual([['info', 'Starting…']]);
    await userEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    await act(() => fake.reply('session.intent.release', intent()));
    expect(returned).toEqual([MESSAGE]);
    await waitFor(() => expect(dockedIds()).toBe(''));
    connection.disconnect();
  });

  it('a start this window sent shows no such card before its first phase arrives', async () => {
    withMain({ 'session.start': answer(starting) });
    putIntent(intent({ message: MESSAGE }));
    render(<Docked />);
    expect(await act(() => startIntent(ID, MESSAGE))).toEqual({ ok: true });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a Retry main refuses because a start still runs hands nothing back', async () => {
    withMain(); // session.start waits for the test's answer
    putIntent(intent({ message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await act(() => fake.fail('session.start', `starting: a start is in flight for ${ID}`));
    expect(returned).toEqual([]);
    expect(useNotices.getState().notices.map((n) => [n.level, n.text])).toEqual([['info', 'Starting…']]);
  });

  it('Discard changes and remove needs its acknowledgement; Back to editing returns the message and releases it', async () => {
    const path = `${REPO}/.claude/worktrees/accept-fail`;
    const lastFailure = { at: '2026-09-29T10:00:00.000Z', phase: 'launching' as const, message: 'MAWS quit before the session started', resources: resources({ worktree: { path, branch: 'worktree-accept-fail', createdHere: true, state: 'remove_refused', detail: 'dirty: 2 uncommitted changes', branchState: 'kept' } }) };
    const discarded = intent({ message: MESSAGE, progress: { ...intent().progress, lastFailure } });
    withMain({
      'session.intent.resolveWorktree': () => ({ intent: discarded, worktree: { path, branch: 'worktree-accept-fail', createdHere: true, state: 'removed', detail: null, branchState: 'deleted' } }),
      'session.intent.release': () => ({ ...discarded, message: null }),
    });
    putIntent(intent({ message: MESSAGE, progress: { ...intent().progress, worktree: { path, branch: 'worktree-accept-fail', head: 'abc', createdHere: true }, lastFailure } }));
    render(<Docked />);
    expect(screen.getByText('MAWS quit before the session started')).toBeTruthy(); // after a restart, from the intent
    const discard = screen.getByRole('button', { name: 'Discard changes and remove' });
    expect(discard.hasAttribute('disabled')).toBe(true);
    const ack = screen.getByRole('checkbox', { name: 'Discard 2 uncommitted changes; this cannot be undone' });
    expect(ack.getAttribute('aria-label'), 'named by its own attribute, not only by the label around it').toBe('Discard 2 uncommitted changes; this cannot be undone');
    await userEvent.click(ack);
    await userEvent.click(discard);
    expect(fake.invoked('session.intent.resolveWorktree')).toEqual([{ appSessionId: ID, resolution: 'discard' }]);
    expect(await screen.findByText('Worktree accept-fail removed')).toBeTruthy(); // the resolution's own outcome
    expect(screen.getByText('Branch worktree-accept-fail deleted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep the worktree' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    expect(returned).toEqual([MESSAGE]);
    expect(fake.invoked('session.intent.release')).toEqual([{ appSessionId: ID }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()); // dismissed until the next start
  });
});

// While a failed attempt's checkout is still the intent's, `session.intent.patch` refuses every location change
// (`retained_worktree`) until "Keep the worktree" or "Discard changes and remove" resolves it; once the card that offers
// them is dismissed, the empty state above the composer offers them instead.
// P2-A start (2026-10-09; the execution document §5.3 and §5.4): a record's card. The composer's message stays in its
// draft while a trust or relay card shows it; the card's continuation acquires with the owner's choice, sends the
// message through the human seam and clears the composer only once the host accepted it.
describe('a record’s trust card and its continuation', () => {
  const TRUST = trustState();
  const ACCEPTED = { status: 'ready', appSessionId: ID, launched: true, joined: false };
  const NEEDS_TRUST = { status: 'needs_trust', appSessionId: ID, trust: TRUST };
  // `session.acquire` answers in turn: each call takes the next outcome (the last repeats)
  const acquiring = (...outcomes: unknown[]) => {
    let n = 0;
    return () => {
      const outcome = outcomes[Math.min(n, outcomes.length - 1)];
      n++;
      return outcome;
    };
  };
  const known = () => useSessions.setState({ records: new Map([[ID, record(ID)]]), engine: new Map(), digests: new Map() });
  const composerSend = () => sendHumanPrompt(ID, MESSAGE.content, { origin: 'composer', display: MESSAGE.display });

  beforeEach(() => {
    known();
    resetComposerStore();
  });

  it('a Send then a Load now on an untrusted session: the docked card still shows the message', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST) });
    render(<Docked />);
    expect(await act(composerSend)).toEqual({ disposition: 'held', started: false, reason: 'trust' });
    expect(await act(() => acquireSession(ID, 'read'))).toMatchObject({ status: 'needs_trust' });
    expect(useSetup.getState().cards.get(ID)).toEqual({ kind: 'trust', trust: TRUST, message: MESSAGE });
    expect(dockedIds()).toBe('c10:trust');
  });

  it('Trust and start acquires with the decision, sends the docked message with its display, then clears the composer', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST, ACCEPTED), 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' } });
    render(<Docked />);
    await act(composerSend);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: ID, content: MESSAGE.content }]));
    expect(fake.invoked('session.acquire')[1]).toEqual({ appSessionId: ID, reason: 'send', options: { trust: 'accepted' } });
    await waitFor(() => expect(useComposerStore.getState().prefills.get(ID)).toEqual({ text: '' }));
    expect(dockedIds()).toBe('');
    expect(fake.invoked('session.intent.release')).toEqual([]);
  });

  // P2-F (L118): the composer's history row for a held message is written by the continuation once the host accepts it,
  // with the draft as the composer serialized it (its display and its pasted segments), and never for a held one
  it('a composer message sent through the card gets its prompt-history row, as the composer serialized it, once the host accepts it', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST, ACCEPTED), 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' }, 'session.history.append': undefined });
    render(<Docked />);
    const pastedContents = { '1': { id: 1, type: 'text' as const, content: 'a long paste', contentHash: null, mediaType: null, filename: null } };
    const draft = { mode: 'send' as const, text: 'Look at a long paste', content: 'Look at a long paste', display: 'Look at [Pasted text #1]', pastedContents, omitted: 0, empty: false };
    expect(await act(() => submitHumanSerialized(fake.client, ID, draft))).toBe(false);
    await waitFor(() => expect(useSetup.getState().cards.get(ID)?.message).toMatchObject({ content: draft.content, display: draft.display }));
    expect(fake.invoked('session.history.append')).toEqual([]);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: ID, content: draft.content }]));
    await waitFor(() => expect(fake.invoked('session.history.append')).toEqual([{ appSessionId: ID, display: draft.display, pastedContents }]));
  });

  // L118 review: the seam may acquire again inside the continuation's send (the renderer's status trails the process);
  // the replacement card it docks keeps the pasted segments, so its own continuation writes them to history
  it('a replacement card docked by the continuation’s own send keeps the pasted segments for the history row', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST, ACCEPTED, NEEDS_TRUST, ACCEPTED), 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' }, 'session.history.append': undefined });
    render(<Docked />);
    const pastedContents = { '1': { id: 1, type: 'text' as const, content: 'a long paste', contentHash: null, mediaType: null, filename: null } };
    const draft = { mode: 'send' as const, text: 'Look at a long paste', content: 'Look at a long paste', display: 'Look at [Pasted text #1]', pastedContents, omitted: 0, empty: false };
    expect(await act(() => submitHumanSerialized(fake.client, ID, draft))).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(fake.invoked('session.acquire')).toHaveLength(3)); // the continuation's, then the seam's again
    await waitFor(() => expect(useSetup.getState().cards.get(ID)?.message).toEqual({ content: draft.content, display: draft.display, pastedContents }));
    expect(fake.invoked('session.send')).toEqual([]);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: ID, content: draft.content }]));
    await waitFor(() => expect(fake.invoked('session.history.append')).toEqual([{ appSessionId: ID, display: draft.display, pastedContents }]));
  });

  it('a refused continuation undocks the card and says why; the composer keeps the text (nothing is handed back or cleared)', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST, { status: 'missing_directory', appSessionId: ID, directory: '/gone' }) });
    render(<Docked />);
    await act(composerSend);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(dockedIds()).toBe(''));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Directory not found: /gone']);
    expect(fake.invoked('session.send')).toEqual([]);
    expect(fake.invoked('session.history.append')).toEqual([]);
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
    expect(returned).toEqual([]);
  });

  it('a host error on the send undocks the card and keeps the text', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST, ACCEPTED) });
    render(<Docked />);
    await act(composerSend);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    await act(() => fake.fail('session.send', 'write failed'));
    await waitFor(() => expect(dockedIds()).toBe(''));
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['write failed']);
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
    expect(fake.invoked('session.history.append')).toEqual([]);
  });

  it('Cancel (Back to editing) only undocks: no hand-back to main, the text stays where it was typed', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST) });
    render(<Docked />);
    await act(composerSend);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dockedIds()).toBe(''));
    expect(fake.invoked('session.intent.release')).toEqual([]);
    expect(returned).toEqual([]);
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
  });

  it('a widget’s card (no message) only starts the session on Trust and start', async () => {
    withMain({ 'session.acquire': acquiring(NEEDS_TRUST, ACCEPTED) });
    render(<Docked />);
    await act(() => acquireSession(ID, 'read'));
    expect(useSetup.getState().cards.get(ID)).toEqual({ kind: 'trust', trust: TRUST, message: null });
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(dockedIds()).toBe(''));
    expect(fake.invoked('session.acquire')[1]).toEqual({ appSessionId: ID, reason: 'resume', options: { trust: 'accepted' } });
    expect(fake.invoked('session.send')).toEqual([]);
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
  });

  // M1's review: one continuation per card, held until its message is accepted or refused
  it('a Resume joined to the continuation cannot unlock the card mid-send; a second continuation meanwhile sends nothing', async () => {
    withMain({ 'session.queue.list': { entries: [], paused: false } });
    const READY_AGAIN = { ...ACCEPTED, joined: true };
    const first = continueSetup(ID, { trust: 'accepted' }, MESSAGE);
    const rowResume = resumeSession(ID);
    await waitFor(() => expect(fake.pending('session.acquire')).toBe(2));
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: status(ID) }));
    await act(() => fake.reply('session.acquire', ACCEPTED));
    await act(() => fake.reply('session.acquire', READY_AGAIN));
    expect(await rowResume).toBe(true);
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    expect(isStarting(useSetup.getState(), ID), 'the card stays busy while its message is on its way').toBe(true);
    expect(await continueSetup(ID, { trust: 'accepted' }, MESSAGE)).toMatchObject({ ok: false });
    expect(fake.invoked('session.acquire')).toHaveLength(2);
    await act(() => fake.reply('session.send', { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' }));
    expect(await first).toEqual({ ok: true });
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: ID, content: MESSAGE.content }]);
    expect(isStarting(useSetup.getState(), ID)).toBe(false);
  });

  it('the relay card’s poll waits while a manual Run direct continues the card: one continuation, one send', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      withMain({
        'engine.relayHealth': () => health({ ok: true, status: 200, error: null }), // the relay answers again
        'session.queue.list': { entries: [], paused: false },
        'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' },
      });
      render(<Docked />);
      const sending = composerSend();
      await waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
      await act(() => fake.reply('session.acquire', { status: 'relay_unreachable', appSessionId: ID, health: health() }));
      expect(await sending).toMatchObject({ disposition: 'held', reason: 'relay' });
      await userEvent.click(await screen.findByRole('button', { name: 'Run direct' }));
      await waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
      expect(isContinuing(ID)).toBe(true);
      await act(() => vi.advanceTimersByTimeAsync(RELAY_POLL_MS * 2)); // the poll finds the relay up while Run direct is in flight
      expect(fake.pending('session.acquire'), 'the poll started no second continuation').toBe(1);
      expect(fake.invoked('session.acquire')[1]).toEqual({ appSessionId: ID, reason: 'send', options: { gateway: 'direct' } });
      act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: status(ID) }));
      await act(() => fake.reply('session.acquire', ACCEPTED));
      await waitFor(() => expect(dockedIds()).toBe(''));
      expect(fake.invoked('session.acquire')).toHaveLength(2);
      expect(fake.invoked('session.send')).toEqual([{ appSessionId: ID, content: MESSAGE.content }]);
    } finally {
      vi.useRealTimers();
    }
  });

  // M1's round-3 review: Cancel on a card whose continuation is active is honoured; the session may still start, but the
  // dismissed card's message is not sent and the draft is left alone
  it('a card cancelled while its continuation acquires: the session starts, nothing is sent, the composer is not cleared', async () => {
    withMain({ 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' } });
    act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useSetup.getState().cards.has(ID)).toBe(false);
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: status(ID) }));
    await act(() => fake.reply('session.acquire', ACCEPTED));
    await waitFor(() => expect(isContinuing(ID)).toBe(false));
    expect(fake.invoked('session.send')).toEqual([]);
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
    expect(useNotices.getState().notices).toEqual([]);
  });

  // M1's round-4 review: a late answer of a dismissed card's acquisition docks nothing and says nothing
  it.each([
    ['relay_unreachable', { status: 'relay_unreachable', appSessionId: ID, health: health() }],
    ['needs_trust', { status: 'needs_trust', appSessionId: ID, trust: trustState() }],
    ['missing_directory', { status: 'missing_directory', appSessionId: ID, directory: '/gone' }],
    ['failed', { status: 'failed', appSessionId: ID, message: 'the model is not available', resources: { worktree: null, record: 'kept', transcript: 'kept' } }],
  ])('a card cancelled while its acquisition is out: a late %s docks no card and says nothing', async (_kind, outcome) => {
    withMain({ 'engine.relayHealth': () => health({ ok: true, status: 200, error: null }) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
      render(<Docked />);
      await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
      await waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await act(() => fake.reply('session.acquire', outcome));
      await waitFor(() => expect(isContinuing(ID)).toBe(false));
      expect(useSetup.getState().cards.has(ID)).toBe(false);
      expect(useNotices.getState().notices).toEqual([]);
      await act(() => vi.advanceTimersByTimeAsync(RELAY_POLL_MS * 2)); // no recreated card, so no poll resumes the wait
      expect(fake.invoked('session.acquire')).toHaveLength(1);
      expect(fake.invoked('session.send')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a host error on a dismissed card’s acquisition says nothing either', async () => {
    withMain();
    act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(() => fake.fail('session.acquire', 'main is gone'));
    await waitFor(() => expect(isContinuing(ID)).toBe(false));
    expect(useNotices.getState().notices).toEqual([]);
    expect(useSetup.getState().cards.has(ID)).toBe(false);
  });

  it('a relay card cancelled while its Run direct acquires sends nothing either', async () => {
    withMain({ 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' } });
    act(() => useSetup.getState().dock(ID, { kind: 'relay', health: health(), message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Run direct' }));
    await waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: status(ID) }));
    await act(() => fake.reply('session.acquire', ACCEPTED));
    await waitFor(() => expect(isContinuing(ID)).toBe(false));
    expect(fake.invoked('session.send')).toEqual([]);
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
  });

  it('a card cancelled while its message is being sent leaves the draft alone', async () => {
    withMain({ 'session.queue.list': { entries: [], paused: false } });
    act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: status(ID) }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await act(() => fake.reply('session.acquire', ACCEPTED));
    await waitFor(() => expect(fake.pending('session.send')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(() => fake.reply('session.send', { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' }));
    await waitFor(() => expect(isContinuing(ID)).toBe(false));
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
  });

  // P2-F F-C1 (C scalpel-1#1): the continuation dies with its card through the send seam's own awaits too (X22)
  it.each([
    ['ready', ACCEPTED],
    ['needs_trust', NEEDS_TRUST],
  ])('a card cancelled during the seam’s second acquisition (the status still trailing): a late %s sends nothing and docks no card', async (_kind, second) => {
    withMain({ 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' } });
    act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await act(() => fake.reply('session.acquire', ACCEPTED)); // no ready status yet: the seam acquires again
    await waitFor(() => expect(fake.pending('session.acquire')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(() => fake.reply('session.acquire', second));
    await waitFor(() => expect(isContinuing(ID)).toBe(false));
    expect(fake.invoked('session.send')).toEqual([]);
    expect(useSetup.getState().cards.has(ID)).toBe(false);
    expect(useComposerStore.getState().prefills.get(ID)).toBeUndefined();
    expect(useNotices.getState().notices).toEqual([]);
  });

  it('a card cancelled while the seam reads the queue sends nothing', async () => {
    withMain({ 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' } });
    act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: status(ID) }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Trust and start' }));
    await act(() => fake.reply('session.acquire', ACCEPTED));
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(() => fake.reply('session.queue.list', { entries: [], paused: false }));
    await waitFor(() => expect(isContinuing(ID)).toBe(false));
    expect(fake.invoked('session.send')).toEqual([]);
    expect(fake.invoked('session.steer')).toEqual([]);
    expect(useNotices.getState().notices).toEqual([]);
  });

  // M1's re-review: the continuation dies with its card; a Recheck whose read was out when the card went starts nothing
  it('a Recheck pending when the card is cancelled continues nothing once the relay answers', async () => {
    withMain({ 'session.queue.list': { entries: [], paused: false } });
    act(() => useSetup.getState().dock(ID, { kind: 'relay', health: health(), message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fake.pending('engine.relayHealth')).toBe(1));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useSetup.getState().cards.has(ID)).toBe(false);
    await act(() => fake.reply('engine.relayHealth', health({ ok: true, status: 200, error: null })));
    expect(fake.invoked('session.acquire')).toEqual([]);
    expect(fake.invoked('session.send')).toEqual([]);
  });

  it('a Recheck pending when another answer replaces the card continues nothing for the replaced card', async () => {
    withMain({ 'session.queue.list': { entries: [], paused: false } });
    act(() => useSetup.getState().dock(ID, { kind: 'relay', health: health(), message: MESSAGE }));
    render(<Docked />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fake.pending('engine.relayHealth')).toBe(1));
    act(() => useSetup.getState().dock(ID, { kind: 'relay', health: health(), message: null })); // a new card, its own wait
    await act(() => fake.reply('engine.relayHealth', health({ ok: true, status: 200, error: null })));
    expect(fake.invoked('session.acquire')).toEqual([]);
  });

  // The whole-branch review: an acquisition's own run streams its phases tagged `acquisition`, and its end reaches the
  // caller in the `session.acquire` reply, which Electron delivers on another transport in no fixed order with the
  // events; the reply alone decides the card and tells the failure, whichever arrives first
  describe('with the setup stream connected, in either delivery order', () => {
    const RELAY_FAILED = { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'relay_unreachable', health: health() }, acquisition: true } as const;
    const RELAY_ANSWER = { status: 'relay_unreachable', appSessionId: ID, health: health() };
    const ERROR_FAILED = { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'the engine exited (code 1)', resources: resources({ record: 'kept' }) }, acquisition: true } as const;
    const ERROR_ANSWER = { status: 'failed', appSessionId: ID, message: 'the engine exited (code 1)', resources: resources({ record: 'kept' }) };
    const ORDERS = ['event first', 'reply first'] as const;
    let connection: { disconnect(): void };
    beforeEach(() => {
      withMain({ 'session.intent.list': { intents: [] }, 'session.deletions.list': { manifests: [] } });
      connection = connectSetup(fake.client);
      act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
    });
    afterEach(() => connection.disconnect());

    // The run's `failed` event and the acquisition's reply in the order given; answers what the continuation answered.
    const deliver = async (order: (typeof ORDERS)[number], event: unknown, answer: unknown, continuing: Promise<unknown>) => {
      if (order === 'event first') act(() => fake.event('session.setup', event));
      await act(() => fake.reply('session.acquire', answer));
      const ended = await continuing;
      if (order === 'reply first') act(() => fake.event('session.setup', event));
      return ended;
    };

    it.each(ORDERS)('a relay failure during Trust and start (%s) leaves the relay card carrying the message', async (order) => {
      const continuing = continueSetup(ID, { trust: 'accepted' }, MESSAGE);
      expect(await deliver(order, RELAY_FAILED, RELAY_ANSWER, continuing)).toEqual({ ok: true });
      expect(useSetup.getState().cards.get(ID)).toEqual({ kind: 'relay', health: health(), message: MESSAGE });
      expect(useSetup.getState().phases.get(ID)?.phase, 'phase readers still see the run end').toBe('failed');
    });

    it.each(ORDERS)('a relay failure after Cancel (%s) recreates no card', async (order) => {
      const continuing = continueSetup(ID, { trust: 'accepted' }, MESSAGE);
      await act(() => releaseMessage(ID, MESSAGE));
      await deliver(order, RELAY_FAILED, RELAY_ANSWER, continuing);
      expect(useSetup.getState().cards.has(ID)).toBe(false);
    });

    it.each(ORDERS)('a failure after Cancel (%s) says nothing; one the card still waits on is told once', async (order) => {
      const cancelled = continueSetup(ID, { trust: 'accepted' }, MESSAGE);
      await act(() => releaseMessage(ID, MESSAGE));
      await deliver(order, ERROR_FAILED, ERROR_ANSWER, cancelled);
      expect(useNotices.getState().notices).toEqual([]);
      act(() => useSetup.getState().dock(ID, { kind: 'trust', trust: trustState(), message: MESSAGE }));
      await deliver(order, ERROR_FAILED, ERROR_ANSWER, continueSetup(ID, { trust: 'accepted' }, MESSAGE));
      expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['the engine exited (code 1)']);
    });

    it('an untagged run (a record’s own start) still docks its relay card and tells its failure', () => {
      act(() => useSetup.getState().undock(ID));
      act(() => fake.event('session.setup', { ...RELAY_FAILED, acquisition: undefined }));
      expect(useSetup.getState().cards.get(ID)).toMatchObject({ kind: 'relay' });
      act(() => fake.event('session.setup', { ...ERROR_FAILED, acquisition: undefined }));
      expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['the engine exited (code 1)']);
    });
  });
});
// P2-A end

describe('a retained worktree with its card dismissed', () => {
  const path = `${REPO}/.claude/worktrees/accept-fail`;
  const location = { kind: 'newWorktree' as const, repoRoot: REPO, name: 'accept-fail', branch: { kind: 'new' as const, name: 'worktree-accept-fail', base: 'HEAD' } };
  const retained = (state: 'kept' | 'remove_refused', detail: string | null) =>
    intent({
      location,
      message: MESSAGE,
      progress: {
        ...intent().progress,
        worktree: { path, branch: 'worktree-accept-fail', head: 'abc', createdHere: true },
        lastFailure: { at: '2026-09-29T10:00:00.000Z', phase: 'launching', message: 'the engine exited', resources: resources({ worktree: { path, branch: 'worktree-accept-fail', createdHere: true, state, detail, branchState: 'kept' } }) },
      },
    });
  const note = () => screen.queryByRole('note', { name: 'Worktree from the failed attempt' });

  it('after Back to editing, the empty state keeps Discard changes and remove (acknowledged) and Keep the worktree', async () => {
    const held = retained('remove_refused', 'dirty: 2 uncommitted changes');
    withMain({
      'session.intent.release': () => ({ ...held, message: null }),
      'session.intent.resolveWorktree': () => ({ intent: { ...held, message: null, progress: { ...held.progress, worktree: null } }, worktree: { path, branch: 'worktree-accept-fail', createdHere: true, state: 'removed', detail: null, branchState: 'deleted' } }),
    });
    putIntent(held);
    render(
      <>
        <NewSessionEmptyState appSessionId={ID} />
        <Docked />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(note(), 'the failure card offers the resolutions itself').toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to editing' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    const shown = note()!;
    expect(shown.textContent).toContain('Worktree accept-fail from the failed attempt is still this session’s: Send reuses it, and the location cannot change until you keep or discard it.');
    expect(within(shown).getByRole('button', { name: 'Keep the worktree' })).toBeTruthy();
    const discard = within(shown).getByRole('button', { name: 'Discard changes and remove' });
    expect(discard.hasAttribute('disabled')).toBe(true);
    await userEvent.click(within(shown).getByRole('checkbox', { name: 'Discard 2 uncommitted changes; this cannot be undone' }));
    await userEvent.click(discard);
    expect(fake.invoked('session.intent.resolveWorktree')).toEqual([{ appSessionId: ID, resolution: 'discard' }]);
    await waitFor(() => expect(note(), 'resolved: nothing is retained any more').toBeNull());
  });

  it('after Cancel on the relay card C3 docked, Keep the worktree stays reachable (a clean checkout kept for the retry)', async () => {
    const held = retained('kept', null);
    withMain({
      'session.intent.release': () => ({ ...held, message: null }),
      'session.intent.resolveWorktree': () => ({
        intent: { ...held, message: null, location: { kind: 'existingWorktree', repoRoot: REPO, path }, progress: { ...held.progress, worktree: { path, branch: 'worktree-accept-fail', head: 'abc', createdHere: false } } },
        worktree: { path, branch: 'worktree-accept-fail', createdHere: false, state: 'kept', detail: null, branchState: 'none' },
      }),
    });
    putIntent(held);
    render(
      <>
        <NewSessionEmptyState appSessionId={ID} />
        <Docked />
      </>,
    );
    act(() => useSetup.getState().applySetup({ appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'relay_unreachable', health: health() } }));
    expect(note(), 'the relay card waits').toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    const shown = await waitFor(() => note()!);
    expect(within(shown).queryByRole('button', { name: 'Discard changes and remove' }), 'a clean kept checkout offers no discard, as on the card').toBeNull();
    await userEvent.click(within(shown).getByRole('button', { name: 'Keep the worktree' }));
    expect(fake.invoked('session.intent.resolveWorktree')).toEqual([{ appSessionId: ID, resolution: 'keep' }]);
    await waitFor(() => expect(note()).toBeNull());
  });

  it('shows nothing while a start runs', () => {
    withMain();
    putIntent(retained('remove_refused', 'dirty: 1 uncommitted change'));
    act(() => useSetup.getState().settle(ID));
    act(() => useSetup.getState().applySetup({ appSessionId: ID, phase: 'launching', detail: 'Starting', outcome: null }));
    render(<NewSessionEmptyState appSessionId={ID} />);
    expect(note()).toBeNull();
  });
});
