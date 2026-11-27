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
import { accessibleDescription, accessibleText } from '../test-support/accessible-text';
import { McpBody, McpWidget, present, toggleView } from './McpWidget';

const ROOT = join(__dirname, '../../../..');
// P5 O6 M2: the backend is main (bare ids); the page holds the address
const BARE = 'app-7412a115' as AppSessionId;
const ID = at(BARE);
const lifted = (status: EngineSessionStatus): EngineSessionStatus => ({ ...status, appSessionId: at(status.appSessionId) });
const DOCS = 'openaiDeveloperDocs';
const TURN: EngineSessionStatus['turn'] = { id: 'ev-turn-open' as never, origin: 'human', startedAt: '2026-11-01T10:00:00Z', acceptedAt: null, userMessageUuids: [] };
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
  // the word cut (P569, P570): Reconnect keeps its word with a quiet spinner beside it while it works, and a success says
  // nothing under the row
  it('calls session.mcpReconnect for the server, shows its spinner, and reads mcp_status again on completion', async () => {
    backend.holdOperations(true);
    mount();
    fireEvent.click(disclosure(await row(DOCS))); // U11a: a connected row's Reconnect is in its opened part
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: 'Reconnect' }));
    const reconnect = within(await row(DOCS)).getByRole('button', { name: /^Reconnect/ });
    expect(await within(reconnect).findByRole('progressbar', { name: 'Working…' })).toBeTruthy();
    expect(reconnect.getAttribute('aria-busy')).toBe('true');
    expect(within(await row(DOCS)).queryByRole('status')).toBeNull();
    expect(backend.calls.find((c) => c.subtype === 'mcp_reconnect')?.input).toEqual({ appSessionId: BARE, serverName: DOCS });
    expect(reads()).toBe(1);
    act(() => void backend.settleOperations());
    await waitFor(() => expect(reads()).toBe(2));
    await waitFor(async () => expect(within(await row(DOCS)).queryByRole('progressbar')).toBeNull());
    expect(within(await row(DOCS)).queryByRole('status')).toBeNull();
    expect((await row(DOCS)).textContent).not.toContain('Reconnected');
  });
});

