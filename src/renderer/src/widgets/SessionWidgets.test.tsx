// The rename and resume widgets (C11 execution document, the widget table; M3 refresh task "rename and resume through
// C10's landed actions", with C10's pieces behind c10-seam.ts until the integration).
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge, SessionDigest } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { registerSessionAction } from '../app/session-actions';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { RenameWidget } from './RenameWidget';
import { ResumeWidget } from './ResumeWidget';

const ROOT = join(__dirname, '../../../..');
const READY = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;
const scenario = () => loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json'));

beforeEach(() => {
  const s = scenario();
  backend = createWidgetBackend({ root: ROOT, statuses: s.engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map(s.engine.map((st) => [st.appSessionId, backend.status(st.appSessionId)])), records: new Map(s.sessions.map((r) => [r.appId, r])), digests: new Map(s.digests.map((d) => [d.appSessionId, d as unknown as SessionDigest])) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map() });
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
  it('`/rename <title>` renames through the engine at once and says so', async () => {
    backend.script('session.renameSession', () => undefined); // rename_session answers no payload (reads.jsonl seq 90)
    mount(RenameWidget, READY, 'Live C11');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Renamed · Live C11'));
    expect(backend.calls.filter((c) => c.command === 'session.renameSession').map((c) => c.input)).toEqual([{ appSessionId: READY, title: 'Live C11' }]);
  });

  it('refuses in words on a session without a process until C10 names it through its record', async () => {
    mount(RenameWidget, 'app-bdb23713' as AppSessionId, 'Later');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The session is not running · renaming it arrives with C10'));
    expect(backend.calls.filter((c) => c.command === 'session.renameSession')).toHaveLength(0);
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
    backend.script('session.renameSession', () => undefined);
    mount(RenameWidget, READY);
    const field = screen.getByRole('textbox', { name: 'New title' }) as HTMLInputElement;
    expect(field.value).toBe('Settings idle probe');
    fireEvent.change(field, { target: { value: 'Settings probe, renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Renamed · Settings probe, renamed'));
  });
});

describe('resume widget', () => {
  it("lists the project's other sessions, newest first, with the foreign-live one's Resume disabled and its holder named", () => {
    mount(ResumeWidget, 'app-bac6130b' as AppSessionId);
    const rows = within(screen.getByRole('list', { name: 'Sessions of this project' })).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('[data-title]')?.textContent)).toEqual(['Somersault terminal run', 'Trace stream reconnects']);
    const foreign = within(rows[0]).getByRole('button', { name: 'Resume' });
    expect(foreign).toHaveProperty('disabled', true);
    expect(foreign.title).toBe('Live in terminal');
    const exited = within(rows[1]).getByRole('button', { name: 'Resume' });
    expect(exited).toHaveProperty('disabled', true);
    expect(exited.title).toBe('Resuming arrives with C10');
  });

  it('opens a listed session in its tab and closes', () => {
    const openSession = vi.fn();
    const layout = useLayout.getState();
    useLayout.setState({ openSession });
    const close = mount(ResumeWidget, 'app-bac6130b' as AppSessionId);
    const rows = within(screen.getByRole('list', { name: 'Sessions of this project' })).getAllByRole('listitem');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Open' }));
    expect(openSession).toHaveBeenCalledWith('app-bdb23713');
    expect(close).toHaveBeenCalledTimes(1);
    useLayout.setState({ openSession: layout.openSession });
  });

  it('says when the project has no other session', () => {
    mount(ResumeWidget, 'app-3d334c38' as AppSessionId); // no project
    expect(screen.getByText('No other sessions in this project')).toBeTruthy();
  });
});
