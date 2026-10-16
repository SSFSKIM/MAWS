// P3-H H4: the session an owner's gesture on an artifact starts (the connector sheet's Start; Send to's, Decision Log 87):
// the artifact's own session while the window knows it in the artifact's project, else a new session in its durable
// directory (the Space's linked directory, else the project the artifact names), else none, never a guessed root; and
// the gesture itself, which resumes or starts without a message, docks a trust or relay card and never answers it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { useSetup } from '../sessions/store';
import { useSessions } from '../stores/sessions';
import { artifactSessionContext, startArtifactSession } from './session-context';

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
function client(answers: Record<string, unknown>) {
  const calls: Invoked[] = [];
  const bridge = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push([name, input]);
      const value = answers[name];
      return value instanceof Error ? { ok: false, error: { code: 'internal', message: value.message } } : { ok: true, value };
    }),
    on: vi.fn(() => () => {}),
  };
  return { bridge: bridge as unknown as MawsBridge, calls };
}

const intent = (appSessionId: AppSessionId) => ({
  appSessionId, projectId: P1, createdAt: 't', updatedAt: 't', kind: 'create', source: null, location: { kind: 'directory', path: '/work/app' }, additionalDirectories: [],
  model: null, effort: null, permissionMode: null, gateway: 'gateway', trust: 'unanswered', trustKey: null, message: null, draft: null,
});

describe('the owner’s Start', () => {
  afterEach(() => {
    useSetup.setState({ intents: new Map(), cards: new Map() });
    useSessions.setState({ records: new Map() });
  });

  it('acquires the own session for a read, with no message', async () => {
    const { bridge, calls } = client({ 'session.acquire': { status: 'ready', appSessionId: OWN, launched: true, joined: false } });
    await expect(startArtifactSession({ kind: 'session', appSessionId: OWN }, null, bridge)).resolves.toEqual({ status: 'ready', appSessionId: OWN });
    expect(calls).toEqual([['session.acquire', { appSessionId: OWN, reason: 'read' }]]);
  });

  it('creates a session in the directory and starts it with no message or option, docking a trust card it never answers', async () => {
    const created = 'created' as AppSessionId;
    const trust = { key: '/work/app', directory: '/work/app', trusted: false };
    const { bridge, calls } = client({ 'session.create': { appSessionId: created, intent: intent(created) }, 'session.start': { status: 'needs_trust', appSessionId: created, trust } });
    const answer = await startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, null, bridge);
    expect(answer).toMatchObject({ status: 'card', appSessionId: created });
    expect(calls).toEqual([
      ['session.create', { projectId: P1, location: { kind: 'directory', path: '/work/app' } }],
      ['session.start', { appSessionId: created, message: null, options: {} }],
    ]);
    expect(useSetup.getState().cards.get(created)).toMatchObject({ kind: 'trust', message: null });
  });

  it('starts the session an earlier Start created rather than another, and resumes it once it is a record', async () => {
    const earlier = 'earlier' as AppSessionId;
    useSetup.setState({ intents: new Map([[earlier, intent(earlier) as never]]) });
    const first = client({ 'session.start': { status: 'starting', appSessionId: earlier } });
    await expect(startArtifactSession({ kind: 'directory', path: '/work/app', projectId: P1 }, earlier, first.bridge)).resolves.toEqual({ status: 'starting', appSessionId: earlier });
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
});
