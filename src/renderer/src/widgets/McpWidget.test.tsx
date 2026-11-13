import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { McpStatusResponse } from '@shared/wire/control';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, fixtureLine, syntheticFixture, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { project, record, remoteRow } from '../../../../test/support/builders';
import { heardRefusal, resetRemoteSurfaces } from '../artifacts/remote-surfaces';
import { useMachines } from '../stores/machines';
import { addressOf } from '@shared/machine/address';
import type { PreloadBridge } from '@shared/ipc/schema';
import { heard, resetSignIns } from '../customize/connectors/sign-in';
import { useSessions } from '../stores/sessions';
import { PlusMenu } from '../composer/plus-menu/PlusMenu';
import { McpBody, McpWidget, present, toggleView } from './McpWidget';

const ROOT = join(__dirname, '../../../..');
// P5 O6 M2: the backend is main (bare ids); the page holds the address
const BARE = 'app-7412a115' as AppSessionId;
const ID = at(BARE);
const lifted = (status: EngineSessionStatus): EngineSessionStatus => ({ ...status, appSessionId: at(status.appSessionId) });
const DOCS = 'openaiDeveloperDocs';
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: unknown }).maws;
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <McpWidget appSessionId={ID} args="" close={() => {}} />
    </QueryClientProvider>,
  );
const reads = () => backend.calls.filter((c) => c.subtype === 'mcp_status').length;
const row = async (name: string) => (await screen.findAllByRole('listitem')).find((li) => li.textContent?.includes(name))!;
const serverSwitch = async (name: string) => within(await row(name)).getByRole('switch');
const statusOf = async (name: string) => within(await row(name)).getByRole('status');
// U11a (§C, "The row"): the row's one line is the disclosure that opens the rest
const disclosure = (li: HTMLElement) => li.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
type McpAnswer = { mcpServers: { name: string; status: string; error?: string }[] };
const withServer = (name: string, patch: Record<string, unknown>): McpAnswer => {
  const answer = fixtureLine(ROOT, 'pass2/real-settings#63') as McpAnswer;
  return { ...answer, mcpServers: answer.mcpServers.map((s) => (s.name === name ? { ...s, ...patch } : s)) };
};

describe('mcp reconnect runs as an operation', () => {
  it('calls session.mcpReconnect for the server, shows Working…, and reads mcp_status again on completion', async () => {
    backend.holdOperations(true);
    mount();
    fireEvent.click(disclosure(await row(DOCS))); // U11a: a connected row's Reconnect is in its opened part
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect((within(document.body).getAllByRole('status').find((s) => s.textContent === 'Working…'))).toBeTruthy());
    expect(backend.calls.find((c) => c.subtype === 'mcp_reconnect')?.input).toEqual({ appSessionId: BARE, serverName: DOCS });
    expect(reads()).toBe(1);
    act(() => void backend.settleOperations());
    await waitFor(() => expect(reads()).toBe(2));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Reconnected'));
  });
});

