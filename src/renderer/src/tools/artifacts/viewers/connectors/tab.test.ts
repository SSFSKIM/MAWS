// P3-H H4: what an HTML artifact's tab keeps of its page's connectors (the X32 lifetime rule: the header's Connectors
// action and its sheet read this, not the body). A page load's surface, relayed to the page's port, opened hidden and
// shown only by the owner's visibility; what the page declared and each tool's latest outcome; the owner's grants, read
// from the store and changed only by the owner's gestures; and the owner's Start, which refreshes the page's watches once
// the session it started is ready.
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorSurface } from '@artifacts/host';
import type { ConnectorCallOutcome, ConnectorGrant } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactSessionEnd, ArtifactSessionStart } from '../../../../artifacts/session-context';
import type { PagePort } from './relay';
import { ConnectorsTab, type ConnectorsTabDeps } from './tab';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const TOOL = { server: 'fixture', tool: 'read_series' };
const WRITE = { server: 'fixture', tool: 'append_row' };
const GRANT: ConnectorGrant = { ...TOOL, fingerprint: 'f1', mode: 'read', grantedAt: 1 };
const SESSION = 'session-1' as AppSessionId;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function surfaceFake(): ConnectorSurface & { visible: boolean[] } {
  const visible: boolean[] = [];
  return {
    visible,
    declareTools: vi.fn(async (tools) => ({ ok: true as const, declared: [...tools] })),
    callTool: vi.fn(async (): Promise<ConnectorCallOutcome> => ({ ok: false, state: 'paused', reason: 'noRoute' })),
    watchTool: vi.fn(async () => ({ ok: true, watchId: 'w1', intervalMs: 60_000 }) as const),
    unwatchTool: vi.fn(async () => true),
    refreshWatch: vi.fn(async () => true),
    setVisible: vi.fn((on: boolean) => void visible.push(on)),
    close: vi.fn(),
  };
}

function portFake() {
  const posted: unknown[] = [];
  const port: PagePort & { send(data: unknown): void } = {
    onmessage: null,
    postMessage: (data) => void posted.push(data),
    close: vi.fn(),
    send(data) {
      this.onmessage?.({ data } as MessageEvent);
    },
  };
  return { port, posted };
}

function tabWith(over: Partial<ConnectorsTabDeps> = {}) {
  const surfaces: ReturnType<typeof surfaceFake>[] = [];
  const deps: ConnectorsTabDeps = {
    host: {
      openConnectors: vi.fn(() => {
        const surface = surfaceFake();
        surfaces.push(surface);
        return surface;
      }),
      connectorGrants: vi.fn(async () => [GRANT]),
      grantConnectorTool: vi.fn(async (_id, tool) => ({ ok: true, grant: { ...tool, fingerprint: 'f', grantedAt: 2 } }) as const),
      revokeConnectorTool: vi.fn(async () => true),
    },
    startSession: vi.fn(async (): Promise<ArtifactSessionStart> => ({ status: 'ready', appSessionId: SESSION })),
    ...over,
  };
  const tab = new ConnectorsTab(ARTIFACT, deps);
  return { tab, deps, surfaces };
}

// A start whose setup runs until the test ends it.
function starting(appSessionId = SESSION) {
  let end: (value: ArtifactSessionEnd) => void = () => {};
  const settled = new Promise<ArtifactSessionEnd>((resolve) => (end = resolve));
  const answer = { status: 'starting' as const, appSessionId, settled, cancel: vi.fn() };
  return { answer, end: async (value: ArtifactSessionEnd) => (end(value), await settle()) };
}

