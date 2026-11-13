import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf, bareOf } from '@shared/machine/address';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { commentsMessage } from '@shared/anchor/message'; // UX wave U5a
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { project, record, status } from '../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { BUTTON_LIKE_INPUTS, connectKeys } from '../keymap/dispatcher';
import { bindingsOf } from '../keymap/useKeyChord';
import { selectPendingOf, useAttention } from '../stores/attention';
import { resetComposerStore, useComposerStore } from '../stores/composer';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { useHosts } from '../stores/hosts';
import { applyRemoteSession, resetRemoteLaneBStore } from '../lane-b/remote-session';
import { remoteSessionState } from '../lane-b/test-support/remote-session';
import { hostStatus, supervisorStatus } from '../test-support/host-status';
import { resetShellStores } from '../test-support/shell-stores';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { currentSet } from '../stores/layout-model';
import { ipcSource, useTranscriptStore } from '../transcript';
import { builder, uuid } from '../transcript/model/test-events';
import { HEADINGS as PREVIEW_HEADINGS } from '../sidebar/RequestPreview';
import { BUTTON_LIKE_INPUTS as CARD_INPUTS, HEADINGS, RequestCard, type Placement } from './RequestCard';
import { fixtureRequest, itemFor, permission, syntheticRequest, type RequestEvent } from './test-requests';

const APP = at('app-test' as AppSessionId);
const MAIN_APP = bareOf(APP); // P5 O6 M2: as main (the fake bridge) is asked
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
  window.maws = fake.client as unknown as PreloadBridge;
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  for (const key of Object.keys(useTranscriptStore.getState().entries)) useTranscriptStore.getState().drop(key);
  delete (window as { maws?: PreloadBridge }).maws;
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
// UC-1 (§C): after a delivered answer the card stands as it was, `button` disabled, and draws no "Answered" line
const sentAsItWas = async (button: string) => {
  await waitFor(() => expect((screen.getAllByRole('button', { name: button }).at(-1) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.queryByText(/Answered/)).toBeNull();
};
const focusOn = (element: HTMLElement) => act(() => element.focus());
const frame = () => document.querySelector<HTMLElement>('[data-docked-frame]')!; // a multi-select question is a named group too
const article = () => screen.getByRole('article');
// UX wave U1a (§D): a permission prompt's keys, as the dispatcher reads them, and the 400 ms they wait after it appears
const CMD_ENTER = { key: 'Enter', code: 'Enter', metaKey: true };
const SHIFT_CMD_ENTER = { key: 'Enter', code: 'Enter', metaKey: true, shiftKey: true };
const ESCAPE = { key: 'Escape', code: 'Escape' };
const keyAt = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
const KEY_GRACE_MS = 400;
const graceOver = () => act(() => void vi.advanceTimersByTime(KEY_GRACE_MS));
const flush = () => act(async () => {});
// A button's name as a reader hears it: its text without what is hidden from the accessibility tree (a key hint)
const nameOf = (b: HTMLElement) =>
  b.getAttribute('aria-label') ?? [...b.childNodes].filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true')).map((n) => n.textContent).join('').trim();
// The buttons that answer a permission prompt, left to right (the quiet reason button and the two carets aside)
const answerButtons = () => screen.queryAllByRole('button').map(nameOf).filter((name) => !/^tab \d|^Deny… with a reason$|^More (deny|allow) options$/.test(name));

const refusal = syntheticRequest('refusal-fallback-dialog');
const autoFallback = syntheticRequest('auto-mode-fallback-dialog');
const undeclared = syntheticRequest('undeclared-dialog');
const flaggedRead = syntheticRequest('flagged-read');
const unflaggedRead = syntheticRequest('flagged-read', (r) => delete r.requires_user_interaction);
const reapply = fixtureRequest('pass2', 'grant-reapply-start', 30);
const question = fixtureRequest('pass1', 'question-roundtrip', 137);
const skippedQuestion = fixtureRequest('pass3', 'question-deny', 108); // the probe's question skipped by a plain deny
// question-roundtrip's form with its previews dropped: picks must still wait for Next
const withoutPreviews = { ...question, questions: (question as Extract<RequestEvent, { kind: 'question.requested' }>).questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o, preview: null })) })) } as RequestEvent;
const elicitation = fixtureRequest('pass2', 'dialogs', 41);
const plan = { ...permission(), kind: 'plan.requested', plan: '# Plan\n\n1. Split the parser\n2. Test it', input: {} } as Extract<RequestEvent, { kind: 'plan.requested' }>;