describe('mcp toggle reads its state back after either outcome', () => {
  it('Toggle off: session.mcpToggle { enabled: false }, one mcp_status after the outcome, and the switch reads it', async () => {
    backend.holdOperations(true);
    mount();
    const docs = await serverSwitch(DOCS);
    expect(docs.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(docs);
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Working…'));
    expect(backend.calls.find((c) => c.subtype === 'mcp_toggle')?.input).toEqual({ appSessionId: BARE, serverName: DOCS, enabled: false });
    expect(reads()).toBe(1);
    act(() => void backend.settleOperations());
    await waitFor(async () => expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('false'));
    await new Promise((r) => setTimeout(r, 20));
    expect(reads()).toBe(2); // exactly one read-back after the outcome
    expect((await statusOf(DOCS)).textContent).toBe('Done');
  });

  it('a refusal before the write (Server not found) leaves the switch where the read puts it, with the words', async () => {
    backend.scriptOutcome('session.mcpToggle', () => ({ ok: false, error: { code: 'engine_error', message: 'Server not found: x', engineCode: null } }));
    mount();
    fireEvent.click(await serverSwitch(DOCS));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Server not found: x · engine_error'));
    expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('true');
    expect(reads()).toBe(2);
  });

  it('an enable that persisted and did not connect reads On · not connected · <error>, never off', async () => {
    const failed = syntheticFixture(ROOT, 'mcp-toggle-connect-failed.json') as { operation: never; mcp_status: McpAnswer };
    let answer: McpAnswer = withServer(DOCS, { status: 'disabled' });
    backend.script('session.mcpStatus', () => answer);
    backend.scriptOutcome('session.mcpToggle', () => {
      answer = failed.mcp_status;
      return failed.operation;
    });
    mount();
    const docs = await serverSwitch(DOCS);
    await waitFor(() => expect(docs.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(docs);
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('On · not connected · Connection failed'));
    expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('true');
    expect(backend.calls.find((c) => c.subtype === 'mcp_toggle')?.input).toEqual({ appSessionId: BARE, serverName: DOCS, enabled: true });
  });

  it('when the read-back fails the switch reads Unconfirmed with the outcome’s words, and Read again reads once more', async () => {
    mount();
    fireEvent.click(await serverSwitch(DOCS));
    backend.script('session.mcpStatus', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'mcp_status unanswered after 8 s' });
    });
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Unconfirmed · Done'));
    expect((await serverSwitch(DOCS)).dataset.state).toBe('unconfirmed');
    expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('true'); // the last read's position (connected), not "off"
    const before = reads();
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(reads()).toBe(before + 1));
  });
});

// P5 O7 M8 ("Sign in from the session's MCP widget"): a server that needs auth offers Sign in beside Reconnect, for a
// session on this Mac or another machine alike: `connectors.signInServer` by the server's name and scope, with the
// session's directory, sent to the session's machine, which reads the entry there. Reconnect stays a restart.
describe('mcp sign in', () => {
  const REMOTE = addressOf(OTHER_MACHINE, BARE);
  let targets: [string, unknown][];
  beforeEach(() => {
    resetSignIns();
    targets = [];
    const bridge = window.maws as PreloadBridge;
    window.maws = { ...bridge, invoke: (name, input, target) => (targets.push([name, target]), bridge.invoke(name, input, target)) } as PreloadBridge;
    backend.script('session.mcpStatus', () => withServer(DOCS, { status: 'needs-auth' }));
    backend.script('connectors.signInServer', () => ({ opId: 'op-1' }));
  });
  const mountFor = (appSessionId: AppSessionId) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <McpWidget appSessionId={appSessionId} args="" close={() => {}} />
      </QueryClientProvider>,
    );
  const signIns = () => backend.calls.filter((c) => c.command === 'connectors.signInServer').map((c) => c.input);

  it('offers Sign in beside Reconnect on a server that needs auth, and signs it in by name and scope in the session’s directory', async () => {
    mountFor(ID);
    const docs = await row(DOCS);
    expect(within(docs).getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    fireEvent.click(within(docs).getByRole('button', { name: `Sign in to ${DOCS}` }));
    await waitFor(() => expect(signIns()).toEqual([{ name: DOCS, scope: 'user', cwd: backend.status(BARE).cwd, appSessionId: BARE }]));
    act(() => heard({ opId: 'op-1', name: DOCS, state: 'waiting_callback', reason: null, message: null, where: null }, Date.now(), null));
    await waitFor(async () => expect((await row(DOCS)).querySelector('[data-sign-in-state]')?.textContent).toBe('Finish signing in in your browser…'));
    // Reconnect is still the restart it was
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(backend.calls.find((c) => c.subtype === 'mcp_reconnect')?.input).toEqual({ appSessionId: BARE, serverName: DOCS }));
    expect(signIns()).toHaveLength(1);
  });

  it('signs a remote session’s server in on its machine, and hears that machine’s sign-in', async () => {
    useSessions.setState({ engine: new Map([[REMOTE, { ...backend.status(BARE), appSessionId: REMOTE }]]) });
    mountFor(REMOTE);
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: `Sign in to ${DOCS}` }));
    await waitFor(() => expect(signIns()).toEqual([{ name: DOCS, scope: 'user', cwd: backend.status(BARE).cwd, appSessionId: BARE }]));
    expect(targets.filter(([name]) => name === 'connectors.signInServer')).toEqual([['connectors.signInServer', OTHER_MACHINE]]);
    act(() => heard({ opId: 'op-1', name: DOCS, state: 'done', reason: null, message: null, where: 'here' }, Date.now(), OTHER_MACHINE));
    await waitFor(async () => expect((await row(DOCS)).querySelector('[data-sign-in-state]')?.textContent).toBe('Signed in · connected here'));
  });

  it('offers no Sign in on a connected server', async () => {
    backend.script('session.mcpStatus', () => withServer('plugin:ptc:ptc', { status: 'needs-auth' }));
    mountFor(ID);
    await row(DOCS);
    expect(screen.queryByRole('button', { name: `Sign in to ${DOCS}` })).toBeNull(); // connected
  });

  // P5 O7 M8 ("An older peer"): a machine heard refusing a command `not-offered` greys its control for that machine's
  // sessions, with the reason, as the Connectors sheet's surfaces grey (lane-b/remote-unavailable.ts)
  it('greys Sign in, Reconnect and the switch for a session on a machine heard not offering them, with the reason', async () => {
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
    useSessions.setState({ engine: new Map([[REMOTE, { ...backend.status(BARE), appSessionId: REMOTE }]]), listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, BARE), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
    try {
      mountFor(REMOTE);
      const signIn = await within(await row(DOCS)).findByRole('button', { name: `Sign in to ${DOCS}` });
      expect(signIn).toHaveProperty('disabled', false);
      for (const name of ['connectors.signInServer', 'session.mcpReconnect', 'session.mcpToggle'] as const) act(() => heardRefusal(name, { issues: { refusal: 'not-offered' } }, OTHER_MACHINE, TEST_MACHINE));
      const docs = await row(DOCS);
      for (const control of [within(docs).getByRole('button', { name: `Sign in to ${DOCS}` }), within(docs).getByRole('button', { name: 'Reconnect' }), within(docs).getByRole('switch')]) {
        expect(control).toHaveProperty('disabled', true);
        expect(control.title).toBe('mini doesn’t offer this');
      }
    } finally {
      resetRemoteSurfaces();
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    }
  });
});

