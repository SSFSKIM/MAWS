import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { connectKeys } from '../keymap/dispatcher';
import { bindingsOf } from '../keymap/useKeyChord';
import { useAttention } from '../stores/attention';
import { resetComposerStore, useComposerStore } from '../stores/composer';
import { useNotices } from '../stores/notices';
import { resetShellStores } from '../test-support/shell-stores';
import { ipcSource, useTranscriptStore } from '../transcript';
import { builder, uuid } from '../transcript/model/test-events';
import { RequestCard, type Placement } from './RequestCard';
import { fixtureRequest, itemFor, permission, syntheticRequest, type RequestEvent } from './test-requests';

const APP = 'app-test' as AppSessionId;
let fake: FakeClient;
let outcome: 'delivered' | 'not_pending' | 'write_failed' = 'delivered';
let sessionEvents: SessionEvent[] = []; // what `session.events` answers for APP (the transcript's IPC source)
let disconnect: () => void;

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  useNotices.setState({ notices: [] });
  outcome = 'delivered';
  sessionEvents = [];
  fake = fakeClient({ 'session.answer': () => ({ outcome }), 'session.events': () => ({ events: sessionEvents, lastSeq: sessionEvents.length, complete: true }) });
  window.maws = fake.client;
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: MawsBridge }).maws;
  vi.useRealTimers();
});

const answers = () => fake.invoked('session.answer').map((input) => (input as { answer: unknown }).answer);

// A pane (C5's `data-pane`) holding the card in `placement`; a card placement sits in a focusable article, as C5's
// Overview card does.
function Pane({ index = 0, children }: { index?: 0 | 1; children: ReactNode }) {
  return (
    <section data-pane={index} aria-label={`pane ${index}`}>
      <button type="button">tab {index}</button>
      {children}
    </section>
  );
}

function Card({ event, placement, item }: { event: SessionEvent; placement: Placement; item: AttentionItem }) {
  const card = <RequestCard item={item} request={event} placement={placement} paneIndex={0} />;
  return placement === 'card' ? (
    <article tabIndex={0} aria-label={`article ${item.appSessionId}`}>
      {card}
    </article>
  ) : (
    card
  );
}

function mount(event: RequestEvent, placement: Placement, over: Partial<AttentionItem> = {}) {
  const item = itemFor(event, APP, over);
  const view = render(
    <Pane>
      <Card event={event} placement={placement} item={item} />
    </Pane>,
  );
  return { item, view };
}

const press = async (key: string) => userEvent.setup().keyboard(key);
const focusOn = (element: HTMLElement) => act(() => element.focus());
const frame = () => screen.getByRole('group', { name: /./ });
const article = () => screen.getByRole('article');

const refusal = syntheticRequest('refusal-fallback-dialog');
const autoFallback = syntheticRequest('auto-mode-fallback-dialog');
const undeclared = syntheticRequest('undeclared-dialog');
const flaggedRead = syntheticRequest('flagged-read');
const unflaggedRead = syntheticRequest('flagged-read', (r) => delete r.requires_user_interaction);
const reapply = fixtureRequest('pass2', 'grant-reapply-start', 30);
const question = fixtureRequest('pass1', 'question-roundtrip', 137);
const elicitation = fixtureRequest('pass2', 'dialogs', 41);
const plan: RequestEvent = { ...permission(), kind: 'plan.requested', plan: '# Plan\n\n1. Split the parser\n2. Test it', input: {} } as never;

