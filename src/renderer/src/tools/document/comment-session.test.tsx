// P3-F1 fix 2 (docs/doperpowers/ledgers/2026-10-17-P3-F1.md; the P3 co-work spec's Decision Log 96, H's policy of 87): a
// document or deck on a tab with no chat beside it takes its comment card's session from the artifact itself. Beside a
// chat the shown session stays the target; alone, the artifact's own session opens the card at once, a directory
// context starts a session on the owner's Comment (never on mount) and opens the card on it with Send to main chosen,
// and with no context the card says why. The notice in the card's place is withdrawn with its draft by Close, Escape,
// a later card, or the editor going, and a start that settles after that opens nothing.
// Runs in `renderer` and, compiled, in `renderer-compiled` (vitest.config.ts): every render reads stores through hooks.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentOverlayProps } from '@artifacts/document/editor/comments/surface';
import { addThread } from '@artifacts/document/threads';
import { newDoc } from '@artifacts/yjs';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { LibraryRow } from '@shared/ipc/schema/library';
import { project, record } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { NO_SESSION_CONTEXT, type ArtifactSessionContext } from '../../artifacts/session-context';
import { resetLibrary } from '../../library/store';
import { useCommentCard } from '../../side/card/store';
import { CommentComposerHost, useCommentComposer } from '../../side/CommentComposer';
import { openComment } from '../../side/register';
import { useSetup } from '../../sessions/store';
import { useLayout } from '../../stores/layout';
import { useSessions } from '../../stores/sessions';
import { shownSession } from '../../panel/host';
import { resetShellStores } from '../../test-support/shell-stores';
import { registerCommentComposer, openCommentComposer } from '../code/anchor/anchor';
import { startCommentSession, useArtifactCommentTarget, usePendingComment } from './comment-session'; // P3-F F4 review B 3: startCommentSession, usePendingComment
import { useDocumentComments } from './comments';

const SHOWN = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const OWN = 'a2222222-2222-4222-8222-222222222222' as AppSessionId;
const STARTED = 'a3333333-3333-4333-8333-333333333333' as AppSessionId;
const P1 = 'p1' as ProjectId;
const SPACE = '55555555-5555-4555-8555-555555555555';
const ARTIFACT = '66666666-6666-4666-8666-666666666666';
const DIRECTORY: ArtifactSessionContext = { kind: 'directory', path: '/work/p1', projectId: P1 };
const HOST_BOX = { width: 800, height: 900 };
const PASSAGE = { x: 120, y: 200, width: 140, height: 20 };
const passage = { threadId: 'k2m9x0qa', tabId: 'tab1', tabTitle: 'Main', quote: 'ships quarterly' };

let fake: FakeClient;
let offComposer: () => void;
const clientSize = { width: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')!, height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')! };
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => HOST_BOX.width });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => HOST_BOX.height });
});
afterAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientSize.width);
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientSize.height);
});
beforeEach(() => {
  resetShellStores();
  resetLibrary();
  useSetup.setState({ intents: new Map(), cards: new Map() });
  fake = fakeClient({ 'session.intent.get': null });
  window.maws = fake.client;
  offComposer = registerCommentComposer(openComment);
  const s = useSessions.getState();
  useSessions.setState({
    records: new Map([[OWN, record(OWN, { projectId: P1, title: { text: 'Own plan', source: 'user' } })]]),
    projects: new Map([[P1, project('p1', 0)]]),
    recordsVersion: s.recordsVersion + 1,
    projectsVersion: s.projectsVersion + 1,
  });
});
afterEach(() => {
  cleanup();
  offComposer();
  useCommentCard.setState({ open: null });
  delete (window as { maws?: unknown }).maws;
});