// UX wave U11a (§C, "The row"): servers in the shape of `mcp_status`'s answer as
// spikes/protocol-probe/fixtures/pass2/real-settings.jsonl seq 63 records it; the servers are invented.
const server = (name: string, status: string, over: Record<string, unknown> = {}) => ({ name, status, serverInfo: { name, version: '1.0.0' }, config: { type: 'http', url: `https://${name}.example.test/mcp` }, scope: 'user', source: 'user', tools: [], ...over });
const FIVE = {
  mcpServers: [
    server('notes', 'connected', { tools: [{ name: 'find_note', annotations: {} }, { name: 'write_note', annotations: {} }] }),
    server('tickets', 'needs-auth'),
    server('search', 'failed', { error: 'Connection refused' }),
    server('calendar', 'pending'),
    server('files', 'disabled', { config: { type: 'stdio', command: '/opt/tools/bin/files-mcp', args: ['--root', '/work'] }, scope: 'project', source: 'project' }),
  ],
};
const lineOf = (li: HTMLElement) => [li.querySelector('[data-connector-name]')?.textContent ?? null, li.querySelector('[data-connector-state]')?.textContent ?? null];

describe('the Connectors dialog: one line per connector (U11a §C)', () => {
  beforeEach(() => {
    resetSignIns();
    backend.script('session.mcpStatus', () => FIVE);
  });

  it('draws five servers as five rows of name, status words and tool count, the rest only once a row is opened', async () => {
    mount();
    const list = await screen.findByRole('list', { name: 'Connectors' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(5));
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map(lineOf)).toEqual([
      ['notes', 'Connected · 2 tools'],
      ['tickets', 'Sign in needed'],
      ['search', 'Failed'],
      ['calendar', 'Connecting…'],
      ['files', null], // disabled: the switch says it
    ]);
    for (const unopened of ['example.test', 'files-mcp', 'scope ', 'from ', 'find_note', 'Connection refused']) expect(list.textContent).not.toContain(unopened);
    const [notes, , , , files] = rows;
    fireEvent.click(disclosure(notes));
    expect(disclosure(notes).getAttribute('aria-expanded')).toBe('true');
    for (const opened of ['http · https://notes.example.test/mcp', 'from user', 'scope user', 'find_note, write_note']) expect(notes.textContent).toContain(opened);
    fireEvent.click(disclosure(files));
    expect(within(files).getByTitle('/opt/tools/bin/files-mcp --root /work').textContent).toBe('stdio · …/files-mcp --root …/work');
    expect(files.textContent).toContain('scope project');
  });

  it('says once, in the head, what the switch reaches, with where the engine records it as the tooltip; no row repeats it', async () => {
    mount();
    const list = await screen.findByRole('list', { name: 'Connectors' });
    const header = document.querySelector<HTMLElement>('[data-widget="mcp"] header')!;
    expect(header.querySelector('h3')?.textContent).toBe('Connectors');
    expect(header.querySelector('[data-widget-subtitle]')?.textContent).toBe('MCP servers');
    const note = await waitFor(() => {
      const found = header.querySelector<HTMLElement>('[data-widget-note]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(note.textContent).toMatch(/^Off here is off for every session in .+\.$/);
    expect(note.title).toBe('The engine records it in ~/.claude.json.');
    expect(screen.getAllByText(/Off here is off/)).toHaveLength(1);
    expect(list.textContent).not.toContain('~/.claude.json');
  });

  it('puts Sign in and Reconnect on the line of a row that needs a sign-in or failed, and Reconnect inside a connected row', async () => {
    mount();
    const [tickets, search, notes] = [await row('tickets'), await row('search'), await row('notes')];
    expect(within(tickets).getByRole('button', { name: 'Sign in to tickets' })).toBeTruthy();
    expect(within(tickets).getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    expect(within(search).getByRole('button', { name: 'Reconnect' })).toBeTruthy();
    for (const li of [tickets, search]) expect(disclosure(li).getAttribute('aria-expanded')).toBe('false');
    expect(within(notes).queryByRole('button', { name: 'Reconnect' })).toBeNull();
    fireEvent.click(disclosure(notes));
    expect(within(notes).getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });

  it('shows a failed row with nothing done as Failed on its line, its error only in the opened part and no line under it', async () => {
    mount();
    const search = await row('search');
    expect(within(search).queryByRole('status')).toBeNull();
    expect(search.textContent).not.toContain('Connection refused');
    fireEvent.click(disclosure(search));
    expect(search.textContent).toContain('Connection refused');
  });

  it('leaves the row closed when its switch or its Sign in is pressed', async () => {
    backend.script('connectors.signInServer', () => ({ opId: 'op-closed' }));
    mount();
    const notes = await row('notes');
    fireEvent.click(within(notes).getByRole('switch'));
    expect(disclosure(notes).getAttribute('aria-expanded')).toBe('false');
    const tickets = await row('tickets');
    fireEvent.click(within(tickets).getByRole('button', { name: 'Sign in to tickets' }));
    expect(disclosure(tickets).getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(backend.calls.some((c) => c.command === 'connectors.signInServer')).toBe(true));
  });

  it('reads a disabled connector as Off where no switch is drawn, as Customize’s live list draws it', () => {
    render(<McpBody view={present({ mcpServers: [server('files', 'disabled'), server('notes', 'connected')] } as unknown as McpStatusResponse)} />);
    const [files, notes] = screen.getAllByRole('listitem');
    expect(lineOf(files)).toEqual(['files', 'Off']);
    expect(lineOf(notes)).toEqual(['notes', 'Connected']);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });
});

describe('held open: an act that is out (U11a §C)', () => {
  it('disables that row’s switch and Reconnect while a toggle is out, and the answer lands under the row closed meanwhile', async () => {
    backend.holdOperations(true);
    mount();
    const docs = await row(DOCS);
    fireEvent.click(disclosure(docs));
    fireEvent.click(within(docs).getByRole('switch'));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Working…'));
    expect(within(docs).getByRole('switch')).toHaveProperty('disabled', true);
    expect(within(docs).getByRole('button', { name: 'Reconnect' })).toHaveProperty('disabled', true);
    fireEvent.click(disclosure(docs));
    expect(disclosure(docs).getAttribute('aria-expanded')).toBe('false');
    act(() => void backend.settleOperations());
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Done'));
    expect(disclosure(await row(DOCS)).getAttribute('aria-expanded')).toBe('false');
    expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('false');
  });
});

// P2 (spikes/protocol-probe/findings-uxwave-u11-connector-off-place.txt, engine 2.1.322): a switched-off server is recorded
// under the key of the repository's main root, from the root, a linked worktree and a subfolder alike, and outside any
// repository under the session's folder exactly. The paths here are invented.
describe('the place the head names (U11a §C, "<place>")', () => {
  const MAIN = '/Users/example/code/atlas';
  const WORKTREE = `${MAIN}/.claude/worktrees/feature`;
  const listed = (toplevel: string) => ({ repoRoot: MAIN, commonDir: `${MAIN}/.git`, worktrees: [], toplevel });
  const inFolder = (cwd: string) => useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), cwd }]]) });
  const head = () =>
    waitFor(() => {
      const note = document.querySelector<HTMLElement>('[data-widget="mcp"] [data-widget-note]');
      expect(note).not.toBeNull();
      return note!.textContent;
    });
  const gitReads = () => backend.calls.filter((c) => c.command === 'git.worktree.list').map((c) => c.input);
  afterEach(() => useSessions.setState({ records: new Map(), projects: new Map() }));

  it('names the project when the session’s record names one, also for a session in a worktree, and reads no git', async () => {
    backend.script('git.worktree.list', () => listed(WORKTREE));
    inFolder(WORKTREE);
    useSessions.setState({ records: new Map([[ID, record(ID, { projectId: 'p-atlas' as ProjectId, directory: MAIN })]]), projects: new Map([['p-atlas' as ProjectId, project('p-atlas', 0, { name: 'Atlas', directory: MAIN })]]) });
    mount();
    expect(await head()).toBe('Off here is off for every session in Atlas.');
    expect(gitReads()).toEqual([]);
  });

  it('names the main root of the repository holding the folder when no project is named, the home abbreviated', async () => {
    backend.script('git.worktree.list', () => listed(WORKTREE));
    inFolder(WORKTREE);
    mount();
    expect(await head()).toBe('Off here is off for every session in ~/code/atlas.');
    expect(gitReads()).toEqual([{ repoRoot: WORKTREE }]);
  });

  it('names the session’s folder when it is in no repository, and when the main root cannot be read', async () => {
    backend.script('git.worktree.list', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'not a git repository' });
    });
    inFolder('/Users/example/scratch/plain');
    mount();
    expect(await head()).toBe('Off here is off for every session in ~/scratch/plain.');
    cleanup();
    backend.script('git.worktree.list', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'git answered nothing' });
    });
    inFolder(`${MAIN}/sub`);
    mount();
    expect(await head()).toBe('Off here is off for every session in ~/code/atlas/sub.');
  });
});