describe('mcp toggle reads its state back after either outcome', () => {
  it('Toggle off: session.mcpToggle { enabled: false }, one mcp_status after the outcome, and the switch reads it', async () => {
    backend.holdOperations(true);
    mount();
    const docs = await serverSwitch(DOCS);
    expect(docs.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(docs);
    // the word cut (P569, P570): the switch's knob spins while it works, and a success says nothing under the row
    expect(await within(docs).findByRole('progressbar', { name: 'Working…' })).toBeTruthy();
    expect(docs.getAttribute('aria-busy')).toBe('true');
    expect(within(await row(DOCS)).queryByRole('status')).toBeNull();
    expect(backend.calls.find((c) => c.subtype === 'mcp_toggle')?.input).toEqual({ appSessionId: BARE, serverName: DOCS, enabled: false });
    expect(reads()).toBe(1);
    act(() => void backend.settleOperations());
    await waitFor(async () => expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('false'));
    await new Promise((r) => setTimeout(r, 20));
    expect(reads()).toBe(2); // exactly one read-back after the outcome
    expect(within(await row(DOCS)).queryByRole('status')).toBeNull();
    expect((await row(DOCS)).textContent).not.toContain('Done');
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

  // P570 keeps the late correction (the word cut's fix wave for M4): a toggle that timed out and then succeeded, its second
  // read-back confirming the requested position, says "Applied after all"
  it('a toggle that timed out and then succeeded reads Applied after all once its read-back confirms it', async () => {
    backend.scriptOutcome('session.mcpToggle', () => ({ ok: false, error: { code: 'timeout', message: 'mcp_toggle unanswered after 8 s', engineCode: null } }));
    mount();
    fireEvent.click(await serverSwitch(DOCS));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Unconfirmed · mcp_toggle unanswered after 8 s · timeout'));
    backend.script('session.mcpStatus', () => withServer(DOCS, { status: 'disabled' }));
    act(() => backend.emitOperation({ appSessionId: BARE, opId: 'op-1', command: 'session.mcpToggle', late: true, outcome: { ok: true, value: null as never } }));
    await waitFor(async () => expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('false'));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Applied after all'));
  });

  // P570: the correction is said only over a read-back that confirms with nothing of its own to say; an enable that
  // persisted late and then failed to connect keeps its failure's words
  it('a toggle that timed out, succeeded late and then failed to connect keeps its failure’s words', async () => {
    let answer: McpAnswer = withServer(DOCS, { status: 'disabled' });
    backend.script('session.mcpStatus', () => answer);
    backend.scriptOutcome('session.mcpToggle', () => ({ ok: false, error: { code: 'timeout', message: 'mcp_toggle unanswered after 8 s', engineCode: null } }));
    mount();
    const docs = await serverSwitch(DOCS);
    await waitFor(() => expect(docs.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(docs);
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('Unconfirmed · mcp_toggle unanswered after 8 s · timeout'));
    answer = withServer(DOCS, { status: 'failed', error: 'Connection failed' });
    act(() => backend.emitOperation({ appSessionId: BARE, opId: 'op-1', command: 'session.mcpToggle', late: true, outcome: { ok: true, value: null as never } }));
    await waitFor(async () => expect((await statusOf(DOCS)).textContent).toBe('On · not connected · Connection failed'));
    expect((await serverSwitch(DOCS)).getAttribute('aria-checked')).toBe('true');
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
        expect(control.getAttribute('aria-disabled')).toBe('true'); // greyed, it keeps Tab and says why
        expect(accessibleDescription(control)).toBe('mini doesn’t offer this');
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
      ['calendar', 'Connecting…'], // the word cut (P565): its words, since nothing can end the wait of an idle session's answered read
      ['files', null], // disabled: the switch says it
    ]);
    for (const unopened of ['example.test', 'files-mcp', 'scope ', 'from ', 'find_note', 'Connection refused']) expect(list.textContent).not.toContain(unopened);
    const [notes, , , , files] = rows;
    fireEvent.click(disclosure(notes));
    expect(disclosure(notes).getAttribute('aria-expanded')).toBe('true');
    for (const opened of ['http · https://notes.example.test/mcp', 'from user', 'scope user', 'find_note, write_note']) expect(notes.textContent).toContain(opened);
    fireEvent.click(disclosure(files));
    const transport = within(files).getByText('stdio · …/files-mcp --root …/work').closest<HTMLElement>('[tabindex="0"]')!; // the whole command line is its tip, which focus reaches
    expect(accessibleDescription(transport)).toBe('/opt/tools/bin/files-mcp --root /work');
    expect(files.textContent).toContain('scope project');
  });

  // the word cut (N148): what the switch reaches is each switch row's note, opened on pointing or focus and its
  // description at rest; nothing of it in the head, and no tooltip of where the engine records it
  it('makes what the switch reaches each switch row’s note, with nothing in the head', async () => {
    mount();
    await screen.findByRole('list', { name: 'Connectors' });
    const header = document.querySelector<HTMLElement>('[data-widget="mcp"] header')!;
    expect(header.querySelector('h3')?.textContent).toBe('Connectors');
    expect(header.querySelector('[data-widget-subtitle]')?.textContent).toBe('MCP servers');
    const notes = await row('notes');
    await waitFor(() => expect(accessibleDescription(notes)).toMatch(/^A switch here is for this chat, and every session started in .+ afterwards\./));
    expect(header.textContent).not.toContain('A switch here');
    const note = notes.querySelector<HTMLElement>('[data-row-note]')!;
    expect(note.hidden).toBe(true);
    act(() => within(notes).getByRole('switch').focus());
    expect(note.hidden).toBe(false);
  });

  // N148: the tooltip that named where the engine records the switch goes with the sentence into the note
  it('says in the row note where the engine records the switch, and nowhere at rest', async () => {
    mount();
    const notes = await row('notes');
    await waitFor(() => expect(accessibleDescription(notes)).toMatch(/afterwards\. The engine records it in ~\/\.claude\.json\.$/));
    expect(accessibleText(document.querySelector<HTMLElement>('[data-widget="mcp"]')!)).not.toContain('~/.claude.json');
    expect(document.querySelector('[data-widget="mcp"] header')?.textContent).not.toContain('~/.claude.json');
  });

  // P565 (the word cut's fix wave for M4): a connecting connector spins only while something can still end its wait, a
  // read out or an open turn, whose close reads again. The engine host asks once at ready, so an idle session's
  // answered read brings nothing more: its words stand
  it('spins for a connecting connector only while a read is out or a turn is open', async () => {
    mount();
    const state = async () => (await row('calendar')).querySelector<HTMLElement>('[data-connector-state]')!;
    await waitFor(async () => expect((await state()).textContent).toBe('Connecting…'));
    expect(within(await state()).queryByRole('progressbar')).toBeNull();
    act(() => useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), turn: TURN }]]) }));
    expect(await within(await state()).findByRole('progressbar', { name: 'Connecting…' })).toBeTruthy();
    const before = reads();
    act(() => useSessions.setState({ engine: new Map([[ID, lifted(backend.status(BARE))]]) }));
    await waitFor(() => expect(reads()).toBeGreaterThan(before)); // the turn's close reads again
    await waitFor(async () => expect((await state()).textContent).toBe('Connecting…'));
  });

  // P565: the quiet spinner stands only while something can still end the wait: once the session's process exits the
  // frame keeps its last answer, and a connector that was connecting then says so in words, dated by the frame
  it('settles a connecting connector to its words when the session exits', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), turn: TURN }]]) });
    mount();
    const calendar = await row('calendar');
    const state = () => calendar.querySelector<HTMLElement>('[data-connector-state]')!;
    expect(await within(state()).findByRole('progressbar', { name: 'Connecting…' })).toBeTruthy();
    act(() => useSessions.setState({ engine: new Map([[ID, { ...lifted(backend.status(BARE)), process: 'exited' }]]) }));
    await waitFor(async () => expect(within((await row('calendar')).querySelector<HTMLElement>('[data-connector-state]')!).queryByRole('progressbar')).toBeNull());
    expect((await row('calendar')).querySelector('[data-connector-state]')?.textContent).toBe('Connecting…');
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

  // P565: Customize's live list spins for a connecting connector only over a live session
  it('spins for a connecting connector in the list without actions only when the session is live', async () => {
    const view = present({ mcpServers: [server('calendar', 'pending')] } as unknown as McpStatusResponse);
    const { rerender } = render(<McpBody view={view} live />);
    expect(await screen.findByRole('progressbar', { name: 'Connecting…' })).toBeTruthy();
    rerender(<McpBody view={view} live={false} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(lineOf(screen.getByRole('listitem'))).toEqual(['calendar', 'Connecting…']);
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
  // P569: a connected row's Reconnect is in its opened part; folding the row while Reconnect is out keeps its spinner on
  // the row's line, and opening it again shows the one beside Reconnect only
  it('keeps one Reconnect spinner on a connected row folded while Reconnect is out', async () => {
    backend.holdOperations(true);
    mount();
    fireEvent.click(disclosure(await row(DOCS)));
    fireEvent.click(within(await row(DOCS)).getByRole('button', { name: 'Reconnect' }));
    expect(await within(await row(DOCS)).findByRole('progressbar', { name: 'Working…' })).toBeTruthy();
    fireEvent.click(disclosure(await row(DOCS)));
    expect(within(await row(DOCS)).queryByRole('button', { name: /^Reconnect/ })).toBeNull();
    expect(await within(await row(DOCS)).findByRole('progressbar', { name: 'Working…' })).toBeTruthy();
    fireEvent.click(disclosure(await row(DOCS)));
    await waitFor(async () => expect(within(await row(DOCS)).getAllByRole('progressbar')).toHaveLength(1));
    expect(within(within(await row(DOCS)).getByRole('button', { name: /^Reconnect/ })).getByRole('progressbar')).toBeTruthy();
    act(() => void backend.settleOperations());
    fireEvent.click(disclosure(await row(DOCS)));
    await waitFor(async () => expect(within(await row(DOCS)).queryByRole('progressbar')).toBeNull());
  });

  it('disables that row’s switch and Reconnect while a toggle is out, and the answer lands under the row closed meanwhile', async () => {
    backend.holdOperations(true);
    mount();
    const docs = await row(DOCS);
    fireEvent.click(disclosure(docs));
    fireEvent.click(within(docs).getByRole('switch'));
    expect(await within(docs).findByRole('progressbar', { name: 'Working…' })).toBeTruthy();
    expect(within(docs).getByRole('switch')).toHaveProperty('disabled', true);
    expect(within(docs).getByRole('button', { name: 'Reconnect' })).toHaveProperty('disabled', true);
    fireEvent.click(disclosure(docs));
    expect(disclosure(docs).getAttribute('aria-expanded')).toBe('false');
    act(() => void backend.settleOperations());
    await waitFor(async () => expect(within(await row(DOCS)).queryByRole('progressbar')).toBeNull());
    expect(within(await row(DOCS)).queryByRole('status')).toBeNull();
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
  // the word cut (N148): the sentence is a switch row's note, read from its description
  const head = async () => {
    const docs = await row(DOCS);
    return waitFor(() => {
      const said = accessibleDescription(docs);
      expect(said).not.toBe('');
      return said;
    });
  };
  const gitReads = () => backend.calls.filter((c) => c.command === 'git.worktree.list').map((c) => c.input);
  afterEach(() => useSessions.setState({ records: new Map(), projects: new Map() }));

  it('names the project when the session’s record names one, also for a session in a worktree, and reads no git', async () => {
    backend.script('git.worktree.list', () => listed(WORKTREE));
    inFolder(WORKTREE);
    useSessions.setState({ records: new Map([[ID, record(ID, { projectId: 'p-atlas' as ProjectId, directory: MAIN })]]), projects: new Map([['p-atlas' as ProjectId, project('p-atlas', 0, { name: 'Atlas', directory: MAIN })]]) });
    mount();
    expect(await head()).toBe('A switch here is for this chat, and every session started in Atlas afterwards. The engine records it in ~/.claude.json.');
    expect(gitReads()).toEqual([]);
  });

  it('names the main root of the repository holding the folder when no project is named, the home abbreviated', async () => {
    backend.script('git.worktree.list', () => listed(WORKTREE));
    inFolder(WORKTREE);
    mount();
    expect(await head()).toBe('A switch here is for this chat, and every session started in ~/code/atlas afterwards. The engine records it in ~/.claude.json.');
    expect(gitReads()).toEqual([{ repoRoot: WORKTREE }]);
  });

  it('names the session’s folder when it is in no repository, and when the main root cannot be read', async () => {
    backend.script('git.worktree.list', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'not a git repository' });
    });
    inFolder('/Users/example/scratch/plain');
    mount();
    expect(await head()).toBe('A switch here is for this chat, and every session started in ~/scratch/plain afterwards. The engine records it in ~/.claude.json.');
    cleanup();
    backend.script('git.worktree.list', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'git answered nothing' });
    });
    inFolder(`${MAIN}/sub`);
    mount();
    expect(await head()).toBe('A switch here is for this chat, and every session started in ~/code/atlas/sub afterwards. The engine records it in ~/.claude.json.');
  });
});