describe('dialog variants answer the two declared kinds and leave an undeclared kind pending', () => {
  it('the refusal fallback offers Retry with the fallback model, Edit prompt and Cancel, each with its pinned result', async () => {
    for (const [name, result] of [
      ['Retry with claude-sonnet-5', 'retry_fallback'],
      ['Cancel', 'cancelled'],
    ] as const) {
      const { view } = mount(refusal, 'inline');
      expect(screen.getByRole('heading', { name: 'The model declined to continue' })).toBeTruthy();
      expect(screen.getByText('claude-fable-5 declined · cyber')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Edit prompt' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(answers().at(-1)).toEqual({ kind: 'dialog', behavior: 'completed', result }));
      view.unmount();
    }
  });

  it('docked, Enter retries and Esc cancels from the frame', async () => {
    const first = mount(refusal, 'docked');
    focusOn(frame());
    await press('{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'dialog', behavior: 'completed', result: 'retry_fallback' }]));
    first.view.unmount();
    mount(refusal, 'docked');
    focusOn(frame());
    await press('{Escape}');
    await waitFor(() => expect(answers().at(-1)).toEqual({ kind: 'dialog', behavior: 'completed', result: 'cancelled' }));
  });

  it('the auto-mode server fallback renders its title and paragraphs and answers continue (Enter) or interrupt (Esc), never cancelled', async () => {
    const first = mount(autoFallback, 'docked');
    expect(screen.getByRole('heading', { name: /changing auto mode/ })).toBeTruthy();
    expect(screen.getByText(/Nothing breaks: auto mode keeps working/)).toBeTruthy();
    expect(screen.getByText('127.0.0.1:8641')).toBeTruthy();
    focusOn(frame());
    await press('{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'dialog', behavior: 'completed', result: 'continue' }]));
    first.view.unmount();
    mount(autoFallback, 'docked');
    focusOn(frame());
    await press('{Escape}');
    await waitFor(() => expect(answers().at(-1)).toEqual({ kind: 'dialog', behavior: 'completed', result: 'interrupt' }));
    expect(answers().some((a) => (a as { result?: string }).result === 'cancelled')).toBe(false);
  });

  it('an undeclared kind shows its payload and the pending notice, with no answer control and no key', async () => {
    mount(undeclared, 'docked');
    expect(screen.getByRole('heading', { name: 'cost_threshold' })).toBeTruthy();
    expect(screen.getByText(/MAWS did not declare this dialog kind and cannot answer it/)).toBeTruthy();
    expect(screen.queryByRole('group')).toBeNull(); // no docked frame: it never takes the editor's place
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['tab 0']);
    expect(bindingsOf('request.accept')).toEqual([]);
    expect(bindingsOf('request.decline')).toEqual([]);
  });

  it('a declared kind whose payload fails its schema is treated as undeclared', () => {
    mount({ ...refusal, payload: { originalModel: 'x' } } as RequestEvent, 'inline');
    expect(screen.getByText(/does not match the declared schema/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
  });
});

describe('edit prompt restores the initiating prompt', () => {
  // The session's history as its IPC source answers it; the card hydrates from that source for the read.
  const transcript = (events: SessionEvent[]) => void (sessionEvents = events);

  it('captures the newest human prompt with its pasted body and image, answers edit_prompt, and prefills after delivery', async () => {
    const b = builder();
    b.turn('u-0', 'earlier prompt');
    b.end(['u-0']);
    const body = 'line one\nline two\nline three';
    b.emit('turn.started', { userMessageUuid: uuid('u-1'), origin: 'human' });
    b.emit('user.message', {
      messageUuid: uuid('u-1'),
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
        { type: 'text', text: `fix the build\n\n<pasted_content id="1a2b">\n${body}\n</pasted_content id="1a2b">\n` },
      ],
      isReplay: false,
      isSynthetic: false,
      origin: 'human',
      bash: null,
    });
    b.text('msg-r', 0, 'I will not do that.'); // the retracted assistant rows follow the prompt
    transcript(b.events);

    outcome = 'delivered';
    mount(refusal, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'dialog', behavior: 'completed', result: 'edit_prompt' }]));
    await waitFor(() => expect(useComposerStore.getState().prefills.get(APP)).toBeDefined());
    const prefill = useComposerStore.getState().prefills.get(APP)!;
    expect(prefill.text).toMatch(/^fix the build\n\[Pasted text #1 \+3 lines\]/);
    expect(prefill.pasted).toEqual([{ name: 'Pasted text #1', text: body }]);
    expect(prefill.images).toEqual([{ name: expect.any(String), mediaType: 'image/png', data: 'iVBORw0KGgo=' }]);
    expect(prefill.editing).toEqual({ messageUuid: 'u-1', seenCursor: 'u-1' });
  });

  it('reads the prompt as the source holds it now, not a view mounted earlier and since closed', async () => {
    const b = builder();
    b.turn('u-1', 'first prompt');
    b.end(['u-1']);
    transcript([...b.events]);
    await act(() => useTranscriptStore.getState().attach(APP, ipcSource(APP))); // a view mounted, then closed:
    act(() => useTranscriptStore.getState().detach(APP)); // the store keeps its entry, and stops following
    b.turn('u-2', 'the newer prompt');
    transcript([...b.events]);
    mount(refusal, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }));
    await waitFor(() => expect(useComposerStore.getState().prefills.get(APP)).toBeDefined());
    expect(useComposerStore.getState().prefills.get(APP)).toMatchObject({ text: 'the newer prompt', editing: { messageUuid: 'u-2', seenCursor: 'u-2' } });
  });

  it('prefills nothing until the answer is delivered', async () => {
    const b = builder();
    b.turn('u-1', 'fix the build');
    transcript(b.events);
    outcome = 'write_failed';
    mount(refusal, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }));
    await screen.findByText("Couldn't deliver the answer");
    expect(useComposerStore.getState().prefills.size).toBe(0);
  });

  it('with no human prompt in the transcript the answer is still delivered and says there is nothing to edit', async () => {
    const b = builder();
    b.turn('p-1', 'a message from a peer', 'peer');
    transcript(b.events);
    mount(refusal, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'dialog', behavior: 'completed', result: 'edit_prompt' }]));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['No prompt to edit']));
    expect(useComposerStore.getState().prefills.size).toBe(0);
  });
});

