// The rename and resume widgets (C11 execution document, the widget table; M3 refresh task "rename and resume through
// C10's landed actions"): `/rename <title>` through C10's `session.rename` and the dialog through C5's registry where
// C10 registers it; `/resume` is P2-D's chooser.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { OrgKey } from '@shared/machine/org-key';
import { ProjectRecordSchema, type SessionDigest } from '@shared/ipc/schema';
import { EngineSessionStatusSchema } from '@shared/engine/status';
import { SessionRecordSchema } from '@shared/graph/session';
import { compileAddressing } from '@shared/machine/address';
import { loadScenario, ScenarioDigestSchema } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { record, remoteRow } from '../../../../test/support/builders';
import { EMPTY_REGISTRY, type OrgProjects } from '../stores/registry';
import { addressOf } from '@shared/machine/address';
import { registerSessionAction } from '../app/session-actions';
import { useMachines } from '../stores/machines';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { RenameWidget } from './RenameWidget';
import { clearPreviewCache } from '../resume/preview'; // P2-D
import { ResumeWidget } from './ResumeWidget';

const ROOT = join(__dirname, '../../../..');
const READY_ID = 'app-7412a115' as AppSessionId; // main's (the backend's) id
const READY = at(READY_ID);
const lift = <T,>(schema: Parameters<typeof compileAddressing>[0], value: T): T => compileAddressing(schema).lift(value, TEST_MACHINE);
let backend: WidgetBackend;
const scenario = () => loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));

beforeEach(() => {
  const s = scenario();
  backend = createWidgetBackend({ root: ROOT, statuses: s.engine, records: s.sessions });
  window.maws = backend.bridge();
  // P5 O6 M2: the store holds what the client lifts from main's answers, the scenario's ids as addresses
  useSessions.setState({ engine: new Map(s.engine.map((st) => [at(st.appSessionId), lift(EngineSessionStatusSchema, backend.status(st.appSessionId))])), records: new Map(s.sessions.map((r) => [at(r.appId), lift(SessionRecordSchema, r)])), digests: new Map(s.digests.map((d) => [at(d.appSessionId), lift(ScenarioDigestSchema, d) as unknown as SessionDigest])), projects: new Map(s.projects.map((p) => [at(p.id), lift(ProjectRecordSchema, p)])) /* P2-D */ });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map(), projects: new Map() });
  delete (window as { maws?: unknown }).maws;
});

const mount = (Widget: typeof RenameWidget, appSessionId: AppSessionId, args = '', close = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Widget appSessionId={appSessionId} args={args} close={close} />
    </QueryClientProvider>,
  );
  return close;
};

describe('rename widget', () => {
  it("`/rename <title>` renames through C10's session.rename at once and says so", async () => {
    mount(RenameWidget, READY, 'Live C11');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Renamed · Live C11'));
    expect(backend.calls.filter((c) => c.command === 'session.rename').map((c) => c.input)).toEqual([{ appSessionId: READY_ID, title: 'Live C11' }]);
  });

  it('renames a session without a process too (C10 names it through its record)', async () => {
    mount(RenameWidget, at('app-bdb23713' as AppSessionId), 'Later');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Renamed · Later'));
  });

  it('says a refused rename in its words', async () => {
    backend.script('session.rename', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'unknown session' });
    });
    mount(RenameWidget, READY, 'Nope');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('unknown session'));
  });

  it('without a title opens the registered rename dialog and closes', () => {
    const dialog = vi.fn();
    const off = registerSessionAction('rename', dialog);
    const close = mount(RenameWidget, READY);
    expect(dialog).toHaveBeenCalledWith(READY);
    expect(close).toHaveBeenCalledTimes(1);
    off();
  });

  it('without a title and no dialog registered, offers the title to edit', async () => {
    mount(RenameWidget, READY);
    const field = screen.getByRole('textbox', { name: 'New title' }) as HTMLInputElement;
    expect(field.value).toBe('Settings idle probe');
    fireEvent.change(field, { target: { value: 'Settings probe, renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Renamed · Settings probe, renamed'));
  });

  // P5 O7 M8 declared `session.rename` not offered on another machine; the UX wave, U9 (M1, M4) offers it behind
  // `rl2.session-acts`: on a machine whose build doesn't list it, nothing is asked, no dialog opens, and the field and
  // Rename are greyed with the update sentence (A14) (a lane A session there too: the helper reads the machine)
  it.each(['B', 'A'] as const)('for a lane %s session on a machine that doesn’t serve the acts, renames nothing and opens no dialog: Rename greyed with the update sentence', async (lane) => {
    const remote = addressOf(OTHER_MACHINE, READY_ID);
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-13T10:00:00Z', generation: 1, capabilities: ['rl2.project-acts'], owner: true }]);
    useSessions.setState({ records: new Map(useSessions.getState().records).set(remote, { ...useSessions.getState().records.get(READY)!, appId: remote }), listed: new Map([[remote, { ...remoteRow(OTHER_MACHINE, READY_ID, { lane }), appId: remote }]]), listedMachines: new Set([OTHER_MACHINE]) });
    const dialog = vi.fn();
    const off = registerSessionAction('rename', dialog);
    try {
      mount(RenameWidget, remote, 'Over there');
      mount(RenameWidget, remote);
      expect(dialog).not.toHaveBeenCalled();
      const words = 'Can’t rename on Studio yet. Update MAWS on Studio and try again.';
      expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual([words, words]);
      const rename = screen.getByRole('button', { name: 'Rename' });
      expect(rename).toHaveProperty('disabled', true);
      expect(rename.title).toBe(words);
      expect(screen.getByRole('textbox', { name: 'New title' })).toHaveProperty('disabled', true);
      await new Promise((r) => setTimeout(r, 20));
      expect(backend.calls.filter((c) => c.command === 'session.rename')).toEqual([]);
    } finally {
      off();
      useSessions.setState({ listed: new Map(), listedMachines: new Set() });
      useMachines.setState({ roster: 'unread', machines: new Map() });
    }
  });
});

