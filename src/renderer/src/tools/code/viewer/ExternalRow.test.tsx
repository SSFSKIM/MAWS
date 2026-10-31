// P5 O7 M4: the viewer's Open externally on a lane B session on another machine would open the file on that machine's
// desktop, so it stays greyed with where the file is, and asks main nothing; a local session's opens as before.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { ipc } from '../../../ipc/client';
import { applyRemoteSession, resetRemoteLaneBStore } from '../../../lane-b/remote-session';
import { remoteSessionState } from '../../../lane-b/test-support/remote-session';
import { useMachines } from '../../../stores/machines';
import { OpenExternally } from './ExternalRow';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetRemoteLaneBStore();
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
});

describe('Open externally', () => {
  it('is greyed with “on <machine>” for a file of another machine’s lane B session, and invokes nothing', () => {
    const invoke = vi.spyOn(ipc, 'invoke');
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
    ]);
    applyRemoteSession(remoteSessionState(REMOTE));
    render(<OpenExternally appSessionId={REMOTE} path="/r/doc.pdf" />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally' });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('This file is on mini, not on this Mac');
    expect(screen.getByText('on mini')).toBeTruthy();
    fireEvent.click(button);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('opens a local session’s file', () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    const LOCAL = addressOf(TEST_MACHINE, 'app-l' as AppSessionId);
    render(<OpenExternally appSessionId={LOCAL} path="/r/doc.pdf" />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally' });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('files.openExternal', { appSessionId: LOCAL, path: '/r/doc.pdf' });
  });
});