// U11a M6 review: the switch reaches this chat and every session started afterwards in the place the head names, so it
// waits for that sentence; a read of the main root that is out holds both back, while Reconnect, which reaches this
// session only, stays available.
describe('the switch waits for the sentence of what it reaches (U11a §C)', () => {
  const MAIN = '/Users/example/code/atlas';
  const WORKTREE = `${MAIN}/.claude/worktrees/feature`;
  const note = () => {
    const docs = document.querySelector<HTMLElement>(`[data-mcp-server="${DOCS}"]`);
    return docs && docs.hasAttribute('data-note-row') ? { textContent: accessibleDescription(docs) } : null;
  };
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
    await waitFor(() => expect(note()?.textContent).toBe('A switch here is for this chat, and every session started in ~/code/atlas afterwards. The engine records it in ~/.claude.json.'));
    expect(within(docs).getByRole('switch')).toHaveProperty('disabled', false);
  });

  it('enables the switch with the folder’s sentence when the read fails', async () => {
    const docs = await heldOpen();
    await act(async () => settle.reject(new WidgetBackendError({ code: 'internal', message: 'not a git repository' })));
    await waitFor(() => expect(note()?.textContent).toBe('A switch here is for this chat, and every session started in ~/code/atlas/.claude/worktrees/feature afterwards. The engine records it in ~/.claude.json.'));
    expect(within(docs).getByRole('switch')).toHaveProperty('disabled', false);
  });
});

describe('the "+" menu’s entries to the dialogs (U11a §C)', () => {
  // the word cut (C18): inside its own submenu, the entry no longer repeats the submenu's name
  it('reads In this chat… in the Connectors and the Plugins submenu', async () => {
    for (const [submenu, entry] of [['Connectors', /^In this chat…/], ['Plugins', /^In this chat…/]] as const) {
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
    // the word cut (P570): a success says nothing
    expect(toggleView(false, ok, { status: 'disabled', error: null })).toEqual({ position: 'off', line: null });
    expect(toggleView(true, ok, { status: 'pending', error: null })).toEqual({ position: 'on', line: null });
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
      expect(dynamic.getAttribute('aria-disabled')).toBe('true');
      expect(accessibleDescription(dynamic)).toBe(NOT_YET);
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