it('reads C5’s kind lines and button-like inputs, the same objects, not copies', () => {
  expect(HEADINGS).toBe(PREVIEW_HEADINGS);
  expect(CARD_INPUTS).toBe(BUTTON_LIKE_INPUTS);
});

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
        { type: 'text', text: `fix the <\\pasted_content> build\n\n<pasted_content id="1a2b">\n${body}\n</pasted_content id="1a2b">\n` }, // a typed tag, neutralised
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
    // W3 (B6): the prompt's own bubble is edited in place, as a bubble's Edit edits it; nothing goes into the composer
    await waitFor(() => expect(useComposerStore.getState().inlineEdits.get(APP)).toBeDefined());
    const edit = useComposerStore.getState().inlineEdits.get(APP)!;
    expect(edit.text).toMatch(/^fix the <pasted_content> build\[Pasted text #1 \+3 lines\]/); // as typed, as history recall has it
    expect(edit.bodies).toEqual({ '[Pasted text #1 +3 lines]': body });
    expect(edit.images).toEqual([{ name: expect.any(String), mediaType: 'image/png', data: 'iVBORw0KGgo=' }]);
    expect(edit).toMatchObject({ messageUuid: 'u-1', seenCursor: 'u-1', kind: 'edit' });
    expect(useComposerStore.getState().prefills.get(APP)).toBeUndefined();
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
    await waitFor(() => expect(useComposerStore.getState().inlineEdits.get(APP)).toBeDefined());
    expect(useComposerStore.getState().inlineEdits.get(APP)).toMatchObject({ text: 'the newer prompt', messageUuid: 'u-2', seenCursor: 'u-2' });
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

  // UX wave U5a (M5; Decision Log 49): a message of several comments is the prompt the refusal interrupted, and its text
  // cannot be edited in place (one text cannot hold the comments' framing): the dialog offers Retry and Cancel only, and
  // never answers edit_prompt for it, also when the transcript changed between the render and the click.
  const SEVERAL = commentsMessage(
    [
      { anchor: { kind: 'browser-element', label: 'Save button', locator: 'form > button.save', pageUrl: 'https://example.com/signup' }, text: 'Make this primary.', screenshot: false },
      { anchor: { kind: 'browser-element', label: 'Page title', locator: 'main > h1', pageUrl: 'https://example.com/signup' }, text: 'Shorter.', screenshot: false },
    ],
    'main',
  );
  const held = async () => {
    await act(() => useTranscriptStore.getState().attach(APP, ipcSource(APP))); // a view mounted, then closed: the store keeps its entry
    act(() => useTranscriptStore.getState().detach(APP));
  };

  // Decision Log 52 (3): the render-time answer reads only rows a holder follows now; a kept entry nobody follows (the
  // overview's and the hover card's hosts attach none) may be older than the session, so the button is offered and
  // the click reads again
  it('a followed transcript whose turn was opened by a message of several comments: no Edit prompt, only Retry and Cancel; offered again once nobody follows it', async () => {
    const b = builder();
    b.turn('u-1', 'an earlier prompt');
    b.end(['u-1']);
    b.turn('u-2', SEVERAL);
    transcript(b.events);
    await act(() => useTranscriptStore.getState().attach(APP, ipcSource(APP))); // a view follows the session
    mount(refusal, 'inline');
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry with claude-sonnet-5' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    act(() => useTranscriptStore.getState().detach(APP)); // the view closes while the card is mounted
    expect(screen.getByRole('button', { name: 'Edit prompt' })).toBeTruthy();
  });

  it('a kept entry nobody follows, whose last prompt was several comments: Edit prompt is offered, and a click on a current plain prompt edits it', async () => {
    const b = builder();
    b.turn('u-1', 'an earlier prompt');
    b.end(['u-1']);
    b.turn('u-2', SEVERAL);
    b.end(['u-2']);
    transcript([...b.events]);
    await held(); // the kept entry ends on the several comments
    b.turn('u-3', 'a newer plain prompt');
    transcript([...b.events]);
    mount(refusal, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Edit prompt' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'dialog', behavior: 'completed', result: 'edit_prompt' }]));
    await waitFor(() => expect(useComposerStore.getState().inlineEdits.get(APP)).toMatchObject({ text: 'a newer plain prompt', messageUuid: 'u-3', kind: 'edit' }));
  });

  it('a prompt that became a message of several comments between the render and the click: no edit_prompt, Retry and Cancel stay', async () => {
    const b = builder();
    b.turn('u-1', 'an earlier prompt');
    b.end(['u-1']);
    transcript([...b.events]);
    await held();
    mount(refusal, 'inline');
    const edit = screen.getByRole('button', { name: 'Edit prompt' });
    b.turn('u-2', SEVERAL);
    transcript([...b.events]);
    fireEvent.click(edit);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull());
    await flush();
    expect(answers()).toEqual([]);
    expect(useComposerStore.getState().inlineEdits.get(APP)).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Retry with claude-sonnet-5' })).toBeTruthy();
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
  it('opens links and files from a standalone plan in the requesting session', async () => {
    mount({ ...plan, plan: '[Website](https://example.com)\n\n[Source](/r/app.ts#L7)' } as RequestEvent, 'docked');
    fireEvent.click(await screen.findByRole('link', { name: 'Website' }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://example.com/' }]);
    fireEvent.click(screen.getByTitle('/r/app.ts'));
    expect(currentSet(useLayout.getState().main).panes.flatMap((pane) => pane.tabs)).toContainEqual(expect.objectContaining({ kind: 'file', path: '/r/app.ts', line: 7, appSessionId: APP, machine: TEST_MACHINE }));
  });

  it.each(['constructor', 'toString', '__proto__'])('renders and submits a question named %s', async (text) => {
    if (question.kind !== 'question.requested') throw new Error('question fixture');
    mount({ ...question, questions: [{ ...question.questions[0], question: text }] }, 'inline');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { [text]: 'Red' } }]));
  });

  // W4: one question at a time, every answer sent as the one reply (question-roundtrip seq 138).
  it('the question card steps through the questions and submits every answer as question-roundtrip seq 138 recorded', async () => {
    mount(question, 'inline');
    const user = userEvent.setup();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('Which color do you prefer?')).toBeTruthy();
    expect(screen.queryByText('Which fruits do you like?')).toBeNull(); // one question at a time
    const next = screen.getByRole('button', { name: 'Next' });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    expect(screen.getByTitle('Preview of Red').getAttribute('sandbox')).toBe(''); // no allow-scripts, no allow-same-origin
    expect(screen.getByTitle('Preview of Red').getAttribute('srcdoc')).toContain('This is a red preview');
    expect(screen.getByText('1 of 2')).toBeTruthy(); // a question with previews waits for Next
    await user.click(next);
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getByText('Which fruits do you like?')).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pear' }));
    expect(answers()).toEqual([]); // nothing leaves before Submit
    await user.click(submit);
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' } }]));
    await sentAsItWas('Submit'); // UC-1: the card stands, sent, until its item leaves the list
  });

  it.each(['inline', 'docked', 'card'] as const)('a single-select pick in %s waits for Next and can be changed, with the pager retaining the answer', async (placement) => {
    mount(withoutPreviews, placement);
    const user = userEvent.setup();
    expect((screen.getByRole('button', { name: 'Show next question' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Blue' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 250))); // beyond the former auto-advance delay
    expect(screen.getByText('1 of 2')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    expect(screen.getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true');
    expect(answers()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2 of 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show previous question' }));
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true'); // the changed pick is kept
    await user.click(screen.getByRole('button', { name: 'Show next question' }));
    expect(screen.getByText('2 of 2')).toBeTruthy();
  });

  it('Other moves on with Next or Enter in its box, and its text is the answer', async () => {
    mount(question, 'inline');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Other…' }));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true); // blank is no answer
    await user.type(screen.getByRole('textbox', { name: 'Other answer to Which color do you prefer?' }), 'Teal{Enter}');
    expect(screen.getByText('2 of 2')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Pear' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Which color do you prefer?': 'Teal', 'Which fruits do you like?': 'Pear' } }]));
  });

  it('Skip leaves a question out of the reply; skipping the last sends the rest, and skipping every one sends none', async () => {
    const first = mount(question, 'inline');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByText('2 of 2')).toBeTruthy();
    await user.click(screen.getByRole('checkbox', { name: 'Apple' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Which fruits do you like?': 'Apple' } }]));
    first.view.unmount();
    mount(skippedQuestion, 'inline');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(answers().at(-1)).toEqual({ kind: 'question', answers: {} })); // the engine: "The user did not answer the questions."
    await sentAsItWas('Skip');
  });

  it('the picks live beside the request: a remount, or the same item in another placement, resumes at the same question', async () => {
    const first = mount(question, 'inline');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('checkbox', { name: 'Pear' }));
    first.view.unmount();
    mount(question, 'docked');
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Pear' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Show previous question' }));
    expect(screen.getByRole('radio', { name: 'Red' }).getAttribute('aria-checked')).toBe('true');
  });

  it('docked, digits pick, Enter is Next then Submit, and focus stays with the frame across the steps', async () => {
    mount(question, 'docked');
    focusOn(frame());
    await press('{Enter}');
    expect(screen.getByText('1 of 2')).toBeTruthy(); // nothing chosen: Enter does nothing
    await press('2');
    expect(screen.getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')).toBe('true');
    await press('{Enter}');
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(document.activeElement).toBe(frame());
    await press('1');
    await press('2');
    await press('{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Which color do you prefer?': 'Blue', 'Which fruits do you like?': 'Apple, Pear' } }]));
  });

  it('Next keeps focus in the docked frame and the frame can continue with digits and Enter', async () => {
    mount(withoutPreviews, 'docked');
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(frame().contains(document.activeElement)).toBe(true);
    focusOn(frame());
    await press('1');
    await press('{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple' } }]));
  });

  it('a shared question advancing in the docked pane restores focus there, not to the Overview article', async () => {
    const item = itemFor(withoutPreviews, APP);
    render(
      <>
        <Pane>
          <Card event={withoutPreviews} placement="card" item={item} />
        </Pane>
        <Pane index={1}>
          <Card event={withoutPreviews} placement="docked" item={item} />
        </Pane>
      </>,
    );
    const user = userEvent.setup();
    await user.click(within(frame()).getByRole('radio', { name: 'Red' }));
    await user.click(within(frame()).getByRole('button', { name: 'Next' }));
    expect(screen.getAllByText('2 of 2')).toHaveLength(2);
    expect(frame().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(article());
  });

  it('Esc declines the whole question with the plain permission deny pass3/question-deny seq 110 recorded, docked and on the Overview card', async () => {
    const first = mount(skippedQuestion, 'docked');
    focusOn(frame());
    await press('{Escape}');
    // the answer C3's broker writes as the recorded deny (broker.test.ts pins the wire over the same fixture)
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }]));
    await sentAsItWas('Skip');
    first.view.unmount();
    mount(question, 'card');
    focusOn(article());
    await press('{Escape}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }, { kind: 'permission', decision: 'deny' }]));
  });

  it('the Overview card steps with digits and Enter on its article', async () => {
    mount(question, 'card');
    focusOn(article());
    await press('1');
    await press('{Enter}');
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(document.activeElement).toBe(article());
    await press('2');
    await press('{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'question', answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Pear' } }]));
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

  it('docked with the request still loading, the keys reach the frame that mounts once it arrives', async () => {
    vi.useFakeTimers();
    const item = itemFor(reapply, APP);
    render(
      <Pane>
        <RequestCard item={item} request={null} placement="docked" paneIndex={0} />
      </Pane>,
    );
    expect(screen.queryByRole('group')).toBeNull(); // the skeleton is not framed
    await act(async () => {
      const replied = fake.reply('attention.request', { event: reapply });
      vi.advanceTimersByTime(0); // the fake client settles its reply on a timer
      await replied;
    });
    focusOn(frame());
    graceOver();
    keyAt(frame(), CMD_ENTER);
    await flush();
    expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]);
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

  it.each(['docked', 'card', 'inline'] as const)('a requires_user_interaction Read has no allow button and no allow key, only Deny and the sentence (%s)', async (placement) => {
    vi.useFakeTimers();
    mount(flaggedRead, placement);
    expect(screen.queryAllByRole('button').filter((b) => /^Allow|^Always allow/.test(nameOf(b) ?? ''))).toEqual([]);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText(/Read needs its own approval surface, which MAWS does not have/)).toBeTruthy();
    expect(answerButtons()).toEqual(['Deny']);
    expect(bindingsOf('request.accept')).toEqual([]);
    expect(bindingsOf('request.allowOnce')).toEqual([]);
    expect(bindingsOf('request.allowLasting')).toEqual([]);
    const owner = placement === 'docked' ? frame() : placement === 'card' ? article() : screen.getByRole('button', { name: 'Deny' });
    focusOn(owner);
    graceOver();
    for (const init of [CMD_ENTER, SHIFT_CMD_ENTER, { key: 'Enter', code: 'Enter' }, { key: '1', code: 'Digit1' }]) keyAt(owner, init);
    keyAt(owner, ESCAPE); // Esc still denies where the card holds keys
    await flush();
    if (placement === 'inline') expect(answers()).toEqual([]);
    else expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }]);
  });

  it('delivered stands as it was, disabled, with no "Answered" line; not_pending says so for two seconds and closes, write_failed offers Retry', async () => {
    const first = mount(unflaggedRead, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    await sentAsItWas('Allow once');
    first.view.unmount();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    outcome = 'not_pending';
    const second = mount(unflaggedRead, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('Already answered elsewhere')).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_000));
    // Its closing timer is set in a passive effect, which under load React can still hold queued at the advance (the text
    // is drawn before the effect runs), so the timer then starts after it: the card goes within two seconds of that.
    await waitFor(() => expect(second.view.container.querySelector('[data-request-card]')).toBeNull(), { timeout: 5_000 });
    second.view.unmount();
    vi.useRealTimers();

    outcome = 'write_failed';
    mount(unflaggedRead, 'inline');
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    expect(await screen.findByText("Couldn't deliver the answer")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Allow once' }) as HTMLButtonElement).disabled).toBe(false); // back to pending
    outcome = 'delivered';
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await sentAsItWas('Allow once');
    expect(screen.queryByText("Couldn't deliver the answer")).toBeNull();
    expect(answers().slice(-2)).toEqual([
      { kind: 'permission', decision: 'allow', scope: 'once' }, // the failed write
      { kind: 'permission', decision: 'allow', scope: 'once' }, // the same answer again
    ]);
  });

  it('fetches the request through the attention store when the placement passes none, showing a skeleton meanwhile', async () => {
    fake = fakeClient({ 'session.answer': () => ({ outcome }) });
    window.maws = fake.client as unknown as PreloadBridge;
    const item = itemFor(reapply, APP);
    render(<RequestCard item={item} request={null} placement="inline" paneIndex={null} />);
    expect(screen.getByText('Loading the request…')).toBeTruthy();
    await act(() => fake.reply('attention.request', { event: reapply }));
    expect(screen.getByRole('heading', { name: 'Run a command' })).toBeTruthy();
    expect(fake.invoked('attention.request')).toEqual([{ appSessionId: MAIN_APP, requestId: reapply.requestId }]);
    expect(useAttention.getState().requests.get(item.id)).toEqual(reapply);
  });

  it('the Manual mode remedy sends the raw default engine id for an auto-unavailable notice', async () => {
    const item = itemFor(permission(), APP, {
      kind: 'auto_mode_unavailable',
      request: { requestId: null, toolUseId: null, taskId: null, agentId: null },
      summary: 'Auto mode is unavailable for this session',
    });
    render(<RequestCard item={item} request={null} placement="inline" paneIndex={null} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to Manual mode' }));
    expect(fake.invoked('session.setPermissionMode')).toEqual([{ appSessionId: MAIN_APP, mode: 'default' }]);
  });

  it('a request the store could not read shows its notice with the failure instead of loading', () => {
    const item = itemFor(reapply, APP);
    useAttention.setState({ requests: new Map([[item.id, null]]), unreadable: new Map([[item.id, 'no host']]) });
    render(<RequestCard item={item} request={null} placement="docked" paneIndex={null} />);
    expect(screen.queryByText('Loading the request…')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('The request could not be readRetry');
    expect(useComposerStore.getState().docked.get(APP)).toBeUndefined(); // nothing docked: the transcript keeps its card
    expect(screen.getByText(item.summary)).toBeTruthy();
  });

  // UX wave U1a §H (M6, A14): the hover card offers what the one rule admits for its surface, each button gated by the
  // session's port on its own answer, by pointer click only; its layout is unchanged
  describe('the hover placement', () => {
    const hoverButtons = () => screen.queryAllByRole('button').map((b) => b.textContent);
    const LONG = ['cd /w/site', `npm run build -- --out ${'dist/'.repeat(40)}`, 'npm test'].join('\n');
    const longCommand = permission({ input: { command: LONG } });
    const edit = permission({ toolName: 'Edit', displayName: 'Edit', input: { file_path: '/w/a.ts', old_string: 'a', new_string: 'b' } });
    const defaultToNo = permission({ toolName: 'Read', displayName: 'Read', input: { file_path: '/w/notes.txt' }, defaultToNo: true });

    it('offers Allow once and Deny for an unflagged Read, answering by pointer only', async () => {
      const { item } = mount(unflaggedRead, 'hover');
      // named for its request and tool, so a reader of the hover dialog (named for the session) finds the approval
      expect(screen.getByRole('group', { name: 'Approval needed: Read' }).dataset.requestCard).toBe(item.id);
      const allow = screen.getByRole('button', { name: 'Allow once' });
      expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Open session' })).toBeTruthy();
      expect(screen.getByText('Approve applies to this request only.')).toBeTruthy();
      expect(screen.getByTestId('request-input').textContent).toBe('/tmp/maws-c7-scratch/README.md');
      focusOn(allow);
      await press('{Enter}');
      fireEvent.click(allow, { detail: 1 }); // no pointer press before it
      expect(answers()).toEqual([]);
      await userEvent.setup().click(allow);
      await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
    });

    it.each([
      ['a one-line command', reapply, 'touch granted.txt'],
      ['a command of several long lines', longCommand, LONG],
    ])('offers Allow once and Deny for %s, its preview whole', async (_, event, command) => {
      mount(event, 'hover');
      expect(hoverButtons()).toEqual(['tab 0', 'Open session', 'Deny', 'Allow once']);
      expect(screen.getByTestId('request-input').textContent).toBe(command);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Allow once' }));
      await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]));
    });

    it.each([
      ['a file change', edit],
      ['a request flagged “default to no”', defaultToNo],
      ['a request needing its own consent surface', flaggedRead],
    ])('offers Deny alone for %s, and Deny sends the plain deny', async (_, event) => {
      mount(event, 'hover');
      expect(hoverButtons()).toEqual(['tab 0', 'Open session', 'Deny']);
      expect(screen.queryByText('Approve applies to this request only.')).toBeNull();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Deny' }));
      await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }]));
    });

    it.each([
      ['a question', question],
      ['a plan', plan],
    ])('offers only Open session for %s', (_, event) => {
      mount(event, 'hover');
      expect(hoverButtons()).toEqual(['tab 0', 'Open session']);
      expect(bindingsOf('request.accept')).toEqual([]);
    });

    it('answers nothing for a click a key synthesised, on Deny and on Allow once', async () => {
      mount(reapply, 'hover');
      for (const name of ['Deny', 'Allow once']) {
        const button = screen.getByRole('button', { name });
        focusOn(button);
        await press('{Enter}');
        await press(' ');
        fireEvent.click(button, { detail: 0 });
        fireEvent.click(button, { detail: 1 }); // no pointer press before it
      }
      expect(answers()).toEqual([]);
    });
  });
});

