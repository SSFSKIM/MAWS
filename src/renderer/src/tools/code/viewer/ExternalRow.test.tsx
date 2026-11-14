// P5 O7 M4: the viewer's Open externally on a lane B session on another machine would open the file on that machine's
// desktop. P5 O7 M5a (A10): it opens a copy of the file here instead (`remote.openCopy`), saying where the file is; a
// local session's opens as before. UX wave U6c (M3, Interfaces §E): a session on this Mac asks with `named`, so a file
// outside its folders that its transcript names opens; a session on another machine is asked as today.
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
  it('opens a copy here of a file of another machine’s lane B session, saying where the file is', () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00Z', generation: 0 },
    ]);
    applyRemoteSession(remoteSessionState(REMOTE));
    render(<OpenExternally appSessionId={REMOTE} path="/r/doc.pdf" />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally' });
    expect(button.disabled).toBe(false);
    expect(button.title).toBe('Opens a copy of this file from mini on this Mac');
    expect(screen.getByText('on mini')).toBeTruthy();
    fireEvent.click(button);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('remote.openCopy', { machine: OTHER_MACHINE, source: { appSessionId: REMOTE, path: '/r/doc.pdf' } });
  });

  it('says why a copy was not opened', async () => {
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: false, message: 'too large to copy from mini' } } as never);
    const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
    applyRemoteSession(remoteSessionState(REMOTE));
    render(<OpenExternally appSessionId={REMOTE} path="/r/big.mov" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    expect((await screen.findByRole('alert')).textContent).toContain('too large to copy from mini');
  });

  it('opens a local session’s file, asking with named', () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    const LOCAL = addressOf(TEST_MACHINE, 'app-l' as AppSessionId);
    render(<OpenExternally appSessionId={LOCAL} path="/r/doc.pdf" />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Open externally' });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('files.openExternal', { appSessionId: LOCAL, path: '/r/doc.pdf', named: true });
  });

  it('asks without named for a session on another machine that MAWS does not run there', () => {
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { opened: true, message: null } } as never);
    const TERMINAL = addressOf(OTHER_MACHINE, 'app-t' as AppSessionId); // no lane B state for it: not a session MAWS runs there
    render(<OpenExternally appSessionId={TERMINAL} path="/r/doc.pdf" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open externally' }));
    expect(invoke).toHaveBeenCalledExactlyOnceWith('files.openExternal', { appSessionId: TERMINAL, path: '/r/doc.pdf' });
  });
});
