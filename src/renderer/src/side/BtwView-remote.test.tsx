// The side question view for a session on another machine (P5 O7 M8, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md,
// "The offer audit and its contract"): side threads are declared not offered there (REMOTE_UNAVAILABLE), so Continue as
// a side thread is greyed with the declared words; an older machine heard refusing `side.question.clear` greys Clear
// with its name. Asking stays the machine's to answer.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { SideExchange } from '@shared/side/question';
import { remoteRow, status } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { heardRefusal, resetRemoteSurfaces } from '../artifacts/remote-surfaces';
import { resetRemoteLaneBStore } from '../lane-b/remote-session';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { BtwView } from './BtwView';
import { resetSideQuestions } from './store';

const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
const FAILED: SideExchange = { id: 'op-2', question: 'Again?', state: 'failed', response: null, synthetic: false, error: 'The side question failed', askedAt: '2026-10-06T10:01:00.000Z', answeredAt: null };
const ANSWERED: SideExchange = { id: 'op-1', question: 'What word?', state: 'answered', response: 'ZEBRA', synthetic: false, error: null, askedAt: '2026-10-06T10:00:00.000Z', answeredAt: '2026-10-06T10:00:02.000Z' };

let fake: ReturnType<typeof fakeClient>;
beforeEach(() => {
  resetSideQuestions();
  resetRemoteSurfaces();
  resetRemoteLaneBStore();
  fake = fakeClient({ 'side.question.list': { exchanges: [ANSWERED, FAILED] } });
  window.maws = { ...(fake.client as unknown as PreloadBridge), localMachine: TEST_MACHINE };
  useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
  useSessions.setState({ engine: new Map([[R, status(R)]]), listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
});
afterEach(() => {
  cleanup();
  resetRemoteSurfaces();
  useSessions.setState({ engine: new Map(), listed: new Map(), listedMachines: new Set() });
  delete (window as { maws?: unknown }).maws;
});

describe('the side question view for a session on another machine', () => {
  it('greys Continue as a side thread with the declared reason, and Clear once the machine was heard not offering it', async () => {
    render(<BtwView parent={R} />);
    await screen.findByText('ZEBRA');
    const promote = screen.getByRole('button', { name: 'Continue as a side thread' });
    expect(promote).toHaveProperty('disabled', true);
    expect(promote.title).toBe(REMOTE_UNAVAILABLE['side.thread.open']);
    const clear = screen.getByRole('button', { name: 'Clear' });
    expect(clear).toHaveProperty('disabled', false);
    act(() => heardRefusal('side.question.clear', { issues: { refusal: 'not-offered' } }, OTHER_MACHINE, TEST_MACHINE));
    expect(clear).toHaveProperty('disabled', true);
    expect(clear.title).toBe('mini doesn’t offer this');
  });

  // An older machine with no side-question row: Ask, Enter and Retry are greyed with its name, the field saying why, and
  // nothing is asked
  it('greys Ask, Enter and Retry once the machine was heard not offering side questions, and asks nothing', async () => {
    render(<BtwView parent={R} />);
    await screen.findByText('ZEBRA');
    act(() => heardRefusal('session.sideQuestion', { issues: { refusal: 'not-offered' } }, OTHER_MACHINE, TEST_MACHINE));
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Still there?' } });
    expect(screen.getByRole('button', { name: 'Ask' })).toHaveProperty('disabled', true);
    expect(screen.getByText('mini doesn’t offer this')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
  });
});
