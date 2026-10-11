// Session info (C11 execution document, Interfaces "Session info tool"; M4's pins): the six sections over a scenario
// session answered by the fixture-backed widget backend, the pinned account named, a direct session's login, no reads
// while the tab is hidden, and the empty state without a session. W2: the Route row's switch (the status line's usage
// popover footer carried it), a Direct session's get_usage poll while the tab is shown, and the pace line.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V13 } from '@shared/settings/defaults';
import type { UsageSnapshot } from '@shared/usage/types';
import { digest } from '../../../../../test/support/builders';
import { useReadLoads } from '../../widgets/read';
import { loadScenario } from '../../../../../test/support/scenario';
import { createWidgetBackend, fixtureLine, RESPONSES, type WidgetBackend } from '../../../../../test/support/widget-backend';
import { useGateway } from '../../gateway/store';
import { answerSwitch } from '../../gateway/switch-route';
import { panelHost } from '../../panel/host';
import { useSetup } from '../../sessions/store';
import { useSettings } from '../../stores/settings';
import { intent } from '../../test-support/setup-intents';
import type { PanelToolContext } from '../../panel/tool';
import { rememberListedModels, useComposerStore, type ListedModel } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore, type TranscriptEntry } from '../../stores/transcript';
import { useUsage } from '../../stores/usage';
import { applyEvents, createState } from '../../transcript/model/reduce';
import { builder, tool } from '../../transcript/model/test-events';
import { sessionInfoTool } from '.';
// E4a start
import { browserTab, T1, T2, T3 } from '../../test-support/browser';
import { browser, resetBrowser } from '../browser/store';
import { REL } from '../../test-support/relative-time';
// E4a end

const ROOT = join(__dirname, '../../../../..');
const READY = 'app-7412a115' as AppSessionId; // Settings idle probe: ready, idle, routed, auto
const scenario = loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));
const record = scenario.sessions.find((r) => r.appId === READY)!;
let backend: WidgetBackend;

const snapshot: UsageSnapshot = {
  available: true, dataDir: '/x', readAt: '2026-09-29T07:36:17Z', error: null, drainTarget: 'u3', drainTargetIsManual: false,
  accounts: [
    { uuid: 'u1', email: '1@example.test', displayName: '1', planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 1, credentialOwnership: null, windows: { fiveHour: null, sevenDay: null, scoped: [] } },
    { uuid: 'u3', email: '3@example.test', displayName: '3', planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 8, credentialOwnership: null, windows: { fiveHour: null, sevenDay: null, scoped: [] } },
  ],
  pinsFor: { [record.engineSessionId!]: 'u1' }, gateway: null, codex: null, activity: null,
};

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: scenario.engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[READY, backend.status(READY)]]), records: new Map([[READY, record]]), digests: new Map() });
  useUsage.getState().applySnapshot(snapshot);
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map() });
  useGateway.setState({ switching: new Map(), directLogin: new Map() }); // W2
  useSetup.setState({ intents: new Map(), phases: new Map(), invoking: new Set() }); // W2
  useSettings.setState({ state: null }); // W2
  useReadLoads.setState({ loads: new Map() }); // P2-A
  delete (window as { maws?: MawsBridge }).maws;
});

const ctxOf = (appSessionId: AppSessionId | null, visible = true): PanelToolContext => ({
  appSessionId, session: appSessionId ? record : null, status: null, pinned: false, visible, focusRequest: 0, setTitle: () => {}, close: () => {}, openTool: panelHost.addTool,
});
const mount = (ctx: PanelToolContext) => {
  const View = sessionInfoTool.render;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <View state={sessionInfoTool.createState({ appSessionId: ctx.appSessionId, session: ctx.session, instanceId: 'session-info:t', params: undefined })} ctx={ctx} />
    </QueryClientProvider>,
  );
};
// The value beside a key, with its note.
const valueOf = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent ?? '';