describe('an HTML artifact tab’s connectors', () => {
  it('opens a hidden surface per page load, shows it only as the owner’s visibility says, and ends the previous load’s', () => {
    const { tab, deps, surfaces } = tabWith();
    const first = tab.attach(portFake().port);
    expect(deps.host.openConnectors).toHaveBeenCalledWith(ARTIFACT);
    expect(surfaces[0]!.visible).toEqual([]); // a lease starts hidden
    tab.setVisible(true);
    tab.setVisible(true);
    expect(surfaces[0]!.visible).toEqual([true]);
    tab.attach(portFake().port); // the page reloaded: the frame ends the previous relay itself
    first();
    expect(surfaces[0]!.close).toHaveBeenCalledTimes(1);
    expect(surfaces[1]!.visible).toEqual([true]); // a new load is shown at once while the tab is visible
    tab.setVisible(false);
    expect(surfaces[1]!.visible).toEqual([true, false]);
    expect(surfaces[0]!.visible).toEqual([true]);
  });

  it('keeps what the current load declared and each tool’s latest outcome, forgetting them at the next load', async () => {
    const { tab } = tabWith();
    const { port } = portFake();
    tab.attach(port);
    port.send({ id: 1, op: 'declare', tools: [TOOL, WRITE] });
    port.send({ id: 2, op: 'call', request: TOOL });
    await settle();
    expect(tab.view.getState().declared).toEqual([TOOL, WRITE]);
    expect(tab.lastOf(TOOL)).toEqual({ ok: false, state: 'paused', reason: 'noRoute' });
    expect(tab.view.getState().needsSession).toBe(true);
    tab.attach(portFake().port);
    expect(tab.view.getState().declared).toEqual([]);
    expect(tab.lastOf(TOOL)).toBeNull();
    expect(tab.view.getState().needsSession).toBe(false);
  });

  it('reads the grants, and reads them again after the owner’s grant or revoke', async () => {
    const { tab, deps } = tabWith();
    await tab.readGrants();
    expect(tab.view.getState().grants).toEqual([GRANT]);
    await tab.grant(WRITE, 'once');
    expect(deps.host.grantConnectorTool).toHaveBeenCalledWith(ARTIFACT, { ...WRITE, mode: 'once' });
    await tab.revoke(TOOL);
    expect(deps.host.revokeConnectorTool).toHaveBeenCalledWith(ARTIFACT, TOOL);
    expect(deps.host.connectorGrants).toHaveBeenCalledTimes(3);
  });

  it('keeps a refused grant’s reason for the tool, and asks for a session when no route has it', async () => {
    const answers = [
      { ok: false, state: 'invalid', reason: 'notReadOnly' },
      { ok: false, state: 'paused', reason: 'noRoute' },
    ] as const;
    const { tab } = tabWith({
      host: { ...tabWith().deps.host, grantConnectorTool: vi.fn(async () => answers[0]) },
    });
    await tab.grant(WRITE, 'read');
    expect(tab.view.getState().refusals).toEqual({ [JSON.stringify([WRITE.server, WRITE.tool])]: answers[0] });
    expect(tab.view.getState().needsSession).toBe(false);
    const second = tabWith({ host: { ...tabWith().deps.host, grantConnectorTool: vi.fn(async () => answers[1]) } }).tab;
    await second.grant(TOOL, 'read');
    expect(second.view.getState().needsSession).toBe(true);
  });

  it('refreshes the page’s watches once the session the owner started is ready, and not before', async () => {
    const first = starting();
    const { tab, deps, surfaces } = tabWith({ startSession: vi.fn(async (): Promise<ArtifactSessionStart> => first.answer) });
    const { port } = portFake();
    tab.attach(port);
    port.send({ id: 1, op: 'watch', request: { ...TOOL, intervalMs: 60_000 } });
    await settle();
    void tab.start({ kind: 'directory', path: '/work/app', projectId: null });
    await settle();
    expect(tab.view.getState().start).toEqual({ phase: 'starting', appSessionId: SESSION });
    expect(surfaces[0]!.refreshWatch).not.toHaveBeenCalled();
    await first.end({ status: 'ready', appSessionId: SESSION });
    expect(surfaces[0]!.refreshWatch).toHaveBeenCalledWith('w1');
    expect(tab.view.getState().start).toEqual({ phase: 'ready', appSessionId: SESSION });
    await tab.start({ kind: 'directory', path: '/work/app', projectId: null }); // again: the same session, not another
    expect(deps.startSession).toHaveBeenLastCalledWith({ kind: 'directory', path: '/work/app', projectId: null }, SESSION);
  });

  it('settles a start whose setup failed, shows why, and lets the owner start the same session again', async () => {
    const first = starting();
    const { tab, deps, surfaces } = tabWith({ startSession: vi.fn(async (): Promise<ArtifactSessionStart> => first.answer) });
    tab.attach(portFake().port);
    void tab.start({ kind: 'directory', path: '/work/app', projectId: null });
    await settle();
    await first.end({ status: 'refused', appSessionId: SESSION, words: 'the engine would not start' });
    expect(tab.view.getState().start).toEqual({ phase: 'refused', appSessionId: SESSION, words: 'the engine would not start' });
    expect(surfaces[0]!.refreshWatch).not.toHaveBeenCalled();
    const relay = starting();
    vi.mocked(deps.startSession).mockResolvedValueOnce(relay.answer);
    void tab.start({ kind: 'directory', path: '/work/app', projectId: null });
    await settle();
    expect(deps.startSession).toHaveBeenLastCalledWith({ kind: 'directory', path: '/work/app', projectId: null }, SESSION); // the intent it made
    await relay.end({ status: 'card', appSessionId: SESSION, words: 'The relay is unreachable · the session offers Run direct' });
    expect(tab.view.getState().start).toMatchObject({ phase: 'card', appSessionId: SESSION });
  });

  it('keeps the session a refused start named, and answers a start that threw as a refusal', async () => {
    const { tab, deps } = tabWith({ startSession: vi.fn(async (): Promise<ArtifactSessionStart> => ({ status: 'refused', appSessionId: SESSION, words: 'A prompt is waiting in this session' })) });
    await tab.start({ kind: 'directory', path: '/work/app', projectId: null });
    expect(tab.view.getState().start).toEqual({ phase: 'refused', appSessionId: SESSION, words: 'A prompt is waiting in this session' });
    vi.mocked(deps.startSession).mockRejectedValueOnce(new Error('main is gone'));
    await tab.start({ kind: 'directory', path: '/work/app', projectId: null });
    expect(deps.startSession).toHaveBeenLastCalledWith({ kind: 'directory', path: '/work/app', projectId: null }, SESSION);
    expect(tab.view.getState().start).toEqual({ phase: 'refused', appSessionId: SESSION, words: 'main is gone' });
  });

  it('shows a card’s words, and drops a wait when the tab goes', async () => {
    const card = tabWith({ startSession: vi.fn(async (): Promise<ArtifactSessionStart> => ({ status: 'card', appSessionId: SESSION, words: 'Trust this folder in the session to continue' })) });
    await card.tab.start({ kind: 'session', appSessionId: SESSION });
    expect(card.tab.view.getState().start).toEqual({ phase: 'card', appSessionId: SESSION, words: 'Trust this folder in the session to continue' });
    const run = starting();
    const waiting = tabWith({ startSession: vi.fn(async (): Promise<ArtifactSessionStart> => run.answer) });
    waiting.tab.attach(portFake().port);
    void waiting.tab.start({ kind: 'session', appSessionId: SESSION });
    await settle();
    waiting.tab.dispose();
    expect(run.answer.cancel).toHaveBeenCalled();
    await run.end({ status: 'ready', appSessionId: SESSION });
    expect(waiting.surfaces[0]!.close).toHaveBeenCalled();
    expect(waiting.surfaces[0]!.refreshWatch).not.toHaveBeenCalled();
  });

  it('opens and closes its sheet, and never opens it by itself on a declaration', async () => {
    const { tab } = tabWith();
    const { port } = portFake();
    tab.attach(port);
    port.send({ id: 1, op: 'declare', tools: [TOOL] });
    await settle();
    expect(tab.view.getState().sheet).toBe(false);
    tab.openSheet();
    expect(tab.view.getState().sheet).toBe(true);
    tab.closeSheet();
    expect(tab.view.getState().sheet).toBe(false);
  });
});