describe('request card placements and delivery states', () => {
  it('the question form submits every answer as question-roundtrip seq 138 recorded, once complete', async () => {
    mount(question, 'inline');
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    expect(screen.getByTitle('Preview of Red').getAttribute('sandbox')).toBe(''); // no allow-scripts, no allow-same-origin
    expect(screen.getByTitle('Preview of Red').getAttribute('srcdoc')).toContain('This is a red preview');
    expect((submit as HTMLButtonElement).disabled).toBe(true); // the fruits are still unanswered
    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pear' }));
    await user.click(submit);
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' } }]));
  });

  it('the elicitation form for pass2/dialogs seq 41 has one required text input and accepts { color: teal }', async () => {
    mount(elicitation, 'inline');
    expect(screen.getByText('MAWS probe: pick a color')).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Color (required)' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(screen.getByRole('alert').textContent).toBe('Color is required');
    expect(answers()).toEqual([]);
    await user.type(input, 'teal');
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'elicitation', action: 'accept', content: { color: 'teal' } }]));
  });

  it('an elicitation whose schema the form cannot map leaves Decline as the only action; Esc cancels nothing', async () => {
    const nested = { ...elicitation, payload: { ...((elicitation as Extract<RequestEvent, { kind: 'elicitation.requested' }>).payload as object), requested_schema: { type: 'object', properties: { address: { type: 'object' } } } } } as RequestEvent;
    mount(nested, 'docked');
    expect(screen.getByText(/MAWS cannot show this form: address/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    focusOn(frame());
    await press('{Escape}');
    await press('{Enter}');
    expect(answers()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'elicitation', action: 'decline' }]));
  });

  it("the plan's Clear context and implement confirms once and sends clear_and_implement with no feedback", async () => {
    mount(plan, 'inline');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Clear context and implement' }));
    expect(answers()).toEqual([]);
    expect(screen.getByRole('alert').textContent).toContain('This resets the conversation and starts a fresh turn seeded with the plan');
    await user.click(screen.getByRole('button', { name: 'Clear and implement' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'clear_and_implement', feedback: null }]));
  });

  it("the plan's Esc opens the feedback box and its Enter sends keep_planning with the feedback", async () => {
    mount(plan, 'docked');
    focusOn(frame());
    await press('{Escape}');
    const box = screen.getByRole('textbox', { name: 'What should change in the plan' });
    expect(document.activeElement).toBe(box);
    await userEvent.setup().type(box, 'split step 2{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'keep_planning', feedback: 'split step 2' }]));
  });

  it('docked, the scope group offers the grant scopes; digits pick, Enter allows the picked scope', async () => {
    mount(reapply, 'docked');
    expect(screen.getByText('Approval needed')).toBeTruthy(); // the frame's title
    const scopes = within(screen.getByRole('radiogroup', { name: 'Allow scope' }));
    expect(scopes.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Allow once', 'Allow for this session', 'Always allow touch granted.txt in this project']);
    expect(scopes.getByRole('radio', { name: 'Allow once' }).getAttribute('aria-checked')).toBe('true');
    focusOn(frame());
    await press('2');
    expect(scopes.getByRole('radio', { name: 'Allow for this session' }).getAttribute('aria-checked')).toBe('true');
    await press('{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'session' }]));
  });

  it('docked with the request still loading, digits reach the frame that mounts once it arrives', async () => {
    const item = itemFor(reapply, APP);
    render(
      <Pane>
        <RequestCard item={item} request={null} placement="docked" paneIndex={0} />
      </Pane>,
    );
    expect(screen.queryByRole('group')).toBeNull(); // the skeleton is not framed
    await act(() => fake.reply('attention.request', { event: reapply }));
    focusOn(frame());
    await press('2');
    expect(screen.getByRole('radio', { name: 'Allow for this session' }).getAttribute('aria-checked')).toBe('true');
  });

  it("Enter in the Deny… with a reason textarea is a newline; ⌘Enter sends the deny with the reason", async () => {
    mount(reapply, 'docked');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Deny… with a reason' }));
    const box = screen.getByRole('textbox', { name: 'Reason for denying' });
    await user.type(box, 'not here{Enter}try /tmp');
    expect((box as HTMLTextAreaElement).value).toBe('not here\ntry /tmp');
    expect(answers()).toEqual([]);
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny', message: 'not here\ntry /tmp' }]));
  });

  it('the caret menu denies and stops the turn', async () => {
    mount(reapply, 'inline');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More deny options' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deny and stop the turn' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny_and_stop' }]));
  });

  it('a default_to_no request never answers on Enter: it says to use the Allow button, which still allows', async () => {
    mount(permission({ defaultToNo: true, suggestions: [] }), 'docked');
    expect(screen.getByRole('radio', { name: 'Allow once' }).getAttribute('aria-checked')).toBe('false');
    focusOn(frame());
    await press('{Enter}');
    await press('1');
    expect(screen.getByRole('status').textContent).toBe('Use the Allow button for this request');
    expect(screen.getByRole('radio', { name: 'Allow once' }).getAttribute('aria-checked')).toBe('false'); // digits disabled
    expect(answers()).toEqual([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Allow once' }));
    await user.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
  });

  it.each(['docked', 'card', 'inline'] as const)('a requires_user_interaction Read has no Allow, no scope group and no Enter or digit approval (%s)', async (placement) => {
    mount(flaggedRead, placement);
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText(/Read needs its own approval surface, which MAWS does not have/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
    expect(bindingsOf('request.accept')).toEqual([]);
    focusOn(placement === 'docked' ? frame() : placement === 'card' ? article() : screen.getByRole('button', { name: 'Deny' }));
    await press('1');
    await press('{Escape}'); // Esc still denies where the card holds keys
    if (placement === 'inline') expect(answers()).toEqual([]);
    else await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }]));
  });

  it('delivered collapses to one line, not_pending says so for two seconds and closes, write_failed offers Retry', async () => {
    const first = mount(unflaggedRead, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Answered · Allowed once')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    first.view.unmount();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    outcome = 'not_pending';
    const second = mount(unflaggedRead, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('Already answered elsewhere')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_000));
    expect(second.view.container.querySelector('[data-request-card]')).toBeNull();
    second.view.unmount();
    vi.useRealTimers();

    outcome = 'write_failed';
    mount(unflaggedRead, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText("Couldn't deliver the answer")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement).disabled).toBe(false); // back to pending
    outcome = 'delivered';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Answered · Allowed once')).toBeTruthy();
    expect(answers().slice(-2)).toEqual([
      { kind: 'permission', decision: 'allow', scope: 'once' }, // the failed write
      { kind: 'permission', decision: 'allow', scope: 'once' }, // the same answer again
    ]);
  });

  it('an item already delivered when the card mounts renders the collapsed line', () => {
    mount(unflaggedRead, 'card', { state: 'delivered' });
    expect(screen.getByRole('status').textContent).toBe('Answered');
    expect(bindingsOf('request.accept')).toEqual([]);
  });

  it('fetches the request through the attention store when the placement passes none, showing a skeleton meanwhile', async () => {
    fake = fakeClient({ 'session.answer': () => ({ outcome }) });
    window.maws = fake.client;
    const item = itemFor(reapply, APP);
    render(<RequestCard item={item} request={null} placement="inline" paneIndex={null} />);
    expect(screen.getByText('Loading the request…')).toBeTruthy();
    await act(() => fake.reply('attention.request', { event: reapply }));
    expect(screen.getByRole('heading', { name: 'Bash' })).toBeTruthy();
    expect(fake.invoked('attention.request')).toEqual([{ appSessionId: APP, requestId: reapply.requestId }]);
    expect(useAttention.getState().requests.get(item.id)).toEqual(reapply);
  });

  describe('the hover placement', () => {
    it('offers Approve and Deny for an unflagged Read, answering by pointer only', async () => {
      mount(unflaggedRead, 'hover');
      const approve = screen.getByRole('button', { name: 'Approve' });
      expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
      expect(screen.getByTestId('request-input').textContent).toBe('/tmp/maws-c7-scratch/README.md');
      focusOn(approve);
      await press('{Enter}');
      fireEvent.click(approve, { detail: 1 }); // no pointer press before it
      expect(answers()).toEqual([]);
      await userEvent.setup().click(approve);
      await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
    });

    it.each([
      ['a Bash request', reapply],
      ['a question', question],
      ['a flagged Read', flaggedRead],
    ])('shows only Open session for %s', (_, event) => {
      mount(event, 'hover');
      expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['tab 0', 'Open session']);
      expect(bindingsOf('request.accept')).toEqual([]);
    });
  });
});