// U11a M6 review: the switch reaches every session in the place the head names, so it waits for that sentence; a read of
// the main root that is out holds both back, while Reconnect, which reaches this session only, stays available.
describe('the switch waits for the sentence of what it reaches (U11a §C)', () => {
  const MAIN = '/Users/example/code/atlas';
  const WORKTREE = `${MAIN}/.claude/worktrees/feature`;
  const note = () => document.querySelector<HTMLElement>('[data-widget="mcp"] [data-widget-note]');
  let settle: { resolve(value: unknown): void; reject(error: unknown): void };
  beforeEach(() => {
    useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), cwd: WORKTREE }]]) });
    backend.script('git.worktree.list', () => new Promise((resolve, reject) => (settle = { resolve, reject })));
  });
  const heldOpen = async () => {
    mount();
    const docs = await row(DOCS);
    await waitFor(() => expect(backend.calls.some((c) => c.command === 'git.worktree.list')).toBe(true));
    expect(note()).toBeNull();
    expect(within(docs).getByRole('switch')).toHaveProperty('disabled', true);
    fireEvent.click(disclosure(docs));
    expect(within(docs).getByRole('button', { name: 'Reconnect' })).toHaveProperty('disabled', false);
    return docs;
  };

  it('holds the switch disabled while the main root is read, and enables it with the sentence once read', async () => {
    const docs = await heldOpen();
    await act(async () => settle.resolve({ repoRoot: MAIN, commonDir: `${MAIN}/.git`, worktrees: [], toplevel: WORKTREE }));
    await waitFor(() => expect(note()?.textContent).toBe('Off here is off for every session in ~/code/atlas.'));
    expect(within(docs).getByRole('switch')).toHaveProperty('disabled', false);
  });

  it('enables the switch with the folder’s sentence when the read fails', async () => {
    const docs = await heldOpen();
    await act(async () => settle.reject(new WidgetBackendError({ code: 'internal', message: 'not a git repository' })));
    await waitFor(() => expect(note()?.textContent).toBe('Off here is off for every session in ~/code/atlas/.claude/worktrees/feature.'));
    expect(within(docs).getByRole('switch')).toHaveProperty('disabled', false);
  });
});