// UX wave U1a (M3, §D; l4-approvals-02 and A3 as this landing cuts them): the permission card is one line saying what is
// asked, the preview, three buttons with their keys on them, and the rule's file line only with a project rule. ⌘↩, ⇧⌘↩ and
// Esc answer from the docked frame or a focused Overview article, on a fresh press, once the prompt has been drawn for
// 400 ms; Enter and the digits answer no permission prompt.
describe('the permission card', () => {
  const askRule = fixtureRequest('pass2', 'grant-askrule-start', 27);
  const sessionOnly = permission({ toolName: 'Read', displayName: 'Read', input: { file_path: '/w/notes.txt' } }); // once, session
  const inProject = (name: string | null) =>
    act(() =>
      useSessions.setState((s) => ({
        records: new Map(s.records).set(APP, record(APP, { projectId: name === null ? null : ('p-1' as never), directory: '/work/the-folder' })),
        projects: name === null ? s.projects : new Map(s.projects).set('p-1' as never, project('p-1', 0, { name })),
        recordsVersion: s.recordsVersion + 1,
        projectsVersion: s.projectsVersion + 1,
      })),
    );
  const ownerOf = (placement: 'docked' | 'card') => (placement === 'docked' ? frame() : article());

  describe('what it reads', () => {
    it.each(['docked', 'card', 'inline'] as const)('reads what is asked, then the preview, with no tool heading, no "wants to" line and no folder line (%s)', (placement) => {
      inProject(null);
      mount(reapply, placement);
      expect(screen.getByRole('heading', { name: 'Run a command' })).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Bash' })).toBeNull();
      expect(screen.queryByText(/wants to/)).toBeNull();
      expect(screen.queryByText('/work/the-folder')).toBeNull();
      expect(screen.queryByRole('radiogroup')).toBeNull();
      expect(screen.getByTestId('request-input').textContent).toBe('touch granted.txt');
      const card = document.querySelector('[data-request-card]')!;
      const heading = screen.getByRole('heading', { name: 'Run a command' });
      expect(heading.compareDocumentPosition(screen.getByTestId('request-input')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(card.contains(heading)).toBe(true);
    });

    // §D's order, for a tool whose preview does not carry the description itself (the review of M3): the preview, the
    // call's "Why", the engine's reason, then the buttons; a command's "Why" stays its preview's own, drawn once
    it.each(['docked', 'card', 'inline'] as const)('reads the preview, the call’s Why, the engine’s reason, then the buttons, for a tool that is not a command (%s)', (placement) => {
      mount(permission({ toolName: 'Read', displayName: 'Read', input: { file_path: '/w/notes.txt' }, description: 'Check the release notes', decisionReason: 'An ask rule in the project matched' }), placement);
      const order = [screen.getByTestId('request-input'), screen.getByText('Why: Check the release notes'), screen.getByText('An ask rule in the project matched'), screen.getByRole('button', { name: 'Deny' })];
      for (const [before, after] of order.slice(0, -1).map((node, i) => [node, order[i + 1]!] as const)) {
        expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING, after.textContent ?? '').toBeTruthy();
      }
    });

    it('draws a command’s Why once, from its preview', () => {
      mount(permission({ input: { command: 'make build', description: 'Build the site' }, description: 'Build the site' }), 'inline');
      expect(screen.getAllByText('Why: Build the site')).toHaveLength(1);
    });

    it('says who asks only when it is not the main agent', () => {
      const first = mount(permission({ agentId: 'agent-1' as never }), 'inline');
      expect(screen.getByRole('heading', { name: 'Run a command · from A subagent' })).toBeTruthy();
      first.view.unmount();
      mount(permission(), 'inline');
      expect(screen.getByRole('heading', { name: 'Run a command' })).toBeTruthy();
      expect(screen.queryByText(/from/)).toBeNull();
    });

    it('keeps the docked frame’s title and the glyph of the kind on the first line', () => {
      mount(reapply, 'docked');
      expect(frame().getAttribute('aria-label')).toBe('Approval needed');
      expect(screen.getByRole('heading', { name: 'Run a command' }).textContent).toBe('◐Run a command');
    });

    it('the hover placement keeps its layout: the tool heading, the "wants to" line and the folder line', () => {
      inProject(null);
      mount(unflaggedRead, 'hover');
      expect(screen.getByRole('heading', { name: 'Read' })).toBeTruthy();
      expect(screen.getByText('Main session wants to read a file')).toBeTruthy();
      expect(screen.getByText('/work/the-folder')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'Read a file' })).toBeNull();
    });
  });

  describe('its buttons, from the scopes the request offers', () => {
    it('an ask-rule prompt: Deny and Allow once, no lasting key, no menu on Allow once, no file line', () => {
      mount(askRule, 'docked');
      expect(answerButtons()).toEqual(['Deny', 'Allow once']);
      expect(screen.queryByRole('button', { name: 'More allow options' })).toBeNull();
      expect(bindingsOf('request.allowLasting')).toEqual([]);
      expect(bindingsOf('request.allowOnce')).toHaveLength(1);
      expect(screen.queryByText(/settings\.local\.json/)).toBeNull();
    });

    it('a session scope only: the third button reads "Allow for this session", with no menu and no file line', () => {
      mount(sessionOnly, 'docked');
      expect(answerButtons()).toEqual(['Deny', 'Allow for this session', 'Allow once']);
      expect(screen.queryByRole('button', { name: 'More allow options' })).toBeNull();
      expect(screen.queryByText(/settings\.local\.json/)).toBeNull();
    });

    it('a project rule: "Always allow in <project>", the rule’s file line, and "Allow for this session" as the one entry of the menu on Allow once', async () => {
      inProject('probe');
      mount(reapply, 'docked');
      expect(answerButtons()).toEqual(['Deny', 'Always allow in probe', 'Allow once']);
      expect(screen.getByText(/^Always allow adds/).textContent).toBe('Always allow adds touch granted.txt to .claude/settings.local.json in the project.');
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'More allow options' }));
      expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Allow for this session']);
      await user.click(screen.getByRole('menuitem', { name: 'Allow for this session' }));
      await waitFor(() => expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'session' }]));
    });

    it('names the project "this project" when the session has none', () => {
      inProject(null);
      mount(reapply, 'inline');
      expect(answerButtons()).toEqual(['Deny', 'Always allow in this project', 'Allow once']);
    });

    it.each([
      ['Allow once', { kind: 'permission', decision: 'allow', scope: 'once' }],
      ['Always allow in this project', { kind: 'permission', decision: 'allow', scope: 'local_settings' }],
      ['Deny', { kind: 'permission', decision: 'deny' }],
    ])('"%s" sends its answer once', async (name, answer) => {
      mount(reapply, 'inline');
      const button = screen.getByRole('button', { name });
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(answers()).toEqual([answer]));
      await flush();
      expect(answers()).toHaveLength(1);
    });

    it('finds each button by its name without its hint, and carries the key in aria-keyshortcuts', () => {
      mount(reapply, 'docked');
      const keys = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-keyshortcuts');
      expect(keys('Allow once')).toBe('Meta+Enter');
      expect(keys('Always allow in this project')).toBe('Meta+Shift+Enter');
      expect(keys('Deny')).toBe('Escape');
      expect(screen.getByRole('button', { name: 'Allow once' }).textContent).toBe('Allow once⌘↩');
      expect(screen.getByRole('button', { name: 'Always allow in this project' }).textContent).toBe('Always allow in this project⌘⇧↩');
      expect(screen.getByRole('button', { name: 'Deny' }).textContent).toBe('Deny⎋');
      expect(screen.queryByRole('button', { name: /⌘/ })).toBeNull();
    });

    it('prints no hint for a row the keymap leaves unbound, and binds no key for it', () => {
      // a stored rebinding of another action holds ⌘↩ (U6a's decision 10), so Allow once has no effective chord
      act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.send': 'Cmd+Enter' } }, resolvedTheme: 'light' } }));
      try {
        mount(reapply, 'docked');
        expect(screen.getByRole('button', { name: 'Allow once' }).textContent).toBe('Allow once');
        expect(screen.getByRole('button', { name: 'Allow once' }).hasAttribute('aria-keyshortcuts')).toBe(false);
        expect(bindingsOf('request.allowOnce')).toEqual([]);
        expect(screen.getByRole('button', { name: 'Deny' }).getAttribute('aria-keyshortcuts')).toBe('Escape');
      } finally {
        useSettings.setState({ state: null });
      }
    });

    it('a request flagged "default to no" binds no allow key and prints no hint on its allow buttons; the buttons still answer', async () => {
      vi.useFakeTimers();
      mount(permission({ defaultToNo: true, suggestions: [] }), 'docked');
      expect(answerButtons()).toEqual(['Deny', 'Allow for this session', 'Allow once']);
      for (const name of ['Allow once', 'Allow for this session']) {
        expect(screen.getByRole('button', { name }).textContent).toBe(name);
        expect(screen.getByRole('button', { name }).hasAttribute('aria-keyshortcuts')).toBe(false);
      }
      expect(screen.getByRole('button', { name: 'Deny' }).getAttribute('aria-keyshortcuts')).toBe('Escape');
      expect(bindingsOf('request.allowOnce')).toEqual([]);
      expect(bindingsOf('request.allowLasting')).toEqual([]);
      focusOn(frame());
      graceOver();
      for (const init of [CMD_ENTER, SHIFT_CMD_ENTER, { key: 'Enter', code: 'Enter' }]) keyAt(frame(), init);
      await flush();
      expect(answers()).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
      await flush();
      expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]);
    });
  });

  describe('its keys', () => {
    beforeEach(() => void vi.useFakeTimers());

    it.each(['docked', 'card'] as const)('⌘↩ allows once, ⇧⌘↩ gives the third button’s scope, Esc denies, from the focused owner (%s)', async (placement) => {
      for (const [init, answer] of [
        [CMD_ENTER, { kind: 'permission', decision: 'allow', scope: 'once' }],
        [SHIFT_CMD_ENTER, { kind: 'permission', decision: 'allow', scope: 'local_settings' }],
        [ESCAPE, { kind: 'permission', decision: 'deny' }],
      ] as const) {
        const { view } = mount(reapply, placement);
        focusOn(ownerOf(placement));
        graceOver();
        expect(keyAt(ownerOf(placement), init).defaultPrevented).toBe(true);
        await flush();
        expect(answers().at(-1)).toEqual(answer);
        view.unmount();
      }
      expect(answers()).toHaveLength(3);
    });

    it.each(['docked', 'card'] as const)('answers nothing at 399 ms and answers at 400 ms (%s)', async (placement) => {
      mount(reapply, placement);
      focusOn(ownerOf(placement));
      act(() => void vi.advanceTimersByTime(KEY_GRACE_MS - 1));
      for (const init of [CMD_ENTER, SHIFT_CMD_ENTER, ESCAPE]) keyAt(ownerOf(placement), init);
      await flush();
      expect(answers()).toEqual([]);
      act(() => void vi.advanceTimersByTime(1));
      keyAt(ownerOf(placement), CMD_ENTER);
      await flush();
      expect(answers()).toEqual([{ kind: 'permission', decision: 'allow', scope: 'once' }]);
    });

    it.each(['docked', 'card'] as const)('Enter and the digits answer nothing (%s)', async (placement) => {
      mount(reapply, placement);
      focusOn(ownerOf(placement));
      graceOver();
      for (const init of [{ key: 'Enter', code: 'Enter' }, { key: '1', code: 'Digit1' }, { key: '2', code: 'Digit2' }, { key: '3', code: 'Digit3' }]) keyAt(ownerOf(placement), init);
      await flush();
      expect(answers()).toEqual([]);
    });

    it('no key answers from a button or from the reason box, whose own ⌘↩ sends the deny with its reason', async () => {
      mount(reapply, 'docked');
      graceOver();
      for (const name of ['Allow once', 'Deny', 'Always allow in this project']) {
        const button = screen.getByRole('button', { name });
        focusOn(button);
        for (const init of [CMD_ENTER, SHIFT_CMD_ENTER, ESCAPE]) keyAt(button, init);
      }
      await flush();
      expect(answers()).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Deny… with a reason' }));
      const box = screen.getByRole('textbox', { name: 'Reason for denying' });
      fireEvent.change(box, { target: { value: 'not now' } });
      keyAt(box, ESCAPE);
      await flush();
      expect(answers()).toEqual([]);
      fireEvent.keyDown(box, CMD_ENTER);
      await flush();
      expect(answers()).toEqual([{ kind: 'permission', decision: 'deny', message: 'not now' }]);
    });

    it.each(['docked', 'card'] as const)('a chord pressed while an input method composes answers nothing (%s)', async (placement) => {
      mount(reapply, placement);
      focusOn(ownerOf(placement));
      graceOver();
      for (const init of [CMD_ENTER, SHIFT_CMD_ENTER, ESCAPE]) keyAt(ownerOf(placement), { ...init, isComposing: true });
      await flush();
      expect(answers()).toEqual([]);
    });

    it('a prompt that offers no allow still waits its 400 ms before Esc denies', async () => {
      mount(flaggedRead, 'docked');
      focusOn(frame());
      keyAt(frame(), ESCAPE);
      await flush();
      expect(answers()).toEqual([]);
      graceOver();
      keyAt(frame(), ESCAPE);
      await flush();
      expect(answers()).toEqual([{ kind: 'permission', decision: 'deny' }]);
    });
  });

  // Two prompts queued in one session: a chord held through the first answer must not answer the second, however long it
  // is held; the second answers to a fresh press once its own 400 ms have passed. One answer per press.
  describe('a held chord across two prompts', () => {
    const second = { ...reapply, requestId: 'req-second', toolUseId: 'toolu_second' } as RequestEvent;
    const events = new Map<string | null, SessionEvent>([[reapply.requestId, reapply], [second.requestId, second]]);
    function Queue({ placement }: { placement: 'docked' | 'card' }) {
      const item = useAttention((s) => selectPendingOf(s, APP)[0] ?? null);
      return item === null ? null : <Card event={events.get(item.request.requestId)!} placement={placement} item={item} />;
    }
    const list = (items: AttentionItem[]) => act(() => useAttention.getState().applySnapshot(items, TEST_MACHINE));
    const sent = () => fake.invoked('session.answer').map((input) => (input as { requestId: string; answer: unknown }));

    beforeEach(() => void vi.useFakeTimers());

    it.each([
      ['⌘↩', 'docked', CMD_ENTER, { kind: 'permission', decision: 'allow', scope: 'once' }],
      ['⇧⌘↩', 'docked', SHIFT_CMD_ENTER, { kind: 'permission', decision: 'allow', scope: 'local_settings' }],
      ['Esc', 'docked', ESCAPE, { kind: 'permission', decision: 'deny' }],
      ['⌘↩', 'card', CMD_ENTER, { kind: 'permission', decision: 'allow', scope: 'once' }],
      ['⇧⌘↩', 'card', SHIFT_CMD_ENTER, { kind: 'permission', decision: 'allow', scope: 'local_settings' }],
      ['Esc', 'card', ESCAPE, { kind: 'permission', decision: 'deny' }],
    ] as const)('%s held on the %s placement answers the first prompt and not the second', async (_name, placement, chord, answer) => {
      const [a, b] = [itemFor(reapply, APP), itemFor(second, APP)];
      list([a, b]);
      render(<Pane><Queue placement={placement} /></Pane>);
      focusOn(ownerOf(placement));
      graceOver();
      keyAt(ownerOf(placement), chord); // the first, fresh press
      await flush();
      expect(sent()).toEqual([{ appSessionId: MAIN_APP, requestId: reapply.requestId, answer }]);
      list([b]); // the publisher lets the answered item go; the second prompt takes its place
      const owner = ownerOf(placement);
      expect(document.activeElement).toBe(owner); // docked: the second prompt's frame took focus from the first
      expect(document.querySelector(`[data-request-card="${b.id}"]`)).not.toBeNull();
      const seen: boolean[] = [];
      const after = (event: KeyboardEvent) => void seen.push(event.defaultPrevented);
      window.addEventListener('keydown', after);
      for (let elapsed = 0; elapsed < 3 * KEY_GRACE_MS; elapsed += 50) {
        act(() => void vi.advanceTimersByTime(50));
        keyAt(owner, { ...chord, repeat: true });
      }
      window.removeEventListener('keydown', after);
      await flush();
      expect(sent()).toHaveLength(1);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every(Boolean)).toBe(true); // every repeat was taken: no other handler acts on it
      owner.dispatchEvent(new KeyboardEvent('keyup', { key: chord.key, code: chord.code, bubbles: true }));
      keyAt(owner, chord); // let go and pressed again
      await flush();
      expect(sent()).toEqual([
        { appSessionId: MAIN_APP, requestId: reapply.requestId, answer },
        { appSessionId: MAIN_APP, requestId: second.requestId, answer },
      ]);
    });
  });
});

