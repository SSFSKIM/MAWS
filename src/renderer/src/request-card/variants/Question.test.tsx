// The question stepper's two behaviours of UX wave U1a (Interfaces §E; A10, A18): Dismiss in the form's foot, which
// sends the decline Esc sends, and a double-click on a single-choice option, which picks it and goes on (Next, or Submit
// on the last step). Both are the app card's to ask for: without the two props (desk web's use) the stepper is today's.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestAnswer } from '@shared/engine/answers';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at } from '../../../../../test/support/machine';
import { connectKeys } from '../../keymap/dispatcher';
import { useAttention } from '../../stores/attention';
import { resetShellStores } from '../../test-support/shell-stores';
import { RequestCard } from '../RequestCard';
import { itemFor } from '../test-requests';
import type { Capability } from '../../session/controls/types';
import { QuestionBody } from './Question';

type QuestionEvent = Extract<SessionEvent, { kind: 'question.requested' }>;
const APP = at('app-q' as AppSessionId);
const option = (label: string) => ({ label, description: null, preview: null });
const COLOUR = { question: 'Which colour?', header: 'Colour', options: [option('Red'), option('Blue')], multiSelect: false };
const DAYS = { question: 'Which days?', header: 'Days', options: [option('Mon'), option('Tue')], multiSelect: true };
const asking = (questions: QuestionEvent['questions'], requestId = 'req-q'): QuestionEvent => ({
  id: `evt-${requestId}` as never, sessionId: 's-1' as never, at: '2026-11-12T09:00:00.000Z', seq: null, agentId: null, parentToolUseId: null,
  kind: 'question.requested', requestId: requestId as RequestId, toolUseId: `toolu_${requestId}` as never, questions,
});

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetShellStores();
  fake = fakeClient({ 'session.answer': { outcome: 'delivered' } });
  window.maws = fake.client as unknown as PreloadBridge;
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

// The stepper alone, as a host draws it: `submit` recorded, `capability` the port's answer (absent: every answer carried).
function stepper(event: QuestionEvent, props: { dismiss?: { disabled: boolean; title: string | undefined; run(): void }; doubleClick?: boolean; capability?: (answer: RequestAnswer) => Capability } = {}) {
  const submit = vi.fn();
  render(<QuestionBody item={itemFor(event, APP)} request={event} placement="inline" busy={false} submit={submit} bindKeys={() => {}} {...props} />);
  return submit;
}
const sent = (submit: ReturnType<typeof vi.fn>) => submit.mock.calls.map(([answer]) => answer as RequestAnswer);

describe('Dismiss', () => {
  it('on the app card’s blocking question sends the plain deny Esc sends, once', async () => {
    const event = asking([COLOUR, DAYS]);
    render(<RequestCard item={itemFor(event, APP)} request={event} placement="docked" paneIndex={0} />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    await userEvent.setup().click(dismiss);
    await waitFor(() => expect(fake.invoked('session.answer').map((input) => (input as { answer: unknown }).answer)).toEqual([{ kind: 'permission', decision: 'deny' }]));
    await userEvent.setup().click(dismiss); // sent: the card stands disabled until its item leaves the list
    expect(fake.invoked('session.answer')).toHaveLength(1);
  });

  it('runs its own action, and is drawn disabled with its reason when the host says so', async () => {
    const run = vi.fn();
    stepper(asking([COLOUR]), { dismiss: { disabled: false, title: undefined, run } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(run).toHaveBeenCalledTimes(1);
    cleanup();
    const closed = vi.fn();
    stepper(asking([COLOUR]), { dismiss: { disabled: true, title: 'Dismiss it in the terminal', run: closed } });
    const button = screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Dismiss it in the terminal');
  });
});

describe('a double-click on a single-choice option', () => {
  it('on a middle step picks the option and moves to the next question, sending nothing', async () => {
    const submit = stepper(asking([COLOUR, DAYS]), { doubleClick: true });
    await userEvent.setup().dblClick(screen.getByRole('radio', { name: 'Blue' }));
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(sent(submit)).toEqual([]);
    expect(useAttention.getState().drafts.get(itemFor(asking([COLOUR, DAYS]), APP).id)?.selected['Which colour?']).toEqual(['Blue']);
  });

  it('on the last step picks and submits once', async () => {
    const submit = stepper(asking([COLOUR]), { doubleClick: true });
    await userEvent.setup().dblClick(screen.getByRole('radio', { name: 'Red' }));
    expect(sent(submit)).toEqual([{ kind: 'question', answers: { 'Which colour?': 'Red' } }]);
  });

  it('acts on the option clicked, whatever was picked before', async () => {
    const submit = stepper(asking([COLOUR]), { doubleClick: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.dblClick(screen.getByRole('radio', { name: 'Blue' }));
    expect(sent(submit)).toEqual([{ kind: 'question', answers: { 'Which colour?': 'Blue' } }]);
  });

  it('only picks where the session cannot carry the submit', async () => {
    const submit = stepper(asking([COLOUR]), { doubleClick: true, capability: (answer) => (answer.kind === 'question' ? { available: false, reason: 'Answer this in the terminal' } : { available: true }) });
    await userEvent.setup().dblClick(screen.getByRole('radio', { name: 'Red' }));
    expect(sent(submit)).toEqual([]);
    expect(screen.getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true');
  });

  it('never submits or moves on from a multi-choice option or from Other…', async () => {
    const submit = stepper(asking([DAYS]), { doubleClick: true });
    const user = userEvent.setup();
    await user.dblClick(screen.getByRole('checkbox', { name: 'Mon' }));
    expect(sent(submit)).toEqual([]);
    cleanup();
    const again = stepper(asking([COLOUR, DAYS], 'req-o'), { doubleClick: true });
    await user.dblClick(screen.getByRole('radio', { name: 'Other…' }));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(sent(again)).toEqual([]);
  });
});

describe('without the two props (desk web’s use)', () => {
  it('draws no Dismiss, and a double-click only picks', async () => {
    const submit = stepper(asking([COLOUR, DAYS]));
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    await userEvent.setup().dblClick(screen.getByRole('radio', { name: 'Blue' }));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')).toBe('true');
    expect(sent(submit)).toEqual([]);
  });
});