const intent = (appSessionId: AppSessionId) => ({
  appSessionId, projectId: P1, createdAt: 't', updatedAt: 't', kind: 'create', source: null, location: { kind: 'directory', path: '/work/p1' }, additionalDirectories: [],
  model: null, effort: null, permissionMode: null, gateway: 'gateway', trust: 'unanswered', trustKey: null, message: null, draft: null,
  progress: { engineSessionId: null, worktree: null, trustRecorded: false, bootstrap: null, launch: null, send: null, lastFailure: null },
});
const ready = (appSessionId: AppSessionId) => ({ appSessionId, phase: 'ready', detail: null, outcome: { kind: 'ready', engineSessionId: 's', firstTurn: 'none' } });
// P3-F F4: an untrusted folder's trust state as main answers a start that needs it (TrustStateSchema)
const TRUST = { directory: '/work/p1', trustKey: '/work/p1', keyKind: 'directory', configPath: '/config/.claude.json', trusted: false, source: null, isHome: false, found: [] } as const;
const needsTrust = (appSessionId: AppSessionId) => ({ status: 'needs_trust', appSessionId, trust: TRUST });
const sessionCalls = () => fake.calls.filter((call) => /^invoke session\.(create|start|acquire)$/.test(call));

// ---- the target ----------------------------------------------------------------------------------------------------

function Target({ artifactId = ARTIFACT }: { artifactId?: string }) {
  const target = useArtifactCommentTarget(artifactId);
  return <output data-testid="target">{JSON.stringify(target)}</output>;
}
const target = () => JSON.parse(screen.getByTestId('target').textContent!) as unknown;
// A library row as main answers it (the IPC client validates every answer).
const row = (over: Partial<LibraryRow>): LibraryRow => ({
  id: ARTIFACT, kind: 'document', title: 'Plan', createdBy: { kind: 'human' }, createdAt: 1, updatedAt: 1, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false,
  revision: 3, lastEditor: { kind: 'human' }, lastEditedAt: 1, sessions: [], ...over,
});

describe('the comment target of a document on a tab', () => {
  it('is the session the main area shows, the artifact’s own context unread', async () => {
    useLayout.getState().openSession(SHOWN);
    expect(shownSession(useLayout.getState().main)).toBe(SHOWN);
    render(<Target />);
    await act(async () => {});
    expect(target()).toEqual({ appSessionId: SHOWN });
    expect(fake.invoked('library.get')).toEqual([]);
  });

  it('with no chat shown: nothing while the artifact’s row loads, then the artifact’s own session', async () => {
    render(<Target />);
    await act(async () => {});
    expect(target()).toBeNull();
    await act(() => fake.reply('library.get', { row: row({ createdBy: { kind: 'session', appSessionId: OWN }, projectId: P1 }) }));
    expect(target()).toEqual({ context: { kind: 'session', appSessionId: OWN } });
  });

  it('waits for the Spaces of an artifact in a Space, then names its linked directory', async () => {
    render(<Target />);
    await act(async () => {});
    await act(() => fake.reply('library.get', { row: row({ spaceId: SPACE }) }));
    expect(target(), 'the Space’s link not read yet').toBeNull();
    await act(() => fake.reply('library.spaces', { spaces: [{ id: SPACE, name: 'Research', linkedDir: '/work/p1', createdAt: 1, count: 1 }] }));
    expect(target()).toEqual({ context: { kind: 'directory', path: '/work/p1', projectId: P1 } });
  });

  it('is none for an artifact with no durable context, or not in the library', async () => {
    render(<Target />);
    await act(async () => {});
    await act(() => fake.reply('library.get', { row: row({}) }));
    expect(target()).toEqual({ context: { kind: 'none' } });
    cleanup();
    resetLibrary();
    render(<Target artifactId="77777777-7777-4777-8777-777777777777" />);
    await act(async () => {});
    await act(() => fake.reply('library.get', { row: null }));
    expect(target()).toEqual({ context: { kind: 'none' } });
  });
});

// ---- the card from a standalone tab --------------------------------------------------------------------------------

