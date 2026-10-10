// P2-A (2026-10-09; the execution document §5.6): the `/btw` widget on a session with no ready process. Opening it starts
// nothing; Ask starts the session (side), then asks once and closes; a refused start says why and keeps the question;
// a session a terminal holds keeps Ask disabled with the holder named.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { digest, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { A, resetPanelStores } from '../test-support/panel';
import { BtwWidget } from './BtwWidget';
import { registerSidePane } from './register';
import { resetSideQuestions, useSidePane } from './store';

let fake: FakeClient;

beforeEach(() => {
  resetPanelStores();
  resetSideQuestions();
  useSidePane.setState({ panes: new Map() });
  useNotices.setState({ notices: [] });
  registerSidePane();
  fake = fakeClient({ 'side.question.list': { exchanges: [] } });
  window.maws = fake.client;
  useSessions.setState({ engine: new Map([[A, status(A, { process: 'exited' } as never)]]) });
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: unknown }).maws;
});

describe('the /btw widget on a session with no ready process', () => {
  it('opening it starts nothing; Ask starts the session, then asks once and closes', async () => {
    const close = vi.fn();
    render(<BtwWidget appSessionId={A} args="why?" close={close} />);
    expect(fake.invoked('session.acquire')).toEqual([]);
    expect(screen.getByText('Starts this session')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: A, reason: 'side' }]);
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false }));
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A, question: 'why?' }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('dismissed while its start runs, it still asks but never closes the widget that replaced it', async () => {
    const close = vi.fn(); // the host's close puts away whichever widget is open by then
    const view = render(<BtwWidget appSessionId={A} args="why?" close={close} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    view.unmount(); // Esc, then another widget opened in its place
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: A, launched: true, joined: false }));
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A, question: 'why?' }]);
    expect(close).not.toHaveBeenCalled();
  });

  it('a refused start says why and keeps the question; nothing is asked', async () => {
    const close = vi.fn();
    render(<BtwWidget appSessionId={A} args="why?" close={close} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await act(() => fake.reply('session.acquire', { status: 'missing_directory', appSessionId: A, directory: '/gone' }));
    expect(screen.getByRole('alert').textContent).toBe('Directory not found: /gone');
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('why?');
  });

  it('a session a terminal holds: Ask disabled, the holder named, nothing acquired', () => {
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, { ...record(A), holder: { kind: 'terminal', pid: 42 } }), digests: new Map([[A, digest(A, { availability: 'foreign_held' })]]) }));
    render(<BtwWidget appSessionId={A} args="why?" close={() => {}} />);
    expect(screen.getByText('Held by terminal · 42')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.invoked('session.acquire')).toEqual([]);
  });
});