describe('session info renders the six sections', () => {
  it('Engine, Model, Gateway, Permissions, Context·usage·cost, Hooks and MCP over a routed scenario session', async () => {
    mount(ctxOf(READY));
    for (const title of ['Engine', 'Model', 'Gateway', 'Permissions', 'Context, usage, cost', 'Hooks and MCP']) expect(screen.getByRole('region', { name: title })).toBeTruthy();
    const labels = screen.getAllByRole('term').map((t) => t.textContent);
    expect(labels).toEqual(['Version', 'Binary', 'Session id', 'Held by' /* W7 */, 'Process tree', 'Memory budget' /* C12 */, 'Browser tabs' /* E4a */, 'Main', 'Subagents', 'Route', 'Account', 'Tool search', 'Mode', 'Auto-mode lane', 'Rules', 'Context', 'Usage', 'Cost', 'Hooks', 'MCP']);
    expect(valueOf('Version')).toBe('2.1.283'); // W13: the session's own, no pin note
    expect(valueOf('Binary')).toBe('~/.local/share/claude/versions/2.1.283'); // W13: the file it was spawned from, not today's setting
    expect(valueOf('Session id')).toBe(record.engineSessionId);
    expect(valueOf('Main')).toBe('claude-sonnet-5[1m]');
    expect(valueOf('Subagents')).toBe("each agent's own, else Main"); // W3: no "engine default"
    expect(valueOf('Route')).toBe('Gateway · ClaudeUsage relay · http://127.0.0.1:8641Switch to Direct…'); // W2: the switch
    expect(valueOf('Account')).toBe('1@example.test · pinned for this session');
    expect(valueOf('Tool search')).toBe('on · ENABLE_TOOL_SEARCH, needed behind a base URL');
    expect(valueOf('Mode')).toBe('Auto · effective, from the init frame');
    // the stores first, the reads as they answer
    // the engine's summary (pass1/reads seq 57: 30,433, 15 %) corrected as C3 corrects its sample: 21,507 measured + 1
    await waitFor(() => expect(valueOf('Context')).toBe('21,508 of 200,000 · 11% · autocompact at 167,000'));
    // C3 has not read the row for this scenario status; Session info's own get_status answer (auto-routed seq 145) has
    await waitFor(() => expect(valueOf('Auto-mode lane')).toBe('Server · reviews ride on the main request · no charge · model chosen server-side'));
    await waitFor(() => expect(valueOf('Rules')).toMatch(/^1 allow · 1 ask · 0 deny · 0 session grants/));
    await waitFor(() => expect(valueOf('Hooks')).toBe('1 settings hook · 0 plugin hooks'));
    await waitFor(() => expect(valueOf('MCP')).toMatch(/^3 connected · plugin:ptc:ptc \(stdio\), .*openaiDeveloperDocs \(http\)/));
    expect(within(screen.getByRole('region', { name: 'Permissions' })).getByRole('button', { name: '/permissions' })).toBeTruthy();
  });

  // Debt wave 3: C3 samples the context at ready and after every turn (`context.sample` → the digest), so the row reads
  // the digest and asks the engine only while no sample has arrived.
  it('reads the context from the digest once C3 has sampled it, with no read of its own', async () => {
    const digest = { appSessionId: READY, context: { percent: 21.4, totalTokens: 42_812, maxTokens: 200_000, autoCompactThreshold: 167_000 } };
    useSessions.setState({ digests: new Map([[READY, digest as never]]) });
    mount(ctxOf(READY));
    expect(valueOf('Context')).toBe('42,812 of 200,000 · 21% · autocompact at 167,000');
    await waitFor(() => expect(valueOf('Rules')).toMatch(/^1 allow/)); // the other reads answered meanwhile
    expect(backend.calls.filter((c) => c.command === 'session.getContextUsage')).toEqual([]);
    expect(backend.calls.filter((c) => c.command === 'engine.models'), 'the lane reads the listed models only').toEqual([]);
  });

  // Whole-branch review: after a set_model the engine accepted and before the next init frame, the Main row names the
  // requested model, pending in the model widget's words, as the lane does; once the frame resolves it, the resolved id.
  it('names the requested model as pending until an init frame resolves it, agreeing with the lane', async () => {
    const catalogue = (fixtureLine(ROOT, RESPONSES.list_models) as { models: ListedModel[] }).models;
    rememberListedModels(READY, catalogue);
    const status = backend.status(READY);
    useSessions.setState({ engine: new Map([[READY, { ...status, model: { requested: 'claude/astra', resolved: 'claude-sonnet-5[1m]' } }]]) });
    mount(ctxOf(READY));
    expect(valueOf('Main')).toMatch(/^claude\/astra( · \w+)? · set · the next init frame confirms it$/);
    expect(valueOf('Auto-mode lane')).toMatch(/^Local \(expected\)/);
    cleanup();
    useSessions.setState({ engine: new Map([[READY, { ...status, model: { requested: 'sonnet', resolved: 'claude-sonnet-5[1m]' } }]]) });
    mount(ctxOf(READY));
    expect(valueOf('Main')).not.toContain('set · the next init frame confirms it'); // the alias resolved: confirmed
    expect(valueOf('Main')).toMatch(/^claude-sonnet-5\[1m\]/);
    useComposerStore.setState({ models: new Map() });
  });

  it('counts the reviews only while the transcript holds rows for the session', async () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a', 'Bash', { command: 'ls' });
    b.emit('tool.safeguard', { toolUseId: tool('a'), verdict: 'flagged', lane: 'server' });
    const state = applyEvents(createState(null, null), b.events);
    const entry = (rows: unknown[]) => ({ state, rows, phase: 'live', error: null, following: true, working: false, clock: null, jump: null }) as unknown as TranscriptEntry;
    useTranscriptStore.setState({ entries: { [READY]: entry([{}]) } });
    mount(ctxOf(READY));
    await waitFor(() => expect(valueOf('Auto-mode lane')).toMatch(/ · 1 tool call evaluated, 1 flagged$/));
    cleanup();
    useTranscriptStore.setState({ entries: { [READY]: entry([]) } });
    mount(ctxOf(READY));
    await waitFor(() => expect(valueOf('Auto-mode lane')).toMatch(/^Server/));
    expect(valueOf('Auto-mode lane')).not.toContain('evaluated');
    useTranscriptStore.setState({ entries: {} });
  });

  it('names the overrides when the launch passed some, and the subagent model chosen at launch', () => {
    useSessions.setState({ engine: new Map([[READY, { ...backend.status(READY), subagentModel: 'haiku', modelOverrides: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5' } }]]) });
    mount(ctxOf(READY));
    expect(valueOf('Subagents')).toBe('haiku · CLAUDE_CODE_SUBAGENT_MODEL, chosen at launch');
    expect(valueOf('Overrides')).toBe('ANTHROPIC_DEFAULT_OPUS_MODEL → claude-opus-5-5 · passed through from your shell');
  });

  it("a direct session reads the engine's own login from its get_status (routing-flag-override seq 12)", async () => {
    const direct: EngineSessionStatus = { ...backend.status(READY), gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'enabled', localLane: null } };
    useSessions.setState({ engine: new Map([[READY, direct]]) });
    backend.script('session.getStatus', () => fixtureLine(ROOT, 'pass2/routing-flag-override#12'));
    mount(ctxOf(READY));
    await waitFor(() => expect(valueOf('Route')).toBe("Direct · engine's own login · Expired — log in againSwitch to gateway…")); // W2: the switch
    expect(valueOf('Email')).toBe('owner@redacted.invalid');
    expect(valueOf('Tool search')).toBe('off');
    expect(screen.queryByText('Account', { selector: 'dt' })).toBeNull();
  });

  it('reads nothing while the tab is hidden, and says what to do without a session', async () => {
    mount(ctxOf(READY, false));
    await new Promise((r) => setTimeout(r, 30));
    expect(backend.calls.filter((c) => c.command.startsWith('session.'))).toEqual([]);
    expect(valueOf('Route')).toBe('Gateway · ClaudeUsage relay · http://127.0.0.1:8641Switch to Direct…'); // the stores render at once
    cleanup();
    mount(ctxOf(null));
    expect(screen.getByText('Open a session to see its details')).toBeTruthy();
  });
});

// P2-A start (2026-10-09; X17): with no live process the sections show what the engine last reported, each labelled
// with when, and "Not observed yet" for a session MAWS never ran; the record's requested values are never shown as
// observed, and no engine read runs
describe('session info of a session with no live process', () => {
  const ago = (ms: number) => new Date(Date.now() - ms - 60_000).toISOString();
  const facts = (over: Record<string, unknown>) => ({
    version: 1, appSessionId: READY, engineSessionId: null, writtenAt: ago(0), source: 'journal', launches: ['L1'],
    engineVersion: null, model: null, effort: null, mode: null, outputStyle: null, plugins: null, contextUsage: null, complete: true, ...over,
  });
  const offline = () => useSessions.setState({ engine: new Map(), records: new Map([[READY, record]]), digests: new Map() });

  it('labels the observed model, effort, mode, output style, plugin count and context with when', async () => {
    offline();
    const days = ago(2 * 86_400_000);
    const hours = ago(3 * 3_600_000);
    backend.script('session.observedFacts', () =>
      facts({
        model: { value: 'claude-haiku-4-5', at: days, launchId: 'L1' }, effort: { value: 'high', at: hours, launchId: 'L1' }, mode: { value: 'plan', at: hours, launchId: 'L1' },
        outputStyle: { value: 'Explanatory', at: days, launchId: 'L1' }, plugins: { value: { plugins: [{ name: 'p', path: '/p', source: null, version: null }], errors: [], warnings: [] }, at: days, launchId: 'L1' },
        contextUsage: { value: { percent: 21.4, totalTokens: 42_812, maxTokens: 200_000, autoCompactThreshold: 167_000 }, at: hours, launchId: 'L1' },
      }),
    );
    mount(ctxOf(READY));
    await waitFor(() => expect(valueOf('Main')).toBe(`claude-haiku-4-5 · Last observed ${REL.ago(2, 'day')}`));
    expect(valueOf('Effort')).toBe(`high · Last observed ${REL.ago(3, 'hour')}`); // its own age, not the model's
    expect(valueOf('Output style')).toBe(`Explanatory · Last observed ${REL.ago(2, 'day')}`);
    expect(valueOf('Plugins')).toBe(`1 loaded · Last observed ${REL.ago(2, 'day')}`);
    expect(valueOf('Mode')).toBe(`Plan · Last observed ${REL.ago(3, 'hour')}`);
    expect(valueOf('Context')).toBe(`42,812 of 200,000 · 21% · autocompact at 167,000 · Last observed ${REL.ago(3, 'hour')}`);
    expect(screen.queryByText(/Not running in this app/)).toBeNull();
    expect(backend.calls.filter((c) => c.command !== 'session.observedFacts' && c.command.startsWith('session.get'))).toEqual([]);
  });

  it('reads "Not observed yet" where a fact would be for a session MAWS never ran, never the record’s defaults', async () => {
    offline();
    backend.script('session.observedFacts', () => null);
    mount(ctxOf(READY));
    await waitFor(() => expect(valueOf('Main')).toBe('Not observed yet'));
    for (const label of ['Effort', 'Output style', 'Plugins', 'Mode', 'Context']) expect(valueOf(label)).toBe('Not observed yet');
  });

  // M3: the Refresh is the owner's gesture; opening the tab starts nothing
  it('offers Refresh, which acquires the session for a read; opening it acquired nothing', async () => {
    offline();
    backend.script('session.observedFacts', () => null);
    mount(ctxOf(READY));
    await waitFor(() => expect(valueOf('Main')).toBe('Not observed yet'));
    const acquires = () => backend.calls.filter((c) => c.command === 'session.acquire').map((c) => c.input);
    expect(acquires()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(acquires()).toEqual([{ appSessionId: READY, reason: 'read' }]));
  });

  // M3 review (§10 Q7, acceptance 6): a terminal holding the session: its facts read-only, the holder's actions in place of Refresh
  it('a session a terminal holds names the holder and offers its actions where Refresh would be, starting nothing', async () => {
    useSessions.setState({ engine: new Map(), records: new Map([[READY, { ...record, holder: { kind: 'terminal', pid: 4711 } }]]), digests: new Map([[READY, digest(READY, { availability: 'foreign_held' })]]) });
    backend.script('session.observedFacts', () => null);
    mount(ctxOf(READY));
    await waitFor(() => expect(valueOf('Main')).toBe('Not observed yet'));
    expect(screen.getByText('Held by terminal · 4711')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take over here' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fork a copy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(backend.calls.filter((c) => c.command === 'session.acquire')).toEqual([]);
  });
});
// P2-A end

// W2 (C3; §5.5 as amended 2026-10-01): the status line is gone, so what only its usage popover's footer offered lives here.
describe('the route switch and the Direct poll, re-homed from the status line', () => {
  const settingsWith = (gateway: Partial<Settings['gateway']>) => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V13, gateway: { ...SETTINGS_DEFAULTS_V13.gateway, ...gateway } }, resolvedTheme: 'light' } as never });
  const route = () => screen.getByText('Route', { selector: 'dt' }).nextElementSibling as HTMLElement;

  it('a routed session’s Route offers Switch to Direct…, which opens the switch’s confirm', async () => {
    mount(ctxOf(READY));
    fireEvent.click(within(route()).getByRole('button', { name: 'Switch to Direct…' }));
    await vi.waitFor(() => expect(useGateway.getState().switching.get(READY)).toMatchObject({ phase: 'confirming', confirm: expect.anything() }));
    expect(answerSwitch(READY, null)).toBe(true);
  });

  it('offerDirect false hides Switch to Direct…; while the switch reads the status it says so and holds the button', () => {
    settingsWith({ offerDirect: false });
    mount(ctxOf(READY));
    expect(within(route()).queryByRole('button')).toBeNull();
    cleanup();
    settingsWith({});
    useGateway.setState({ switching: new Map([[READY, { target: 'direct', phase: 'confirming', confirm: null, error: null }]]) });
    mount(ctxOf(READY));
    expect(within(route()).getByRole('status').textContent).toBe('Checking the session…');
    expect((within(route()).getByRole('button', { name: 'Switch to Direct…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a failed switch says why and offers the retry; a session held elsewhere says where to switch it instead', () => {
    useGateway.setState({ switching: new Map([[READY, { target: 'direct', phase: 'failed', confirm: null, error: 'The process could not be stopped · gone' }]]) });
    mount(ctxOf(READY));
    expect(within(route()).getByRole('alert').textContent).toBe('The process could not be stopped · gone');
    expect(within(route()).getByRole('button', { name: 'Retry · Switch to Direct…' })).toBeTruthy();
    cleanup();
    useGateway.setState({ switching: new Map() });
    useSessions.setState({ records: new Map([[READY, { ...record, holder: { kind: 'terminal', pid: 7 } as never }]]) });
    mount(ctxOf(READY));
    expect(valueOf('Route')).toBe('Gateway · ClaudeUsage relay · http://127.0.0.1:8641 · Held by a terminal · switch it there');
    expect(within(route()).queryByRole('button')).toBeNull();
  });

  it('a session whose first launch is still under C10’s setup offers no restart: its route is the intent’s', () => {
    useSessions.setState({ engine: new Map(), records: new Map([[READY, { ...record, gateway: { ...record.gateway, routed: null } }]]) });
    useSetup.setState({ intents: new Map([[READY, intent({ appSessionId: READY })]]) });
    mount(ctxOf(READY));
    expect(within(route()).queryByRole('button')).toBeNull();
    cleanup();
    useSetup.setState({ intents: new Map() });
    mount(ctxOf(READY)); // an exited session whose route was never recorded: both, as the footer offered them
    expect(within(route()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Switch to gateway…', 'Switch to Direct…']);
  });

  it('a Direct session’s get_usage is read while the tab is shown, and not while it is hidden', async () => {
    const direct: EngineSessionStatus = { ...backend.status(READY), gateway: { mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'enabled', localLane: null } };
    useSessions.setState({ engine: new Map([[READY, direct]]) });
    mount(ctxOf(READY, false));
    await new Promise((r) => setTimeout(r, 30));
    expect(backend.calls.filter((c) => c.command === 'session.getUsage')).toEqual([]);
    cleanup();
    mount(ctxOf(READY));
    await waitFor(() => expect(backend.calls.filter((c) => c.command === 'session.getUsage').length).toBeGreaterThan(0));
    await waitFor(() => expect(useUsage.getState().direct.get(READY)).toBeTruthy());
  });
});

// E4a start: the Browser tabs row under Memory budget (E4a execution document, Design §12): the app's loaded pages from
// the browser store, any session's, with their sampled weight, outside the engine budget.
describe('session info names the browser’s loaded pages', () => {
  afterEach(() => resetBrowser());

  it('reads none, then the loaded tabs across sessions with the sum of their sampled working sets', () => {
    mount(ctxOf(READY));
    expect(valueOf('Browser tabs')).toBe('No tabs loaded');
    cleanup();
    const other = 'app-other' as AppSessionId;
    browser.setState({
      sessions: new Map([
        [READY, { tabs: [browserTab(T1, READY, { memoryKiB: 300 * 1024 }), browserTab(T2, READY, { suspended: true, memoryKiB: null })], selected: T1 }],
        [other, { tabs: [browserTab(T3, other, { memoryKiB: 112 * 1024 })], selected: T3 }],
      ]),
    });
    mount(ctxOf(READY));
    expect(valueOf('Browser tabs')).toBe('2 loaded · 412 MB · outside the engine budget');
  });
});
// E4a end