describe('the "+" menu’s entries to the dialogs (U11a §C)', () => {
  it('reads Connectors in this chat… and Plugins in this chat…', async () => {
    for (const [submenu, entry] of [['Connectors', /^Connectors in this chat…/], ['Plugins', /^Plugins in this chat…/]] as const) {
      const user = userEvent.setup();
      render(<QueryClientProvider client={new QueryClient()}><PlusMenu appSessionId={ID} cwd="/work/atlas" editor={{ current: null }} /></QueryClientProvider>);
      await user.click(screen.getByRole('button', { name: 'Add files, photos or commands' }));
      const trigger = screen.getByRole('menuitem', { name: submenu });
      act(() => trigger.focus());
      await user.keyboard('{ArrowRight}');
      expect(await screen.findByRole('menuitem', { name: entry })).toBeTruthy();
      cleanup();
    }
  });
});

describe('toggleView: the switch from the read, never from the outcome', () => {
  const ok = { ok: true as const, value: null };
  const failed = (message: string) => ({ ok: false as const, error: { code: 'engine_error' as const, message, engineCode: null } });
  it('reads disabled as off, any other status as on, failed as on and not connected', () => {
    expect(toggleView(false, ok, { status: 'disabled', error: null })).toEqual({ position: 'off', line: 'Done' });
    expect(toggleView(true, ok, { status: 'pending', error: null })).toEqual({ position: 'on', line: 'Done' });
    expect(toggleView(true, failed('Connection failed'), { status: 'failed', error: 'Connection failed' })).toEqual({ position: 'on', line: 'On · not connected · Connection failed' });
  });
  it('is unconfirmed when the read failed, the server is gone, or a disable that failed after its write still reads connected', () => {
    expect(toggleView(false, ok, 'unread')).toEqual({ position: 'unconfirmed', line: 'Unconfirmed · Done' });
    expect(toggleView(false, ok, null)).toEqual({ position: 'unconfirmed', line: 'Unconfirmed · Done' });
    expect(toggleView(false, failed('disconnect failed'), { status: 'connected', error: null })).toEqual({ position: 'unconfirmed', line: 'Unconfirmed · disconnect failed · engine_error' });
  });
  it('trusts the read after a refusal thrown before the write', () => {
    expect(toggleView(true, failed('MCP server x is blocked by enterprise managed policy'), { status: 'disabled', error: null })).toEqual({ position: 'off', line: 'MCP server x is blocked by enterprise managed policy · engine_error' });
  });
});