describe('card focus owner is the Overview article', () => {
  function Articles() {
    const a = itemFor(reapply, at('app-a'));
    const b = itemFor({ ...reapply, requestId: 'req-b' } as RequestEvent, at('app-b'));
    return (
      <Pane>
        <Card event={reapply} placement="card" item={a} />
        <Card event={{ ...reapply, requestId: 'req-b' } as SessionEvent} placement="card" item={b} />
      </Pane>
    );
  }

  it('⌘↩ and Esc on the focused article answer through the dispatcher, and only that article', async () => {
    vi.useFakeTimers();
    render(<Articles />);
    const [first, second] = screen.getAllByRole('article');
    graceOver();
    focusOn(second);
    keyAt(second, CMD_ENTER);
    await flush();
    expect(fake.invoked('session.answer')).toEqual([{ appSessionId: 'app-b', requestId: 'req-b', answer: { kind: 'permission', decision: 'allow', scope: 'once' } }]);
    focusOn(first);
    keyAt(first, ESCAPE);
    await flush();
    expect(fake.invoked('session.answer').at(-1)).toEqual({ appSessionId: 'app-a', requestId: reapply.requestId, answer: { kind: 'permission', decision: 'deny' } });
  });

  it('a card without a focusable ancestor binds to its own root', () => {
    render(<RequestCard item={itemFor(reapply, APP)} request={reapply} placement="card" paneIndex={null} />);
    const [binding] = bindingsOf('request.allowOnce');
    expect(binding.within?.current).toBe(document.querySelector('[data-request-card]'));
  });

  it('two docked cards in two panes: ⌘↩ with focus in one answers that one only', async () => {
    vi.useFakeTimers();
    render(
      <>
        <Pane index={0}>
          <RequestCard item={itemFor(reapply, at('app-a'))} request={reapply} placement="docked" paneIndex={0} />
        </Pane>
        <Pane index={1}>
          <RequestCard item={itemFor({ ...reapply, requestId: 'req-b' } as RequestEvent, at('app-b'))} request={{ ...reapply, requestId: 'req-b' } as SessionEvent} placement="docked" paneIndex={1} />
        </Pane>
      </>,
    );
    const frames = screen.getAllByRole('group', { name: 'Approval needed' });
    graceOver();
    focusOn(frames[1]);
    keyAt(frames[1], CMD_ENTER);
    await flush();
    expect(fake.invoked('session.answer')).toHaveLength(1);
    expect(fake.invoked('session.answer')[0]).toMatchObject({ appSessionId: 'app-b' });
  });
});

