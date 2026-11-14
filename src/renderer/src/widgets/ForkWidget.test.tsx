// `/fork [prompt]` (UX wave U4a, decision 18; A20): picked or typed bare, the panel forks the conversation in place and
// closes; typed with a prompt, its `apply` forks with the prompt as the fork's first message; either way through
// today's `forkSession`, once. A refusal is a toast in the host's words. For a session on another machine U9's helper
// decides: its sentence, and nothing forked, where the machine serves no session acts; a fork where it does.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { resetRemoteSurfaces } from '../artifacts/remote-surfaces';
import { resetRemoteLaneBStore } from '../lane-b/remote-session';
import { remoteUnavailableOf } from '../lane-b/remote-unavailable';
import { useMachines } from '../stores/machines';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { applyFork, ForkWidget } from './ForkWidget';

type Answer = { ok: true; appSessionId: string } | { ok: false; error: string };
const fork = vi.hoisted(() => ({ answer: { ok: true, appSessionId: 'fork' } as Answer }));
const forkSession = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<Answer>>(async () => fork.answer));
vi.mock('../sessions/record-ops', () => ({ forkSession }));

const LOCAL = at('app-here' as AppSessionId);
const REMOTE = addressOf(OTHER_MACHINE, 'app-far' as AppSessionId);
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  window.maws = { localMachine: TEST_MACHINE } as never;
  resetRemoteSurfaces();
  resetRemoteLaneBStore();
  useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
  useSessions.setState({ listed: new Map([[REMOTE, { ...remoteRow(OTHER_MACHINE, 'app-far'), appId: REMOTE }]]), listedMachines: new Set([OTHER_MACHINE]) });
  fork.answer = { ok: true, appSessionId: 'fork' };
});
afterEach(() => {
  cleanup();
  forkSession.mockClear();
  useNotices.setState({ notices: [] });
  useSessions.setState({ listed: new Map(), listedMachines: new Set() });
  delete (window as { maws?: unknown }).maws;
});

describe('/fork', () => {
  it('picked or typed bare: forks in place with no first message, once, and closes', async () => {
    const close = vi.fn();
    const { rerender } = render(<ForkWidget appSessionId={LOCAL} args="" close={close} />);
    rerender(<ForkWidget appSessionId={LOCAL} args="" close={close} />);
    await settle();
    expect(forkSession.mock.calls).toEqual([[LOCAL, { kind: 'inPlace' }, { message: null, rewindTo: null }]]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('typed with a prompt: forks once with the prompt as the fork’s first message, and opens nothing', async () => {
    await expect(applyFork(LOCAL, '  try the other branch  ')).resolves.toBe(true);
    await settle();
    expect(forkSession.mock.calls).toEqual([[LOCAL, { kind: 'inPlace' }, { message: { content: 'try the other branch', display: 'try the other branch' }, rewindTo: null }]]);
  });

  it('says a refusal in the host’s words', async () => {
    fork.answer = { ok: false, error: 'The session is held by a terminal' };
    await applyFork(LOCAL, 'again');
    await settle();
    expect(useNotices.getState().notices.map((n) => [n.kind, n.level, n.text])).toEqual([['toast', 'danger', 'The session is held by a terminal']]);
  });

  // From the master that holds U9 (the landing's edge, the `/fork` row): `session.fork` is offered behind
  // `rl2.session-acts`, so the typed form reads U9's helper: its sentence where the machine lists no such capability,
  // nothing where it does, and then it forks there.
  const machineLists = (capabilities: string[]) => {
    resetRemoteSurfaces();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay', capabilities }]);
  };

  it('forks nothing for a session on a machine that serves no session acts: the typed form opens the panel, which says why', async () => {
    machineLists([]);
    const words = remoteUnavailableOf(REMOTE, 'session.fork');
    expect(words).toContain('Update MAWS on mini');
    await expect(applyFork(REMOTE, 'elsewhere')).resolves.toBe(false);
    const close = vi.fn();
    render(<ForkWidget appSessionId={REMOTE} args="elsewhere" close={close} />);
    await settle();
    expect(screen.getByRole('status').textContent).toBe(words);
    expect(forkSession).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('forks a session on a machine that lists rl2.session-acts, once, with the prompt as its first message', async () => {
    machineLists([SESSION_ACTS_CAPABILITY]);
    expect(remoteUnavailableOf(REMOTE, 'session.fork')).toBeNull();
    await expect(applyFork(REMOTE, 'elsewhere')).resolves.toBe(true);
    await settle();
    expect(forkSession.mock.calls).toEqual([[REMOTE, { kind: 'inPlace' }, { message: { content: 'elsewhere', display: 'elsewhere' }, rewindTo: null }]]);
  });
});
