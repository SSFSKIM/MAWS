import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { launchDefaults } from '@shared/composer/launch-defaults';
import { record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import { parseExtraSettings, resumeSpec, type Resumable } from './resume-spec';
import { ResumeLauncher } from './ResumeLauncher';

const A = 'app-a' as AppSessionId;
const scratch = record(A, { directory: '/tmp/maws-scratch', additionalDirectories: ['/tmp/extra'], engineSessionId: '7c0e2d1a-4b3f-4c5d-8e6f-9a0b1c2d3e4f' as SessionId }) as Resumable;
let fake: FakeClient;

beforeEach(() => {
  resetShellStores();
  fake = fakeClient({ 'session.launch': { status: 'launching', session: status(A) } });
  window.maws = fake.client;
  const archived = record('app-archived', { archived: true });
  const unsaved = record('app-new', { engineSessionId: null });
  useSessions.setState({ records: new Map([[A, scratch], [archived.appId, archived], [unsaved.appId, unsaved]]), recordsVersion: 1, loaded: true });
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the dev-only resume launcher', () => {
  it("builds the resume launch from the shared defaults, passing Direct, Permission mode and extraSettings through literally", () => {
    expect(resumeSpec(scratch, { direct: true, permissionMode: 'default', extraSettings: { permissions: { ask: ['Bash(git log:*)'] } } })).toEqual({
      ...launchDefaults(A, '/tmp/maws-scratch'),
      additionalDirectories: ['/tmp/extra'],
      resume: { sessionId: '7c0e2d1a-4b3f-4c5d-8e6f-9a0b1c2d3e4f', fork: false },
      gateway: 'direct',
      permissionMode: 'default',
      extraSettings: { permissions: { ask: ['Bash(git log:*)'] } },
      maxBudgetUsd: 0.5,
    });
    expect(resumeSpec(scratch, { direct: false, permissionMode: null, extraSettings: null })).toMatchObject({ gateway: 'gateway', permissionMode: null, extraSettings: null, sessionId: null, replay: null });
  });

  it('reads extraSettings as a JSON object, empty as none, and anything else as an error', () => {
    expect(parseExtraSettings('  ')).toEqual({ ok: true, value: null });
    expect(parseExtraSettings('{ "permissions": { "allow": [] } }')).toEqual({ ok: true, value: { permissions: { allow: [] } } });
    for (const text of ['[1]', 'null', '"x"', '{ not json']) expect(parseExtraSettings(text).ok).toBe(false);
  });

  it('lists the resumable records and launches one with the fields as set', async () => {
    render(<ResumeLauncher />);
    const list = screen.getByRole('list', { name: 'Resumable sessions' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('/tmp/maws-scratch')]); // not the archived one, nor one with no engine session
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Direct' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Permission mode' }), 'default');
    await user.click(screen.getByRole('textbox', { name: 'extraSettings' }));
    await user.paste('{ "permissions": { "ask": ["Bash(git log:*)"] } }');
    await user.click(within(list).getByRole('button', { name: 'Resume live' }));
    await waitFor(() => expect(fake.invoked('session.launch')).toHaveLength(1));
    expect(fake.invoked('session.launch')[0]).toEqual({ spec: resumeSpec(scratch, { direct: true, permissionMode: 'default', extraSettings: { permissions: { ask: ['Bash(git log:*)'] } } }) });
    await waitFor(() => expect(within(list).getByRole('status').textContent).toBe('launching'));
  });

  it('disables Resume live with the parse error while extraSettings is not a JSON object', async () => {
    render(<ResumeLauncher />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('textbox', { name: 'extraSettings' }));
    await user.paste('[1, 2]');
    const button = screen.getByRole('button', { name: 'Resume live' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.title).toBe('extraSettings must be a JSON object');
  });
});
