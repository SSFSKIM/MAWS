// P3-H H4: the owner's Connectors sheet over a tab's connectors: one row per tool the page declared or the artifact holds
// a grant for, the permission in words, Allow / Allow once / Revoke as the grant stands, and the owner's Start when a
// tool found no live session (or, with no durable context, how to give it one).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorGrant, ConnectorGrantOutcome } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactSessionStart } from '../../../../artifacts/session-context';
import { ConnectorsSheet } from './ConnectorsSheet';
import type { PagePort } from './relay';
import { ConnectorsTab } from './tab';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const READ = { server: 'fixture', tool: 'read_series' };
const WRITE = { server: 'fixture', tool: 'append_row' };
const OLD = { server: 'notes', tool: 'search' };
const SESSION = 'session-1' as AppSessionId;
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

afterEach(cleanup);

function setup({ grants = [] as ConnectorGrant[], grantAnswer = null as ConnectorGrantOutcome | null, callAnswer = null as unknown, startAnswer = null as ArtifactSessionStart | null } = {}) {
  const host = {
    openConnectors: vi.fn(() => ({
      declareTools: vi.fn(async (tools: { server: string; tool: string }[]) => ({ ok: true as const, declared: [...tools] })),
      callTool: vi.fn(async () => callAnswer ?? { ok: true, result: 1, fetchedAt: 0, via: { route: 'engine' } }),
      watchTool: vi.fn(async () => ({ ok: true, watchId: 'w1', intervalMs: 60_000 }) as const),
      unwatchTool: vi.fn(async () => true),
      refreshWatch: vi.fn(async () => true),
      setVisible: vi.fn(),
      close: vi.fn(),
    })),
    connectorGrants: vi.fn(async () => grants),
    grantConnectorTool: vi.fn(async (_id: string, tool: { server: string; tool: string; mode: 'read' | 'once' }) => grantAnswer ?? ({ ok: true, grant: { ...tool, fingerprint: 'f', grantedAt: 1 } } as const)),
    revokeConnectorTool: vi.fn(async () => true),
  };
  const startSession = vi.fn(async () => startAnswer ?? ({ status: 'ready', appSessionId: SESSION } as const));
  const tab = new ConnectorsTab(ARTIFACT, { host: host as never, startSession });
  const port: PagePort & { send(data: unknown): void } = {
    onmessage: null,
    postMessage: () => {},
    close: () => {},
    send(data) {
      this.onmessage?.({ data } as MessageEvent);
    },
  };
  tab.attach(port);
  return { tab, host, port, startSession };
}

const row = (name: string) => screen.getByText((_, element) => element?.getAttribute('data-connector-tool') === name);

describe('the Connectors sheet', () => {
  it('lists the page’s tools then the granted ones, each permission in words, with the actions it allows', async () => {
    const { tab, port } = setup({ grants: [{ ...READ, fingerprint: 'f', mode: 'read', grantedAt: 1 }, { ...OLD, fingerprint: 'g', mode: 'read', grantedAt: 1 }] });
    port.send({ id: 1, op: 'declare', tools: [READ, WRITE] });
    await tab.readGrants();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    await flush();
    const names = [...document.querySelectorAll('[data-connector-tool]')].map((element) => element.getAttribute('data-connector-tool'));
    expect(names).toEqual(['fixture · read_series', 'fixture · append_row', 'notes · search']);
    expect(within(row('fixture · read_series')).getByText('Allowed to read')).toBeTruthy();
    expect(within(row('fixture · read_series')).getByRole('button', { name: 'Revoke fixture · read_series' })).toBeTruthy();
    expect(within(row('fixture · read_series')).queryByRole('button', { name: /^Allow/ })).toBeNull();
    expect(within(row('fixture · append_row')).getByText('Not allowed')).toBeTruthy();
    expect(within(row('fixture · append_row')).getByRole('button', { name: 'Allow fixture · append_row to read' })).toBeTruthy();
    expect(within(row('fixture · append_row')).getByRole('button', { name: 'Allow fixture · append_row once' })).toBeTruthy();
    expect(document.querySelector('[data-connectors-start]')).toBeNull(); // every tool has had a route, or none was asked
  });

  it('grants and revokes on the owner’s click, and says why a grant was refused', async () => {
    const { tab, host, port } = setup({ grantAnswer: { ok: false, state: 'invalid', reason: 'notReadOnly' } });
    port.send({ id: 1, op: 'declare', tools: [WRITE] });
    await flush();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow fixture · append_row to read' }));
    await flush();
    expect(host.grantConnectorTool).toHaveBeenCalledWith(ARTIFACT, { ...WRITE, mode: 'read' });
    expect(within(row('fixture · append_row')).getByText(/This tool may change data: allow it once instead/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow fixture · append_row once' }));
    await flush();
    expect(host.grantConnectorTool).toHaveBeenLastCalledWith(ARTIFACT, { ...WRITE, mode: 'once' });
  });

  it('revokes a standing grant', async () => {
    const { tab, host } = setup({ grants: [{ ...READ, fingerprint: 'f', mode: 'read', grantedAt: 1 }] });
    await tab.readGrants();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke fixture · read_series' }));
    await flush();
    expect(host.revokeConnectorTool).toHaveBeenCalledWith(ARTIFACT, READ);
  });

  it('offers the owner’s Start when a tool found no live session, and says what came of it', async () => {
    const { tab, port, startSession } = setup({ callAnswer: { ok: false, state: 'paused', reason: 'noRoute' }, startAnswer: { status: 'card', appSessionId: SESSION, words: 'Trust this folder in the session to continue' } });
    port.send({ id: 1, op: 'declare', tools: [READ] });
    port.send({ id: 2, op: 'call', request: READ });
    await flush();
    const context = { kind: 'directory' as const, path: '/work/app', projectId: null };
    render(<ConnectorsSheet tab={tab} context={context} />);
    expect(within(row('fixture · read_series')).getByText(/No live session for this artifact has this server/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await flush();
    expect(startSession).toHaveBeenCalledWith(context, null);
    expect(screen.getByRole('status').textContent).toBe('Trust this folder in the session to continue');
    expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
  });

  it('sends the owner to a session whose waiting prompt refused the Start, and lets them start again', async () => {
    const words = 'A prompt is waiting in this session · open it to send or discard the prompt first';
    const { tab, port, startSession } = setup({ callAnswer: { ok: false, state: 'paused', reason: 'noRoute' }, startAnswer: { status: 'refused', appSessionId: SESSION, words } });
    port.send({ id: 1, op: 'declare', tools: [READ] });
    port.send({ id: 2, op: 'call', request: READ });
    await flush();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'directory', path: '/work/app', projectId: null }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await flush();
    expect(screen.getByRole('status').textContent).toBe(words);
    expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start session' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    await flush();
    expect(startSession).toHaveBeenLastCalledWith({ kind: 'directory', path: '/work/app', projectId: null }, SESSION);
  });

  it('says how to give the artifact a session when it has no durable context, with no Start', async () => {
    const { tab, port } = setup({ callAnswer: { ok: false, state: 'paused', reason: 'noRoute' } });
    port.send({ id: 1, op: 'declare', tools: [READ] });
    port.send({ id: 2, op: 'call', request: READ });
    await flush();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    expect(screen.getByText(/Put this artifact in a Space linked to a folder/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull();
  });

  it('closes on Done', () => {
    const { tab } = setup();
    tab.openSheet();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(tab.view.getState().sheet).toBe(false);
  });
});