// UX wave U11a M8 (§A, "Who offers Sign in"): a dynamic row that needs a sign-in, a plugin's (`plugin:<plugin>:<server>`)
// or one of MAWS's own list, both `dynamic` in mcp_status (P1), offers Sign in through `connectors.signInDynamicServer`
// by its name; `claudeai` and the managed scopes are signed in nowhere a session reaches. For a session on another
// machine the control is drawn disabled with U9's sentence until U11f; a file-scope row beside it keeps its Sign in.
describe('the Connectors dialog’s Sign in for a dynamic connector', () => {
  const PLUGIN = 'plugin:fx-plugin:fx-oauth';
  const REMOTE = addressOf(OTHER_MACHINE, BARE);
  const NOT_YET = 'Not on another machine yet: signing in to a connector from a plugin or from MAWS’s own list';
  const dynamicServer = (name: string) => server(name, 'needs-auth', { scope: 'dynamic', source: 'dynamic' });
  const sent = () => backend.calls.filter((c) => c.command === 'connectors.signInDynamicServer').map((c) => c.input);
  beforeEach(() => {
    resetSignIns();
    backend.script('connectors.signInDynamicServer', () => ({ opId: 'op-d' }));
    backend.script('connectors.signInServer', () => ({ opId: 'op-f' }));
  });
  const signInOf = async (name: string) => within(await row(name)).findByRole('button', { name: `Sign in to ${name}` });

  it('offers Sign in on a plugin’s row and on one of MAWS’s own list, and signs each in by its name; the line under it follows the sign-in', async () => {
    backend.script('session.mcpStatus', () => ({ mcpServers: [dynamicServer(PLUGIN), dynamicServer('fx-own')] }));
    mount();
    fireEvent.click(await signInOf(PLUGIN));
    await waitFor(() => expect(sent()).toEqual([{ name: PLUGIN, appSessionId: BARE }]));
    act(() => heard({ opId: 'op-d', name: PLUGIN, state: 'waiting_callback', reason: null, message: null, where: null }, Date.now(), null));
    await waitFor(async () => expect((await row(PLUGIN)).querySelector('[data-sign-in-state]')?.textContent).toBe('Finish signing in in your browser…'));
    expect((await row('fx-own')).querySelector('[data-sign-in-state]')).toBeNull(); // another connector's sign-in
    fireEvent.click(await signInOf('fx-own'));
    await waitFor(() => expect(sent()).toEqual([{ name: PLUGIN, appSessionId: BARE }, { name: 'fx-own', appSessionId: BARE }]));
    expect(backend.calls.filter((c) => c.command === 'connectors.signInServer')).toEqual([]);
  });

  it('offers none for the claudeai and managed scopes, nor for a dynamic name past the 128 characters the command takes', async () => {
    const long = `plugin:fx-plugin:${'x'.repeat(112)}`; // 129 characters
    backend.script('session.mcpStatus', () => ({ mcpServers: [server('fx-claude', 'needs-auth', { scope: 'claudeai' }), server('fx-managed', 'needs-auth', { scope: 'managed' }), server('fx-enterprise', 'needs-auth', { scope: 'enterprise' }), dynamicServer(long), dynamicServer('fx-own')] }));
    mount();
    await signInOf('fx-own');
    for (const name of ['fx-claude', 'fx-managed', 'fx-enterprise', long]) expect(within(await row(name)).queryByRole('button', { name: `Sign in to ${name}` }), name).toBeNull();
  });

  it('is disabled with its sentence for a session on another machine, a file-scope row beside it keeping its Sign in', async () => {
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
    useSessions.setState({ engine: new Map([[REMOTE, { ...backend.status(BARE), appSessionId: REMOTE }]]), listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, BARE), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
    backend.script('session.mcpStatus', () => ({ mcpServers: [dynamicServer(PLUGIN), server('tickets', 'needs-auth')] }));
    try {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <McpWidget appSessionId={REMOTE} args="" close={() => {}} />
        </QueryClientProvider>,
      );
      const dynamic = await signInOf(PLUGIN);
      expect(dynamic).toHaveProperty('disabled', true);
      expect(dynamic.title).toBe(NOT_YET);
      fireEvent.click(dynamic);
      const file = await signInOf('tickets');
      expect(file).toHaveProperty('disabled', false);
      fireEvent.click(file);
      await waitFor(() => expect(backend.calls.filter((c) => c.command === 'connectors.signInServer')).toHaveLength(1));
      expect(sent()).toEqual([]);
    } finally {
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    }
  });
});
