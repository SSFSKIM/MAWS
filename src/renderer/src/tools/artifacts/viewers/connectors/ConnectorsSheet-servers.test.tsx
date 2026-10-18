// P3-HD M3c2: the Connectors sheet's Servers section (./ConnectorsSheet.tsx; docs/doperpowers/plans/2026-10-17-p3-hd-
// direct-route.md, Decision Log 29 and 33), over a tab with the owner's dependency: each row's server, transport and
// configuration file, MAWS's connection in words and the actions it allows; session-only servers with their reason;
// stale, unreadable and retiring saved connections; the withdrawal explained. Copy names both routes. Without the
// dependency the section is absent (H's sheet, ./ConnectorsSheet.test.tsx).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorServerRow, ConnectorServers } from '@shared/ipc/schema/connectors';
import type { ConnectorsOwner } from '../../../../artifacts/connector-owner';
import { ConnectorsSheet } from './ConnectorsSheet';
import type { PagePort } from './relay';
import { ConnectorsTab } from './tab';

const ARTIFACT = '11111111-1111-4111-8111-111111111111';
const H1 = '22222222-2222-4222-8222-222222222221';
const H2 = '22222222-2222-4222-8222-222222222222';
const H3 = '22222222-2222-4222-8222-222222222223';
const CONN = '33333333-3333-4333-8333-333333333333';
const OLD = '44444444-4444-4444-8444-444444444444';
const BAD = '55555555-5555-4555-8555-555555555555';
const GONE = '66666666-6666-4666-8666-666666666666';
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
afterEach(cleanup);

const ROWS: ConnectorServerRow[] = [
  { kind: 'source', handle: H1, server: 'notes', scope: 'user', transport: 'http', path: '/Users/me/.claude.json', tools: ['search'], needsDiscovery: false, connection: { state: 'connected', connectionId: CONN }, last: { action: 'connect', ok: true, tools: 3, credential: 'maws' } },
  { kind: 'source', handle: H2, server: 'files', scope: 'local', transport: 'stdio', path: '/Users/me/.claude.json', tools: ['read'], needsDiscovery: true },
  { kind: 'source', handle: H3, server: 'wiki', scope: 'user', transport: 'http', path: '/Users/me/.claude.json', tools: ['page'], needsDiscovery: true, connection: { state: 'needsConnect' }, last: { action: 'connect', ok: false, why: 'denied' } },
  { kind: 'engineOnly', server: 'mail', why: 'unobserved', tools: ['send'] },
  { kind: 'saved', connectionId: OLD, server: 'notes', scope: 'local', path: '/Users/me/old/.claude.json' },
  { kind: 'unreadable', connectionId: BAD },
  { kind: 'retiring', connectionId: GONE, server: 'notes', scope: 'user', path: '/Users/me/.claude.json', disconnecting: 'unconfirmed' },
];

function setup(answer: Partial<ConnectorServers> = {}, declared: unknown[] = [{ server: 'notes', tool: 'search' }]) {
  const owner: ConnectorsOwner = {
    servers: vi.fn(async () => ({ servers: ROWS, saved: 'ok' as const, withdrawnUnattributed: false, ...answer })),
    connect: vi.fn(async () => ({ accepted: true }) as const),
    reconnect: vi.fn(async () => ({ accepted: true }) as const),
    disconnect: vi.fn(async () => ({ accepted: true }) as const),
    onServersChanged: vi.fn(() => () => {}),
  };
  const host = {
    openConnectors: vi.fn(() => ({ declareTools: vi.fn(async (tools: unknown[]) => ({ ok: true as const, declared: tools })), callTool: vi.fn(async () => ({ ok: false, state: 'paused', reason: 'noRoute' })), setVisible: vi.fn(), close: vi.fn() })),
    connectorGrants: vi.fn(async () => []),
    grantConnectorTool: vi.fn(),
    revokeConnectorTool: vi.fn(),
  };
  const tab = new ConnectorsTab(ARTIFACT, { host: host as never, startSession: vi.fn(), owner });
  const port: PagePort & { send(data: unknown): void } = { onmessage: null, postMessage: () => {}, close: () => {}, send(data) { this.onmessage?.({ data } as MessageEvent); } };
  tab.attach(port);
  port.send({ id: 1, op: 'declare', tools: declared });
  return { tab, owner, port };
}

const server = (name: string, kind?: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-connector-server]')].find((element) => element.dataset.connectorServer === name && (kind === undefined || element.dataset.kind === kind))!;
const buttons = (element: HTMLElement) => within(element).queryAllByRole('button').map((button) => button.textContent);

