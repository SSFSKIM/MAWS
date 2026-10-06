// `/skills` Reload (E8 execution document, M2; parent G3): `reload_skills` as an operation, `Reloaded · N skills`, and the
// dialog read again on its completion, over the fixture-backed widget backend.
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { SkillsWidget } from './SkillsWidget';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
});
afterEach(() => {
  cleanup();
  useSessions.setState({ engine: new Map() });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('skills widget: Reload', () => {
  it('runs reload_skills, says how many skills the engine offers, and reads the dialog again', async () => {
    backend.script('session.reloadSkills', () => {
      setTimeout(() => backend.emitOperation({ appSessionId: ID, opId: 'op-skills', command: 'session.reloadSkills', late: false, outcome: { ok: true, value: { skills: [{ name: 'e8-probe:e8-hello', description: 'Say hello' }] } } }), 0);
      return { opId: 'op-skills' };
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SkillsWidget appSessionId={ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('list', { name: 'Skills' })).toBeTruthy());
    const reads = () => backend.calls.filter((c) => c.subtype === 'get_skills_dialog').length;
    const before = reads();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Reloaded · 1 skill'));
    expect(backend.calls.filter((c) => c.command === 'session.reloadSkills').map((c) => c.input)).toEqual([{ appSessionId: ID }]);
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it('shows a failed reload in red in the operation’s words', async () => {
    backend.script('session.reloadSkills', () => {
      setTimeout(() => backend.emitOperation({ appSessionId: ID, opId: 'op-skills', command: 'session.reloadSkills', late: false, outcome: { ok: false, error: { code: 'engine_error', message: 'reload_skills failed', engineCode: null } } }), 0);
      return { opId: 'op-skills' };
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SkillsWidget appSessionId={ID} args="" close={() => {}} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole('list', { name: 'Skills' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('reload_skills failed · engine_error'));
    expect(screen.getByRole('status').className).toContain('text-danger');
  });
});
