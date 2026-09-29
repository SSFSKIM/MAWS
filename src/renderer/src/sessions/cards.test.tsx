import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { StartOutcome } from '@shared/sessions/setup';
import { TRUST_GATES } from '@shared/sessions/trust';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { health, ID, intent, MESSAGE, putIntent, REPO, resetSetupStore, resources, trustState } from '../test-support/setup-intents';
import { FailureCard } from './FailureCard';
import { RelayCard } from './RelayCard';
import { connectSetupDock } from './SetupCard';
import { connectKeys } from '../keymap/dispatcher';
import { resetDockedCards, useDockedCards } from '../composer/docked/registry';
import { registerMessageReturn } from './message-return';
import { resumeSession, startIntent } from './setup-actions';
import { connectSetup, useSetup } from './store';
import { TrustCard } from './TrustCard';

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

  it("Cancel on a resume's card, sent without a message, releases quietly (main answers null for a record's id)", async () => {
    withMain({ 'session.start': answer({ status: 'needs_trust', appSessionId: ID, trust: trustState() }), 'session.intent.release': () => null });
    render(<Docked />);
    await act(() => resumeSession(ID));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(fake.invoked('session.intent.release')).toEqual([{ appSessionId: ID }]);
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
    expect(screen.getByText(/Waiting for the relay · checked 4 s ago/)).toBeTruthy();
    rerender(<RelayCard health={health()} policy="ask" now={Date.parse('2026-09-29T10:00:04.000Z')} gatewayModel openClaudeUsage={null} onAccept={vi.fn()} onDecline={vi.fn()} onRecheck={vi.fn()} />);
    const direct = screen.getByRole('button', { name: 'Run direct' });
    expect(direct.hasAttribute('disabled')).toBe(true);
    expect(direct.getAttribute('title')).toBe('Pick a Claude model first');
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
    withMain({ 'session.start': answer(starting), 'session.intent.resolveWorktree': () => ({ intent: intent(), worktree: { path, branch: 'worktree-accept-fail', createdHere: false, state: 'kept', detail: null, branchState: 'kept' } }) });
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

  it("a resume that fails after it started returns its message to the editor; C3's relay answer docks the card with it instead", async () => {
    withMain({ 'session.start': answer(starting), 'session.intent.list': () => ({ intents: [] }), 'session.deletions.list': () => ({ manifests: [] }), 'engine.relayHealth': () => health() });
    const connection = connectSetup(fake.client);
    await connection.ready;
    render(<Docked />);
    await act(() => resumeSession(ID, MESSAGE));
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'the engine exited (code 1)', resources: resources({ record: 'kept' }) } }));
    expect(returned).toEqual([MESSAGE]);
    // a resume that became ready sent it: nothing comes back
    await act(() => resumeSession(ID, MESSAGE));
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'ready', detail: null, outcome: { kind: 'ready', engineSessionId: 'e' as never, firstTurn: 'sent' } }));
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'later', resources: resources({ record: 'kept' }) } }));
    expect(returned).toEqual([MESSAGE]);
    // C3's relay answer: the card holds the message, and its Cancel returns it
    await act(() => resumeSession(ID, MESSAGE));
    act(() => fake.event('session.setup', { appSessionId: ID, phase: 'failed', detail: null, outcome: { kind: 'relay_unreachable', health: health() } }));
    expect(returned).toEqual([MESSAGE]);
    expect(useSetup.getState().cards.get(ID)).toMatchObject({ kind: 'relay', message: MESSAGE });
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