// P2-D (the P2 spec, child P2-D, G1 and G5): `/resume` is the resume chooser the sidebar opens too, scoped to this
// session's project and listing the others; Enter opens in the current tab, ⌘Enter in a new one; nothing resumes here.
describe('resume widget', () => {
  beforeEach(() => clearPreviewCache());
  const titles = () => screen.getAllByRole('option').map((o) => o.querySelector('[data-title]')!.textContent);

  it("is the chooser over this session's project, without this session, newest first, the terminal-held one marked", () => {
    mount(ResumeWidget, at('app-bac6130b' as AppSessionId));
    expect(screen.getByTestId('resume-scope').textContent).toBe('codex_somersault');
    expect(titles()).toEqual(['Somersault terminal run', 'Trace stream reconnects']);
    expect(within(screen.getAllByRole('option')[0]).getByRole('img').getAttribute('aria-label')).toBe('Live in terminal');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull(); // opening is the action; the first Send continues it
  });

  // P2-A's availability, read only: a session no gesture continues from here says why, in A's words
  it('a terminal-held session says why it cannot be continued here; an exited one says nothing', () => {
    // main's read model derives availability (the scenario's digests carry none): the terminal's session is foreign-held
    const held = at('app-466b0d0d' as AppSessionId);
    const digests = new Map(useSessions.getState().digests);
    digests.set(held, { ...digests.get(held)!, availability: 'foreign_held' });
    useSessions.setState({ digests });
    mount(ResumeWidget, at('app-bac6130b' as AppSessionId));
    expect(screen.getByTestId('resume-refusal').textContent).toMatch(/^Held by terminal · \d+$/);
    expect(screen.getAllByRole('option')[0].title).toBe(screen.getByTestId('resume-refusal').textContent);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' }); // Trace stream reconnects: no process
    expect(screen.queryByTestId('resume-refusal')).toBeNull();
  });

  it('opens the selected session in the current tab on Enter and in a new tab on ⌘Enter, and closes', () => {
    const openSession = vi.fn();
    const openTab = vi.fn();
    const layout = useLayout.getState();
    useLayout.setState({ openSession, openTab });
    const close = mount(ResumeWidget, at('app-bac6130b' as AppSessionId));
    const search = screen.getByRole('combobox');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(openSession).toHaveBeenCalledWith(at('app-bdb23713'));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(search, { key: 'Enter', metaKey: true });
    expect(openTab).toHaveBeenCalledWith({ kind: 'session', appSessionId: at('app-bdb23713') });
    useLayout.setState({ openSession: layout.openSession, openTab: layout.openTab });
  });

  // ticket 644: `/resume` on another machine's session opens on the row the sidebar files it under, by its listing, though
  // the registry places its project on that machine, so it lists the sessions that row holds
  it('opens on the row the sidebar files another machine’s session under, by its listing, though the registry knows its project', () => {
    const ID = '11111111-2222-4333-8444-555555555555';
    const KEY = 'remote:example.org/app' as OrgKey;
    const registry: OrgProjects = {
      ...EMPTY_REGISTRY,
      projects: [{ id: ID, name: 'app', hub: true, renamable: true, locations: [{ machine: OTHER_MACHINE, pid: 'app', path: '/srv/app', key: KEY, name: 'app', source: 'remote', acts: true }] }],
      keys: { [ID]: KEY },
    };
    const [b1, b2] = ['b1', 'b2'].map((id) => addressOf(OTHER_MACHINE, id) as AppSessionId);
    const held = (appId: AppSessionId, text: string) => record(appId, { projectId: addressOf(OTHER_MACHINE, 'app') as ProjectId, title: { text, source: 'user' } });
    useSessions.getState().applyRegistry(registry, TEST_MACHINE);
    useSessions.setState({
      records: new Map([[b1, held(b1, 'First on B')], [b2, held(b2, 'Second on B')]]),
      listed: new Map([[b1, 'b1'], [b2, 'b2']].map(([appId, bare]) => [appId as AppSessionId, { ...remoteRow(OTHER_MACHINE, bare), appId: appId as AppSessionId }])),
    });
    try {
      mount(ResumeWidget, b1);
      expect(screen.getByTestId('resume-scope').textContent, 'its machine’s row').toBe(OTHER_MACHINE);
      expect(screen.queryAllByRole('option').map((o) => o.querySelector('[data-title]')!.textContent)).toEqual(['Second on B']);
    } finally {
      useSessions.setState({ listed: new Map() });
      useSessions.getState().applyRegistry(EMPTY_REGISTRY, TEST_MACHINE);
    }
  });

  it('a session without a project opens on every project', () => {
    mount(ResumeWidget, at('app-3d334c38' as AppSessionId)); // no project
    expect(screen.getByTestId('resume-scope').textContent).toBe('All projects');
    expect(screen.getByRole('button', { name: /^All projects/ }).getAttribute('aria-pressed')).toBe('true');
    expect(titles()).not.toContain(useSessions.getState().records.get(at('app-3d334c38' as AppSessionId))!.title.text);
    expect(titles().length).toBeGreaterThan(2);
  });
});
