// P3-H H4: the session an owner's gesture on an artifact starts (the connector sheet's Start; Send to's, Decision Log 87):
// the artifact's own session while the window knows it in the artifact's project, else a new session in its durable
// directory (the Space's linked directory, else the project the artifact names), else none, never a guessed root; and
// the gesture itself, which resumes or starts without a message, docks a trust or relay card and never answers it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { record, status } from '../../../../test/support/builders';
import { continueSetup } from '../sessions/setup-actions';
import { useSetup } from '../sessions/store';
import { resetComposerStore, useComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { artifactSessionContext, startArtifactSession, type ArtifactSessionStart } from './session-context';

const OWN = 'own-session' as AppSessionId;
const LINKED = 'linked-session' as AppSessionId;
const P1 = 'p1' as ProjectId;
const P2 = 'p2' as ProjectId;
const SPACE = '55555555-5555-4555-8555-555555555555';

const facts = (over: Partial<Parameters<typeof artifactSessionContext>[1]> = {}): Parameters<typeof artifactSessionContext>[1] => ({
  records: new Map([[OWN, { projectId: P1 }]]),
  spaces: [{ id: SPACE, linkedDir: '/work/research' }],
  projects: new Map([
    [P1, { directory: '/work/app' }],
    [P2, { directory: '/work/research' }],
  ]),
  ...over,
});

describe('the session an owner’s gesture on an artifact starts', () => {
  it('is the creating session while the window knows it in the artifact’s project', () => {
    expect(artifactSessionContext({ createdBy: { kind: 'session', appSessionId: OWN }, projectId: P1, sessions: [] }, facts())).toEqual({ kind: 'session', appSessionId: OWN });
    expect(artifactSessionContext({ createdBy: { kind: 'session', appSessionId: OWN }, sessions: [] }, facts())).toEqual({ kind: 'session', appSessionId: OWN });
  });

  it('is an import’s created link, never a session that only touched it', () => {
    const records = new Map([
      [OWN, { projectId: P1 }],
      [LINKED, { projectId: P1 }],
    ]);
    const touched = [{ appSessionId: LINKED, roles: ['viewed' as const, 'edited' as const] }];
    expect(artifactSessionContext({ createdBy: { kind: 'human' }, sessions: [{ appSessionId: OWN, roles: ['created'] }, ...touched] }, facts({ records }))).toEqual({ kind: 'session', appSessionId: OWN });
    expect(artifactSessionContext({ createdBy: { kind: 'human' }, sessions: touched }, facts({ records }))).toEqual({ kind: 'none' });
  });

  it('falls to the Space’s linked directory, then the named project’s, when the own session is unknown or elsewhere', () => {
    const moved = facts({ records: new Map([[OWN, { projectId: P2 }]]) });
    const own = { createdBy: { kind: 'session' as const, appSessionId: OWN }, projectId: P1, sessions: [] };
    expect(artifactSessionContext({ ...own, spaceId: SPACE }, moved)).toEqual({ kind: 'directory', path: '/work/research', projectId: P2 });
    expect(artifactSessionContext(own, moved)).toEqual({ kind: 'directory', path: '/work/app', projectId: P1 });
    expect(artifactSessionContext({ createdBy: { kind: 'human' }, projectId: P1, sessions: [] }, facts({ records: new Map() }))).toEqual({ kind: 'directory', path: '/work/app', projectId: P1 });
    const elsewhere = facts({ projects: new Map([[P1, { directory: '/work/app' }]]) });
    expect(artifactSessionContext({ createdBy: { kind: 'human' }, spaceId: SPACE, sessions: [] }, elsewhere)).toEqual({ kind: 'directory', path: '/work/research', projectId: null });
  });

  it('is none without a durable context: no creator known, no linked Space, no project', () => {
    expect(artifactSessionContext({ createdBy: { kind: 'human' }, sessions: [] }, facts())).toEqual({ kind: 'none' });
    expect(artifactSessionContext({ createdBy: { kind: 'session', appSessionId: OWN }, sessions: [] }, facts({ records: new Map() }))).toEqual({ kind: 'none' });
    expect(artifactSessionContext({ createdBy: { kind: 'human' }, spaceId: 'unlinked', sessions: [] }, facts({ spaces: [{ id: 'unlinked' }] }))).toEqual({ kind: 'none' });
  });
});

type Invoked = [string, unknown];
// A bridge answering each command from `answers`; `during` runs inside a command before its answer (an event main sent
// first, say). Events reach what `on` subscribed.
function client(answers: Record<string, unknown>, during: Record<string, () => void> = {}) {
  const calls: Invoked[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const bridge = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push([name, input]);
      during[name]?.();
      const value = answers[name];
      return value instanceof Error ? { ok: false, error: { code: 'internal', message: value.message } } : { ok: true, value };
    }),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    }),
  };
  const emit = (name: string, payload: unknown) => listeners.get(name)?.forEach((listener) => listener(payload));
  const listening = (name: string) => listeners.get(name)?.size ?? 0;
  return { bridge: bridge as unknown as MawsBridge, calls, emit, listening };
}
const setupEvent = (appSessionId: AppSessionId, phase: string, outcome: unknown) => ({ appSessionId, phase, detail: null, outcome });
const RESOURCES = { worktree: null, record: 'kept', transcript: 'none' };