describe('the Connectors sheet’s Servers section', () => {
  it('shows each row’s origin, MAWS’s connection in words and only the actions it allows', async () => {
    const { tab } = setup();
    tab.openSheet();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    await flush();
    const notes = server('notes', 'source');
    expect(notes.textContent).toContain('HTTP');
    expect(notes.textContent).toContain('User config · /Users/me/.claude.json');
    expect(within(notes).getByText(/Connected through MAWS/)).toBeTruthy();
    expect(notes.textContent).toContain('Connected · 3 tools listed');
    expect(buttons(notes)).toEqual(['Reconnect', 'Disconnect']);
    expect(buttons(server('files'))).toEqual(['Connect']);
    expect(server('files').textContent).toContain('MAWS hasn’t listed its tools yet');
    expect(server('wiki').textContent).toContain('This server needs a sign-in');
    expect(server('wiki').textContent).toContain('Connect didn’t finish: the sign-in was declined');
    expect(server('mail').textContent).toContain('Session only: No session has reported this server since MAWS started');
    expect(buttons(server('mail'))).toEqual([]);
    expect(buttons(server('notes', 'saved'))).toEqual(['Disconnect']);
    expect(server('notes', 'saved').textContent).toContain('Project-local config · /Users/me/old/.claude.json');
    expect(buttons(server('Unreadable saved MAWS connection'))).toEqual(['Forget']);
    expect(buttons(server('notes · MAWS connection being disconnected'))).toEqual(['Retry disconnect']);
    expect(screen.getByText(/Disconnect affects MAWS only/)).toBeTruthy();
    expect(screen.getByText(/or MAWS’s own connection to a server a session reported/)).toBeTruthy(); // both routes
  });

  it('sends each action by its row’s handle or saved connection id', async () => {
    const { tab, owner } = setup();
    tab.openSheet();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    await flush();
    const opened = vi.mocked(owner.servers).mock.calls.length; // the opening's, and the declaration's answer while open
    fireEvent.click(screen.getByRole('button', { name: 'Connect MAWS to files' }));
    await flush();
    expect(owner.connect).toHaveBeenCalledWith(ARTIFACT, H2);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect MAWS to notes' }));
    await flush();
    expect(owner.reconnect).toHaveBeenCalledWith(ARTIFACT, H1);
    fireEvent.click(screen.getByRole('button', { name: 'Forget the unreadable saved MAWS connection' }));
    await flush();
    expect(owner.disconnect).toHaveBeenCalledWith(BAD);
    fireEvent.click(screen.getByRole('button', { name: 'Retry disconnecting MAWS from notes' }));
    await flush();
    expect(owner.disconnect).toHaveBeenLastCalledWith(GONE);
    expect(vi.mocked(owner.servers).mock.calls.length - opened).toBe(4); // once after each acknowledgment
  });

  it('explains a withdrawal by an unreadable connection’s forgetting, and that a relaunch restores the rest', async () => {
    const { tab } = setup({ servers: [{ ...ROWS[0]!, connection: { state: 'withdrawn' }, last: undefined } as ConnectorServerRow], withdrawnUnattributed: true });
    tab.openSheet();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    await flush();
    expect(server('notes').textContent).toContain('Not used by MAWS until you Connect or MAWS relaunches');
    expect(buttons(server('notes'))).toEqual(['Connect']);
    expect(document.querySelector('[data-connectors-withdrawn]')!.textContent).toMatch(/until MAWS relaunches.*works again after a relaunch/);
  });

  // P3-F: recovery rows stand apart from the tools; a page with none declared (and no grant) still reaches them
  it('offers Forget and Retry disconnect when no tool is declared or granted', async () => {
    const { tab, owner } = setup({ servers: [ROWS[5]!, ROWS[6]!] }, []);
    tab.openSheet();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    await flush();
    expect(screen.getByText('This page has asked for no tools.')).toBeTruthy();
    expect(buttons(server('Unreadable saved MAWS connection'))).toEqual(['Forget']);
    expect(buttons(server('notes · MAWS connection being disconnected'))).toEqual(['Retry disconnect']);
    fireEvent.click(screen.getByRole('button', { name: 'Forget the unreadable saved MAWS connection' }));
    await flush();
    expect(owner.disconnect).toHaveBeenCalledWith(BAD);
  });

  it('says while it reads, and keeps the tools usable', async () => {
    const { tab, owner } = setup();
    vi.mocked(owner.servers).mockImplementation(() => new Promise(() => {}));
    tab.openSheet();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    await flush();
    expect(screen.getByRole('status').textContent).toBe('Reading MAWS’s connections…');
    expect(screen.getByRole('button', { name: 'Allow notes · search to read' })).toBeTruthy();
  });
});

// P3-HD M3c2 correction: the owned sheet's body scrolls within the viewport, so every control and Done stay reachable
describe('the owned sheet at a narrow height', () => {
  it('bounds its body by the viewport with its own scroller, Done outside it', async () => {
    const { tab } = setup({ servers: Array.from({ length: 40 }, (_, i) => ({ kind: 'unreadable', connectionId: `55555555-5555-4555-8555-${String(i).padStart(12, '0')}` }) as ConnectorServerRow) });
    tab.openSheet();
    render(<ConnectorsSheet tab={tab} context={{ kind: 'none' }} />);
    await flush();
    const body = document.querySelector<HTMLElement>('[data-connectors-body]')!;
    expect(body).not.toBeNull();
    expect(body.className).toMatch(/\bmax-h-\[[^\]]*vh[^\]]*\]/);
    expect(body.className).toContain('overflow-y-auto');
    expect(body.querySelector('[data-connectors-servers]')).not.toBeNull();
    expect(body.querySelector('[data-connector-tool]')).not.toBeNull();
    const done = screen.getByRole('button', { name: 'Done' });
    expect(body.contains(done)).toBe(false);
  });
});
