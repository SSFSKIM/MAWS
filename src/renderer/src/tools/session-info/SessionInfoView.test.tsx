// Session info (C11 execution document, Interfaces "Session info tool"; M4's pins): the six sections over a scenario
// session answered by the fixture-backed widget backend, the pinned account named, a direct session's login, no reads
// while the tab is hidden, and the empty state without a session.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { UsageSnapshot } from '@shared/usage/types';
import { loadScenario } from '../../../../../test/support/scenario';
import { createWidgetBackend, fixtureLine, type WidgetBackend } from '../../../../../test/support/widget-backend';
import { panelHost } from '../../panel/host';
import type { PanelToolContext } from '../../panel/tool';
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore, type TranscriptEntry } from '../../stores/transcript';
import { useUsage } from '../../stores/usage';
import { applyEvents, createState } from '../../transcript/model/reduce';
import { builder, tool } from '../../transcript/model/test-events';
import { sessionInfoTool } from '.';

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
  pinsFor: { [record.engineSessionId!]: 'u1' },
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
    expect(labels).toEqual(['Version', 'Binary', 'Session id', 'Process tree', 'Main', 'Subagents', 'Route', 'Account', 'Tool search', 'Mode', 'Auto-mode lane', 'Rules', 'Context', 'Usage', 'Cost', 'Hooks', 'MCP']);
    expect(valueOf('Version')).toBe('2.1.283 · pinned');
    expect(valueOf('Session id')).toBe(record.engineSessionId);
    expect(valueOf('Main')).toBe('claude-sonnet-5[1m]');
    expect(valueOf('Subagents')).toBe('engine default');
    expect(valueOf('Route')).toBe('Gateway · ClaudeUsage relay · http://127.0.0.1:8641');
    expect(valueOf('Account')).toBe('1@example.test · pinned for this session');
    expect(valueOf('Tool search')).toBe('on · ENABLE_TOOL_SEARCH, needed behind a base URL');
    expect(valueOf('Mode')).toBe('auto · effective, from the init frame');
    // the stores first, the reads as they answer
    await waitFor(() => expect(valueOf('Context')).toBe('30,433 of 200,000 · 15% · autocompact at 167,000'));
    // C3 has not read the row for this scenario status; Session info's own get_status answer (auto-routed seq 145) has
    await waitFor(() => expect(valueOf('Auto-mode lane')).toBe('Server · reviews ride on the main request · no charge · model chosen server-side'));
    await waitFor(() => expect(valueOf('Rules')).toMatch(/^1 allow · 1 ask · 0 deny · 0 session grants/));
    await waitFor(() => expect(valueOf('Hooks')).toBe('1 settings hook · 0 plugin hooks'));
    await waitFor(() => expect(valueOf('MCP')).toMatch(/^3 connected · plugin:ptc:ptc \(stdio\), .*openaiDeveloperDocs \(http\)/));
    expect(within(screen.getByRole('region', { name: 'Permissions' })).getByRole('button', { name: '/permissions' })).toBeTruthy();
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
    await waitFor(() => expect(valueOf('Route')).toBe("Direct · engine's own login · Expired — log in again"));
    expect(valueOf('Email')).toBe('owner@redacted.invalid');
    expect(valueOf('Tool search')).toBe('off');
    expect(screen.queryByText('Account', { selector: 'dt' })).toBeNull();
  });

  it('reads nothing while the tab is hidden, and says what to do without a session', async () => {
    mount(ctxOf(READY, false));
    await new Promise((r) => setTimeout(r, 30));
    expect(backend.calls.filter((c) => c.command.startsWith('session.'))).toEqual([]);
    expect(valueOf('Route')).toBe('Gateway · ClaudeUsage relay · http://127.0.0.1:8641'); // the stores render at once
    cleanup();
    mount(ctxOf(null));
    expect(screen.getByText('Open a session to see its details')).toBeTruthy();
  });
});