const intent = (appSessionId: AppSessionId) => ({
  appSessionId, projectId: P1, createdAt: 't', updatedAt: 't', kind: 'create', source: null, location: { kind: 'directory', path: '/work/app' }, additionalDirectories: [],
  model: null, effort: null, permissionMode: null, gateway: 'gateway', trust: 'unanswered', trustKey: null, message: null, draft: null,
});

describe('the owner’s Start', () => {
  afterEach(() => {
    useSetup.setState({ intents: new Map(), cards: new Map() });
    useSessions.setState({ records: new Map() });
  });

  it('acquires the own session for a read, requiring no message', async () => {
    const { bridge, calls } = client({ 'session.acquire': { status: 'ready', appSessionId: OWN, launched: true, joined: false } });
    await expect(startArtifactSession({ kind: 'session', appSessionId: OWN }, null, bridge)).resolves.toEqual({ status: 'ready', appSessionId: OWN });
    expect(calls).toEqual([['session.acquire', { appSessionId: OWN, reason: 'read', options: { requireEmptyMessage: true } }]]); // Decision Log 88
  });

  it('creates a session in the directory and starts it requiring no message, docking a trust card it never answers', async () => {
    const created = 'created' as AppSessionId;
    const trust = { key: '/work/app', directory: '/work/app', trusted: false };
    const { bridge, calls } = client({ 'session.create': { appSessionId: created, intent: intent(created) }, 'session.start': { status: 'needs_trust', appSessionId: created, trust } });
    const answer = await startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, null, bridge);
    expect(answer).toMatchObject({ status: 'card', appSessionId: created });
    expect(calls).toEqual([
      ['session.create', { projectId: P1, location: { kind: 'directory', path: '/work/app' } }],
      ['session.start', { appSessionId: created, message: null, options: { requireEmptyMessage: true } }], // Decision Log 88
    ]);
    expect(useSetup.getState().cards.get(created)).toMatchObject({ kind: 'trust', message: null });
  });

  it('starts the session an earlier Start created rather than another, and resumes it once it is a record', async () => {
    const earlier = 'earlier' as AppSessionId;
    useSetup.setState({ intents: new Map([[earlier, intent(earlier) as never]]) });
    const first = client({ 'session.start': { status: 'starting', appSessionId: earlier } });
    await expect(startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, earlier, first.bridge)).resolves.toMatchObject({ status: 'starting', appSessionId: earlier });
    expect(first.calls.map(([name]) => name)).toEqual(['session.start']);
    useSetup.setState({ intents: new Map() });
    useSessions.setState({ records: new Map([[earlier, { appId: earlier } as never]]) });
    const again = client({ 'session.acquire': { status: 'ready', appSessionId: earlier, launched: false, joined: false } });
    await expect(startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, earlier, again.bridge)).resolves.toEqual({ status: 'ready', appSessionId: earlier });
    expect(again.calls.map(([name]) => name)).toEqual(['session.acquire']);
  });

  it('answers a refusal in words, and refuses at once without a context', async () => {
    const { bridge } = client({ 'session.acquire': { status: 'missing_directory', appSessionId: OWN, directory: '/gone' } });
    await expect(startArtifactSession({ kind: 'session', appSessionId: OWN }, null, bridge)).resolves.toEqual({ status: 'refused', appSessionId: OWN, words: 'Directory not found: /gone' });
    const none = client({});
    await expect(startArtifactSession({ kind: 'none' }, null, none.bridge)).resolves.toMatchObject({ status: 'refused', appSessionId: null });
    expect(none.calls).toEqual([]);
  });

  it('settles a start on its setup’s end, even one main announced before the start answered', async () => {
    const created = 'created' as AppSessionId;
    const early = client(
      { 'session.create': { appSessionId: created, intent: intent(created) }, 'session.start': { status: 'starting', appSessionId: created } },
      { 'session.start': () => early.emit('session.setup', setupEvent(created, 'failed', { kind: 'error', message: 'the engine would not start', resources: RESOURCES })) },
    );
    const answer = await startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, null, early.bridge);
    expect(answer.status).toBe('starting');
    await expect((answer as Extract<typeof answer, { status: 'starting' }>).settled).resolves.toEqual({ status: 'refused', appSessionId: created, words: 'the engine would not start' });
    expect(early.listening('session.setup')).toBe(0);

    const later = client({ 'session.start': { status: 'starting', appSessionId: created } });
    useSetup.setState({ intents: new Map([[created, intent(created) as never]]) });
    const second = (await startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, created, later.bridge)) as Extract<ArtifactSessionStart, { status: 'starting' }>;
    later.emit('session.setup', setupEvent('another' as AppSessionId, 'failed', null)); // another session's: not this one's end
    later.emit('session.setup', setupEvent(created, 'launching', null));
    later.emit('session.setup', setupEvent(created, 'failed', { kind: 'relay_unreachable', health: { ok: false } }));
    await expect(second.settled).resolves.toEqual({ status: 'card', appSessionId: created, words: 'The relay is unreachable · the session offers Run direct' });

    const ready = client({ 'session.start': { status: 'starting', appSessionId: created } });
    const third = (await startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, created, ready.bridge)) as Extract<ArtifactSessionStart, { status: 'starting' }>;
    ready.emit('session.setup', setupEvent(created, 'ready', { kind: 'ready', engineSessionId: 's', firstTurn: 'none' }));
    await expect(third.settled).resolves.toEqual({ status: 'ready', appSessionId: created });
    third.cancel();
    expect(ready.listening('session.setup')).toBe(0);
  });

  // P3-F F4 (c26): the owner's answer to a trust card, given on another surface, travels as the composer's card sends it
  // (StartOptions.trust) with the start or the resume; nothing here answers it by itself.
  it('answers a trust card with the folder it asks about, and carries the owner’s decision with the start or the resume', async () => {
    const created = 'created' as AppSessionId;
    const trust = { directory: '/work/app', trustKey: '/work/app', keyKind: 'directory', configPath: '/config/.claude.json', trusted: false, source: null, isHome: false, found: [] };
    const asked = client({ 'session.create': { appSessionId: created, intent: intent(created) }, 'session.start': { status: 'needs_trust', appSessionId: created, trust } });
    await expect(startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, null, asked.bridge)).resolves.toEqual({ status: 'card', appSessionId: created, words: 'Trust this folder in the session to continue', trust });

    // the decision with the start of the session the first one made; the trust card this surface docked goes as it is answered
    const decided = client({ 'session.start': { status: 'starting', appSessionId: created } });
    await expect(startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, created, decided.bridge, 'accepted')).resolves.toMatchObject({ status: 'starting', appSessionId: created });
    expect(decided.calls).toEqual([['session.start', { appSessionId: created, message: null, options: { requireEmptyMessage: true, trust: 'accepted' } }]]);
    expect(useSetup.getState().cards.has(created)).toBe(false);

    // with the resume of a record, its card asked again
    useSessions.setState({ records: new Map([[OWN, { appId: OWN } as never]]) });
    const resumed = client({ 'session.acquire': { status: 'ready', appSessionId: OWN, launched: true, joined: false } });
    useSetup.getState().dock(OWN, { kind: 'trust', trust: trust as never, message: null });
    await expect(startArtifactSession({ kind: 'session', appSessionId: OWN }, null, resumed.bridge, 'declined')).resolves.toEqual({ status: 'ready', appSessionId: OWN });
    expect(resumed.calls).toEqual([['session.acquire', { appSessionId: OWN, reason: 'read', options: { requireEmptyMessage: true, trust: 'declined' } }]]);
    expect(useSetup.getState().cards.has(OWN)).toBe(false);

    // review B 2: an intent's card the composer docked with its own message is the composer's: it stays, main refusing the
    // no-turn start while the intent's message waits
    const message = { content: 'Draft the summary.', display: 'Draft the summary.' };
    useSetup.getState().dock(created, { kind: 'trust', trust: trust as never, message });
    const busy = client({ 'session.start': { status: 'refused', appSessionId: created, reason: 'busy', message: 'A prompt is waiting in this session' } });
    await startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, created, busy.bridge, 'accepted');
    expect(useSetup.getState().cards.get(created)).toMatchObject({ kind: 'trust', message });

    // a record's: its message never left the composer's draft (main keeps nothing for an acquisition), so the start goes
    // ahead, and once the session is ready with the answer the card asking the same question goes
    useSetup.getState().dock(OWN, { kind: 'trust', trust: trust as never, message });
    const ready = client({ 'session.acquire': { status: 'ready', appSessionId: OWN, launched: true, joined: false } });
    await expect(startArtifactSession({ kind: 'session', appSessionId: OWN }, null, ready.bridge, 'accepted')).resolves.toEqual({ status: 'ready', appSessionId: OWN });
    expect(ready.calls).toEqual([['session.acquire', { appSessionId: OWN, reason: 'read', options: { requireEmptyMessage: true, trust: 'accepted' } }]]);
    expect(useSetup.getState().cards.has(OWN), 'the answered question’s card goes; its text is still the composer’s draft').toBe(false);
  });

  // P4 W1-B (tracker L309): the owner pressed Trust and start on the composer's card, and a comment's resume carrying the
  // same answer readies while that continuation runs: the card stays for the continuation, which sends the composer's
  // message once and clears the composer, then lets the card go
  it('leaves a record’s trust card to the continuation running for it, so the composer’s message is sent once', async () => {
    const trust = { directory: '/work/app', trustKey: '/work/app', keyKind: 'directory', configPath: '/config/.claude.json', trusted: false, source: null, isHome: false, found: [] };
    const message = { content: 'Draft the summary.', display: 'Draft the summary.' };
    const ready = { status: 'ready', appSessionId: OWN, launched: true, joined: false };
    const composer = fakeClient({ 'session.queue.list': { entries: [], paused: false }, 'session.send': { messageUuid: '22222222-2222-4222-8222-222222222222', disposition: 'sent', queueId: 'q1' }, 'session.history.append': undefined });
    window.maws = composer.client;
    try {
      resetComposerStore();
      useSessions.setState({ records: new Map([[OWN, record(OWN)]]), engine: new Map(), digests: new Map() });
      useSetup.getState().dock(OWN, { kind: 'trust', trust: trust as never, message });

      const continuing = continueSetup(OWN, { trust: 'accepted' }, message); // the composer card's Trust and start
      await vi.waitFor(() => expect(composer.pending('session.acquire')).toBe(1));
      const comment = client({ 'session.acquire': ready });
      await expect(startArtifactSession({ kind: 'session', appSessionId: OWN }, null, comment.bridge, 'accepted')).resolves.toEqual({ status: 'ready', appSessionId: OWN });
      expect(useSetup.getState().cards.get(OWN), 'the continuation’s card').toMatchObject({ kind: 'trust', message });

      useSessions.getState().applyStatus({ appSessionId: OWN, status: status(OWN) });
      await composer.reply('session.acquire', ready);
      await expect(continuing).resolves.toEqual({ ok: true });
      expect(composer.invoked('session.send')).toEqual([{ appSessionId: OWN, content: message.content }]);
      expect(useComposerStore.getState().prefills.get(OWN)).toEqual({ text: '' });
      expect(useSetup.getState().cards.has(OWN)).toBe(false);
    } finally {
      delete (window as { maws?: unknown }).maws;
    }
  });

  it('answers main’s refusal of a session holding a prompt with its words and the session to open', async () => {
    const earlier = 'earlier' as AppSessionId;
    useSetup.setState({ intents: new Map([[earlier, intent(earlier) as never]]) });
    const words = 'A prompt is waiting in this session · open it to send or discard the prompt first';
    const { bridge, listening } = client({ 'session.start': { status: 'refused', appSessionId: earlier, reason: 'busy', message: words } });
    await expect(startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, earlier, bridge)).resolves.toEqual({ status: 'refused', appSessionId: earlier, words });
    expect(listening('session.setup')).toBe(0);
  });
});