describe('card focus owner is the Overview article', () => {
  function Articles() {
    const a = itemFor(reapply, 'app-a');
    const b = itemFor({ ...reapply, requestId: 'req-b' } as RequestEvent, 'app-b');
    return (
      <Pane>
        <Card event={reapply} placement="card" item={a} />
        <Card event={{ ...reapply, requestId: 'req-b' } as SessionEvent} placement="card" item={b} />
      </Pane>
    );
  }

  it('Enter and Esc on the focused article answer through the dispatcher, and only that article', async () => {
    render(<Articles />);
    const [first, second] = screen.getAllByRole('article');
    focusOn(second);
    await press('{Enter}');
    await waitFor(() => expect(fake.invoked('session.answer')).toEqual([{ appSessionId: 'app-b', requestId: 'req-b', answer: { kind: 'permission', decision: 'allow', scope: 'once' } }]));
    focusOn(first);
    await press('{Escape}');
    await waitFor(() => expect(fake.invoked('session.answer').at(-1)).toEqual({ appSessionId: 'app-a', requestId: reapply.requestId, answer: { kind: 'permission', decision: 'deny' } }));
  });

  it('a card without a focusable ancestor binds to its own root', () => {
    render(<RequestCard item={itemFor(reapply, APP)} request={reapply} placement="card" paneIndex={null} />);
    const [binding] = bindingsOf('request.accept');
    expect(binding.within?.current).toBe(document.querySelector('[data-request-card]'));
  });

  it('two docked cards in two panes: Enter with focus in one answers that one only', async () => {
    render(
      <>
        <Pane index={0}>
          <RequestCard item={itemFor(reapply, 'app-a')} request={reapply} placement="docked" paneIndex={0} />
        </Pane>
        <Pane index={1}>
          <RequestCard item={itemFor({ ...reapply, requestId: 'req-b' } as RequestEvent, 'app-b')} request={{ ...reapply, requestId: 'req-b' } as SessionEvent} placement="docked" paneIndex={1} />
        </Pane>
      </>,
    );
    const frames = screen.getAllByRole('group', { name: 'Approval needed' });
    focusOn(frames[1]);
    await press('{Enter}');
    await waitFor(() => expect(fake.invoked('session.answer')).toHaveLength(1));
    expect(fake.invoked('session.answer')[0]).toMatchObject({ appSessionId: 'app-b' });
  });
});

describe('a card whose item changes starts over (C5 renders the slot unkeyed)', () => {
  const inArticle = (event: RequestEvent) => (
    <Pane>
      <Card event={event} placement="card" item={itemFor(event, APP)} />
    </Pane>
  );

  it('the next request in the same Overview card inherits neither the delivery nor the picked scope', async () => {
    const view = render(inArticle(reapply));
    focusOn(article());
    await press('2');
    expect(screen.getByRole('radio', { name: 'Allow for this session' }).getAttribute('aria-checked')).toBe('true');
    view.rerender(inArticle({ ...reapply, requestId: 'req-next' } as RequestEvent));
    expect(screen.getByRole('radio', { name: 'Allow once' }).getAttribute('aria-checked')).toBe('true'); // not a scope nobody picked here
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('Answered · Denied')).toBeTruthy();
    view.rerender(inArticle({ ...reapply, requestId: 'req-third' } as RequestEvent));
    expect(screen.queryByText(/Answered/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
  });
});