// UC-1 (§C, decision 2): the list decides when a card goes. After its answer is delivered the card stands as it was, its
// controls disabled, until its item is no longer in the session's list; it draws no "Answered" line in between.
describe('the card after an answer', () => {
  // A placement as every host draws one: the session's oldest waiting item, from the store
  function Listed({ placement, event }: { placement: Placement; event: SessionEvent }) {
    const item = useAttention((s) => selectPendingOf(s, APP)[0] ?? null);
    return item === null ? null : <Card event={event} placement={placement} item={item} />;
  }
  const list = (items: AttentionItem[]) => act(() => useAttention.getState().applySnapshot(items, TEST_MACHINE));
  const card = () => document.querySelector('[data-request-card]');
  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('after a delivered outcome draws no "Answered" text, its controls disabled, and goes when its item leaves the list', async () => {
    const item = itemFor(unflaggedRead, APP);
    list([item]);
    render(<Pane><Listed placement="inline" event={unflaggedRead} /></Pane>);
    fireEvent.click(button('Allow once'));
    await waitFor(() => expect(answers()).toHaveLength(1));
    await act(async () => {});
    expect(screen.queryByText(/Answered/)).toBeNull();
    expect(button('Allow once').disabled).toBe(true);
    expect(button('Deny').disabled).toBe(true);
    list([]);
    expect(card()).toBeNull();
  });

  it('goes the same when its item leaves the list before the outcome arrives', async () => {
    fake = fakeClient({ 'session.events': () => ({ events: [], lastSeq: 0, complete: true }) }); // session.answer held open
    window.maws = fake.client as unknown as PreloadBridge;
    const item = itemFor(unflaggedRead, APP);
    list([item]);
    render(<Pane><Listed placement="inline" event={unflaggedRead} /></Pane>);
    fireEvent.click(button('Allow once'));
    await waitFor(() => expect(fake.invoked('session.answer')).toHaveLength(1));
    list([]); // the broker told its list before session.answer returned
    expect(card()).toBeNull();
    await act(() => fake.reply('session.answer', { outcome: 'delivered' }));
    expect(card()).toBeNull();
    expect(screen.queryByText(/Answered/)).toBeNull();
  });

  it('stands, sent and disabled, while a delivered answer’s item is still listed', async () => {
    list([itemFor(unflaggedRead, APP)]);
    render(<Pane><Listed placement="card" event={unflaggedRead} /></Pane>);
    fireEvent.click(button('Allow once'));
    await waitFor(() => expect(answers()).toHaveLength(1));
    await act(async () => {});
    expect(card()).not.toBeNull();
    expect(screen.queryByText(/Answered/)).toBeNull();
    expect(button('Allow once').disabled).toBe(true);
    expect(bindingsOf('request.accept')).toEqual([]);
  });

  // A17: an item whose state is delivered (only a machine on an older build still sends one) is drawn nowhere
  it.each(['docked', 'card', 'hover', 'inline'] as const)('draws nothing for an item of state delivered, %s, and binds no key', (placement) => {
    const { view } = mount(unflaggedRead, placement, { state: 'delivered' });
    expect(view.container.querySelector('[data-request-card]')).toBeNull();
    expect(screen.queryByText(/Answered/)).toBeNull();
    expect(bindingsOf('request.accept')).toEqual([]);
    expect(bindingsOf('request.decline')).toEqual([]);
  });
});

