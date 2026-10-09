// The rename and resume widgets (C11 execution document, the widget table; M3 refresh task "rename and resume through
// C10's landed actions"): `/rename <title>` through C10's `session.rename` and the dialog through C5's registry where
// C10 registers it; `/resume` is P2-D's chooser.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, SessionDigest } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registerSessionAction } from '../app/session-actions';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { RenameWidget } from './RenameWidget';
import { clearPreviewCache } from '../resume/preview'; // P2-D
import { ResumeWidget } from './ResumeWidget';

const ROOT = join(__dirname, '../../../..');
const READY = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;
const scenario = () => loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));

beforeEach(() => {
  const s = scenario();
  backend = createWidgetBackend({ root: ROOT, statuses: s.engine, records: s.sessions });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map(s.engine.map((st) => [st.appSessionId, backend.status(st.appSessionId)])), records: new Map(s.sessions.map((r) => [r.appId, r])), digests: new Map(s.digests.map((d) => [d.appSessionId, d as unknown as SessionDigest])), projects: new Map(s.projects.map((p) => [p.id, p])) /* P2-D */ });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map(), projects: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
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
    expect(backend.calls.filter((c) => c.command === 'session.rename').map((c) => c.input)).toEqual([{ appSessionId: READY, title: 'Live C11' }]);
  });

  it('renames a session without a process too (C10 names it through its record)', async () => {
    mount(RenameWidget, 'app-bdb23713' as AppSessionId, 'Later');
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
});

// P2-D (the P2 spec, child P2-D, G1 and G5): `/resume` is the resume chooser the sidebar opens too, scoped to this
// session's project and listing the others; Enter opens in the current tab, ⌘Enter in a new one; nothing resumes here.
describe('resume widget', () => {
  beforeEach(() => clearPreviewCache());
  const titles = () => screen.getAllByRole('option').map((o) => o.querySelector('[data-title]')!.textContent);

  it("is the chooser over this session's project, without this session, newest first, the terminal-held one marked", () => {
    mount(ResumeWidget, 'app-bac6130b' as AppSessionId);
    expect(screen.getByTestId('resume-scope').textContent).toBe('codex_somersault');
    expect(titles()).toEqual(['Somersault terminal run', 'Trace stream reconnects']);
    expect(within(screen.getAllByRole('option')[0]).getByRole('img').getAttribute('aria-label')).toBe('Live in terminal');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull(); // opening is the action; the first Send continues it
  });

  it('opens the selected session in the current tab on Enter and in a new tab on ⌘Enter, and closes', () => {
    const openSession = vi.fn();
    const openTab = vi.fn();
    const layout = useLayout.getState();
    useLayout.setState({ openSession, openTab });
    const close = mount(ResumeWidget, 'app-bac6130b' as AppSessionId);
    const search = screen.getByRole('combobox');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(openSession).toHaveBeenCalledWith('app-bdb23713');
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(search, { key: 'Enter', metaKey: true });
    expect(openTab).toHaveBeenCalledWith({ kind: 'session', appSessionId: 'app-bdb23713' });
    useLayout.setState({ openSession: layout.openSession, openTab: layout.openTab });
  });

  it('a session without a project opens on every project', () => {
    mount(ResumeWidget, 'app-3d334c38' as AppSessionId); // no project
    expect(screen.getByTestId('resume-scope').textContent).toBe('All projects');
    expect(screen.getByRole('button', { name: /^All projects/ }).getAttribute('aria-pressed')).toBe('true');
    expect(titles()).not.toContain(useSessions.getState().records.get('app-3d334c38' as AppSessionId)!.title.text);
    expect(titles().length).toBeGreaterThan(2);
  });
});