function editorReach(): CommentOverlayProps {
  const doc = newDoc();
  addThread(doc, { threadId: passage.threadId, tabId: 'tab1', blockId: 'p1', quote: passage.quote, anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
  return {
    doc,
    locate: vi.fn((threadId: string) => (threadId === passage.threadId ? PASSAGE : null)),
    layoutKey: 'k1',
    setActive: vi.fn(),
    resolve: vi.fn(),
    reopen: vi.fn(),
    record: vi.fn(),
    discard: vi.fn(),
    focus: vi.fn(),
  };
}

function Editor({ artifactId, reach, onOpen, given }: { artifactId: string; reach: CommentOverlayProps; onOpen(open: (p: typeof passage) => void): void; given: { appSessionId: AppSessionId } | { context: ArtifactSessionContext } }) {
  const comments = useDocumentComments({ artifactId, ...given, title: 'Q3 plan', mode: 'tab' });
  onOpen(comments.opened);
  return <div className="relative">{comments.overlay(reach)}</div>;
}

type Given = { appSessionId: AppSessionId } | { context: ArtifactSessionContext };
function mount(given: Given) {
  const reach = editorReach();
  let open: ((p: typeof passage) => void) | null = null;
  const onOpen = (o: (p: typeof passage) => void) => (open = o);
  const artifactId = crypto.randomUUID(); // each case's own, so no start of an earlier case's is this one's
  const view = render(<Editor artifactId={artifactId} reach={reach} given={given} onOpen={onOpen} />);
  return {
    reach,
    view,
    comment: (p: typeof passage = passage) => act(() => open!(p)),
    // the artifact's context moved (its Space linked elsewhere, another project): the same editor, a new context
    move: (next: Given) => view.rerender(<Editor artifactId={artifactId} reach={reach} given={next} onOpen={onOpen} />),
  };
}
const OTHER: ArtifactSessionContext = { kind: 'directory', path: '/work/p2', projectId: null };
const LATER = 'a4444444-4444-4444-8444-444444444444' as AppSessionId;
const second = { threadId: 'p7q1w3ze', tabId: 'tab1', tabTitle: 'Main', quote: 'with design review' };
const card = () => document.querySelector<HTMLElement>('[data-comment-card]');
const notice = () => document.querySelector<HTMLElement>('[data-comment-context]');
const destination = () => (screen.getAllByRole('radio') as HTMLInputElement[]).find((radio) => radio.checked)?.value;

describe('a comment from a document with no chat beside it', () => {
  it('beside a chat: the card goes to the shown session and does not name it', async () => {
    const { comment } = mount({ appSessionId: SHOWN });
    comment();
    await act(async () => {});
    expect(useCommentCard.getState().open).toMatchObject({ parent: SHOWN, hostId: expect.any(String) });
    expect(document.querySelector('[data-card-parent]')).toBeNull();
    expect(destination()).toBe('thread');
  });

  it('the artifact’s own session: the card opens on it at once, naming it, Side thread chosen, nothing started', async () => {
    const { comment } = mount({ context: { kind: 'session', appSessionId: OWN } });
    comment();
    await act(async () => {});
    expect(useCommentCard.getState().open).toMatchObject({ parent: OWN });
    const named = document.querySelector<HTMLElement>('[data-card-parent]')!;
    expect(named.dataset.cardParent).toBe(OWN);
    expect(named.textContent).toBe('Session: Own plan');
    expect(destination()).toBe('thread');
    expect(sessionCalls()).toEqual([]);
  });

  it('no context: the card says why, starts nothing, and Close withdraws the comment’s draft', async () => {
    const { reach, comment } = mount({ context: { kind: 'none' } });
    comment();
    await act(async () => {});
    expect(card()).toBeNull();
    expect(notice()!.dataset.commentContext).toBe('none');
    expect(notice()!.style).toMatchObject({ left: `${PASSAGE.x}px`, top: `${PASSAGE.y + PASSAGE.height + 4}px` }); // where the card would be
    expect(screen.getByRole('dialog', { name: 'Comment on Q3 plan, Main' }).textContent).toContain(NO_SESSION_CONTEXT);
    expect(reach.setActive).toHaveBeenLastCalledWith(passage.threadId);
    expect(reach.discard).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(notice()).toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    expect(reach.setActive).toHaveBeenLastCalledWith(null);
    expect(reach.focus).toHaveBeenCalled();
    expect(sessionCalls()).toEqual([]);
  });

  // P4-B1 (D7): in the margin the notice is in flow in the hosting thread's entry, above the card host, not pinned over
  // the page; the margin is told the thread it is on
  it('no context, in the margin: the notice is in flow at the entry’s width and the margin hosts its thread', async () => {
    const reach = { ...editorReach(), placement: 'margin' as const, hosting: vi.fn() };
    let open: ((p: typeof passage) => void) | null = null;
    render(<Editor artifactId={crypto.randomUUID()} reach={reach} given={{ context: { kind: 'none' } }} onOpen={(o) => (open = o)} />);
    act(() => open!(passage));
    await act(async () => {});
    expect(reach.hosting).toHaveBeenLastCalledWith(passage.threadId);
    const flow = notice()!.parentElement!;
    expect(flow.hasAttribute('data-notice-flow')).toBe(true);
    expect(flow.className).not.toContain('absolute');
    expect(notice()!.className).toContain('relative');
    expect(notice()!.style.left).toBe('');
    expect(notice()!.style.top).toBe('');
    expect(flow.nextElementSibling?.hasAttribute('data-card-margin')).toBe(true); // the card host below it
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(reach.hosting).toHaveBeenLastCalledWith(null);
  });

  it('no context: Escape inside the card withdraws it too', async () => {
    const { reach, comment } = mount({ context: { kind: 'none' } });
    comment();
    await act(async () => {});
    expect(notice()).toBe(document.activeElement);
    fireEvent.keyDown(notice()!, { key: 'Escape' });
    expect(notice()).toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
  });

  // The history-anchors review (scalpel-5#1): a second Comment on the same editor replaces the notice in its place; the
  // new one takes the keyboard as the first did, so its Escape is heard.
  it('no context: a second Comment on the same editor gives its notice the keyboard, and Escape withdraws it', async () => {
    const { reach, comment } = mount({ context: { kind: 'none' } });
    comment();
    await act(async () => {});
    expect(notice()).toBe(document.activeElement);
    act(() => notice()!.blur()); // the second Comment is a click on the page's own control
    comment(second);
    await act(async () => {});
    expect(reach.setActive).toHaveBeenLastCalledWith(second.threadId);
    expect(notice(), 'the replacing notice has the keyboard').toBe(document.activeElement);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(notice()).toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(second.threadId);
  });

  it('a directory: nothing on mount; Comment starts a session there, then opens the card on it with Send to main chosen', async () => {
    const { reach, comment } = mount({ context: DIRECTORY });
    await act(async () => {});
    expect(sessionCalls(), 'never a start on mount').toEqual([]);
    comment();
    await act(async () => {});
    expect(notice()!.dataset.commentContext).toBe('starting');
    expect(fake.invoked('session.create')).toEqual([{ projectId: P1, location: { kind: 'directory', path: '/work/p1' } }]);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    expect(fake.invoked('session.start')).toEqual([{ appSessionId: STARTED, message: null, options: { requireEmptyMessage: true } }]);
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    expect(card()).toBeNull();
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(notice()).toBeNull();
    expect(useCommentCard.getState().open).toMatchObject({ parent: STARTED });
    expect(document.querySelector<HTMLElement>('[data-card-parent]')!.dataset.cardParent).toBe(STARTED);
    expect(destination(), 'a blank session has no conversation a side thread could fork').toBe('main');
    expect(reach.discard).not.toHaveBeenCalled();
  });

  it('a directory: a later comment goes to the session the first one started, never another', async () => {
    const { comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    const s = useSessions.getState();
    useSessions.setState({ records: new Map([...s.records, [STARTED, record(STARTED, { projectId: P1 })]]), recordsVersion: s.recordsVersion + 1 }); // the record it became
    comment();
    await act(async () => {});
    expect(fake.invoked('session.create')).toHaveLength(1);
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: STARTED, reason: 'read', options: { requireEmptyMessage: true } }]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: STARTED, launched: false, joined: false }));
    expect(useCommentCard.getState().open).toMatchObject({ parent: STARTED });
  });

  it('a directory whose start is refused: the card says so in its words and offers the session it made', async () => {
    const { reach, comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.fail('session.start', 'the directory is gone'));
    expect(notice()!.dataset.commentContext).toBe('refused');
    expect(notice()!.textContent).toContain('the directory is gone');
    expect(card()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open session' }));
    expect(shownSession(useLayout.getState().main)).toBe(STARTED);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
  });

  // P3-F F4 (c26, the owner's E1 mark): a start that meets the trust card asks the owner's decision in the card's place,
  // the comment's draft kept; the decision travels as the composer's card sends it (StartOptions.trust), never decided
  // here, and the card then opens on the same passage.
  it('a directory whose start needs trust: the notice offers Trust and start and Start without trusting, the draft kept, and nothing is decided for the owner', async () => {
    const { reach, comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', needsTrust(STARTED)));
    expect(notice()!.dataset.commentContext).toBe('trust');
    expect(notice()!.textContent).toContain(TRUST.directory);
    expect(screen.getByRole('button', { name: 'Trust and start' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start without trusting' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open session' }), 'the choices are here, not in another session').toBeNull();
    expect(card()).toBeNull();
    expect(reach.discard, 'the comment’s draft is kept').not.toHaveBeenCalled();
    expect(reach.setActive).toHaveBeenLastCalledWith(passage.threadId);
    expect(fake.invoked('session.start'), 'no decision sent without the owner’s click').toEqual([{ appSessionId: STARTED, message: null, options: { requireEmptyMessage: true } }]);
  });

  // P3-F F4 fix wave (review B 1): the consent says what the answer records, as the composer's card says it: a folder in a
  // repository is trusted as the repository (main's trustKeyOf), and trust turns on what the folder holds
  it('a folder inside a repository: the notice names the repository trust is recorded for, the config file, and what trust would turn on', async () => {
    const { comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    const nested = { ...TRUST, directory: '/work/p1/docs', trustKey: '/work/p1', keyKind: 'repo', found: [{ file: '.claude/settings.json', summary: '2 hooks' }, { file: '.mcp.json', summary: '1 MCP server' }] };
    await act(() => fake.reply('session.start', { status: 'needs_trust', appSessionId: STARTED, trust: nested }));
    const words = notice()!.textContent!;
    expect(words).toContain('/work/p1/docs');
    expect(words).toContain('Trust is recorded for the repository at /work/p1');
    expect(words).toContain(TRUST.configPath);
    for (const text of ['.claude/settings.json', '2 hooks', '.mcp.json', '1 MCP server']) expect(words).toContain(text);
    expect(screen.getByRole('button', { name: 'Trust and start' })).toBeTruthy();
  });

  for (const [choice, trust] of [['Trust and start', 'accepted'], ['Start without trusting', 'declined']] as const) {
    it(`${choice}: the session it made starts again with the trust ${trust}, and on ready the card opens on the same passage with its draft`, async () => {
      const { reach, comment } = mount({ context: DIRECTORY });
      comment();
      await act(async () => {});
      await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
      await act(() => fake.reply('session.start', needsTrust(STARTED)));
      expect(useSetup.getState().cards.get(STARTED)).toMatchObject({ kind: 'trust', message: null });
      await userEvent.click(screen.getByRole('button', { name: choice }));
      expect(notice()!.dataset.commentContext).toBe('starting');
      expect(useSetup.getState().cards.has(STARTED), 'the composer’s card for the same question goes as it is answered').toBe(false);
      expect(fake.invoked('session.create'), 'the same session, never another').toHaveLength(1);
      expect(fake.invoked('session.start')).toEqual([
        { appSessionId: STARTED, message: null, options: { requireEmptyMessage: true } },
        { appSessionId: STARTED, message: null, options: { requireEmptyMessage: true, trust } },
      ]);
      await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
      await act(async () => fake.event('session.setup', ready(STARTED)));
      expect(notice()).toBeNull();
      expect(useCommentCard.getState().open).toMatchObject({ parent: STARTED, target: { threadId: passage.threadId } });
      expect(destination()).toBe('main');
      expect(reach.discard).not.toHaveBeenCalled();
    });
  }

  it('a later comment’s resume that needs trust: the choice goes with the acquisition, and the card opens on ready', async () => {
    const { reach, comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    const s = useSessions.getState();
    useSessions.setState({ records: new Map([...s.records, [STARTED, record(STARTED, { projectId: P1 })]]), recordsVersion: s.recordsVersion + 1 });
    comment(second);
    await act(async () => {});
    await act(() => fake.reply('session.acquire', needsTrust(STARTED)));
    expect(notice()!.dataset.commentContext).toBe('trust');
    await userEvent.click(screen.getByRole('button', { name: 'Trust and start' }));
    expect(fake.invoked('session.acquire')).toEqual([
      { appSessionId: STARTED, reason: 'read', options: { requireEmptyMessage: true } },
      { appSessionId: STARTED, reason: 'read', options: { requireEmptyMessage: true, trust: 'accepted' } },
    ]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: STARTED, launched: true, joined: false }));
    expect(useCommentCard.getState().open).toMatchObject({ parent: STARTED, target: { threadId: second.threadId } });
    expect(useSetup.getState().cards.has(STARTED)).toBe(false);
    expect(reach.discard).not.toHaveBeenCalledWith(second.threadId);
  });

  // review B 3: the answer a notice holds, given after a later Comment replaced that notice (a press React would no longer
  // deliver, so the notice's own `decide` is called), starts nothing and says nothing over the later notice
  it('an answer from a notice a later Comment replaced starts nothing', async () => {
    let latest: ReturnType<typeof usePendingComment> = null;
    function Probe({ seen }: { seen(pending: ReturnType<typeof usePendingComment>): void }) {
      seen(usePendingComment('stale-host'));
      return null;
    }
    render(<Probe seen={(pending) => (latest = pending)} />);
    const artifactId = crypto.randomUUID();
    const open = vi.fn();
    act(() => startCommentSession({ hostId: 'stale-host', artifactId, threadId: passage.threadId, label: 'Q3 plan, Main', context: DIRECTORY, open }));
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', needsTrust(STARTED)));
    const asked = latest!.notice;
    if (asked.status !== 'trust') throw new Error(`the notice asks no trust: ${asked.status}`);
    act(() => startCommentSession({ hostId: 'stale-host', artifactId, threadId: second.threadId, label: 'Q3 plan, Main', context: { kind: 'none' }, open }));
    expect(latest!.threadId).toBe(second.threadId);
    act(() => asked.decide('accepted'));
    await act(async () => {});
    expect(fake.invoked('session.start'), 'the replaced notice’s answer starts nothing').toHaveLength(1);
    expect(latest!.notice.status, 'the later notice stands').toBe('none');
    expect(open).not.toHaveBeenCalled();
  });

  it('another card a start meets (the relay’s) still says so with Open session, offering no trust choice', async () => {
    const { comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'relay_unreachable', appSessionId: STARTED, health: { url: 'http://127.0.0.1:1', ok: false, status: null, latencyMs: null, checkedAt: 't', error: 'refused' } }));
    expect(notice()!.dataset.commentContext).toBe('card');
    expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Trust and start' })).toBeNull();
  });

  it('a start settling after Close opens nothing', async () => {
    const { reach, comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open).toBeNull();
    expect(notice()).toBeNull();
  });

  it('a later card anywhere in the window replaces the notice: its draft goes, and the start that settles opens nothing', async () => {
    const { reach, comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    act(() => openCommentComposer({ kind: 'file-line', locator: '/x.ts#L1', label: 'x.ts:1', path: '/x.ts', line: 1 }, { appSessionId: OWN, placement: { kind: 'card', host: 'browser', hostId: 'elsewhere' } }));
    expect(notice()).toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open).toMatchObject({ parent: OWN, hostId: 'elsewhere' });
  });

  it('a context that moved starts in its new directory, never resuming the session the old one started', async () => {
    const { comment, move } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    const s = useSessions.getState();
    useSessions.setState({ records: new Map([...s.records, [STARTED, record(STARTED, { projectId: P1 })]]), recordsVersion: s.recordsVersion + 1 });
    move({ context: OTHER });
    comment();
    await act(async () => {});
    expect(fake.invoked('session.acquire'), 'the old directory’s session is not this one’s').toEqual([]);
    expect(fake.invoked('session.create')).toEqual([
      { projectId: P1, location: { kind: 'directory', path: '/work/p1' } },
      { projectId: null, location: { kind: 'directory', path: '/work/p2' } },
    ]);
    await act(() => fake.reply('session.create', { appSessionId: LATER, intent: intent(LATER) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: LATER }));
    await act(async () => fake.event('session.setup', ready(LATER)));
    expect(useCommentCard.getState().open).toMatchObject({ parent: LATER });
  });

  it('a Comment replacing one whose start has not answered joins that start: one session, the card for the latest only', async () => {
    const { reach, comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    comment(second);
    await act(async () => {});
    expect(reach.discard, 'the replaced comment’s draft withdrawn').toHaveBeenCalledWith(passage.threadId);
    expect(fake.invoked('session.create'), 'one creation for both').toHaveLength(1);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    expect(fake.invoked('session.start')).toHaveLength(1);
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open).toMatchObject({ parent: STARTED, target: { threadId: second.threadId } });
    expect(reach.discard).not.toHaveBeenCalledWith(second.threadId);
    expect(fake.invoked('session.create')).toHaveLength(1);
  });

  it('an old context’s start answering after the new one’s opens nothing and is no session of the new context', async () => {
    const { comment, move } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    move({ context: OTHER });
    comment(second);
    await act(async () => {});
    await act(() => fake.reply('session.create', { appSessionId: LATER, intent: intent(LATER) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: LATER }));
    await act(async () => fake.event('session.setup', ready(LATER)));
    expect(useCommentCard.getState().open).toMatchObject({ parent: LATER, target: { threadId: second.threadId } });
    await act(async () => fake.event('session.setup', ready(STARTED))); // the old directory's, late
    expect(useCommentCard.getState().open).toMatchObject({ parent: LATER, target: { threadId: second.threadId } });
    // the new context's next comment resumes its own session, never the old one's
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    const s = useSessions.getState();
    useSessions.setState({ records: new Map([...s.records, [STARTED, record(STARTED)], [LATER, record(LATER)]]), recordsVersion: s.recordsVersion + 1 });
    comment();
    await act(async () => {});
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: LATER, reason: 'read', options: { requireEmptyMessage: true } }]);
  });

  // The panel's follow-up: a pending comment belongs to the target it was made for. The target moving on, with no other
  // Comment, withdraws it and its draft; the start it waited on still runs to its end for its own directory.
  it('a context that moves while its start runs withdraws the comment at once; the start then opens nothing, its session kept for its directory', async () => {
    const { reach, comment, move } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    expect(notice()!.dataset.commentContext).toBe('starting');
    move({ context: OTHER });
    expect(notice(), 'withdrawn without another Comment').toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    expect(reach.setActive).toHaveBeenLastCalledWith(null);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open, 'no card on the old directory’s session').toBeNull();
    expect(notice()).toBeNull();
    const s = useSessions.getState();
    useSessions.setState({ records: new Map([...s.records, [STARTED, record(STARTED, { projectId: P1 })]]), recordsVersion: s.recordsVersion + 1 });
    move({ context: DIRECTORY });
    comment();
    await act(async () => {});
    expect(fake.invoked('session.create'), 'back in its directory, the session it made is the one reused').toHaveLength(1);
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: STARTED, reason: 'read', options: { requireEmptyMessage: true } }]);
  });

  it('a context that moves away and back while its start runs: the old comment stays withdrawn, a new Comment joins the same start', async () => {
    const { reach, comment, move } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    move({ context: OTHER });
    move({ context: DIRECTORY });
    expect(notice()).toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    comment(second);
    await act(async () => {});
    expect(fake.invoked('session.create'), 'one start for the directory').toHaveLength(1);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open).toMatchObject({ parent: STARTED, target: { threadId: second.threadId } });
  });

  it('a chat shown beside it while a comment waits withdraws the comment, which never opens on the artifact’s context', async () => {
    const { reach, comment, move } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    move({ appSessionId: SHOWN });
    expect(notice()).toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open).toBeNull();
  });

  it('no context, then one: the notice saying why is withdrawn as the target moves', async () => {
    const { reach, comment, move } = mount({ context: { kind: 'none' } });
    comment();
    await act(async () => {});
    expect(notice()!.dataset.commentContext).toBe('none');
    move({ context: { kind: 'session', appSessionId: OWN } });
    expect(notice()).toBeNull();
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    expect(useCommentCard.getState().open).toBeNull();
  });

  it('the same target given anew (an equal context object) keeps the waiting comment, which opens on its start', async () => {
    const { reach, comment, move } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    move({ context: { projectId: P1, path: '/work/p1', kind: 'directory' } });
    expect(notice()!.dataset.commentContext).toBe('starting');
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open).toMatchObject({ parent: STARTED, target: { threadId: passage.threadId } });
    expect(reach.discard).not.toHaveBeenCalled();
  });

  it('the editor going withdraws a pending comment, and its start then opens nothing', async () => {
    const { reach, view, comment } = mount({ context: DIRECTORY });
    comment();
    await act(async () => {});
    view.unmount();
    await act(async () => {});
    expect(reach.discard).toHaveBeenCalledWith(passage.threadId);
    await act(() => fake.reply('session.create', { appSessionId: STARTED, intent: intent(STARTED) }));
    await act(() => fake.reply('session.start', { status: 'starting', appSessionId: STARTED }));
    await act(async () => fake.event('session.setup', ready(STARTED)));
    expect(useCommentCard.getState().open).toBeNull();
  });
});

// The seam's `destination` (CommentContext's, P3-F1) is the form's first choice in either presentation; absent, Side thread.
describe('the composer seam’s destination', () => {
  afterEach(() => useCommentComposer.setState({ open: null }));
  const anchor = { kind: 'file-line', locator: '/x.ts#L1', label: 'x.ts:1', path: '/x.ts', line: 1 } as const;

  it('starts the sheet on it, and on Side thread without it', async () => {
    render(<CommentComposerHost />);
    act(() => openCommentComposer(anchor, { appSessionId: OWN, destination: 'main' }));
    await act(async () => {});
    expect(destination()).toBe('main');
    act(() => openCommentComposer(anchor, { appSessionId: OWN }));
    await act(async () => {});
    expect(destination()).toBe('thread');
  });
});