describe('a card whose item changes starts over (C5 renders the slot unkeyed)', () => {
  const inArticle = (event: RequestEvent) => (
    <Pane>
      <Card event={event} placement="card" item={itemFor(event, APP)} />
    </Pane>
  );

  it('the next request in the same Overview card inherits neither the delivery nor the keys’ 400 ms', async () => {
    vi.useFakeTimers();
    const view = render(inArticle(reapply));
    focusOn(article());
    graceOver();
    view.rerender(inArticle({ ...reapply, requestId: 'req-next' } as RequestEvent));
    keyAt(article(), CMD_ENTER); // the next prompt has just appeared: its keys wait their own 400 ms
    await flush();
    expect(answers()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await flush();
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(inArticle({ ...reapply, requestId: 'req-third' } as RequestEvent));
    expect((screen.getByRole('button', { name: 'Allow once' }) as HTMLButtonElement).disabled).toBe(false); // the next one inherits no sent state
    expect((screen.getByRole('button', { name: 'Deny' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

// R2 (the waves plan's R2 rulings): the engine's dev-mods consent reaches MAWS as an ordinary AskUserQuestion permission
// request headed "Mods" (pass3/mods-consent seq 7, R0's question 5), so the question card already asks it.
describe('the dev-mods consent (R2, pass3/mods-consent)', () => {
  it('renders as a question card headed "Mods" with the engine’s three choices', () => {
    const consent = fixtureRequest('pass3', 'mods-consent', 7);
    expect(consent.kind).toBe('question.requested');
    mount(consent, 'docked');
    expect(screen.getByText('Mods')).toBeTruthy();
    expect(screen.getByText(/Enable hot reloading for this session\?/)).toBeTruthy();
    for (const choice of ['How does this work?', 'Enable for this session', 'Not now']) expect(screen.getByRole('radio', { name: choice })).toBeTruthy();
  });
});

// UX wave U1a §F (A12): a plan's primary button names the mode the session will be in after the allow, and, where the
// session is MAWS's own on this Mac and its engine host has this build's wire, a menu of the other modes an allow may
// name. Under a host of another build, or none, the card is today's: "Implement" with no menu, and no answer naming a
// mode ever leaves the window.
describe("a plan's next mode", () => {
  const otherWire = hostStatus({ supervisor: supervisorStatus({ wire: 'w-older' }), matches: 'wire' });
  const noHost = hostStatus({ state: 'starting', supervisor: null, matches: null });
  const inPlan = (appSessionId: typeof APP, prePlanMode: 'default' | 'acceptEdits' | 'auto' | null, machine = TEST_MACHINE) =>
    useSessions.getState().applyStatus({ appSessionId, status: { ...status(appSessionId), permissionMode: { requested: 'plan', effective: 'plan', refusal: null }, prePlanMode } }, machine);
  const caret = () => screen.queryByRole('button', { name: 'More implement options' });
  const entries = async () => (await screen.findAllByRole('menuitem')).map((entry) => entry.textContent);
  beforeEach(() => {
    useHosts.setState({ supervisor: hostStatus() });
    resetRemoteLaneBStore();
  });
  afterEach(() => useHosts.setState({ supervisor: null }));

  it('names the mode before Plan, and its press sends today’s answer', async () => {
    inPlan(APP, 'default');
    mount(plan, 'docked');
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Implement · Manual' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null }]));
  });

  it('a menu entry sends the mode it names; the menu never lists Plan or the button’s mode', async () => {
    inPlan(APP, 'default');
    mount(plan, 'docked');
    const user = userEvent.setup();
    await user.click(caret()!);
    expect(await entries()).toEqual(['Implement · Accept edits']);
    await user.click(screen.getByRole('menuitem', { name: 'Implement · Accept edits' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null, mode: 'acceptEdits' }]));
  });

  it('lists the modes in the mode menu’s order without the one on the button, and Enter sends the button’s answer', async () => {
    inPlan(APP, 'auto');
    mount(plan, 'docked');
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Implement · Auto' })).toBeTruthy();
    await user.click(caret()!);
    expect(await entries()).toEqual(['Implement · Manual', 'Implement · Accept edits']);
    await user.keyboard('{Escape}');
    focusOn(frame());
    await press('{Enter}');
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null }]));
  });

  it('with the mode before Plan unknown reads "Implement", sends no mode, and still lists every mode', async () => {
    inPlan(APP, null);
    mount(plan, 'card');
    const user = userEvent.setup();
    await user.click(caret()!);
    expect(await entries()).toEqual(['Implement · Manual', 'Implement · Accept edits']);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Implement' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null }]));
  });

  it.each([
    ['an engine host of another wire', otherWire],
    ['no engine host connected', noHost],
    ['no host status yet', null],
  ])('under %s is today’s card: "Implement", no menu, today’s answer', async (_name, supervisor) => {
    useHosts.setState({ supervisor });
    inPlan(APP, 'acceptEdits');
    mount(plan, 'docked');
    expect(caret()).toBeNull();
    expect(screen.queryByRole('button', { name: /^Implement · / })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Implement' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null }]));
  });

  it('an entry pressed after the host stopped applying a mode sends nothing, and the card is drawn again without the menu', async () => {
    inPlan(APP, 'default');
    mount(plan, 'docked');
    const user = userEvent.setup();
    await user.click(caret()!);
    const entry = await screen.findByRole('menuitem', { name: 'Implement · Accept edits' });
    // the status changes and the entry is pressed before the card is drawn again: its handler is the one drawn under the gate
    act(() => {
      useHosts.setState({ supervisor: otherWire });
      fireEvent.click(entry);
    });
    await flush();
    expect(answers()).toEqual([]);
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(caret()).toBeNull();
    expect(screen.getByRole('button', { name: 'Implement' })).toBeTruthy();
  });

  it('on a session another machine runs names the mode its status gives, offers no menu and sends no mode', async () => {
    const REMOTE = addressOf(OTHER_MACHINE, 'app-remote' as AppSessionId);
    applyRemoteSession(remoteSessionState(REMOTE));
    inPlan(REMOTE, 'acceptEdits', OTHER_MACHINE);
    render(
      <Pane>
        <Card event={plan} placement="card" item={itemFor(plan, REMOTE)} />
      </Pane>,
    );
    expect(caret()).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Implement · Accept edits' }));
    await waitFor(() => expect(answers()).toEqual([{ kind: 'plan', outcome: 'implement', feedback: null }]));
  });
});
